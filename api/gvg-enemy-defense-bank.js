/* global process */
import { createClient } from "@supabase/supabase-js";
import {
  applyPortalCorsHeaders,
  applyPortalSecurityHeaders,
  requirePortalAdminSession,
  sendPortalJson,
  validatePortalInput,
  verifyPortalRequestOrigin,
} from "./_portal-auth.js";
import {
  canUseRunTargetGuild,
  getRunScopeForGvgGuild,
  isMissingGuildCodeColumn,
  isMissingRunBoycottTable,
  resolveRunScope,
  stratMatchesRunReadScope,
} from "../src/lib/runScopeServer.js";
import { searchDefenceStrict } from "./gvg-strat-search.js";
import {
  GVG_ENEMY_DEFENSE_BANK_MESSAGE,
  buildEnemyDefenseCanonicalDefinition,
  createEnemyDefenseSimilaritySignature,
  createLocalDefenseSimilaritySignature,
  detectEnemyDefenseSimilaritiesForArchive,
  getEnemyDefenseHeroLayoutByChampion,
  getEnemyDefenseRateTone,
  getEnemyDefenseSuccessRate,
  isEnemyDefenseBankSchemaMissing,
  isEnemyDefenseLinksSchemaMissing,
  normalizeGvgChampionName,
  normalizeGvgDirection,
  normalizeGvgMapType,
  normalizeGvgPosition,
  resolvePortalGuildForGvgGuild,
  sortEnemyDefenseBankRows,
} from "./_gvg-enemy-defense-bank.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const STRAT_AVAILABILITY_LIMIT = 50000;
const LOCAL_DEFENSE_SELECT_WITH_LINKS = `
  id,
  name,
  tier,
  type,
  faction,
  guild_code,
  is_global,
  is_hidden,
  organization_id,
  image_url,
  source_enemy_defense_id,
  source_enemy_defense_fingerprint,
  source_enemy_portal_guild_id,
  source_enemy_label,
  source_enemy_imported_at,
  guild_defense_slots (
    slot_index,
    champion_id,
    position,
    direction,
    champions (
      id,
      name,
      portal_name,
      english_name
    )
  ),
  guild_defense_conditions (
    id,
    champion_id,
    min_awakening,
    champions (
      id,
      name,
      portal_name,
      english_name
    )
  )
`;
const LOCAL_DEFENSE_SELECT_FALLBACK = `
  id,
  name,
  tier,
  type,
  faction,
  guild_code,
  is_global,
  is_hidden,
  organization_id,
  image_url,
  guild_defense_slots (
    slot_index,
    champion_id,
    champions (
      id,
      name,
      portal_name,
      english_name
    )
  ),
  guild_defense_conditions (
    id,
    champion_id,
    min_awakening,
    champions (
      id,
      name,
      portal_name,
      english_name
    )
  )
`;

function normalizeGuild(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "_");
}

function readChampionNameFromSlot(slot) {
  return slot?.champions?.name || slot?.champions?.portal_name || slot?.champions?.english_name || "";
}

