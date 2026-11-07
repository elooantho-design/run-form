/* global process */
import { createClient } from "@supabase/supabase-js";
import { applyPortalCorsHeaders, applyPortalSecurityHeaders, requirePortalAdminSession, sendPortalJson, verifyPortalRequestOrigin } from "./_portal-auth.js";
import { canUseRunTargetGuild, getRunScopeForGvgGuild, resolveRunScope, stratMatchesRunScope } from "../src/lib/runScopeServer.js";
import { loadPortalGuildCatalog } from "./_portal-guild-catalog.js";
import { searchDefenceStrict } from "./gvg-strat-search.js";
import { allySignature, buildAllyFollowupPreview, buildAllyGroups, renderAllyFeedbackMessage, youtubeReference } from "../src/lib/gvgAllyFollowup.js";
import { allyDeliveryConfigured, attachAllyDeliveries, deliverAllyFeedback, sendAllyThreadMessage } from "./_gvg-ally-delivery.js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const failure = (message, statusCode) => Object.assign(new Error(message), { statusCode });

async function callRpc(db, name, args) {
  const { data, error } = await db.rpc(name, args);
  if (error) {
    if (["PGRST202", "42883", "42P01"].includes(error.code)) throw failure("Installation SQL des retours allies requise.", 428);
    throw failure(error.message || "Operation alliee impossible.", error.code === "42501" ? 403
      : ["40001", "55P03"].includes(error.code) ? 409 : error.code === "22023" ? 400 : 500);
  }
  return data;
}

export async function loadGvgAllyHistory(db, data, { search = searchDefenceStrict } = {}) {
  const result = [];
  const visited = new Set();
  const warnings = [];
  for (const defense of data.defenses || []) {
    if (!data.states?.some(state => state.defense_id === defense.id && state.opened)) continue;
    const signature = allySignature(defense);
    if (!signature || visited.has(signature)) continue;
    visited.add(signature);
    try {
      const scope = getRunScopeForGvgGuild(defense.guild);
      const searchOptions = { limit: 50, maxCandidates: 800,
        scope: { ...scope, isAdmin: false, isLeader: false }, targetGuildCode: defense.guild, mapType: defense.type };
      const runs = await search(db, defense.heroes, searchOptions);
      const compactHeroes = defense.heroes.map(hero => ({ ...hero,
        champion: String(hero.champion || hero.name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "") }));
      if (compactHeroes.some((hero, index) => hero.champion !== String(defense.heroes[index].champion || defense.heroes[index].name || "").trim().toLowerCase())) {
        runs.push(...await search(db, compactHeroes, searchOptions));
      }
      const ids = runs.filter(run => stratMatchesRunScope(run, scope)).map(run => run.strat_id);
      if (!ids.length) continue;
      const { data: metadata, error } = await db.from("defence_strat").select("id,def_key,name").in("id", ids);
      if (error) throw error;
      for (const run of runs) {
        if (!stratMatchesRunScope(run, scope) || !youtubeReference(run.youtube_url)) continue;
        const meta = metadata?.find(item => String(item.id) === String(run.strat_id));
        const key = String(meta?.def_key || "");
        const map = /_fort_team\d+$/.test(key) ? "fortress" : /_t[1-5]_team\d+$/.test(key) ? "tower" : null;
        if (!map || map !== defense.type || allySignature({ type: map, heroes: run.slots }) !== signature) continue;
        result.push({ signature, guild: defense.guild, youtube_url: run.youtube_url, created_at: run.created_at });
      }
    } catch {
      warnings.push("Recherche des anciennes videos indisponible pour une composition. Aucune video non verifiee retenue.");
    }
  }
  return { historicalRuns: result, history_warnings: warnings };
}

