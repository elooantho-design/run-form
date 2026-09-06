/* global Buffer, process */
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  applyPortalCorsHeaders,
  readJsonBody,
  requirePortalAdminSession,
  sendPortalJson,
  validatePortalInput,
  verifyPortalRequestOrigin,
} from "./_portal-auth.js";
import {
  createLocalDefenseSimilaritySignature,
  getEnemyDefenseRateTone,
  getEnemyDefenseSuccessRate,
  isEnemyDefenseBankSchemaMissing,
  isEnemyDefenseLinksSchemaMissing,
} from "./_gvg-enemy-defense-bank.js";
import {
  GUILD_DEFENSE_LIBRARY_EQUIVALENCE_MESSAGE,
  buildLibraryEquivalenceState,
  buildLibraryEquivalenceMergeCandidates,
  buildGuildDefenseLibraryMergePlan,
  detectLibraryDefenseSimilarities,
  findLibraryDefenseSimilarityCandidates,
  getEquivalentImportTargetStatus,
  isLibraryEquivalenceSchemaMissing,
  loadLibrarySimilarityCandidates,
  loadLibrarySimilarityReviews,
  markLibrarySimilarityReview,
  recordLibrarySimilarityDecision,
} from "./_guild-defense-library-equivalence.js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const PALADIN_CLUSTER_GUILD_CODES = ["G1", "G2", "G3", "G4", "G5", "G6", "G7"];
const EMPTY_DEFENSE_SLOT = "--";
const MAX_DEFENSE_ROWS = 1200;
const MAX_BLOCK_ROWS = 200;
const DEFENSE_SELECT_BASE = `
  id,
  name,
  tier,
  type,
  faction,
  guild_code,
  is_global,
  is_hidden,
  sort_order,
  image_url,
  created_at,
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
const DEFENSE_SELECT = DEFENSE_SELECT_BASE;
const DEFENSE_SELECT_WITH_LIBRARY = `
  id,
  name,
  tier,
  type,
  faction,
  guild_code,
  is_global,
  is_hidden,
  merged_into_defense_id,
  merged_at,
  merged_by_member_id,
  source_defense_id,
  source_guild_code,
  source_defense_name,
  imported_at,
  organization_id,
  sort_order,
  image_url,
  created_at,
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
const DEFENSE_SELECT_WITH_ENEMY_LINKS = `
  id,
  name,
  tier,
  type,
  faction,
  guild_code,
  is_global,
  is_hidden,
  merged_into_defense_id,
  merged_at,
  merged_by_member_id,
  source_defense_id,
  source_guild_code,
  source_defense_name,
  imported_at,
  organization_id,
  source_enemy_defense_id,
  source_enemy_defense_fingerprint,
  source_enemy_portal_guild_id,
  source_enemy_label,
  source_enemy_imported_at,
  sort_order,
  image_url,
  created_at,
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
const CHAMPION_SAFE_SELECT = "id, name, portal_name, english_name, rarity, faction, role, lord";
const BLOCK_SAFE_SELECT = "id, defense_id, block_type, content, sort_order";

function sendJson(res, status, payload) {
  sendPortalJson(res, status, payload, res._portalReq || null);
}

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeText(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeGuildCode(value) {
  return cleanText(value).toUpperCase().replace(/\s+/g, "_");
}

function normalizePortalGuildCodeValue(value) {
  return cleanText(value).replace(/\s+/g, " ");
}

function isPaladinGuildCode(value) {
  return PALADIN_CLUSTER_GUILD_CODES.includes(normalizeGuildCode(value));
}

function isCommunityRole(role) {
  return ["community_member", "content_creator", "vip"].includes(normalizeText(role));
}

function isCommunityAccount(member) {
  return (
    member?.community_access_type === "community" ||
    isCommunityRole(member?.role) ||
    (!member?.guild_code && isCommunityRole(member?.role))
  );
}

function isMissingColumn(error, columnName = "") {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return error?.code === "42703" || error?.code === "PGRST204" || message.includes(columnName.toLowerCase());
}

function isMissingGuildLibrarySchema(error) {
  return (
    isMissingColumn(error, "organization_id") ||
    isMissingColumn(error, "source_defense_id") ||
    isMissingColumn(error, "source_guild_code") ||
    isMissingColumn(error, "source_defense_name") ||
    isMissingColumn(error, "imported_at") ||
    isMissingColumn(error, "merged_into_defense_id") ||
    isMissingColumn(error, "merged_at") ||
    isMissingColumn(error, "merged_by_member_id") ||
    String(error?.message || "").toLowerCase().includes("import_guild_defense_snapshot")
  );
}

function isMissingDefenseEnemyLinksSchema(error) {
  return (
    isEnemyDefenseLinksSchemaMissing(error) ||
    isMissingColumn(error, "source_enemy_defense_id") ||
    isMissingColumn(error, "source_enemy_defense_fingerprint") ||
    isMissingColumn(error, "source_enemy_portal_guild_id") ||
    isMissingColumn(error, "source_enemy_label") ||
    isMissingColumn(error, "source_enemy_imported_at") ||
    isMissingColumn(error, "position") ||
    isMissingColumn(error, "direction")
  );
}

function getGuildSpaceKey(value) {
  const code = normalizeGuildCode(value);
  if (!code) return "";
  if (isPaladinGuildCode(code)) return "PALADIN";

  const match = code.match(/^(.+?)(?:_?G\d+)$/i);
  return (match?.[1] || code).replace(/_+$/g, "") || code;
}

function sameGuildSpace(left, right) {
  const leftSpace = getGuildSpaceKey(left);
  const rightSpace = getGuildSpaceKey(right);
  return Boolean(leftSpace && rightSpace && leftSpace === rightSpace);
}

function normalizeAllowedGuildCodes(guildCodes = []) {
  const byKey = new Map();

  guildCodes.forEach((guildCode) => {
    const value = normalizePortalGuildCodeValue(guildCode);
    const key = normalizeGuildCode(value || guildCode);
    if (key && !byKey.has(key)) byKey.set(key, value || key);
  });

  return [...byKey.values()];
}

function findPortalGuildByCode(guildRows = [], guildCode) {
  const requested = normalizeGuildCode(guildCode);
  if (!requested) return null;
  return (guildRows || []).find((row) => normalizeGuildCode(row?.guild_code) === requested) || null;
}

async function resolveDefenseLibraryScope(actor, requestedGuildCode) {
  const fallbackGuildCodes = normalizeAllowedGuildCodes(
    isPaladinGuildCode(actor?.guild_code) ? PALADIN_CLUSTER_GUILD_CODES : [actor?.guild_code],
  );
  const requested = normalizeGuildCode(requestedGuildCode || actor?.guild_code || fallbackGuildCodes[0]);
  const fallback = {
    organizationId: "",
    organizationKey: "",
    activeGuildCode: requested,
    allowedGuildCodes: fallbackGuildCodes,
    manageableGuildCodes: fallbackGuildCodes,
    librarySchemaReady: false,
    migrationRequired: true,
    migrationMessage:
      "Migration bibliotheque defenses non confirmee : execute scripts/guild_defense_library.sql avant d'utiliser les imports.",
  };

  if (!actor || isCommunityAccount(actor)) return fallback;

  const { data: portalGuildRows, error: portalGuildRowsError } = await supabase
    .from("portal_guilds")
    .select("guild_code, organization_id, is_active")
    .eq("is_active", true)
    .order("guild_code", { ascending: true });

  if (portalGuildRowsError) return fallback;

  const actorGuild = findPortalGuildByCode(portalGuildRows || [], actor.guild_code);
  if (!actorGuild?.organization_id) return fallback;

  const targetGuild = findPortalGuildByCode(
    (portalGuildRows || []).filter((row) => row.organization_id === actorGuild.organization_id),
    requested,
  );
  if (!targetGuild?.organization_id || targetGuild.organization_id !== actorGuild.organization_id) {
    const error = new Error("Acces guilde refuse.");
    error.statusCode = 403;
    throw error;
  }

  const { data: organization, error: organizationError } = await supabase
    .from("portal_organizations")
    .select("id, organization_key, is_active")
    .eq("id", actorGuild.organization_id)
    .eq("is_active", true)
    .maybeSingle();

  if (organizationError || !organization?.id) {
    const error = new Error("Organisation introuvable.");
    error.statusCode = 403;
    throw error;
  }

  const { data: guildRows, error: guildRowsError } = await supabase
    .from("portal_guilds")
    .select("guild_code")
    .eq("organization_id", organization.id)
    .eq("is_active", true)
    .order("guild_code", { ascending: true });

  if (guildRowsError) throw guildRowsError;

  const allowedGuildCodes = normalizeAllowedGuildCodes((guildRows || []).map((row) => row.guild_code));

  return {
    organizationId: organization.id,
    organizationKey: organization.organization_key || "",
    activeGuildCode: targetGuild.guild_code || requested,
    allowedGuildCodes,
    manageableGuildCodes: allowedGuildCodes,
    librarySchemaReady: true,
    migrationRequired: false,
    migrationMessage: "",
  };
}

function isGuildInScope(scope, guildCode) {
  const key = normalizeGuildCode(guildCode);
  return Boolean(key && (scope?.allowedGuildCodes || []).some((allowed) => normalizeGuildCode(allowed) === key));
}

function canViewGuildCode(actor, guildCode, { leaderSeesAll = false } = {}) {
  if (!actor || isCommunityAccount(actor)) return false;
  void leaderSeesAll;

  const actorGuild = normalizeGuildCode(actor.guild_code);
  const targetGuild = normalizeGuildCode(guildCode);
  if (!actorGuild || !targetGuild) return false;

  if (isPaladinGuildCode(actorGuild)) return isPaladinGuildCode(targetGuild);
  return sameGuildSpace(actorGuild, targetGuild);
}

function canViewDefense(actor, defense, targetGuildCode) {
  if (!canViewGuildCode(actor, targetGuildCode, { leaderSeesAll: true })) return false;
  if (defense?.is_hidden) return false;

  const targetGuild = normalizeGuildCode(targetGuildCode);
  const defenseGuild = normalizeGuildCode(defense?.guild_code);
  return Boolean(targetGuild && defenseGuild && targetGuild === defenseGuild);
}

function canManageDefense(actor, defense, targetGuildCode) {
  if (!canViewGuildCode(actor, targetGuildCode, { leaderSeesAll: true })) return false;

  const targetGuild = normalizeGuildCode(targetGuildCode);
  const defenseGuild = normalizeGuildCode(defense?.guild_code);
  if (!targetGuild || !defenseGuild) return false;
  return targetGuild === defenseGuild;
}

function getDefenseRootId(defense) {
  return defense?.sourceDefenseId || defense?.source_defense_id || defense?.id || null;
}

function isInheritedDefense(defense, targetGuildCode) {
  if (!defense?.id) return false;
  if (defense.source_defense_id || defense.sourceDefenseId) return false;
  return Boolean(defense.is_global || defense.isGlobal) && normalizeGuildCode(defense.guild_code || defense.guildCode) !== normalizeGuildCode(targetGuildCode);
}

function normalizeInfoBlock(block) {
  return {
    id: block.id,
    defense_id: block.defense_id,
    defenseId: block.defense_id,
    block_type: block.block_type || "text",
    blockType: block.block_type || "text",
    content: block.content || "",
    sort_order: block.sort_order ?? 9999,
    sortOrder: block.sort_order ?? 9999,
  };
}

function mapConditionRow(condition) {
  const heroName = condition.champions?.name || "Hero";
  return {
    id: condition.id,
    championId: condition.champion_id,
    champion_id: condition.champion_id,
    minAwakening: condition.min_awakening,
    min_awakening: condition.min_awakening,
    label: `${heroName} A${condition.min_awakening} minimum`,
  };
}

function mapDefenseRow(row, blocksByDefenseId = new Map()) {
  const detailedSlots = [...(row.guild_defense_slots || [])]
    .sort((a, b) => (a.slot_index ?? 0) - (b.slot_index ?? 0))
    .map((slot) => ({
      slotIndex: slot.slot_index ?? null,
      slot_index: slot.slot_index ?? null,
      championId: slot.champion_id || null,
      champion_id: slot.champion_id || null,
      champion: slot.champions?.name || slot.champions?.portal_name || slot.champions?.english_name || "",
      portalName: slot.champions?.portal_name || "",
      portal_name: slot.champions?.portal_name || "",
      englishName: slot.champions?.english_name || "",
      english_name: slot.champions?.english_name || "",
      position: slot.position || null,
      direction: slot.direction || null,
    }));
  const slots = detailedSlots.map((slot) => slot.champion).filter(Boolean);

  return {
    id: row.id,
    name: row.name || "",
    tier: row.tier || "meta_s",
    type: row.type || "Tour",
    faction: row.faction || "",
    guildCode: row.guild_code || "",
    guild_code: row.guild_code || "",
    isGlobal: Boolean(row.is_global),
    is_global: Boolean(row.is_global),
    isHidden: Boolean(row.is_hidden),
    is_hidden: Boolean(row.is_hidden),
    mergedIntoDefenseId: row.merged_into_defense_id || null,
    merged_into_defense_id: row.merged_into_defense_id || null,
    mergedAt: row.merged_at || null,
    merged_at: row.merged_at || null,
    mergedByMemberId: row.merged_by_member_id || null,
    merged_by_member_id: row.merged_by_member_id || null,
    sourceDefenseId: row.source_defense_id || null,
    source_defense_id: row.source_defense_id || null,
    sourceGuildCode: row.source_guild_code || "",
    source_guild_code: row.source_guild_code || "",
    sourceDefenseName: row.source_defense_name || "",
    source_defense_name: row.source_defense_name || "",
    originGuildCode: row.source_guild_code || row.guild_code || "",
    originDefenseName: row.source_defense_name || row.name || "",
    organizationId: row.organization_id || "",
    organization_id: row.organization_id || "",
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
    importedAt: row.imported_at || null,
    imported_at: row.imported_at || null,
    sortOrder: row.sort_order ?? 9999,
    sort_order: row.sort_order ?? 9999,
    slots,
    detailedSlots,
    detailed_slots: detailedSlots,
    conditions: (row.guild_defense_conditions || []).map(mapConditionRow),
    infoBlocks: blocksByDefenseId.get(String(row.id)) || [],
    image: row.image_url || "",
    image_url: row.image_url || "",
  };
}

function sortDefenses(defenses = []) {
  return [...defenses].sort((left, right) => {
    if ((left.sortOrder ?? 9999) !== (right.sortOrder ?? 9999)) {
      return (left.sortOrder ?? 9999) - (right.sortOrder ?? 9999);
    }

    return String(left.name || "").localeCompare(String(right.name || ""), "fr", { sensitivity: "base" });
  });
}

function extractStoragePath(fileUrl) {
  if (!fileUrl) return null;

  try {
    const url = new URL(fileUrl);
    const marker = "/storage/v1/object/public/defense-images/";
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex === -1) return null;
    return decodeURIComponent(url.pathname.slice(markerIndex + marker.length));
  } catch {
    return null;
  }
}

async function filterUnusedStoragePaths(storagePaths = [], ignoredDefenseId = "") {
  const uniqueStoragePaths = [...new Set(storagePaths.filter(Boolean))];
  if (uniqueStoragePaths.length === 0) return [];

  const [defensesResult, blocksResult] = await Promise.all([
    supabase.from("guild_defenses").select("id, image_url").neq("id", ignoredDefenseId || "0"),
    supabase.from("guild_defense_blocks").select("id, defense_id, content").neq("defense_id", ignoredDefenseId || "0"),
  ]);

  if (defensesResult.error) throw defensesResult.error;
  if (blocksResult.error) throw blocksResult.error;

  const usedPaths = new Set();
  (defensesResult.data || []).forEach((row) => {
    const path = extractStoragePath(row.image_url);
    if (path) usedPaths.add(path);
  });
  (blocksResult.data || []).forEach((row) => {
    const path = extractStoragePath(row.content);
    if (path) usedPaths.add(path);
  });

  return uniqueStoragePaths.filter((path) => !usedPaths.has(path));
}

async function removeUnusedStoragePaths(storagePaths = [], ignoredDefenseId = "") {
  const removablePaths = await filterUnusedStoragePaths(storagePaths, ignoredDefenseId);
  if (removablePaths.length === 0) return;

  const { error } = await supabase.storage.from("defense-images").remove(removablePaths);
  if (error) throw error;
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=]+)$/);
  if (!match) return null;
  return {
    contentType: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}

async function requireAdmin(req, res) {
  const sessionCheck = await requirePortalAdminSession(req, supabase);
  if (sessionCheck.error) {
    sendJson(res, sessionCheck.status || 401, { error: sessionCheck.error });
    return null;
  }
  return sessionCheck.member;
}

async function loadBlocksByDefenseIds(defenseIds = []) {
  if (!defenseIds.length) return new Map();

  const { data, error } = await supabase
    .from("guild_defense_blocks")
    .select(BLOCK_SAFE_SELECT)
    .in("defense_id", defenseIds)
    .order("sort_order", { ascending: true })
    .limit(MAX_BLOCK_ROWS);

  if (error) throw error;

  return (data || []).reduce((grouped, block) => {
    const defenseId = String(block.defense_id);
    grouped.set(defenseId, [...(grouped.get(defenseId) || []), normalizeInfoBlock(block)]);
    return grouped;
  }, new Map());
}

async function loadBlocksArray(defenseId) {
  const blocksByDefenseId = await loadBlocksByDefenseIds([defenseId]);
  return [...(blocksByDefenseId.get(String(defenseId)) || [])];
}

async function loadDefenseRow(defenseId) {
  const { data, error } = await supabase
    .from("guild_defenses")
    .select(DEFENSE_SELECT_WITH_ENEMY_LINKS)
    .eq("id", defenseId)
    .maybeSingle();

  if (!error) return { row: data || null, schemaReady: true, enemyLinksSchemaReady: true };
  if (!isMissingDefenseEnemyLinksSchema(error) && !isMissingGuildLibrarySchema(error)) throw error;

  const libraryResult = await supabase
    .from("guild_defenses")
    .select(DEFENSE_SELECT_WITH_LIBRARY)
    .eq("id", defenseId)
    .maybeSingle();

  if (!libraryResult.error) return { row: libraryResult.data || null, schemaReady: true, enemyLinksSchemaReady: false };
  if (!isMissingGuildLibrarySchema(libraryResult.error)) throw libraryResult.error;

  const fallback = await supabase
    .from("guild_defenses")
    .select(DEFENSE_SELECT_BASE)
    .eq("id", defenseId)
    .maybeSingle();

  if (fallback.error) throw fallback.error;
  return { row: fallback.data || null, schemaReady: false, enemyLinksSchemaReady: false };
}

async function loadDefenseRows() {
  const { data, error } = await supabase
    .from("guild_defenses")
    .select(DEFENSE_SELECT_WITH_ENEMY_LINKS)
    .order("created_at", { ascending: true })
    .limit(MAX_DEFENSE_ROWS);

  if (!error) return { rows: data || [], schemaReady: true, enemyLinksSchemaReady: true };
  if (!isMissingDefenseEnemyLinksSchema(error) && !isMissingGuildLibrarySchema(error)) throw error;

  const libraryResult = await supabase
    .from("guild_defenses")
    .select(DEFENSE_SELECT_WITH_LIBRARY)
    .order("created_at", { ascending: true })
    .limit(MAX_DEFENSE_ROWS);

  if (!libraryResult.error) return { rows: libraryResult.data || [], schemaReady: true, enemyLinksSchemaReady: false };
  if (!isMissingGuildLibrarySchema(libraryResult.error)) throw libraryResult.error;

  const fallback = await supabase
    .from("guild_defenses")
    .select(DEFENSE_SELECT_BASE)
    .order("created_at", { ascending: true })
    .limit(MAX_DEFENSE_ROWS);

  if (fallback.error) throw fallback.error;
  return { rows: fallback.data || [], schemaReady: false, enemyLinksSchemaReady: false };
}

async function hasGuildDefenseLibrarySchema() {
  const { error } = await supabase
    .from("guild_defenses")
    .select("organization_id, source_defense_id, source_guild_code, source_defense_name, imported_at, merged_into_defense_id, merged_at, merged_by_member_id")
    .limit(1);

  if (!error) return true;
  if (isMissingGuildLibrarySchema(error)) return false;
  throw error;
}

async function loadMappedDefenseRowsInScope(scope) {
  const { rows, schemaReady, enemyLinksSchemaReady } = await loadDefenseRows();
  const scopedRows = rows.filter((row) => isGuildInScope(scope, row.guild_code));
  const blocksByDefenseId = await loadBlocksByDefenseIds(scopedRows.map((row) => row.id).filter(Boolean));

  return {
    defenses: scopedRows.map((row) => mapDefenseRow(row, blocksByDefenseId)),
    schemaReady,
    enemyLinksSchemaReady,
  };
}

function buildLibraryEntries(nativeDefenses, localDefenses, scope, activeGuildCode, equivalenceState = null) {
  const activeGuildKey = normalizeGuildCode(activeGuildCode);
  const activeSourceIds = new Set(
    localDefenses
      .filter(
        (defense) =>
          defense.sourceDefenseId &&
          normalizeGuildCode(defense.guildCode) === activeGuildKey &&
          !defense.isHidden,
      )
      .map((defense) => String(defense.sourceDefenseId)),
  );

  return sortDefenses(nativeDefenses).map((defense) => {
    const sourceId = String(defense.id || "");
    const sourceGuildKey = normalizeGuildCode(defense.guildCode);
    const importTargets = (scope.manageableGuildCodes || []).map((guildCode) => {
      const target = getEquivalentImportTargetStatus(defense, guildCode, localDefenses, equivalenceState);

      return {
        guildCode,
        status: target.status,
        viaDefenseId: target.viaDefenseId || null,
        via_defense_id: target.viaDefenseId || null,
        viaDefenseName: target.viaDefenseName || "",
        via_defense_name: target.viaDefenseName || "",
      };
    });
    const activeTarget = getEquivalentImportTargetStatus(defense, activeGuildCode, localDefenses, equivalenceState);
    const state = equivalenceState?.byDefenseId?.get(sourceId) || {};

    return {
      ...defense,
      originGuildCode: defense.guildCode,
      libraryTargetStatus:
        activeTarget.status ||
        (sourceGuildKey === activeGuildKey ? "native" : activeSourceIds.has(sourceId) ? "imported" : "available"),
      libraryTargetViaDefenseId: activeTarget.viaDefenseId || null,
      library_target_via_defense_id: activeTarget.viaDefenseId || null,
      libraryTargetViaDefenseName: activeTarget.viaDefenseName || "",
      library_target_via_defense_name: activeTarget.viaDefenseName || "",
      librarySimilarityPendingCount: state.pendingCount || state.pending_count || 0,
      library_similarity_pending_count: state.pendingCount || state.pending_count || 0,
      libraryEquivalenceCount: state.equivalenceCount || state.equivalence_count || 0,
      library_equivalence_count: state.equivalenceCount || state.equivalence_count || 0,
      equivalentDefenses: state.equivalentDefenses || state.equivalent_defenses || [],
      equivalent_defenses: state.equivalentDefenses || state.equivalent_defenses || [],
      familyRootIds: state.familyRootIds || state.family_root_ids || [sourceId],
      family_root_ids: state.familyRootIds || state.family_root_ids || [sourceId],
      presentGuilds: state.presentGuilds || state.present_guilds || [],
      present_guilds: state.presentGuilds || state.present_guilds || [],
      importTargets,
    };
  });
}

function buildDraftDefenseSimilarityRow({ cleanName, draft, guildCode, organizationId, slotChampions, defenseId = null, sourceDefenseId = null }) {
  return {
    id: defenseId || null,
    name: cleanName,
    tier: validatePortalInput(draft.tier, 40) || "meta_s",
    type: validatePortalInput(draft.type, 40) || "Tour",
    guild_code: guildCode,
    organization_id: organizationId || "",
    is_hidden: false,
    is_global: false,
    source_defense_id: sourceDefenseId || null,
    guild_defense_slots: slotChampions.map((champion, index) => ({
      slot_index: index + 1,
      champion_id: champion.id,
      champions: {
        id: champion.id,
        name: champion.name,
        portal_name: champion.portal_name || "",
        english_name: champion.english_name || "",
      },
      position: null,
      direction: null,
    })),
  };
}

function normalizeLibrarySimilarityDecisions(value) {
  const input = Array.isArray(value) ? value : [];
  const decisionsByCandidateId = new Map();

  for (const entry of input) {
    const candidateDefenseId = validatePortalInput(
      entry?.candidateDefenseId || entry?.candidate_defense_id || entry?.defenseId || entry?.defense_id,
      80,
    );
    const status = validatePortalInput(entry?.status, 40).toLowerCase();
    if (!candidateDefenseId || !["identical", "different"].includes(status)) continue;
    decisionsByCandidateId.set(String(candidateDefenseId), { candidateDefenseId, status });
  }

  return decisionsByCandidateId;
}

async function loadPreCreateLibrarySimilarityWarning(scope, targetGuildCode, draftDefense) {
  const draftSignature = createLocalDefenseSimilaritySignature(draftDefense);
  if (!draftSignature) return null;

  const [{ defenses: scopedDefenses }, reviews] = await Promise.all([
    loadMappedDefenseRowsInScope(scope),
    loadLibrarySimilarityReviews(supabase, scope.organizationId),
  ]);
  const similarityResult = findLibraryDefenseSimilarityCandidates(
    scopedDefenses,
    reviews,
    draftDefense,
    targetGuildCode,
  );

  if (!similarityResult.candidates.length) return null;

  const candidatesWithStats = await attachEnemyStatsToDefenses(
    similarityResult.candidates.map((candidate) => candidate.defense),
    scope,
  );
  const candidatesById = new Map(candidatesWithStats.map((defense) => [String(defense.id), defense]));

  return {
    ok: false,
    similarLibraryDefense: true,
    similar_library_defense: true,
    error: "Une defense similaire existe deja dans la Bibliotheque.",
    draftSignature: similarityResult.draftSignature,
    draft_signature: similarityResult.draft_signature,
    targetGuildCode,
    target_guild_code: targetGuildCode,
    candidates: similarityResult.candidates.map((candidate) => {
      const defense = candidatesById.get(String(candidate.defense.id)) || candidate.defense;
      return {
        ...defense,
        originGuildCode: defense.originGuildCode || defense.guildCode || defense.guild_code || "",
        origin_guild_code: defense.originGuildCode || defense.guildCode || defense.guild_code || "",
        libraryTargetStatus: candidate.targetStatus,
        library_target_status: candidate.targetStatus,
        libraryTargetViaDefenseId: candidate.viaDefenseId || null,
        library_target_via_defense_id: candidate.viaDefenseId || null,
        libraryTargetViaDefenseName: candidate.viaDefenseName || "",
        library_target_via_defense_name: candidate.viaDefenseName || "",
        presentGuilds: candidate.presentGuilds || [],
        present_guilds: candidate.presentGuilds || [],
        familyRootIds: candidate.familyRootIds || [],
        family_root_ids: candidate.familyRootIds || [],
      };
    }),
  };
}

async function loadDefenseLibraryPayload(scope, guildCode) {
  const { defenses, schemaReady, enemyLinksSchemaReady } = await loadMappedDefenseRowsInScope(scope);
  const activeGuildKey = normalizeGuildCode(guildCode);
  const visibleDefenses = defenses.filter(
    (defense) => normalizeGuildCode(defense.guildCode) === activeGuildKey && !defense.isHidden,
  );
  const nativeDefenses = defenses.filter((defense) => !defense.sourceDefenseId && !defense.isHidden && !defense.mergedIntoDefenseId);
  const visibleDefensesWithEnemyStats = await attachEnemyStatsToDefenses(visibleDefenses, scope);
  const nativeDefensesWithEnemyStats = await attachEnemyStatsToDefenses(nativeDefenses, scope);
  let libraryEquivalenceSchemaReady = true;
  let equivalenceState = null;

  if (scope.organizationId) {
    try {
      const reviews = await loadLibrarySimilarityReviews(supabase, scope.organizationId);
      equivalenceState = buildLibraryEquivalenceState(defenses, reviews);
    } catch (error) {
      if (!isLibraryEquivalenceSchemaMissing(error)) throw error;
      libraryEquivalenceSchemaReady = false;
    }
  }

  return {
    schemaReady,
    enemyLinksSchemaReady,
    libraryEquivalenceSchemaReady,
    defenses: sortDefenses(visibleDefensesWithEnemyStats),
    libraryDefenses: buildLibraryEntries(nativeDefensesWithEnemyStats, defenses, scope, guildCode, equivalenceState),
  };
}

function mapEnemyGuildStat(row, guildsById = new Map()) {
  const encounters = Number(row?.encounters) || 0;
  const opened = Number(row?.opened) || 0;
  const successRate = getEnemyDefenseSuccessRate(opened, encounters);
  const guild = guildsById.get(String(row?.portal_guild_id || ""));

  return {
    portalGuildId: row?.portal_guild_id || null,
    portal_guild_id: row?.portal_guild_id || null,
    guildCode: guild?.guild_code || "",
    guild_code: guild?.guild_code || "",
    displayName: guild?.display_name || guild?.guild_code || "",
    display_name: guild?.display_name || guild?.guild_code || "",
    encounters,
    opened,
    successRate,
    success_rate: successRate,
    rateTone: getEnemyDefenseRateTone(successRate),
    rate_tone: getEnemyDefenseRateTone(successRate),
    firstSeenAt: row?.first_seen_at || null,
    first_seen_at: row?.first_seen_at || null,
    lastSeenAt: row?.last_seen_at || null,
    last_seen_at: row?.last_seen_at || null,
  };
}

function selectPrimaryEnemyStat(stats = [], linkedDefense = {}, guildsById = new Map()) {
  const defenseGuildKey = normalizeGuildCode(linkedDefense?.guild_code);
  const sourceGuildId = String(linkedDefense?.source_enemy_portal_guild_id || "");

  const localStat = stats.find((row) => {
    const guild = guildsById.get(String(row?.portal_guild_id || ""));
    return guild && normalizeGuildCode(guild.guild_code) === defenseGuildKey;
  });
  if (localStat) return localStat;

  const sourceStat = stats.find((row) => sourceGuildId && String(row?.portal_guild_id || "") === sourceGuildId);
  if (sourceStat) return sourceStat;

  return stats[0] || null;
}

async function attachEnemyStatsToDefenses(defenses = [], scope = {}) {
  const linkedDefenses = defenses.filter((defense) => defense.sourceEnemyDefenseId || defense.source_enemy_defense_id);
  if (!linkedDefenses.length || !scope.organizationId) return defenses;

  const enemyIds = [...new Set(linkedDefenses.map((defense) => defense.sourceEnemyDefenseId || defense.source_enemy_defense_id).filter(Boolean))];

  try {
    const [{ data: statsRows, error: statsError }, { data: guildRows, error: guildRowsError }] = await Promise.all([
      supabase
        .from("gvg_enemy_defense_guild_stats")
        .select("enemy_defense_id, organization_id, portal_guild_id, encounters, opened, first_seen_at, last_seen_at, updated_at")
        .eq("organization_id", scope.organizationId)
        .in("enemy_defense_id", enemyIds),
      supabase
        .from("portal_guilds")
        .select("id, guild_code, display_name, organization_id, is_active")
        .eq("organization_id", scope.organizationId)
        .eq("is_active", true),
    ]);

    if (statsError) throw statsError;
    if (guildRowsError) throw guildRowsError;

    const guildsById = new Map((guildRows || []).map((row) => [String(row.id), row]));
    const statsByEnemyId = new Map();
    (statsRows || []).forEach((row) => {
      const enemyId = String(row.enemy_defense_id || "");
      if (!statsByEnemyId.has(enemyId)) statsByEnemyId.set(enemyId, []);
      statsByEnemyId.get(enemyId).push(row);
    });

    return defenses.map((defense) => {
      const enemyId = String(defense.sourceEnemyDefenseId || defense.source_enemy_defense_id || "");
      if (!enemyId) return defense;

      const scopedStats = statsByEnemyId.get(enemyId) || [];
      const primaryStat = selectPrimaryEnemyStat(scopedStats, {
        guild_code: defense.guildCode || defense.guild_code,
        source_enemy_portal_guild_id: defense.sourceEnemyPortalGuildId || defense.source_enemy_portal_guild_id,
      }, guildsById);
      const mappedPrimaryStat = primaryStat ? mapEnemyGuildStat(primaryStat, guildsById) : null;
      const mappedCrossStats = scopedStats.map((row) => mapEnemyGuildStat(row, guildsById));

      return {
        ...defense,
        enemyStats: mappedPrimaryStat,
        enemy_stats: mappedPrimaryStat,
        enemyCrossGuildStats: mappedCrossStats,
        enemy_cross_guild_stats: mappedCrossStats,
      };
    });
  } catch (error) {
    if (isEnemyDefenseBankSchemaMissing(error) || isMissingDefenseEnemyLinksSchema(error)) return defenses;
    throw error;
  }
}

async function loadEnemyHistoryForLocalDefense(linkedDefense) {
  const enemyDefenseId = linkedDefense?.source_enemy_defense_id;
  if (!enemyDefenseId) return null;

  const [
    { data: enemyDefense, error: enemyDefenseError },
    { data: statsRows, error: statsError },
    { data: guildRows, error: guildRowsError },
  ] = await Promise.all([
    supabase
      .from("gvg_enemy_defenses")
      .select("id, defense_fingerprint, canonical_definition, map_type, heroes_count, image_url, image_storage_path, created_at, updated_at")
      .eq("id", enemyDefenseId)
      .maybeSingle(),
    supabase
      .from("gvg_enemy_defense_guild_stats")
      .select("enemy_defense_id, organization_id, portal_guild_id, encounters, opened, first_seen_at, last_seen_at, updated_at")
      .eq("organization_id", linkedDefense.organization_id)
      .eq("enemy_defense_id", enemyDefenseId),
    supabase
      .from("portal_guilds")
      .select("id, guild_code, display_name, organization_id, is_active")
      .eq("organization_id", linkedDefense.organization_id)
      .eq("is_active", true),
  ]);

  if (enemyDefenseError) throw enemyDefenseError;
  if (statsError) throw statsError;
  if (guildRowsError) throw guildRowsError;

  const guildsById = new Map((guildRows || []).map((row) => [String(row.id), row]));
  const scopedStats = (statsRows || []).filter((row) => String(row.organization_id) === String(linkedDefense.organization_id));
  const primaryStat = selectPrimaryEnemyStat(scopedStats, linkedDefense, guildsById);

  return {
    enemyDefense: enemyDefense
      ? {
          id: enemyDefense.id,
          defenseFingerprint: enemyDefense.defense_fingerprint || "",
          defense_fingerprint: enemyDefense.defense_fingerprint || "",
          mapType: enemyDefense.map_type || enemyDefense.canonical_definition?.map_type || "tower",
          map_type: enemyDefense.map_type || enemyDefense.canonical_definition?.map_type || "tower",
          heroes: Array.isArray(enemyDefense.canonical_definition?.heroes)
            ? enemyDefense.canonical_definition.heroes
            : [],
          imageUrl: enemyDefense.image_url || "",
          image_url: enemyDefense.image_url || "",
          canonicalDefinition: enemyDefense.canonical_definition || {},
          canonical_definition: enemyDefense.canonical_definition || {},
        }
      : null,
    primaryStat: primaryStat ? mapEnemyGuildStat(primaryStat, guildsById) : null,
    primary_stat: primaryStat ? mapEnemyGuildStat(primaryStat, guildsById) : null,
    crossGuildStats: scopedStats.map((row) => mapEnemyGuildStat(row, guildsById)),
    cross_guild_stats: scopedStats.map((row) => mapEnemyGuildStat(row, guildsById)),
  };
}

async function loadChampions() {
  const { data, error } = await supabase
    .from("champions")
    .select(CHAMPION_SAFE_SELECT)
    .order("name", { ascending: true });

  if (error) throw error;
  return data || [];
}

function buildChampionByName(champions = []) {
  return new Map(champions.map((champion) => [normalizeText(champion.name), champion]));
}

async function copyDefenseChildren(sourceDefense, targetDefenseId, champions = []) {
  const championByName = buildChampionByName(champions);
  const slotChampions = (sourceDefense.slots || [])
    .map((heroName) => championByName.get(normalizeText(heroName)))
    .filter(Boolean);

  if (slotChampions.length > 0) {
    const { error: slotsError } = await supabase.from("guild_defense_slots").insert(
      slotChampions.map((champion, index) => ({
        defense_id: targetDefenseId,
        champion_id: champion.id,
        slot_index: index + 1,
      })),
    );
    if (slotsError) throw slotsError;
  }

  const conditionRows = (sourceDefense.conditions || [])
    .filter((condition) => condition.championId)
    .map((condition) => ({
      defense_id: targetDefenseId,
      champion_id: condition.championId,
      min_awakening: condition.minAwakening,
    }));

  if (conditionRows.length > 0) {
    const { error: conditionsError } = await supabase.from("guild_defense_conditions").insert(conditionRows);
    if (conditionsError) throw conditionsError;
  }

  const blockRows = (sourceDefense.infoBlocks || []).map((block, index) => ({
    defense_id: targetDefenseId,
    block_type: block.block_type || block.blockType || "text",
    content: block.content,
    sort_order: block.sort_order ?? block.sortOrder ?? index + 1,
  }));

  if (blockRows.length > 0) {
    const { error: blocksError } = await supabase.from("guild_defense_blocks").insert(blockRows);
    if (blocksError) throw blocksError;
  }
}

async function ensureEditableDefense(actor, defenseId, guildCode, { hidden = false } = {}) {
  const { row } = await loadDefenseRow(defenseId);
  if (!row) throw new Error("Defense introuvable.");
  if (!canManageDefense(actor, row, guildCode)) throw new Error("Acces defense refuse.");

  const blocksByDefenseId = await loadBlocksByDefenseIds([row.id]);
  const sourceDefense = mapDefenseRow(row, blocksByDefenseId);
  const rootId = getDefenseRootId(sourceDefense);

  if (!isInheritedDefense(row, guildCode)) {
    if (hidden) {
      const { data, error } = await supabase
        .from("guild_defenses")
        .update({ is_hidden: true })
        .eq("id", row.id)
        .select(DEFENSE_SELECT)
        .single();
      if (error) throw error;
      return mapDefenseRow(data, await loadBlocksByDefenseIds([data.id]));
    }

    return sourceDefense;
  }

  const { data: existingRows, error: existingError } = await supabase
    .from("guild_defenses")
    .select(DEFENSE_SELECT)
    .eq("source_defense_id", rootId)
    .eq("guild_code", guildCode)
    .limit(1);

  if (existingError) throw existingError;

  const localPayload = {
    name: sourceDefense.name || "",
    tier: sourceDefense.tier || "meta_s",
    type: sourceDefense.type || "Tour",
    faction: sourceDefense.faction || null,
    image_url: sourceDefense.image || sourceDefense.image_url || null,
    guild_code: guildCode,
    is_global: false,
    source_defense_id: rootId,
    sort_order: sourceDefense.sortOrder ?? 9999,
    is_hidden: Boolean(hidden),
  };

  const existing = existingRows?.[0] || null;
  const { data: localRow, error: localError } = existing
    ? await supabase.from("guild_defenses").update(localPayload).eq("id", existing.id).select(DEFENSE_SELECT).single()
    : await supabase.from("guild_defenses").insert(localPayload).select(DEFENSE_SELECT).single();

  if (localError) throw localError;

  if (!existing && !hidden) {
    await copyDefenseChildren(sourceDefense, localRow.id, await loadChampions());
  }

  return mapDefenseRow(localRow, await loadBlocksByDefenseIds([localRow.id]));
}

async function resetAssignedDefense(defense, guildCode) {
  const defenseId = cleanText(defense?.id);
  const defenseName = cleanText(defense?.name);
  const targetGuildCode = normalizeGuildCode(guildCode);

  const updates = [];
  if (defenseId) {
    updates.push(
      supabase
        .from("guild_members")
        .update({ defense_1: EMPTY_DEFENSE_SLOT, defense_1_id: null })
        .eq("defense_1_id", defenseId),
      supabase
        .from("guild_members")
        .update({ defense_2: EMPTY_DEFENSE_SLOT, defense_2_id: null })
        .eq("defense_2_id", defenseId),
    );
  }

  if (defenseName) {
    let defense1ByName = supabase
      .from("guild_members")
      .update({ defense_1: EMPTY_DEFENSE_SLOT })
      .eq("defense_1", defenseName);
    let defense2ByName = supabase
      .from("guild_members")
      .update({ defense_2: EMPTY_DEFENSE_SLOT })
      .eq("defense_2", defenseName);

    if (targetGuildCode) {
      defense1ByName = defense1ByName.eq("guild_code", targetGuildCode);
      defense2ByName = defense2ByName.eq("guild_code", targetGuildCode);
    }

    updates.push(defense1ByName, defense2ByName);
  }

  const results = await Promise.all(updates);
  const missingAssignmentIdColumn = results.find(
    (result) => result.error && (isMissingColumn(result.error, "defense_1_id") || isMissingColumn(result.error, "defense_2_id")),
  );
  if (missingAssignmentIdColumn) {
    const fallbackUpdates = [];
    if (defenseName) {
      let defense1ByName = supabase
        .from("guild_members")
        .update({ defense_1: EMPTY_DEFENSE_SLOT })
        .eq("defense_1", defenseName);
      let defense2ByName = supabase
        .from("guild_members")
        .update({ defense_2: EMPTY_DEFENSE_SLOT })
        .eq("defense_2", defenseName);
      if (targetGuildCode) {
        defense1ByName = defense1ByName.eq("guild_code", targetGuildCode);
        defense2ByName = defense2ByName.eq("guild_code", targetGuildCode);
      }
      fallbackUpdates.push(defense1ByName, defense2ByName);
    }
    const fallbackResults = await Promise.all(fallbackUpdates);
    const fallbackError = fallbackResults.find((result) => result.error)?.error;
    if (fallbackError) throw fallbackError;
    return;
  }

  const mutationError = results.find((result) => result.error)?.error;
  if (mutationError) throw mutationError;
}

async function handleLoad(body, req, res) {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  let scope;
  try {
    scope = await resolveDefenseLibraryScope(actor, validatePortalInput(body.guildCode, 40) || actor.guild_code);
  } catch (error) {
    sendJson(res, error?.statusCode || 403, { error: error?.message || "Acces guilde refuse." });
    return;
  }

  const guildCode = scope.activeGuildCode;
  if (!canViewGuildCode(actor, guildCode, { leaderSeesAll: true })) {
    sendJson(res, 403, { error: "Acces guilde refuse." });
    return;
  }

  const [payload, champions] = await Promise.all([loadDefenseLibraryPayload(scope, guildCode), loadChampions()]);

  sendJson(res, 200, {
    ok: true,
    defenses: payload.defenses,
    libraryDefenses: payload.libraryDefenses,
    guilds: scope.allowedGuildCodes,
    manageableGuilds: scope.manageableGuildCodes,
    migrationRequired: scope.migrationRequired || !payload.schemaReady,
    migrationMessage:
      scope.migrationMessage ||
      (!payload.schemaReady
        ? "Migration bibliotheque defenses non executee : imports et IDs d'attribution indisponibles."
        : ""),
    enemyLinksMigrationRequired: payload.enemyLinksSchemaReady === false,
    enemy_links_migration_required: payload.enemyLinksSchemaReady === false,
    libraryEquivalenceMigrationRequired: payload.libraryEquivalenceSchemaReady === false,
    library_equivalence_migration_required: payload.libraryEquivalenceSchemaReady === false,
    champions,
  });
}

async function handleEnemyHistory(body, req, res) {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  let scope;
  try {
    scope = await resolveDefenseLibraryScope(actor, validatePortalInput(body.guildCode, 40) || actor.guild_code);
  } catch (error) {
    sendJson(res, error?.statusCode || 403, { error: error?.message || "Acces guilde refuse." });
    return;
  }

  const defenseId = validatePortalInput(body.defenseId, 80);
  if (!defenseId) {
    sendJson(res, 400, { error: "Defense locale requise." });
    return;
  }

  const { row: defense, schemaReady, enemyLinksSchemaReady } = await loadDefenseRow(defenseId);
  if (!schemaReady || !enemyLinksSchemaReady) {
    sendJson(res, 428, { error: "Migration liaisons defenses adverses requise." });
    return;
  }
  if (!defense || !canViewDefense(actor, defense, scope.activeGuildCode)) {
    sendJson(res, 404, { error: "Defense locale introuvable." });
    return;
  }
  if (!defense.source_enemy_defense_id) {
    sendJson(res, 404, { error: "Aucune defense adverse liee a cette defense locale." });
    return;
  }

  try {
    const history = await loadEnemyHistoryForLocalDefense(defense);
    if (!history?.enemyDefense) {
      sendJson(res, 404, {
        error: "La defense adverse saisonniere n'est plus disponible.",
        sourceEnemyDefenseFingerprint: defense.source_enemy_defense_fingerprint || "",
        source_enemy_defense_fingerprint: defense.source_enemy_defense_fingerprint || "",
      });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      defense: mapDefenseRow(defense, await loadBlocksByDefenseIds([defense.id])),
      ...history,
    });
  } catch (error) {
    if (isEnemyDefenseBankSchemaMissing(error) || isMissingDefenseEnemyLinksSchema(error)) {
      sendJson(res, 428, { error: "Migration liaisons defenses adverses requise." });
      return;
    }
    throw error;
  }
}

function canViewLibraryDefenseInScope(scope, defense) {
  return Boolean(
    defense?.id &&
      !defense.is_hidden &&
      !defense.merged_into_defense_id &&
      !defense.source_defense_id &&
      isGuildInScope(scope, defense.guild_code),
  );
}

function mapLibrarySimilarityReview(review) {
  return {
    id: review?.id || "",
    organizationId: review?.organization_id || "",
    organization_id: review?.organization_id || "",
    leftDefenseId: review?.left_defense_id || "",
    left_defense_id: review?.left_defense_id || "",
    rightDefenseId: review?.right_defense_id || "",
    right_defense_id: review?.right_defense_id || "",
    status: review?.status || "pending",
    reviewedByName: review?.reviewed_by_name || "",
    reviewed_by_name: review?.reviewed_by_name || "",
    reviewedAt: review?.reviewed_at || null,
    reviewed_at: review?.reviewed_at || null,
  };
}

async function handleLibrarySimilarities(body, req, res) {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  let scope;
  try {
    scope = await resolveDefenseLibraryScope(actor, validatePortalInput(body.guildCode, 40) || actor.guild_code);
  } catch (error) {
    sendJson(res, error?.statusCode || 403, { error: error?.message || "Acces guilde refuse." });
    return;
  }

  const defenseId = validatePortalInput(body.defenseId, 80);
  if (!defenseId) {
    sendJson(res, 400, { error: "Defense bibliotheque requise." });
    return;
  }

  const { row: defense, schemaReady } = await loadDefenseRow(defenseId);
  if (!schemaReady) {
    sendJson(res, 428, { error: "Migration bibliotheque defenses requise." });
    return;
  }
  if (!canViewLibraryDefenseInScope(scope, defense)) {
    sendJson(res, 404, { error: "Defense bibliotheque introuvable." });
    return;
  }

  try {
    await detectLibraryDefenseSimilarities(supabase, {
      organizationId: scope.organizationId,
      rootDefenseIds: [defenseId],
    });
    const { candidates, rootId } = await loadLibrarySimilarityCandidates(supabase, {
      organizationId: scope.organizationId,
      defenseId,
    });
    const blocksByDefenseId = await loadBlocksByDefenseIds(
      candidates
        .flatMap((candidate) => [candidate.leftDefense?.id, candidate.rightDefense?.id])
        .filter(Boolean),
    );

    sendJson(res, 200, {
      ok: true,
      defenseId: rootId,
      defense_id: rootId,
      candidates: candidates.map((candidate) => ({
        review: mapLibrarySimilarityReview(candidate.review),
        leftDefense: mapDefenseRow(candidate.leftDefense, blocksByDefenseId),
        left_defense: mapDefenseRow(candidate.leftDefense, blocksByDefenseId),
        rightDefense: mapDefenseRow(candidate.rightDefense, blocksByDefenseId),
        right_defense: mapDefenseRow(candidate.rightDefense, blocksByDefenseId),
      })),
    });
  } catch (error) {
    if (isLibraryEquivalenceSchemaMissing(error)) {
      sendJson(res, 428, { error: GUILD_DEFENSE_LIBRARY_EQUIVALENCE_MESSAGE });
      return;
    }
    throw error;
  }
}

async function handleLibraryEquivalenceDetails(body, req, res) {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  let scope;
  try {
    scope = await resolveDefenseLibraryScope(actor, validatePortalInput(body.guildCode, 40) || actor.guild_code);
  } catch (error) {
    sendJson(res, error?.statusCode || 403, { error: error?.message || "Acces guilde refuse." });
    return;
  }

  const defenseId = validatePortalInput(body.defenseId, 80);
  if (!defenseId) {
    sendJson(res, 400, { error: "Defense bibliotheque requise." });
    return;
  }

  try {
    const { defenses } = await loadMappedDefenseRowsInScope(scope);
    const reviews = await loadLibrarySimilarityReviews(supabase, scope.organizationId);
    const { family, mergeCandidates } = buildLibraryEquivalenceMergeCandidates(defenses, reviews, defenseId, {
      organizationId: scope.organizationId,
    });
    if (!family) {
      sendJson(res, 404, { error: "Famille bibliotheque introuvable." });
      return;
    }

    const defensesById = new Map(defenses.map((defense) => [String(defense.id), defense]));
    const mergeCandidateByEquivalentId = new Map(
      mergeCandidates.map((candidate) => [String(candidate.equivalentDefenseId || candidate.equivalent_defense_id || ""), candidate]),
    );
    const equivalentDefenses = (family.equivalentDefenses || family.equivalent_defenses || []).map((equivalent) => {
      const defense = defensesById.get(String(equivalent.id || "")) || equivalent;
      const mergeCandidate = mergeCandidateByEquivalentId.get(String(equivalent.id || ""));
      const review = mergeCandidate?.review ? mapLibrarySimilarityReview(mergeCandidate.review) : null;
      const mergeStatus = defense.mergedIntoDefenseId || defense.merged_into_defense_id ? "merged" : review?.status || "";

      return {
        ...defense,
        review,
        reviewId: review?.id || "",
        review_id: review?.id || "",
        libraryMergeStatus: mergeStatus,
        library_merge_status: mergeStatus,
      };
    });
    const mappedMergeCandidates = mergeCandidates.map((candidate) => ({
      review: mapLibrarySimilarityReview(candidate.review),
      review_id: candidate.review?.id || "",
      status: candidate.review?.status || "",
      equivalentDefenseId: candidate.equivalentDefenseId || candidate.equivalent_defense_id || "",
      equivalent_defense_id: candidate.equivalentDefenseId || candidate.equivalent_defense_id || "",
      leftDefense: candidate.leftDefense,
      left_defense: candidate.leftDefense,
      rightDefense: candidate.rightDefense,
      right_defense: candidate.rightDefense,
    }));

    sendJson(res, 200, {
      ok: true,
      defenseId,
      defense_id: defenseId,
      familyRootIds: family.familyRootIds || family.family_root_ids || [],
      family_root_ids: family.familyRootIds || family.family_root_ids || [],
      equivalentDefenses,
      equivalent_defenses: equivalentDefenses,
      mergeCandidates: mappedMergeCandidates,
      merge_candidates: mappedMergeCandidates,
      presentGuilds: family.presentGuilds || family.present_guilds || [],
      present_guilds: family.presentGuilds || family.present_guilds || [],
    });
  } catch (error) {
    if (isLibraryEquivalenceSchemaMissing(error)) {
      sendJson(res, 428, { error: GUILD_DEFENSE_LIBRARY_EQUIVALENCE_MESSAGE });
      return;
    }
    throw error;
  }
}

async function handleLibrarySimilarityReview(body, req, res) {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  let scope;
  try {
    scope = await resolveDefenseLibraryScope(actor, validatePortalInput(body.guildCode, 40) || actor.guild_code);
  } catch (error) {
    sendJson(res, error?.statusCode || 403, { error: error?.message || "Acces guilde refuse." });
    return;
  }

  try {
    const result = await markLibrarySimilarityReview(supabase, {
      organizationId: scope.organizationId,
      reviewId: validatePortalInput(body.reviewId || body.review_id, 80),
      status: validatePortalInput(body.status, 40),
      reviewer: {
        memberId: actor.id || null,
        name: actor.watcher_name || actor.display_name || actor.name || "",
      },
    });
    sendJson(res, 200, result);
  } catch (error) {
    if (isLibraryEquivalenceSchemaMissing(error)) {
      sendJson(res, 428, { error: GUILD_DEFENSE_LIBRARY_EQUIVALENCE_MESSAGE });
      return;
    }
    sendJson(res, error?.statusCode || 500, { error: error?.message || "Validation similarite bibliotheque impossible." });
  }
}

async function handleLibraryMergePreview(body, req, res) {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  let scope;
  try {
    scope = await resolveDefenseLibraryScope(actor, validatePortalInput(body.guildCode, 40) || actor.guild_code);
  } catch (error) {
    sendJson(res, error?.statusCode || 403, { error: error?.message || "Acces guilde refuse." });
    return;
  }

  try {
    const [{ defenses }, reviews] = await Promise.all([
      loadMappedDefenseRowsInScope(scope),
      loadLibrarySimilarityReviews(supabase, scope.organizationId),
    ]);
    const plan = buildGuildDefenseLibraryMergePlan(defenses, reviews, {
      organizationId: scope.organizationId,
      reviewId: validatePortalInput(body.reviewId || body.review_id, 80),
      leftDefenseId: validatePortalInput(body.leftDefenseId || body.left_defense_id, 80),
      rightDefenseId: validatePortalInput(body.rightDefenseId || body.right_defense_id, 80),
    });

    sendJson(res, 200, { ok: true, mergePlan: plan, merge_plan: plan });
  } catch (error) {
    if (isLibraryEquivalenceSchemaMissing(error) || isMissingGuildLibrarySchema(error)) {
      sendJson(res, 428, { error: "Migration fusion bibliotheque defenses requise." });
      return;
    }
    sendJson(res, error?.statusCode || 500, { error: error?.message || "Plan de fusion indisponible." });
  }
}

async function handleLibraryMerge(body, req, res) {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  let scope;
  try {
    scope = await resolveDefenseLibraryScope(actor, validatePortalInput(body.guildCode, 40) || actor.guild_code);
  } catch (error) {
    sendJson(res, error?.statusCode || 403, { error: error?.message || "Acces guilde refuse." });
    return;
  }

  try {
    const [{ defenses }, reviews] = await Promise.all([
      loadMappedDefenseRowsInScope(scope),
      loadLibrarySimilarityReviews(supabase, scope.organizationId),
    ]);
    const plan = buildGuildDefenseLibraryMergePlan(defenses, reviews, {
      organizationId: scope.organizationId,
      reviewId: validatePortalInput(body.reviewId || body.review_id, 80),
    });

    if (!plan.canMerge || !plan.canonical?.id || !plan.absorbed?.id) {
      sendJson(res, 409, { ok: false, error: "Fusion bloquee par le plan de controle.", mergePlan: plan, merge_plan: plan });
      return;
    }

    const { data, error } = await supabase.rpc("merge_guild_defense_library_roots", {
      p_review_id: plan.reviewId || plan.review_id,
      p_canonical_defense_id: plan.canonical.id,
      p_absorbed_defense_id: plan.absorbed.id,
      p_actor_member_id: actor.id || null,
      p_actor_name: actor.watcher_name || actor.display_name || actor.name || "",
      p_merge_plan: plan,
    });

    if (error) throw error;

    sendJson(res, 200, {
      ok: true,
      mergeResult: data || null,
      merge_result: data || null,
      mergePlan: plan,
      merge_plan: plan,
    });
  } catch (error) {
    if (isLibraryEquivalenceSchemaMissing(error) || isMissingGuildLibrarySchema(error)) {
      sendJson(res, 428, { error: "Migration fusion bibliotheque defenses requise." });
      return;
    }
    sendJson(res, error?.statusCode || 500, { error: error?.message || "Fusion bibliotheque impossible." });
  }
}

async function handleLibrarySimilarityRecalculate(body, req, res) {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  let scope;
  try {
    scope = await resolveDefenseLibraryScope(actor, validatePortalInput(body.guildCode, 40) || actor.guild_code);
  } catch (error) {
    sendJson(res, error?.statusCode || 403, { error: error?.message || "Acces guilde refuse." });
    return;
  }

  try {
    const result = await detectLibraryDefenseSimilarities(supabase, {
      organizationId: scope.organizationId,
      rootDefenseIds: validatePortalInput(body.defenseId, 80) ? [validatePortalInput(body.defenseId, 80)] : [],
    });
    sendJson(res, 200, result);
  } catch (error) {
    if (isLibraryEquivalenceSchemaMissing(error)) {
      sendJson(res, 428, { error: GUILD_DEFENSE_LIBRARY_EQUIVALENCE_MESSAGE });
      return;
    }
    throw error;
  }
}

async function handleEnsureLocal(body, req, res) {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  const guildCode = normalizeGuildCode(validatePortalInput(body.guildCode, 40) || actor.guild_code);
  const defenseId = validatePortalInput(body.defenseId, 80);
  const defense = await ensureEditableDefense(actor, defenseId, guildCode, { hidden: Boolean(body.hidden) });
  sendJson(res, 200, { ok: true, defense });
}

async function handleUploadImage(body, req, res) {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  const parsed = parseDataUrl(body.dataUrl);
  if (!parsed) {
    sendJson(res, 400, { error: "Image invalide." });
    return;
  }

  if (parsed.buffer.length > 4 * 1024 * 1024) {
    sendJson(res, 413, { error: "Image trop lourde." });
    return;
  }

  const fileName = validatePortalInput(body.fileName, 120).replace(/[^\w.-]+/g, "-") || "defense.webp";
  const filePath = `portal-defense-${Date.now()}-${crypto.randomUUID()}-${fileName.replace(/\.[^.]+$/, ".webp")}`;
  const { error: uploadError } = await supabase.storage.from("defense-images").upload(filePath, parsed.buffer, {
    contentType: parsed.contentType,
    upsert: false,
  });

  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from("defense-images").getPublicUrl(filePath);
  sendJson(res, 200, { ok: true, imageUrl: data.publicUrl });
}

async function handleImport(body, req, res) {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  const sourceDefenseId = validatePortalInput(body.sourceDefenseId || body.source_defense_id || body.defenseId, 80);
  const targetGuildCodeInput = validatePortalInput(body.targetGuildCode || body.target_guild_code || body.guildCode, 40);
  if (!sourceDefenseId || !targetGuildCodeInput) {
    sendJson(res, 400, { error: "Defense source et guilde cible requises." });
    return;
  }

  let scope;
  try {
    scope = await resolveDefenseLibraryScope(actor, targetGuildCodeInput);
  } catch (error) {
    sendJson(res, error?.statusCode || 403, { error: error?.message || "Acces guilde refuse." });
    return;
  }

  if (scope.migrationRequired || !scope.librarySchemaReady) {
    sendJson(res, 428, {
      error: scope.migrationMessage || "Migration bibliotheque defenses requise avant import.",
    });
    return;
  }

  const targetGuildCode = scope.activeGuildCode;
  const canManageTargetGuild = (scope.manageableGuildCodes || []).some(
    (guildCode) => normalizeGuildCode(guildCode) === normalizeGuildCode(targetGuildCode),
  );
  if (!canManageTargetGuild) {
    sendJson(res, 403, { error: "Guilde cible hors perimetre." });
    return;
  }

  const { row: source, schemaReady } = await loadDefenseRow(sourceDefenseId);
  if (!schemaReady) {
    sendJson(res, 428, { error: "Migration bibliotheque defenses requise avant import." });
    return;
  }

  if (!source || !isGuildInScope(scope, source.guild_code) || source.is_hidden) {
    sendJson(res, 404, { error: "Defense source introuvable dans la bibliotheque." });
    return;
  }

  if (source.source_defense_id) {
    sendJson(res, 400, { error: "Seules les defenses natives peuvent etre importees depuis la bibliotheque." });
    return;
  }

  if (normalizeGuildCode(source.guild_code) === normalizeGuildCode(targetGuildCode)) {
    sendJson(res, 409, { error: `Cette defense est deja native dans ${targetGuildCode}.` });
    return;
  }

  try {
    const { defenses: scopedDefenses } = await loadMappedDefenseRowsInScope(scope);
    const reviews = await loadLibrarySimilarityReviews(supabase, scope.organizationId);
    const equivalenceState = buildLibraryEquivalenceState(scopedDefenses, reviews);
    const mappedSource = scopedDefenses.find((defense) => String(defense.id) === String(source.id)) || mapDefenseRow(source);
    const targetStatus = getEquivalentImportTargetStatus(mappedSource, targetGuildCode, scopedDefenses, equivalenceState);

    if (targetStatus.status !== "available") {
      const viaLabel = targetStatus.viaDefenseName ? ` via ${targetStatus.viaDefenseName}` : "";
      sendJson(res, 409, {
        ok: false,
        alreadyPresent: true,
        already_present: true,
        equivalentPresent: targetStatus.status.startsWith("equivalent"),
        equivalent_present: targetStatus.status.startsWith("equivalent"),
        viaDefenseId: targetStatus.viaDefenseId || null,
        via_defense_id: targetStatus.viaDefenseId || null,
        viaDefenseName: targetStatus.viaDefenseName || "",
        via_defense_name: targetStatus.viaDefenseName || "",
        error: `Cette defense est deja presente dans ${targetGuildCode}${viaLabel}.`,
      });
      return;
    }
  } catch (error) {
    if (!isLibraryEquivalenceSchemaMissing(error)) throw error;
  }

  const { data: existingImport, error: existingImportError } = await supabase
    .from("guild_defenses")
    .select("id")
    .eq("guild_code", targetGuildCode)
    .eq("source_defense_id", source.id)
    .or("is_hidden.is.null,is_hidden.eq.false")
    .maybeSingle();

  if (existingImportError) throw existingImportError;
  if (existingImport) {
    sendJson(res, 409, { error: `Cette defense est deja importee dans ${targetGuildCode}.` });
    return;
  }

  const { data: importedDefenseId, error: importError } = await supabase.rpc("import_guild_defense_snapshot", {
    p_source_defense_id: source.id,
    p_target_guild_code: targetGuildCode,
    p_actor_member_id: actor.id,
  });

  if (importError) {
    if (isMissingGuildLibrarySchema(importError)) {
      sendJson(res, 428, { error: "Migration bibliotheque defenses requise avant import." });
      return;
    }
    throw importError;
  }

  const { row: importedDefense } = await loadDefenseRow(importedDefenseId);
  const mappedDefense = importedDefense
    ? mapDefenseRow(importedDefense, await loadBlocksByDefenseIds([importedDefense.id]))
    : null;

  sendJson(res, 200, { ok: true, defense: mappedDefense, defenseId: importedDefenseId });
}

async function handleSave(body, req, res) {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  let scope;
  try {
    scope = await resolveDefenseLibraryScope(actor, validatePortalInput(body.guildCode, 40) || actor.guild_code);
  } catch (error) {
    sendJson(res, error?.statusCode || 403, { error: error?.message || "Acces guilde refuse." });
    return;
  }

  const guildCode = scope.activeGuildCode;

  const champions = await loadChampions();
  const championByName = buildChampionByName(champions);
  const draft = body.draft || {};
  const cleanName = validatePortalInput(draft.name, 120);
  const slots = Array.isArray(draft.slots)
    ? draft.slots.map((slot) => validatePortalInput(slot, 120)).filter(Boolean)
    : [];

  if (!cleanName || slots.length !== 5) {
    sendJson(res, 400, { error: "Renseigne un nom et les 5 heros de la defense." });
    return;
  }

  const slotChampions = slots.map((heroName) => championByName.get(normalizeText(heroName)));
  if (slotChampions.some((champion) => !champion)) {
    sendJson(res, 400, { error: "Un des heros n'existe pas dans la table champions." });
    return;
  }

  const defenseId = validatePortalInput(draft.id, 80);
  const isEditMode = defenseId && defenseId !== "0";
  let existing = null;
  let existingLinksSchemaReady = false;

  if (isEditMode) {
    const existingResult = await loadDefenseRow(defenseId);
    existing = existingResult.row;
    existingLinksSchemaReady = Boolean(existingResult.enemyLinksSchemaReady);
    if (!existing) throw new Error("Defense introuvable.");
    if (!canManageDefense(actor, existing, guildCode)) throw new Error("Acces defense refuse.");
  }

  const defensePayload = {
    name: cleanName,
    tier: validatePortalInput(draft.tier, 40) || "meta_s",
    type: validatePortalInput(draft.type, 40) || "Tour",
    faction: validatePortalInput(draft.faction, 80) || null,
    image_url: validatePortalInput(draft.imageUrl || draft.image || draft.image_url, 500) || null,
    guild_code: guildCode,
    is_global: false,
  };

  const defenseLibrarySchemaReady = await hasGuildDefenseLibrarySchema();
  if (defenseLibrarySchemaReady) {
    defensePayload.source_defense_id = isEditMode ? existing.source_defense_id || null : null;
  }
  if (!isEditMode && defenseLibrarySchemaReady && scope.organizationId) {
    defensePayload.organization_id = scope.organizationId;
  }

  const proposedSimilarityDefense = buildDraftDefenseSimilarityRow({
    cleanName,
    draft,
    guildCode,
    organizationId: scope.organizationId,
    slotChampions,
    defenseId: isEditMode ? defenseId : null,
    sourceDefenseId: isEditMode ? existing?.source_defense_id || null : null,
  });
  const existingSimilaritySignature = isEditMode ? createLocalDefenseSimilaritySignature(existing) : "";
  const proposedSimilaritySignature = createLocalDefenseSimilaritySignature(proposedSimilarityDefense);
  const structureChanged = !isEditMode || existingSimilaritySignature !== proposedSimilaritySignature;
  const canCreateLibrarySimilarityReview = !isEditMode || !existing?.source_defense_id;
  const librarySimilarityDecisions = normalizeLibrarySimilarityDecisions(
    body.librarySimilarityDecisions || body.library_similarity_decisions,
  );
  let acceptedLibrarySimilarityDecisions = [];
  const allowSimilarLibraryDuplicate = Boolean(
    body.allowSimilarLibraryDuplicate || body.allow_similar_library_duplicate,
  );
  if (
    defenseLibrarySchemaReady &&
    scope.organizationId &&
    structureChanged &&
    canCreateLibrarySimilarityReview
  ) {
    try {
      const warning = await loadPreCreateLibrarySimilarityWarning(
        scope,
        guildCode,
        proposedSimilarityDefense,
      );

      if (warning?.candidates?.length) {
        const matchingDecisions = warning.candidates
          .map((candidate) => librarySimilarityDecisions.get(String(candidate.id)))
          .filter(Boolean);
        const decidedCandidateIds = new Set(matchingDecisions.map((decision) => String(decision.candidateDefenseId)));
        const undecidedCandidates = warning.candidates.filter((candidate) => !decidedCandidateIds.has(String(candidate.id)));
        const createIdenticalDecision = !isEditMode && matchingDecisions.some((decision) => decision.status === "identical");

        if (!allowSimilarLibraryDuplicate || undecidedCandidates.length || createIdenticalDecision) {
          sendJson(res, 409, {
            ...warning,
            operation: isEditMode ? "edit" : "create",
            undecidedCandidates,
            undecided_candidates: undecidedCandidates,
            error: createIdenticalDecision
              ? "Pour creer une defense identique, importe la defense existante au lieu de creer un doublon."
              : warning.error,
          });
          return;
        }

        acceptedLibrarySimilarityDecisions = matchingDecisions;
      }
    } catch (error) {
      if (isLibraryEquivalenceSchemaMissing(error)) {
        sendJson(res, 428, { error: GUILD_DEFENSE_LIBRARY_EQUIVALENCE_MESSAGE });
        return;
      }
      throw error;
    }
  }

  const { data: savedDefense, error: defenseError } = isEditMode
    ? await supabase.from("guild_defenses").update(defensePayload).eq("id", defenseId).select("id").single()
    : await supabase.from("guild_defenses").insert(defensePayload).select("id").single();

  if (defenseError) throw defenseError;

  if (isEditMode) {
    const { error: deleteSlotsError } = await supabase.from("guild_defense_slots").delete().eq("defense_id", savedDefense.id);
    if (deleteSlotsError) throw deleteSlotsError;
  }

  const existingLayoutByChampion = new Map(
    (existing?.guild_defense_slots || []).map((slot) => [
      normalizeText(slot.champions?.name || slot.champions?.portal_name || slot.champions?.english_name || ""),
      {
        position: slot.position || null,
        direction: slot.direction || null,
      },
    ]),
  );
  const slotInsertRows = slotChampions.map((champion, index) => {
    const row = {
      defense_id: savedDefense.id,
      champion_id: champion.id,
      slot_index: index + 1,
    };
    const existingLayout = existingLayoutByChampion.get(normalizeText(champion.name));
    if (existingLinksSchemaReady && existingLayout) {
      row.position = existingLayout.position;
      row.direction = existingLayout.direction;
    }
    return row;
  });

  const { error: slotsError } = await supabase.from("guild_defense_slots").insert(slotInsertRows);
  if (slotsError) throw slotsError;

  const librarySimilarityDecisionResults = [];
  if (scope.organizationId && acceptedLibrarySimilarityDecisions.length) {
    for (const decision of acceptedLibrarySimilarityDecisions) {
      const result = await recordLibrarySimilarityDecision(supabase, {
        organizationId: scope.organizationId,
        leftDefenseId: savedDefense.id,
        rightDefenseId: decision.candidateDefenseId,
        status: decision.status,
        reviewer: {
          memberId: actor.id || null,
          name: actor.watcher_name || actor.display_name || actor.name || "",
        },
      });
      librarySimilarityDecisionResults.push(result);
    }
  }

  if (scope.organizationId) {
    try {
      await detectLibraryDefenseSimilarities(supabase, {
        organizationId: scope.organizationId,
        rootDefenseIds: [savedDefense.id],
      });
    } catch (error) {
      if (!isLibraryEquivalenceSchemaMissing(error)) throw error;
    }
  }

  const { row: reloadedDefense } = await loadDefenseRow(savedDefense.id);
  sendJson(res, 200, {
    ok: true,
    defense: mapDefenseRow(reloadedDefense || savedDefense, await loadBlocksByDefenseIds([savedDefense.id])),
    librarySimilarityDecisionResults,
    library_similarity_decision_results: librarySimilarityDecisionResults,
  });
}

async function handleConditionsLoad(body, req, res) {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  const guildCode = normalizeGuildCode(validatePortalInput(body.guildCode, 40) || actor.guild_code);
  const defenseId = validatePortalInput(body.defenseId, 80);
  const defense = await ensureEditableDefense(actor, defenseId, guildCode);

  const { data, error } = await supabase
    .from("guild_defense_conditions")
    .select("id, champion_id, min_awakening, champions ( name )")
    .eq("defense_id", defense.id)
    .order("min_awakening", { ascending: false });

  if (error) throw error;
  sendJson(res, 200, { ok: true, defense, conditions: (data || []).map(mapConditionRow) });
}

async function handleConditionAdd(body, req, res) {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  const guildCode = normalizeGuildCode(validatePortalInput(body.guildCode, 40) || actor.guild_code);
  const defense = await ensureEditableDefense(actor, validatePortalInput(body.defenseId, 80), guildCode);
  const heroNameInput = validatePortalInput(body.heroName, 120);
  const championIdInput = validatePortalInput(body.championId, 80);
  const minAwakening = Number(body.minAwakening);

  if ((!heroNameInput && !championIdInput) || Number.isNaN(minAwakening)) throw new Error("Condition invalide.");

  const champions = await loadChampions();
  const championByName = buildChampionByName(champions);
  const championById = new Map(champions.map((champion) => [String(champion.id), champion]));
  const champion = championIdInput
    ? championById.get(String(championIdInput))
    : championByName.get(normalizeText(heroNameInput));

  if (!champion) throw new Error("Hero introuvable.");

  const validConditionHeroNames = [
    heroNameInput,
    champion.name,
    champion.portal_name,
    champion.english_name,
  ]
    .filter(Boolean)
    .map(normalizeText);

  if (!(defense.slots || []).some((slot) => validConditionHeroNames.includes(normalizeText(slot)))) {
    throw new Error("La condition doit viser un heros present dans cette defense.");
  }

  const { error } = await supabase.from("guild_defense_conditions").insert({
    defense_id: defense.id,
    champion_id: champion.id,
    min_awakening: minAwakening,
  });

  if (error) throw error;
  sendJson(res, 200, { ok: true, defense });
}

async function handleConditionRemove(body, req, res) {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  const guildCode = normalizeGuildCode(validatePortalInput(body.guildCode, 40) || actor.guild_code);
  const defense = await ensureEditableDefense(actor, validatePortalInput(body.defenseId, 80), guildCode);
  const conditionId = validatePortalInput(body.conditionId, 80);

  const { error } = await supabase
    .from("guild_defense_conditions")
    .delete()
    .eq("id", conditionId)
    .eq("defense_id", defense.id);

  if (error) throw error;
  sendJson(res, 200, { ok: true, defense });
}

async function handleDelete(body, req, res) {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  const guildCode = normalizeGuildCode(validatePortalInput(body.guildCode, 40) || actor.guild_code);
  const defenseId = validatePortalInput(body.defenseId, 80);
  const { row } = await loadDefenseRow(defenseId);

  if (!row) throw new Error("Defense introuvable.");
  if (!canManageDefense(actor, row, guildCode)) throw new Error("Acces defense refuse.");

  const mappedDefense = mapDefenseRow(row, await loadBlocksByDefenseIds([row.id]));
  const isImportedCopy = Boolean(mappedDefense.sourceDefenseId);

  await resetAssignedDefense(mappedDefense, guildCode);

  const { data: blocks, error: blocksError } = await supabase
    .from("guild_defense_blocks")
    .select("id, block_type, content")
    .eq("defense_id", defenseId);
  if (blocksError) throw blocksError;

  const storagePaths = [
    extractStoragePath(mappedDefense.image || mappedDefense.image_url),
    ...(blocks || [])
      .filter((block) => block.block_type === "image")
      .map((block) => extractStoragePath(block.content)),
  ].filter(Boolean);

  const uniqueStoragePaths = [...new Set(storagePaths)];
  if (uniqueStoragePaths.length > 0) {
    await removeUnusedStoragePaths(uniqueStoragePaths, defenseId);
  }

  const [blocksDelete, conditionsDelete, slotsDelete] = await Promise.all([
    supabase.from("guild_defense_blocks").delete().eq("defense_id", defenseId),
    supabase.from("guild_defense_conditions").delete().eq("defense_id", defenseId),
    supabase.from("guild_defense_slots").delete().eq("defense_id", defenseId),
  ]);

  const mutationError = blocksDelete.error || conditionsDelete.error || slotsDelete.error;
  if (mutationError) throw mutationError;

  const { error: defenseError } = await supabase.from("guild_defenses").delete().eq("id", defenseId);
  if (defenseError) throw defenseError;

  sendJson(res, 200, { ok: true, deleted: true, removedLocalCopy: isImportedCopy });
}

async function handleBlocksLoad(body, req, res) {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  const guildCode = normalizeGuildCode(validatePortalInput(body.guildCode, 40) || actor.guild_code);
  const defenseId = validatePortalInput(body.defenseId, 80);
  const { row: defense } = await loadDefenseRow(defenseId);
  if (!defense || !canViewDefense(actor, defense, guildCode)) throw new Error("Acces defense refuse.");

  const blocks = await loadBlocksArray(defenseId);
  sendJson(res, 200, { ok: true, blocks });
}

async function handleBlockReorder(body, req, res) {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  const guildCode = normalizeGuildCode(validatePortalInput(body.guildCode, 40) || actor.guild_code);
  const defense = await ensureEditableDefense(actor, validatePortalInput(body.defenseId, 80), guildCode);
  const blocks = Array.isArray(body.blocks) ? body.blocks : [];

  await Promise.all(
    blocks.map((block, index) =>
      supabase
        .from("guild_defense_blocks")
        .update({ sort_order: index + 1 })
        .eq("id", validatePortalInput(block.id, 80))
        .eq("defense_id", defense.id),
    ),
  );

  sendJson(res, 200, { ok: true, blocks: await loadBlocksArray(defense.id) });
}

async function handleBlockDelete(body, req, res) {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  const guildCode = normalizeGuildCode(validatePortalInput(body.guildCode, 40) || actor.guild_code);
  const defense = await ensureEditableDefense(actor, validatePortalInput(body.defenseId, 80), guildCode);
  const blockId = validatePortalInput(body.blockId, 80);

  const { data: block, error: blockError } = await supabase
    .from("guild_defense_blocks")
    .select(BLOCK_SAFE_SELECT)
    .eq("id", blockId)
    .eq("defense_id", defense.id)
    .maybeSingle();
  if (blockError) throw blockError;

  const storagePath = block?.block_type === "image" ? extractStoragePath(block.content) : null;
  if (storagePath) {
    await removeUnusedStoragePaths([storagePath], defense.id);
  }

  const { error } = await supabase
    .from("guild_defense_blocks")
    .delete()
    .eq("id", blockId)
    .eq("defense_id", defense.id);
  if (error) throw error;

  sendJson(res, 200, { ok: true, blocks: await loadBlocksArray(defense.id) });
}

async function handleBlockAddText(body, req, res) {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  const guildCode = normalizeGuildCode(validatePortalInput(body.guildCode, 40) || actor.guild_code);
  const defense = await ensureEditableDefense(actor, validatePortalInput(body.defenseId, 80), guildCode);
  const content = validatePortalInput(body.content, 5000);
  if (!content) throw new Error("Texte vide.");

  const existingBlocks = await loadBlocksArray(defense.id);
  const { error } = await supabase.from("guild_defense_blocks").insert({
    defense_id: defense.id,
    block_type: "text",
    content,
    sort_order: existingBlocks.length + 1,
  });
  if (error) throw error;

  sendJson(res, 200, { ok: true, blocks: await loadBlocksArray(defense.id) });
}

async function handleBlockAddImage(body, req, res) {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  const guildCode = normalizeGuildCode(validatePortalInput(body.guildCode, 40) || actor.guild_code);
  const defense = await ensureEditableDefense(actor, validatePortalInput(body.defenseId, 80), guildCode);
  const parsed = parseDataUrl(body.dataUrl);
  if (!parsed) throw new Error("Image invalide.");
  if (parsed.buffer.length > 4 * 1024 * 1024) throw new Error("Image trop lourde.");

  const fileName = validatePortalInput(body.fileName, 120).replace(/[^\w.-]+/g, "-") || "block.webp";
  const filePath = `editor-block-${Date.now()}-${crypto.randomUUID()}-${fileName.replace(/\.[^.]+$/, ".webp")}`;

  const { error: uploadError } = await supabase.storage.from("defense-images").upload(filePath, parsed.buffer, {
    contentType: parsed.contentType,
    upsert: false,
  });
  if (uploadError) throw uploadError;

  const { data: publicData } = supabase.storage.from("defense-images").getPublicUrl(filePath);
  const existingBlocks = await loadBlocksArray(defense.id);
  const { error } = await supabase.from("guild_defense_blocks").insert({
    defense_id: defense.id,
    block_type: "image",
    content: publicData.publicUrl,
    sort_order: existingBlocks.length + 1,
  });
  if (error) throw error;

  sendJson(res, 200, { ok: true, blocks: await loadBlocksArray(defense.id) });
}

export default async function handler(req, res) {
  try {
    res._portalReq = req;
    applyPortalCorsHeaders(req, res);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    if (!verifyPortalRequestOrigin(req)) {
      sendJson(res, 403, { error: "Origine de la requete refusee." });
      return;
    }

    const body = await readJsonBody(req);
    const action = cleanText(body.action);

    if (action === "load") return await handleLoad(body, req, res);
    if (action === "enemy-history") return await handleEnemyHistory(body, req, res);
    if (action === "library-similarities") return await handleLibrarySimilarities(body, req, res);
    if (action === "library-equivalence-details") return await handleLibraryEquivalenceDetails(body, req, res);
    if (action === "library-review") return await handleLibrarySimilarityReview(body, req, res);
    if (action === "library-merge-preview") return await handleLibraryMergePreview(body, req, res);
    if (action === "library-merge") return await handleLibraryMerge(body, req, res);
    if (action === "library-recalculate") return await handleLibrarySimilarityRecalculate(body, req, res);
    if (action === "ensure-local") return await handleEnsureLocal(body, req, res);
    if (action === "upload-image") return await handleUploadImage(body, req, res);
    if (action === "import") return await handleImport(body, req, res);
    if (action === "save") return await handleSave(body, req, res);
    if (action === "conditions-load") return await handleConditionsLoad(body, req, res);
    if (action === "condition-add") return await handleConditionAdd(body, req, res);
    if (action === "condition-remove") return await handleConditionRemove(body, req, res);
    if (action === "delete") return await handleDelete(body, req, res);
    if (action === "blocks-load") return await handleBlocksLoad(body, req, res);
    if (action === "block-reorder") return await handleBlockReorder(body, req, res);
    if (action === "block-delete") return await handleBlockDelete(body, req, res);
    if (action === "block-add-text") return await handleBlockAddText(body, req, res);
    if (action === "block-add-image") return await handleBlockAddImage(body, req, res);

    sendJson(res, 400, { error: "Action inconnue." });
  } catch (error) {
    sendJson(res, 500, { error: error?.message || "Erreur gestion defenses." });
  }
}