function mapCanonicalDefenseRow(row) {
  const definition = row?.canonical_definition || {};
  const heroes = Array.isArray(definition.heroes) ? definition.heroes : [];
  const similaritySignature = createEnemyDefenseSimilaritySignature(row);

  return {
    id: row.id,
    defenseFingerprint: row.defense_fingerprint,
    defense_fingerprint: row.defense_fingerprint,
    similaritySignature,
    similarity_signature: similaritySignature,
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

function mapLocalCondition(condition) {
  const heroName = condition?.champions?.name || condition?.champions?.portal_name || "Hero";
  return {
    id: condition.id,
    championId: condition.champion_id,
    champion_id: condition.champion_id,
    minAwakening: condition.min_awakening,
    min_awakening: condition.min_awakening,
    label: `${heroName} A${condition.min_awakening} minimum`,
  };
}

function mapLocalDefenseRow(row, review = null) {
  const detailedSlots = [...(row?.guild_defense_slots || [])]
    .sort((left, right) => (left.slot_index ?? 0) - (right.slot_index ?? 0))
    .map((slot) => ({
      slotIndex: slot.slot_index ?? null,
      slot_index: slot.slot_index ?? null,
      championId: slot.champion_id || null,
      champion_id: slot.champion_id || null,
      champion: readChampionNameFromSlot(slot),
      position: slot.position || null,
      direction: slot.direction || null,
    }));

  return {
    id: row.id,
    name: row.name || "",
    tier: row.tier || "meta_s",
    type: row.type || "Tour",
    faction: row.faction || "",
    guildCode: row.guild_code || "",
    guild_code: row.guild_code || "",
    organizationId: row.organization_id || "",
    organization_id: row.organization_id || "",
    isHidden: Boolean(row.is_hidden),
    is_hidden: Boolean(row.is_hidden),
    imageUrl: row.image_url || "",
    image_url: row.image_url || "",
    sourceEnemyDefenseId: row.source_enemy_defense_id || null,
    source_enemy_defense_id: row.source_enemy_defense_id || null,
    sourceEnemyDefenseFingerprint: row.source_enemy_defense_fingerprint || "",
    source_enemy_defense_fingerprint: row.source_enemy_defense_fingerprint || "",
    sourceEnemyPortalGuildId: row.source_enemy_portal_guild_id || null,
    source_enemy_portal_guild_id: row.source_enemy_portal_guild_id || null,
    sourceEnemyLabel: row.source_enemy_label || "",
    source_enemy_label: row.source_enemy_label || "",
    sourceEnemyImportedAt: row.source_enemy_imported_at || null,
    source_enemy_imported_at: row.source_enemy_imported_at || null,
    slots: detailedSlots.map((slot) => slot.champion).filter(Boolean),
    detailedSlots,
    detailed_slots: detailedSlots,
    conditions: (row.guild_defense_conditions || []).map(mapLocalCondition),
    similaritySignature: createLocalDefenseSimilaritySignature(row),
    similarity_signature: createLocalDefenseSimilaritySignature(row),
    reviewId: review?.id || null,
    review_id: review?.id || null,
    reviewStatus: review?.status || null,
    review_status: review?.status || null,
    reviewedByName: review?.reviewed_by_name || "",
    reviewed_by_name: review?.reviewed_by_name || "",
    reviewedAt: review?.reviewed_at || null,
    reviewed_at: review?.reviewed_at || null,
  };
}

function requireLinksMigration(message = "Migration liaisons defenses adverses requise.") {
  const error = new Error(message);
  error.statusCode = 428;
  throw error;
}

async function loadLocalDefenseRowsByIds(defenseIds = [], { requireLinksSchema = false } = {}) {
  const ids = [...new Set(defenseIds.map(String).filter(Boolean))];
  if (!ids.length) return { rows: [], linksSchemaReady: true };

  const { data, error } = await supabase
    .from("guild_defenses")
    .select(LOCAL_DEFENSE_SELECT_WITH_LINKS)
    .in("id", ids);

  if (!error) return { rows: data || [], linksSchemaReady: true };
  if (requireLinksSchema || !isEnemyDefenseLinksSchemaMissing(error)) throw error;

  const fallback = await supabase
    .from("guild_defenses")
    .select(LOCAL_DEFENSE_SELECT_FALLBACK)
    .in("id", ids);

  if (fallback.error) throw fallback.error;
  return { rows: fallback.data || [], linksSchemaReady: false };
}

async function loadEnemyDefenseInOrganization(defenseId, organizationId) {
  const { data: statRow, error: statError } = await supabase
    .from("gvg_enemy_defense_guild_stats")
    .select("enemy_defense_id")
    .eq("organization_id", organizationId)
    .eq("enemy_defense_id", defenseId)
    .limit(1)
    .maybeSingle();

  if (statError) throw statError;
  if (!statRow) {
    const error = new Error("Defense adverse introuvable dans cette organisation.");
    error.statusCode = 404;
    throw error;
  }

  const { data: defense, error: defenseError } = await supabase
    .from("gvg_enemy_defenses")
    .select("id, defense_fingerprint, canonical_definition, map_type, heroes_count, image_url, image_storage_path, created_at, updated_at")
    .eq("id", defenseId)
    .maybeSingle();

  if (defenseError) throw defenseError;
  if (!defense) {
    const error = new Error("Defense adverse introuvable.");
    error.statusCode = 404;
    throw error;
  }

  return defense;
}

async function resolveBankScope(req, sessionMember, { requireSearch = false } = {}) {
  const guild = normalizeGuild(req.query?.guild || req.body?.guild || req.body?.guildCode);
  const runScope = await resolveRunScope(supabase, req, sessionMember);

  if (!runScope.canUseGvg || (requireSearch && !runScope.canSearchRuns) || !canUseRunTargetGuild(runScope, guild)) {
    const error = new Error("acces gvg refuse");
    error.statusCode = 403;
    throw error;
  }

  const portalGuild = await resolvePortalGuildForGvgGuild(supabase, guild);
  return { guild, runScope, portalGuild };
}

async function loadEnemyDefenseLinkSummaries(defenseIds = [], organizationId) {
  if (!defenseIds.length) return { initialized: true, byDefenseId: new Map() };

  const { data: reviewRows, error } = await supabase
    .from("gvg_enemy_defense_similarity_reviews")
    .select("id, enemy_defense_id, local_defense_id, local_portal_guild_id, local_guild_code, status, reviewed_by_name, reviewed_at, local_identity_signature")
    .eq("organization_id", organizationId)
    .in("enemy_defense_id", defenseIds)
    .in("status", ["pending", "identical"]);

  if (error) {
    if (isEnemyDefenseLinksSchemaMissing(error)) return { initialized: false, byDefenseId: new Map() };
    throw error;
  }

  const localIds = [...new Set((reviewRows || []).map((row) => row.local_defense_id).filter(Boolean))];
  const { rows: localRows } = await loadLocalDefenseRowsByIds(localIds);
  const localRowsById = new Map((localRows || []).map((row) => [String(row.id), row]));
  const byDefenseId = new Map();

  for (const review of reviewRows || []) {
    const localRow = localRowsById.get(String(review.local_defense_id));
    if (!localRow || localRow.is_hidden) continue;

    const defenseId = String(review.enemy_defense_id);
    if (!byDefenseId.has(defenseId)) {
      byDefenseId.set(defenseId, { pendingCount: 0, linkedLocalDefenses: [] });
    }

    const summary = byDefenseId.get(defenseId);
    if (review.status === "pending") summary.pendingCount += 1;
    if (review.status === "identical") summary.linkedLocalDefenses.push(mapLocalDefenseRow(localRow, review));
  }

  return { initialized: true, byDefenseId };
}

function buildEnemyDefenseQueryItems(defense) {
  const definition = defense?.canonical_definition || defense?.canonicalDefinition || buildEnemyDefenseCanonicalDefinition(defense);
  const mapType = normalizeGvgMapType(defense?.map_type || defense?.mapType || definition?.map_type);

  return (definition?.heroes || [])
    .map((hero) => ({
      champion: normalizeGvgChampionName(hero?.champion),
      position: normalizeGvgPosition(hero?.position, mapType),
      direction: normalizeGvgDirection(hero?.direction),
      mapType,
    }))
    .filter((hero) => hero.champion);
}

function slotMatchesEnemyQuery(slot, query) {
  if (normalizeGvgChampionName(slot?.champion) !== query.champion) return false;
  if (query.position && normalizeGvgPosition(slot?.position, query.mapType) !== query.position) return false;
  if (query.direction && normalizeGvgDirection(slot?.direction) !== query.direction) return false;
  return true;
}

function stratMatchesEnemyQueries(stratSlots = [], queryItems = []) {
  return queryItems.every((query) => stratSlots.some((slot) => slotMatchesEnemyQuery(slot, query)));
}

async function loadCandidateStratIdsByChampions(champions = []) {
  const uniqueChampions = [...new Set(champions.map(normalizeGvgChampionName).filter(Boolean))];
  if (!uniqueChampions.length) return [];

  const orFilter = uniqueChampions.map((champion) => `champion.eq.${champion}`).join(",");
  const { data, error } = await supabase
    .from("defence_slot")
    .select("strat_id, champion")
    .or(orFilter);

  if (error) throw error;

  const hitMap = new Map();
  for (const row of data || []) {
    const stratId = row.strat_id;
    const champion = normalizeGvgChampionName(row.champion);
    if (!hitMap.has(stratId)) hitMap.set(stratId, new Set());
    hitMap.get(stratId).add(champion);
  }

  return [...hitMap.entries()]
    .map(([stratId, hitSet]) => ({ stratId, hits: hitSet.size }))
    .sort((left, right) => right.hits - left.hits)
    .slice(0, STRAT_AVAILABILITY_LIMIT)
    .map((entry) => entry.stratId);
}

async function loadStratRowsByIds(stratIds = [], scope) {
  if (!stratIds.length) return [];

  let { data, error } = await supabase
    .from("defence_strat")
    .select("id, commentaire, youtube_url, created_at, attack_code, guild_code")
    .in("id", stratIds);

  if (error) {
    if (!isMissingGuildCodeColumn(error)) throw error;
    if (!scope?.isPaladin) throw error;

    const fallback = await supabase
      .from("defence_strat")
      .select("id, commentaire, youtube_url, created_at, attack_code")
      .in("id", stratIds);

    if (fallback.error) throw fallback.error;
    data = (fallback.data || []).map((strat) => ({ ...strat, guild_code: null }));
  }

  return (data || []).filter((strat) => stratMatchesRunReadScope(strat, scope));
}

async function loadBoycottedStratIds(stratIds = [], targetGuildCode = "") {
  if (!stratIds.length || !targetGuildCode) return new Set();

  const { data, error } = await supabase
    .from("defence_strat_boycotts")
    .select("strat_id")
    .eq("guild_code", targetGuildCode)
    .in("strat_id", stratIds);

  if (error) {
    if (isMissingRunBoycottTable(error)) return new Set();
    throw error;
  }

  return new Set((data || []).map((row) => String(row.strat_id)));
}

async function loadStratSlotsByIds(stratIds = []) {
  if (!stratIds.length) return new Map();

  const { data, error } = await supabase
    .from("defence_slot")
    .select("strat_id, champion, position, direction")
    .in("strat_id", stratIds);

  if (error) throw error;

  const slotsByStratId = new Map();
  for (const slot of data || []) {
    const stratId = String(slot.strat_id);
    if (!slotsByStratId.has(stratId)) slotsByStratId.set(stratId, []);
    slotsByStratId.get(stratId).push(slot);
  }

  return slotsByStratId;
}

async function loadStratAvailabilityCounts(defenseRows = [], { scope, targetGuildCode, portalGuild } = {}) {
  const queryItemsByDefenseId = new Map();
  const allChampions = [];

  for (const defense of defenseRows || []) {
    const queryItems = buildEnemyDefenseQueryItems(defense);
    if (!queryItems.length) continue;
    queryItemsByDefenseId.set(String(defense.id), queryItems);
    allChampions.push(...queryItems.map((item) => item.champion));
  }

  if (!queryItemsByDefenseId.size) return new Map();

  const candidateIds = await loadCandidateStratIdsByChampions(allChampions);
  const strats = await loadStratRowsByIds(candidateIds, scope);
  const scopedStratIds = strats.map((strat) => strat.id).filter(Boolean);
  const boycottedIds = await loadBoycottedStratIds(scopedStratIds, targetGuildCode);
  const activeStratIds = scopedStratIds.filter((stratId) => !boycottedIds.has(String(stratId)));
  const slotsByStratId = await loadStratSlotsByIds(activeStratIds);
  const countsByDefenseId = new Map();

  for (const [defenseId, queryItems] of queryItemsByDefenseId) {
    let count = 0;
    for (const stratId of activeStratIds) {
      if (stratMatchesEnemyQueries(slotsByStratId.get(String(stratId)) || [], queryItems)) count += 1;
    }
    countsByDefenseId.set(defenseId, count);
  }

  if (portalGuild?.id) {
    const rows = [...countsByDefenseId.entries()].map(([enemyDefenseId, count]) => ({
      enemy_defense_id: enemyDefenseId,
      organization_id: portalGuild.organization_id,
      portal_guild_id: portalGuild.id,
      guild_code: portalGuild.guild_code,
      available_strat_count: count,
      checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from("gvg_enemy_defense_strat_availability")
      .upsert(rows, { onConflict: "enemy_defense_id,portal_guild_id" });

    if (error && !isEnemyDefenseLinksSchemaMissing(error)) {
      console.warn("[gvg-enemy-defense-bank] availability cache update skipped:", error.message);
    }
  }

  return countsByDefenseId;
}

export async function refreshEnemyDefenseStratAvailabilityForGuild({ scope, targetGuildCode } = {}) {
  const guildCode = normalizeGuild(targetGuildCode || scope?.guildCode);
  if (!guildCode) return { ok: true, skipped: true, reason: "missing_guild" };

  const portalGuild = await resolvePortalGuildForGvgGuild(supabase, guildCode);
  if (scope && !canUseRunTargetGuild(scope, portalGuild.guild_code)) {
    return { ok: true, skipped: true, reason: "guild_out_of_scope" };
  }

  const { data: statsRows, error: statsError } = await supabase
    .from("gvg_enemy_defense_guild_stats")
    .select("enemy_defense_id")
    .eq("organization_id", portalGuild.organization_id)
    .eq("portal_guild_id", portalGuild.id);

  if (statsError) {
    if (isEnemyDefenseBankSchemaMissing(statsError) || isEnemyDefenseLinksSchemaMissing(statsError)) {
      return { ok: true, skipped: true, reason: "enemy_bank_schema_missing" };
    }
    throw statsError;
  }

  const defenseIds = [...new Set((statsRows || []).map((row) => row.enemy_defense_id).filter(Boolean))];
  if (!defenseIds.length) return { ok: true, refreshed: 0 };

  const { data: defenseRows, error: defenseError } = await supabase
    .from("gvg_enemy_defenses")
    .select("id, defense_fingerprint, canonical_definition, map_type, heroes_count, image_url, image_storage_path, created_at, updated_at")
    .in("id", defenseIds);

  if (defenseError) {
    if (isEnemyDefenseBankSchemaMissing(defenseError)) {
      return { ok: true, skipped: true, reason: "enemy_bank_schema_missing" };
    }
    throw defenseError;
  }

  const targetScope = getRunScopeForGvgGuild(portalGuild.guild_code);
  const counts = await loadStratAvailabilityCounts(defenseRows || [], {
    scope: targetScope,
    targetGuildCode: guildCode,
    portalGuild,
  });

  return {
    ok: true,
    refreshed: counts.size,
    guildCode: portalGuild.guild_code,
    guild_code: portalGuild.guild_code,
  };
}

async function loadBankItems(req, res, sessionMember) {
  const { guild, runScope, portalGuild } = await resolveBankScope(req, sessionMember);

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
      linksInitialized: true,
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

  const [linkSummaries, stratCounts] = await Promise.all([
    loadEnemyDefenseLinkSummaries(defenseIds, portalGuild.organization_id),
    loadStratAvailabilityCounts(defenseRows || [], { scope: runScope, targetGuildCode: guild, portalGuild }),
  ]);

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
        const linkedSummary = linkSummaries.byDefenseId.get(String(row.enemy_defense_id)) || {};
        const stratCount = stratCounts.get(String(row.enemy_defense_id)) || 0;

        return {
          ...mapStatsRow(row, defense, crossGuildStats),
          linksInitialized: linkSummaries.initialized,
          links_initialized: linkSummaries.initialized,
          similarityPendingCount: linkedSummary.pendingCount || 0,
          similarity_pending_count: linkedSummary.pendingCount || 0,
          linkedLocalDefenses: linkedSummary.linkedLocalDefenses || [],
          linked_local_defenses: linkedSummary.linkedLocalDefenses || [],
          stratCount,
          strat_count: stratCount,
          hasAvailableStrat: stratCount > 0,
          has_available_strat: stratCount > 0,
        };
      })
      .filter(Boolean),
  );

  return sendPortalJson(res, 200, {
    ok: true,
    initialized: true,
    linksInitialized: linkSummaries.initialized,
    links_initialized: linkSummaries.initialized,
    guild: portalGuild.guild_code,
    portalGuild,
    guilds: guildRows || [],
    items,
  }, req);
}

async function loadStrats(req, res, sessionMember) {
  const { guild, portalGuild } = await resolveBankScope(req, sessionMember, { requireSearch: true });
  const defenseId = String(req.query?.defenseId || req.body?.defenseId || "").trim();
  if (!defenseId) return sendPortalJson(res, 400, { error: "defenseId manquant" }, req);

  const defense = await loadEnemyDefenseInOrganization(defenseId, portalGuild.organization_id);
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
    scope: getRunScopeForGvgGuild(guild),
    targetGuildCode: guild,
    mapType: normalizeGvgMapType(defense.map_type || canonicalDefinition?.map_type),
  });

  return sendPortalJson(res, 200, {
    ok: true,
    success: true,
    items,
  }, req);
}