export function createGvgAllyFollowupHandler(overrides = {}) {
  const deps = { db: supabase, requireSession: requirePortalAdminSession, resolveScope: resolveRunScope,
    loadCatalog: loadPortalGuildCatalog, loadHistory: loadGvgAllyHistory,
    deliveryConfigured: allyDeliveryConfigured, send: sendAllyThreadMessage, ...overrides };
  return async function handler(req, res) {
    applyPortalCorsHeaders(req, res);
    applyPortalSecurityHeaders(res);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") return res.status(200).end();
    if (!["GET", "POST"].includes(req.method)) return sendPortalJson(res, 405, { error: "method not allowed" }, req);
    if (!verifyPortalRequestOrigin(req)) return sendPortalJson(res, 403, { error: "origine invalide" }, req);
    try {
      const body = req.body || {};
      const guild = String(req.method === "GET" ? req.query?.guild || "" : body.guild || "").trim().toUpperCase().replace(/\s+/g, "_");
      if (!/^[A-Z0-9_-]{2,24}$/.test(guild)) throw failure("Guilde invalide.", 400);
      const session = await deps.requireSession(req, deps.db);
      if (session.error) return sendPortalJson(res, session.status || 401, { error: session.error }, req);
      const scope = await deps.resolveScope(deps.db, req, session.member);
      const catalog = await deps.loadCatalog(deps.db, session.member);
      const portalGuild = (catalog.guilds || []).find(item => item.organization_id === catalog.organizationId
        && String(item.guild_code).trim().toUpperCase().replace(/\s+/g, "_") === guild);
      if (!scope.canUseGvg || !canUseRunTargetGuild(scope, guild) || !portalGuild) throw failure("Guilde hors perimetre autorise.", 403);
      const context = { p_portal_guild_id: portalGuild.id, p_actor_member_id: session.member.id };
      let data;
      try { data = await callRpc(deps.db, "read_gvg_ally_delivery", context); }
      catch (error) {
        if (error.statusCode !== 428 || body.action === "send") throw error;
        data = await callRpc(deps.db, "read_gvg_ally_followup", context);
      }
      if (req.method === "POST" && !["preview", "send"].includes(body.action)) {
        if (!["opened", "owner", "video"].includes(body.action) || !UUID.test(body.defense_id || "")
          || !Number.isSafeInteger(body.revision) || body.revision < 0 || !/^[0-9a-f]{32}$/.test(body.roster_version || "")) throw failure("Modification alliee invalide.", 400);
        const target = data.defenses.find(defense => defense.id === body.defense_id);
        if (!target) throw failure("Defense alliee hors guilde.", 403);
        let value;
        if (body.action === "opened") {
          if (typeof body.opened !== "boolean") throw failure("Statut ouvert booleen requis.", 400);
          value = { opened: body.opened };
        } else if (body.action === "owner") {
          if (!UUID.test(body.member_id || "")) throw failure("Joueur invalide.", 400);
          value = { member_id: body.member_id };
        } else {
          const source = body.video_defense_id == null ? null : data.defenses.find(defense => defense.id === body.video_defense_id);
          if (body.video_defense_id != null && (!source || !allySignature(target)
            || allySignature(source) !== allySignature(target) || !youtubeReference(source.youtube_url))) throw failure("Video hors groupe de defenses identiques.", 400);
          value = { video_defense_id: source?.id || null };
        }
        data = await callRpc(deps.db, "save_gvg_ally_followup", { ...context, p_defense_id: body.defense_id,
          p_action: body.action, p_value: value, p_expected_revision: body.revision, p_roster_version: body.roster_version });
        try { data = await callRpc(deps.db, "read_gvg_ally_delivery", context); }
        catch (error) { if (error.statusCode !== 428) throw error; }
      }
      const history = ["preview", "send"].includes(body.action) ? await deps.loadHistory(deps.db, data) : { historicalRuns: [], history_warnings: [] };
      let preview = buildAllyFollowupPreview({ ...data, historicalRuns: history.historicalRuns });
      if (["preview", "send"].includes(body.action)) {
        for (const row of preview.rows) if (row.opened) row.message = renderAllyFeedbackMessage(row);
      }
      preview = attachAllyDeliveries(preview, data.deliveries);
      const enabled = data.delivery_enabled === true && data.delivery_version === 1 && deps.deliveryConfigured();
      let deliveryResult;
      if (req.method === "POST" && body.action === "send") {
        if (!enabled) throw failure("Envois allies non actives ou bot non configure.", 428);
        if (body.confirm !== true || !UUID.test(body.defense_id || "")) throw failure("Confirmation d'envoi requise.", 400);
        const row = preview.rows.find(item => item.defense_id === body.defense_id);
        if (!row || body.snapshot_version !== data.snapshot_version || body.message_version !== row.message_version) {
          throw failure("Les retours ont change. Actualisez avant envoi.", 409);
        }
        deliveryResult = await deliverAllyFeedback({ db: deps.db, context, data, row, rpc: callRpc, send: deps.send });
        data = await callRpc(deps.db, "read_gvg_ally_delivery", context);
        preview = attachAllyDeliveries(buildAllyFollowupPreview({ ...data, historicalRuns: history.historicalRuns }), data.deliveries);
      }
      return sendPortalJson(res, 200, { ...data, guild, ally_groups: buildAllyGroups(data.defenses), preview,
        history_warnings: history.history_warnings, mode: enabled ? "manual_delivery" : "preview_only",
        delivery_enabled: enabled, sent: preview.sent, ...(deliveryResult ? { delivery_result: deliveryResult } : {}) }, req);
    } catch (error) {
      return sendPortalJson(res, error.statusCode || 500, { error: error.message || "Operation impossible." }, req);
    }
  };
}

export default createGvgAllyFollowupHandler();
