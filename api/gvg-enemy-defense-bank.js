/* global process */
import { createClient } from "@supabase/supabase-js";
import {
  applyPortalCorsHeaders,
  applyPortalSecurityHeaders,
  requirePortalAdminSession,
  sendPortalJson,
  verifyPortalRequestOrigin,
} from "./_portal-auth.js";
import {
  canUseRunTargetGuild,
  resolveRunScope,
} from "../src/lib/runScopeServer.js";
import { searchDefenceStrict } from "./gvg-strat-search.js";
import {
  GVG_ENEMY_DEFENSE_BANK_MESSAGE,
  buildEnemyDefenseCanonicalDefinition,
  getEnemyDefenseSuccessRate,
  getEnemyDefenseRateTone,
  isEnemyDefenseBankSchemaMissing,
  normalizeGvgMapType,
  resolvePortalGuildForGvgGuild,
  sortEnemyDefenseBankRows,
} from "./_gvg-enemy-defense-bank.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

function normalizeGuild(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "_");
}

function mapCanonicalDefenseRow(row) {
  const definition = row?.canonical_definition || {};
  const heroes = Array.isArray(definition.heroes) ? definition.heroes : [];

  return {
    id: row.id,
    defenseFingerprint: row.defense_fingerprint,
    defense_fingerprint: row.defense_fingerprint,
    mapType: row.map_type || definition.map_type || "tower",
    map_type: row.map_type || definition.map_type || "tower",
    heroes,
    heroesCount: row.heroes_count ?? heroes.length,
    imageUrl: row.image_url || "",
    image_url: row.image_url || "",
    canonicalDefinition: definition,
    canonical_definition: definition,
  };
}

function mapStatsRow(row, defense, crossGuildStats = []) {
  const encounters = Number(row.encounters) || 0;
  const opened = Number(row.opened) || 0;
  const successRate = getEnemyDefenseSuccessRate(opened, encounters);

  return {
    ...defense,
    statsId: row.id,
    stats_id: row.id,
    organizationId: row.organization_id,
    organization_id: row.organization_id,
    portalGuildId: row.portal_guild_id,
    portal_guild_id: row.portal_guild_id,
    encounters,
    opened,
    successRate,
    success_rate: successRate,
    rateTone: getEnemyDefenseRateTone(successRate),
    rate_tone: getEnemyDefenseRateTone(successRate),
    firstSeenAt: row.first_seen_at || null,
    first_seen_at: row.first_seen_at || null,
    lastSeenAt: row.last_seen_at || null,
    last_seen_at: row.last_seen_at || null,
    crossGuildStats,
  };
}

function mapCrossGuildStats(rows = [], guildsById = new Map()) {
  return rows
    .map((row) => {
      const encounters = Number(row.encounters) || 0;
      const opened = Number(row.opened) || 0;
      const successRate = getEnemyDefenseSuccessRate(opened, encounters);
      const guild = guildsById.get(String(row.portal_guild_id));

      return {
        guildCode: guild?.guild_code || "",
        guild_code: guild?.guild_code || "",
        displayName: guild?.display_name || guild?.guild_code || "",
        display_name: guild?.display_name || guild?.guild_code || "",
        portalGuildId: row.portal_guild_id,
        portal_guild_id: row.portal_guild_id,
        encounters,
        opened,
        successRate,
        success_rate: successRate,
        rateTone: getEnemyDefenseRateTone(successRate),
        rate_tone: getEnemyDefenseRateTone(successRate),
        lastSeenAt: row.last_seen_at || null,
        last_seen_at: row.last_seen_at || null,
      };
    })
    .filter((row) => row.guildCode);
}

async function loadBankItems(req, res, sessionMember) {
  const guild = normalizeGuild(req.query?.guild || req.body?.guild || req.body?.guildCode);
  const runScope = await resolveRunScope(supabase, req, sessionMember);

  if (!runScope.canUseGvg || !canUseRunTargetGuild(runScope, guild)) {
    return sendPortalJson(res, 403, { error: "acces gvg refuse" }, req);
  }

  const portalGuild = await resolvePortalGuildForGvgGuild(supabase, guild);

  const { data: statsRows, error: statsError } = await supabase
    .from("gvg_enemy_defense_guild_stats")
    .select("id, enemy_defense_id, organization_id, portal_guild_id, encounters, opened, first_seen_at, last_seen_at, updated_at")
    .eq("portal_guild_id", portalGuild.id)
    .order("updated_at", { ascending: false })
    .limit(300);

  if (statsError) {
    if (isEnemyDefenseBankSchemaMissing(statsError)) {
      return sendPortalJson(res, 200, {
        ok: true,
        initialized: false,
        migrationRequired: true,
        migrationMessage: GVG_ENEMY_DEFENSE_BANK_MESSAGE,
        guild: portalGuild.guild_code,
        items: [],
      }, req);
    }
    throw statsError;
  }

  const defenseIds = [...new Set((statsRows || []).map((row) => row.enemy_defense_id).filter(Boolean))];
  if (!defenseIds.length) {
    return sendPortalJson(res, 200, {
      ok: true,
      initialized: true,
      guild: portalGuild.guild_code,
      items: [],
      guilds: [portalGuild],
    }, req);
  }

  const [{ data: defenseRows, error: defenseError }, { data: orgStatsRows, error: orgStatsError }, { data: guildRows, error: guildRowsError }] =
    await Promise.all([
      supabase
        .from("gvg_enemy_defenses")
        .select("id, defense_fingerprint, canonical_definition, map_type, heroes_count, image_url, image_storage_path, created_at, updated_at")
        .in("id", defenseIds),
      supabase
        .from("gvg_enemy_defense_guild_stats")
        .select("enemy_defense_id, organization_id, portal_guild_id, encounters, opened, first_seen_at, last_seen_at")
        .eq("organization_id", portalGuild.organization_id)
        .in("enemy_defense_id", defenseIds),
      supabase
        .from("portal_guilds")
        .select("id, guild_code, display_name, organization_id, is_active")
        .eq("organization_id", portalGuild.organization_id)
        .eq("is_active", true),
    ]);

  if (defenseError) throw defenseError;
  if (orgStatsError) throw orgStatsError;
  if (guildRowsError) throw guildRowsError;

  const defensesById = new Map((defenseRows || []).map((row) => [String(row.id), mapCanonicalDefenseRow(row)]));
  const guildsById = new Map((guildRows || []).map((row) => [String(row.id), row]));
  const orgStatsByDefenseId = new Map();

  for (const row of orgStatsRows || []) {
    const defenseId = String(row.enemy_defense_id || "");
    if (!orgStatsByDefenseId.has(defenseId)) orgStatsByDefenseId.set(defenseId, []);
    orgStatsByDefenseId.get(defenseId).push(row);
  }

  const items = sortEnemyDefenseBankRows(
    (statsRows || [])
      .map((row) => {
        const defense = defensesById.get(String(row.enemy_defense_id));
        if (!defense) return null;

        const crossGuildStats = mapCrossGuildStats(
          (orgStatsByDefenseId.get(String(row.enemy_defense_id)) || []).filter(
            (crossRow) => String(crossRow.portal_guild_id) !== String(portalGuild.id),
          ),
          guildsById,
        );

        return mapStatsRow(row, defense, crossGuildStats);
      })
      .filter(Boolean),
  );

  return sendPortalJson(res, 200, {
    ok: true,
    initialized: true,
    guild: portalGuild.guild_code,
    portalGuild,
    guilds: guildRows || [],
    items,
  }, req);
}