async function loadSimilarities(req, res, sessionMember) {
  const { portalGuild } = await resolveBankScope(req, sessionMember);
  const defenseId = String(req.query?.defenseId || req.body?.defenseId || "").trim();
  if (!defenseId) return sendPortalJson(res, 400, { error: "defenseId manquant" }, req);

  const enemyDefense = await loadEnemyDefenseInOrganization(defenseId, portalGuild.organization_id);

  const { data: reviewRows, error: reviewError } = await supabase
    .from("gvg_enemy_defense_similarity_reviews")
    .select("id, enemy_defense_id, local_defense_id, local_portal_guild_id, local_guild_code, status, reviewed_by_name, reviewed_at, created_at")
    .eq("organization_id", portalGuild.organization_id)
    .eq("enemy_defense_id", defenseId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (reviewError) {
    if (isEnemyDefenseLinksSchemaMissing(reviewError)) requireLinksMigration();
    throw reviewError;
  }

  const { rows: localRows } = await loadLocalDefenseRowsByIds((reviewRows || []).map((row) => row.local_defense_id), {
    requireLinksSchema: true,
  });
  const localRowsById = new Map(localRows.map((row) => [String(row.id), row]));
  const candidates = (reviewRows || [])
    .map((review) => {
      const localRow = localRowsById.get(String(review.local_defense_id));
      if (!localRow || localRow.is_hidden) return null;
      return {
        review,
        localDefense: mapLocalDefenseRow(localRow, review),
      };
    })
    .filter(Boolean);

  return sendPortalJson(res, 200, {
    ok: true,
    enemyDefense: mapCanonicalDefenseRow(enemyDefense),
    enemy_defense: mapCanonicalDefenseRow(enemyDefense),
    candidates,
  }, req);
}

async function enrichLocalDefenseFromEnemy({ localDefenseId, enemyDefense, portalGuild }) {
  const { rows, linksSchemaReady } = await loadLocalDefenseRowsByIds([localDefenseId], { requireLinksSchema: true });
  if (!linksSchemaReady) requireLinksMigration();

  const localDefense = rows[0];
  if (!localDefense || localDefense.is_hidden) {
    const error = new Error("Defense locale introuvable.");
    error.statusCode = 404;
    throw error;
  }

  if (String(localDefense.organization_id) !== String(portalGuild.organization_id)) {
    const error = new Error("Defense locale hors organisation.");
    error.statusCode = 403;
    throw error;
  }

  const layoutByChampion = getEnemyDefenseHeroLayoutByChampion(enemyDefense);
  const slotUpdates = (localDefense.guild_defense_slots || [])
    .map((slot) => {
      const layout = layoutByChampion.get(normalizeGvgChampionName(readChampionNameFromSlot(slot)));
      if (!layout) return null;
      return {
        slotIndex: slot.slot_index,
        position: layout.position,
        direction: layout.direction,
      };
    })
    .filter((slot) => slot?.slotIndex !== null && (slot.position || slot.direction));

  const updateResults = await Promise.all(
    slotUpdates.map((slot) =>
      supabase
        .from("guild_defense_slots")
        .update({
          position: slot.position,
          direction: slot.direction,
        })
        .eq("defense_id", localDefenseId)
        .eq("slot_index", slot.slotIndex),
    ),
  );

  const slotError = updateResults.find((result) => result.error)?.error;
  if (slotError) throw slotError;

  const { error: defenseUpdateError } = await supabase
    .from("guild_defenses")
    .update({
      source_enemy_defense_id: enemyDefense.id,
      source_enemy_defense_fingerprint: enemyDefense.defense_fingerprint,
      source_enemy_portal_guild_id: portalGuild.id,
      source_enemy_label: `Defense adverse ${portalGuild.guild_code}`,
      source_enemy_imported_at: new Date().toISOString(),
    })
    .eq("id", localDefenseId);

  if (defenseUpdateError) throw defenseUpdateError;
}

async function markSimilarityReview(req, res, sessionMember) {
  const { portalGuild } = await resolveBankScope(req, sessionMember);
  const reviewId = String(req.body?.reviewId || req.body?.review_id || "").trim();
  const status = String(req.body?.status || "").trim().toLowerCase();

  if (!reviewId || !["identical", "different"].includes(status)) {
    return sendPortalJson(res, 400, { error: "Review et statut requis." }, req);
  }

  const { data: review, error: reviewError } = await supabase
    .from("gvg_enemy_defense_similarity_reviews")
    .select("id, enemy_defense_id, local_defense_id, organization_id, local_guild_code, status")
    .eq("id", reviewId)
    .maybeSingle();

  if (reviewError) {
    if (isEnemyDefenseLinksSchemaMissing(reviewError)) requireLinksMigration();
    throw reviewError;
  }

  if (!review || String(review.organization_id) !== String(portalGuild.organization_id)) {
    return sendPortalJson(res, 404, { error: "Review introuvable." }, req);
  }

  const enemyDefense = await loadEnemyDefenseInOrganization(review.enemy_defense_id, portalGuild.organization_id);

  if (status === "identical") {
    await enrichLocalDefenseFromEnemy({
      localDefenseId: review.local_defense_id,
      enemyDefense,
      portalGuild,
    });
  }

  const { error: updateError } = await supabase
    .from("gvg_enemy_defense_similarity_reviews")
    .update({
      status,
      reviewed_by_member_id: sessionMember.id || null,
      reviewed_by_name: sessionMember.watcher_name || sessionMember.display_name || sessionMember.name || "",
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", reviewId);

  if (updateError) throw updateError;

  return sendPortalJson(res, 200, {
    ok: true,
    status,
  }, req);
}

async function ensureFreshSimilarityCandidates(enemyDefense, organizationId) {
  try {
    return await detectEnemyDefenseSimilaritiesForArchive(supabase, {
      organizationId,
      enemyDefenses: [enemyDefense],
    });
  } catch (error) {
    if (isEnemyDefenseLinksSchemaMissing(error)) requireLinksMigration();
    throw error;
  }
}

async function loadChampionsByNormalizedName() {
  const { data, error } = await supabase
    .from("champions")
    .select("id, name, portal_name, english_name")
    .order("name", { ascending: true });

  if (error) throw error;

  const byName = new Map();
  for (const champion of data || []) {
    for (const name of [champion.name, champion.portal_name, champion.english_name]) {
      const key = normalizeGvgChampionName(name);
      if (key && !byName.has(key)) byName.set(key, champion);
    }
  }

  return byName;
}

async function importEnemyDefense(req, res, sessionMember) {
  const { guild, runScope, portalGuild } = await resolveBankScope(req, sessionMember);
  const defenseId = String(req.body?.defenseId || req.body?.defense_id || "").trim();
  const targetGuildInput = validatePortalInput(req.body?.targetGuildCode || req.body?.target_guild_code || portalGuild.guild_code, 60);
  const requestedName = validatePortalInput(req.body?.name || req.body?.defenseName, 120);

  if (!defenseId || !targetGuildInput) return sendPortalJson(res, 400, { error: "Defense et guilde cible requises." }, req);

  const targetPortalGuild = await resolvePortalGuildForGvgGuild(supabase, targetGuildInput);
  if (String(targetPortalGuild.organization_id) !== String(portalGuild.organization_id)) {
    return sendPortalJson(res, 403, { error: "Guilde cible hors organisation." }, req);
  }
  if (!canUseRunTargetGuild(runScope, normalizeGuild(targetPortalGuild.guild_code))) {
    return sendPortalJson(res, 403, { error: "Guilde cible refusee." }, req);
  }

  const enemyDefense = await loadEnemyDefenseInOrganization(defenseId, portalGuild.organization_id);
  await ensureFreshSimilarityCandidates(enemyDefense, portalGuild.organization_id);

  const { data: existingCopies, error: existingCopyError } = await supabase
    .from("guild_defenses")
    .select("id, name, guild_code, is_hidden, source_enemy_defense_id")
    .eq("organization_id", targetPortalGuild.organization_id)
    .eq("guild_code", targetPortalGuild.guild_code)
    .eq("source_enemy_defense_id", defenseId)
    .or("is_hidden.is.null,is_hidden.eq.false");

  if (existingCopyError) {
    if (isEnemyDefenseLinksSchemaMissing(existingCopyError)) requireLinksMigration();
    throw existingCopyError;
  }
  if ((existingCopies || []).length) {
    return sendPortalJson(res, 409, {
      ok: false,
      alreadyPresent: true,
      already_present: true,
      error: `Cette defense est deja presente en ${targetPortalGuild.guild_code}.`,
      localDefense: existingCopies[0],
      local_defense: existingCopies[0],
    }, req);
  }

  const { data: reviewRows, error: reviewError } = await supabase
    .from("gvg_enemy_defense_similarity_reviews")
    .select("id, enemy_defense_id, local_defense_id, local_portal_guild_id, local_guild_code, status")
    .eq("organization_id", targetPortalGuild.organization_id)
    .eq("enemy_defense_id", defenseId)
    .eq("local_portal_guild_id", targetPortalGuild.id);

  if (reviewError) {
    if (isEnemyDefenseLinksSchemaMissing(reviewError)) requireLinksMigration();
    throw reviewError;
  }

  const identicalReview = (reviewRows || []).find((row) => row.status === "identical");
  if (identicalReview) {
    return sendPortalJson(res, 409, {
      ok: false,
      alreadyPresent: true,
      already_present: true,
      error: `Cette defense est deja presente en ${targetPortalGuild.guild_code}.`,
      reviewId: identicalReview.id,
      review_id: identicalReview.id,
    }, req);
  }

  const pendingReviews = (reviewRows || []).filter((row) => row.status === "pending");
  if (pendingReviews.length) {
    return sendPortalJson(res, 409, {
      ok: false,
      requiresReview: true,
      requires_review: true,
      error: `Similarite a verifier avant import dans ${targetPortalGuild.guild_code}.`,
      pendingCount: pendingReviews.length,
      pending_count: pendingReviews.length,
    }, req);
  }

  const canonicalDefinition = enemyDefense.canonical_definition || {};
  const enemyHeroes = Array.isArray(canonicalDefinition.heroes) ? canonicalDefinition.heroes : [];
  if (enemyHeroes.length !== 5) {
    return sendPortalJson(res, 400, { error: "Defense adverse incomplete pour import." }, req);
  }

  const championsByName = await loadChampionsByNormalizedName();
  const slotRows = enemyHeroes.map((hero, index) => {
    const champion = championsByName.get(normalizeGvgChampionName(hero.champion));
    return {
      champion,
      position: normalizeGvgPosition(hero.position, canonicalDefinition.map_type),
      direction: normalizeGvgDirection(hero.direction),
      slotIndex: index + 1,
    };
  });

  if (slotRows.some((slot) => !slot.champion?.id)) {
    return sendPortalJson(res, 400, { error: "Un des heros adverses est absent de la table champions." }, req);
  }

  const mapType = normalizeGvgMapType(enemyDefense.map_type || canonicalDefinition.map_type);
  const defenseName = requestedName || `${mapType === "fortress" ? "Bastion" : "Tour"} adverse`;

  const { data: createdDefense, error: defenseError } = await supabase
    .from("guild_defenses")
    .insert({
      name: defenseName,
      tier: "meta_s",
      type: mapType === "fortress" ? "Bastion" : "Tour",
      faction: null,
      organization_id: targetPortalGuild.organization_id,
      guild_code: targetPortalGuild.guild_code,
      is_global: false,
      is_hidden: false,
      sort_order: 9999,
      image_url: enemyDefense.image_url || null,
      source_enemy_defense_id: enemyDefense.id,
      source_enemy_defense_fingerprint: enemyDefense.defense_fingerprint,
      source_enemy_portal_guild_id: portalGuild.id,
      source_enemy_label: `Defense adverse ${portalGuild.guild_code}`,
      source_enemy_imported_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (defenseError) {
    if (isEnemyDefenseLinksSchemaMissing(defenseError)) requireLinksMigration();
    throw defenseError;
  }

  const { error: slotsError } = await supabase.from("guild_defense_slots").insert(
    slotRows.map((slot) => ({
      defense_id: createdDefense.id,
      champion_id: slot.champion.id,
      slot_index: slot.slotIndex,
      position: slot.position,
      direction: slot.direction,
    })),
  );

  if (slotsError) throw slotsError;

  const localSignature = createLocalDefenseSimilaritySignature({
    type: mapType,
    guild_defense_slots: slotRows.map((slot) => ({ champions: slot.champion })),
  });
  const enemySignature = createEnemyDefenseSimilaritySignature(enemyDefense);

  const { error: reviewUpsertError } = await supabase
    .from("gvg_enemy_defense_similarity_reviews")
    .upsert({
      enemy_defense_id: enemyDefense.id,
      local_defense_id: createdDefense.id,
      organization_id: targetPortalGuild.organization_id,
      local_portal_guild_id: targetPortalGuild.id,
      local_guild_code: targetPortalGuild.guild_code,
      status: "identical",
      reviewed_by_member_id: sessionMember.id || null,
      reviewed_by_name: sessionMember.watcher_name || sessionMember.display_name || sessionMember.name || "",
      reviewed_at: new Date().toISOString(),
      enemy_identity_signature: enemySignature,
      local_identity_signature: localSignature,
    }, { onConflict: "enemy_defense_id,local_defense_id" });

  if (reviewUpsertError) throw reviewUpsertError;

  const { rows: reloadedRows } = await loadLocalDefenseRowsByIds([createdDefense.id], { requireLinksSchema: true });

  return sendPortalJson(res, 200, {
    ok: true,
    imported: true,
    defenseId: createdDefense.id,
    defense_id: createdDefense.id,
    defense: reloadedRows[0] ? mapLocalDefenseRow(reloadedRows[0]) : null,
    sourceGuild: guild,
    source_guild: guild,
  }, req);
}

async function removeLinkedLocalDefense(req, res, sessionMember) {
  const { portalGuild } = await resolveBankScope(req, sessionMember);
  const defenseId = String(req.body?.defenseId || req.body?.defense_id || "").trim();
  const localDefenseId = String(req.body?.localDefenseId || req.body?.local_defense_id || "").trim();
  if (!defenseId || !localDefenseId) return sendPortalJson(res, 400, { error: "Defense adverse et locale requises." }, req);

  const { rows } = await loadLocalDefenseRowsByIds([localDefenseId], { requireLinksSchema: true });
  const localDefense = rows[0];
  if (!localDefense || localDefense.is_hidden) return sendPortalJson(res, 404, { error: "Defense locale introuvable." }, req);
  if (String(localDefense.organization_id) !== String(portalGuild.organization_id)) {
    return sendPortalJson(res, 403, { error: "Defense locale hors organisation." }, req);
  }

  const mapped = mapLocalDefenseRow(localDefense);
  if (String(mapped.sourceEnemyDefenseId || "") !== String(defenseId)) {
    return sendPortalJson(res, 409, { error: "Cette defense locale n'est pas liee a cette defense adverse." }, req);
  }

  const assignmentUpdates = await Promise.all([
    supabase.from("guild_members").update({ defense_1_id: null }).eq("defense_1_id", localDefenseId),
    supabase.from("guild_members").update({ defense_2_id: null }).eq("defense_2_id", localDefenseId),
    supabase.from("guild_members").update({ defense_1: "--" }).eq("guild_code", mapped.guildCode).eq("defense_1", mapped.name),
    supabase.from("guild_members").update({ defense_2: "--" }).eq("guild_code", mapped.guildCode).eq("defense_2", mapped.name),
  ]);
  const assignmentError = assignmentUpdates.find((result) => result.error)?.error;
  if (assignmentError) throw assignmentError;

  const childDeletes = await Promise.all([
    supabase.from("guild_defense_blocks").delete().eq("defense_id", localDefenseId),
    supabase.from("guild_defense_conditions").delete().eq("defense_id", localDefenseId),
    supabase.from("guild_defense_slots").delete().eq("defense_id", localDefenseId),
  ]);
  const childError = childDeletes.find((result) => result.error)?.error;
  if (childError) throw childError;

  const { error: deleteError } = await supabase
    .from("guild_defenses")
    .delete()
    .eq("id", localDefenseId);

  if (deleteError) throw deleteError;

  return sendPortalJson(res, 200, {
    ok: true,
    deleted: true,
    removedLocalCopy: true,
    removed_local_copy: true,
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
    if (action === "similarities") return await loadSimilarities(req, res, sessionCheck.member);
    if (action === "review-similarity") return await markSimilarityReview(req, res, sessionCheck.member);
    if (action === "import") return await importEnemyDefense(req, res, sessionCheck.member);
    if (action === "remove-local") return await removeLinkedLocalDefense(req, res, sessionCheck.member);
    return await loadBankItems(req, res, sessionCheck.member);
  } catch (error) {
    if (isEnemyDefenseBankSchemaMissing(error)) {
      return sendPortalJson(res, error?.statusCode || 428, { error: GVG_ENEMY_DEFENSE_BANK_MESSAGE }, req);
    }
    if (isEnemyDefenseLinksSchemaMissing(error)) {
      return sendPortalJson(res, error?.statusCode || 428, { error: error?.message || "Migration liaisons defenses adverses requise." }, req);
    }

    console.error("[gvg-enemy-defense-bank]", error);
    return sendPortalJson(res, error?.statusCode || 500, { error: error?.message || "Erreur banque defenses adverses." }, req);
  }
}
