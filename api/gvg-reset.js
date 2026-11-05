/* global process */
import { createClient } from "@supabase/supabase-js";
import { cleanupDiscordReproRequestsForDefenseIds } from "../src/lib/discordReproServer.js";
import {
  applyPortalCorsHeaders,
  applyPortalSecurityHeaders,
  requirePortalAdminSession,
  sendPortalJson,
  verifyPortalRequestOrigin,
} from "./_portal-auth.js";
import { canUseRunTargetGuild, resolveRunScope } from "../src/lib/runScopeServer.js";
import { loadPortalGuildCatalog } from "./_portal-guild-catalog.js";
import { archiveEnemyDefensesBeforeGvgReset } from "./_gvg-enemy-defense-bank.js";
import { refreshEnemyDefenseStratAvailabilityForGuild } from "./gvg-enemy-defense-bank.js";
import { executeGvgReset, getPendingGvgReset, parseGvgResetInput } from "./_gvg-reset.js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function requestGvgVps(pathname, options = {}) {
  let base;
  let target;
  try {
    base = new URL(process.env.GVG_SERVER_URL || process.env.GVG_VPS_URL || "");
    target = new URL(pathname, base);
  } catch {
    // Invalid configuration must not fall back to a public HTTP endpoint.
  }
  if (base?.protocol !== "https:" || !target || target.origin !== base.origin
    || base.username || base.password || target.username || target.password) {
    throw Object.assign(new Error("Le reset GvG exige une URL VPS HTTPS configuree. Aucun reset lance."), { statusCode: 428 });
  }
  const token = process.env.GVG_API_TOKEN || process.env.GVG_SERVER_TOKEN || "";
  if (!token) throw Object.assign(new Error("GVG_API_TOKEN manquant cote serveur"), { statusCode: 500 });
  const response = await fetch(target, {
    method: options.method || "GET",
    redirect: "error",
    headers: { "X-GVG-Token": token, "Content-Type": "application/json" },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(data?.detail || data?.error || "Erreur VPS " + response.status), { statusCode: response.status });
  return data;
}

export function createGvgResetHandler(overrides = {}) {
  const deps = {
    db: supabase, requireSession: requirePortalAdminSession, resolveScope: resolveRunScope,
    loadCatalog: loadPortalGuildCatalog, execute: executeGvgReset,
    archiveEnemyDefenses: archiveEnemyDefensesBeforeGvgReset,
    refreshAvailability: refreshEnemyDefenseStratAvailabilityForGuild,
    async purgeDiscord(db, _guild, options) {
      const result = await cleanupDiscordReproRequestsForDefenseIds(db, options.defenseIds);
      return { ...result, scoped_cleanup_confirmed: result.enabled !== false
        && (result.items || []).every(item => !item.errors?.length) };
    },
    requestVps: requestGvgVps, getPending: getPendingGvgReset,
    ...overrides,
  };
  return async function handler(req, res) {
    applyPortalCorsHeaders(req, res);
    applyPortalSecurityHeaders(res);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") return res.status(200).end();
    if (!["GET", "POST"].includes(req.method)) return sendPortalJson(res, 405, { error: "method not allowed" }, req);
    if (!verifyPortalRequestOrigin(req)) return sendPortalJson(res, 403, { error: "origine invalide" }, req);
    try {
      const input = req.method === "GET"
        ? { guild: String(req.query?.guild || "").trim().toUpperCase().replace(/\s+/g, "_") }
        : parseGvgResetInput(req.body);
      const sessionCheck = await deps.requireSession(req, deps.db);
      if (sessionCheck.error) return sendPortalJson(res, sessionCheck.status || 401, { error: sessionCheck.error }, req);
      const actor = sessionCheck.member;
      const scope = await deps.resolveScope(deps.db, req, actor);
      const catalog = await deps.loadCatalog(deps.db, actor);
      const portalGuild = (catalog.guilds || []).find(row =>
        String(row.guild_code || "").trim().toUpperCase().replace(/\s+/g, "_") === input.guild
        && row.organization_id === catalog.organizationId);
      if (!scope.canUseGvg || !canUseRunTargetGuild(scope, input.guild) || !portalGuild) {
        return sendPortalJson(res, 403, { error: "Acces GvG refuse pour cette organisation." }, req);
      }
      if (req.method === "GET") {
        const operation = await deps.getPending({ db: deps.db, portalGuild, actor });
        return sendPortalJson(res, 200, { operation: operation ? {
          operationId: operation.operation_id, guild: operation.technical_guild,
          saveEnemyDefenses: operation.save_enemy_defenses, state: operation.state,
        } : null }, req);
      }
      const result = await deps.execute({
        db: deps.db, input, portalGuild, actor,
        archiveEnemyDefenses: deps.archiveEnemyDefenses,
        refreshAvailability: () => deps.refreshAvailability({ scope: { ...scope, organizationId: catalog.organizationId }, targetGuildCode: input.guild }),
        purgeDiscord: deps.purgeDiscord, requestVps: deps.requestVps,
      });
      return sendPortalJson(res, 200, result, req);
    } catch (error) {
      console.error("[gvg-reset]", error.code || "reset_failed", error.message);
      return sendPortalJson(res, error.statusCode || 500, {
        error: error.message || "Reset impossible.",
        reset_committed: error.resetCommitted === true,
        reset_state: error.resetState,
        operation_id: error.operationId || null,
      }, req);
    }
  };
}

export default createGvgResetHandler();