async function loadStrats(req, res, sessionMember) {
  const guild = normalizeGuild(req.query?.guild || req.body?.guild || req.body?.guildCode);
  const defenseId = String(req.query?.defenseId || req.body?.defenseId || "").trim();
  if (!defenseId) return sendPortalJson(res, 400, { error: "defenseId manquant" }, req);

  const runScope = await resolveRunScope(supabase, req, sessionMember);
  if (!runScope.canUseGvg || !runScope.canSearchRuns || !canUseRunTargetGuild(runScope, guild)) {
    return sendPortalJson(res, 403, { error: "acces gvg refuse" }, req);
  }

  const portalGuild = await resolvePortalGuildForGvgGuild(supabase, guild);

  const { data: statRow, error: statError } = await supabase
    .from("gvg_enemy_defense_guild_stats")
    .select("enemy_defense_id, portal_guild_id")
    .eq("portal_guild_id", portalGuild.id)
    .eq("enemy_defense_id", defenseId)
    .maybeSingle();

  if (statError) {
    if (isEnemyDefenseBankSchemaMissing(statError)) {
      return sendPortalJson(res, 428, { error: GVG_ENEMY_DEFENSE_BANK_MESSAGE }, req);
    }
    throw statError;
  }
  if (!statRow) return sendPortalJson(res, 404, { error: "Defense adverse introuvable pour cette guilde." }, req);

  const { data: defense, error: defenseError } = await supabase
    .from("gvg_enemy_defenses")
    .select("id, canonical_definition, map_type")
    .eq("id", defenseId)
    .maybeSingle();

  if (defenseError) throw defenseError;
  if (!defense) return sendPortalJson(res, 404, { error: "Defense adverse introuvable." }, req);

  const canonicalDefinition = buildEnemyDefenseCanonicalDefinition({
    type: defense.map_type,
    heroes: defense.canonical_definition?.heroes || [],
  }) || defense.canonical_definition;

  const queryItems = (canonicalDefinition?.heroes || []).map((hero) => ({
    champion: hero.champion,
    position: hero.position,
    direction: hero.direction,
  }));

  const items = await searchDefenceStrict(supabase, queryItems, {
    limit: 10,
    scope: runScope,
    targetGuildCode: guild,
    mapType: normalizeGvgMapType(defense.map_type || canonicalDefinition?.map_type),
  });

  return sendPortalJson(res, 200, {
    ok: true,
    success: true,
    items,
  }, req);
}

export default async function handler(req, res) {
  applyPortalCorsHeaders(req, res);
  applyPortalSecurityHeaders(res);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (!verifyPortalRequestOrigin(req)) return sendPortalJson(res, 403, { error: "origine invalide" }, req);
  if (!["GET", "POST"].includes(req.method)) {
    return sendPortalJson(res, 405, { error: "method not allowed" }, req);
  }

  try {
    const sessionCheck = await requirePortalAdminSession(req, supabase);
    if (sessionCheck.error) {
      return sendPortalJson(res, sessionCheck.status || 401, { error: sessionCheck.error }, req);
    }

    const action = String(req.query?.action || req.body?.action || "list").trim();
    if (action === "strats") return await loadStrats(req, res, sessionCheck.member);
    return await loadBankItems(req, res, sessionCheck.member);
  } catch (error) {
    if (isEnemyDefenseBankSchemaMissing(error)) {
      return sendPortalJson(res, error?.statusCode || 428, { error: GVG_ENEMY_DEFENSE_BANK_MESSAGE }, req);
    }

    console.error("[gvg-enemy-defense-bank]", error);
    return sendPortalJson(res, error?.statusCode || 500, { error: error?.message || "Erreur banque defenses adverses." }, req);
  }
}
