import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import {
  applyPortalCorsHeaders,
  isPortalAdminRole,
  requirePortalSession,
  verifyPortalRequestOrigin,
} from "./_portal-auth.js";
import {
  canUseRunTargetGuild,
  getRunScopeForGvgGuild,
  isMissingGuildCodeColumn,
  isMissingRunBoycottTable,
  resolveRunScope,
  stratMatchesRunReadScope,
  stratMatchesRunScope,
} from "../src/lib/runScopeServer.js";
import {
  cleanupDiscordReproRequestForDefenseId,
  notifyDiscordReproRequestsForDefenses,
  reopenDiscordReproRequestForDefense,
} from "../src/lib/discordReproServer.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);
const UPLOADED_DIR =
  process.env.YOUTUBE_UPLOADED_DIR || "";
const DEFAULT_GVG_SERVER_URL = "http://152.228.128.157";
const GVG_DEFENSE_LIST_SELECT_BASE = `
  id,
  guild,
  bastion,
  type,
  tower,
  team,
  defense_key,
  raw_name,
  heroes,
  status,
  repro_by,
  group_num,
  image_url,
  record_status,
  record_comment,
  attack_code,
  youtube_url,
  is_ally,
  created_at,
  updated_at
`;
const GVG_DEFENSE_LIST_SELECT_WITH_MIRROR = `
  id,
  guild,
  bastion,
  type,
  tower,
  team,
  defense_key,
  raw_name,
  heroes,
  status,
  repro_by,
  group_num,
  mirror_group_num,
  image_url,
  record_status,
  record_comment,
  attack_code,
  youtube_url,
  is_ally,
  created_at,
  updated_at
`;
const GVG_DATA_TIMING_LOGS = process.env.GVG_DATA_TIMING_LOGS !== "0";
const SUPABASE_IN_CHUNK_SIZE = 80;
const SUPABASE_ID_CHUNK_SIZE = 400;

function createTimingLogger(label, meta = {}) {
  const enabled = GVG_DATA_TIMING_LOGS;
  const startedAt = performance.now();
  let lastAt = startedAt;
  const marks = [];

  function mark(step, extra = {}) {
    if (!enabled) return;

    const now = performance.now();
    const entry = {
      step,
      delta_ms: Math.round((now - lastAt) * 10) / 10,
      total_ms: Math.round((now - startedAt) * 10) / 10,
      ...extra,
    };
    marks.push(entry);
    lastAt = now;
    console.log(`[${label}:timing]`, JSON.stringify(entry));
  }

  function end(extra = {}) {
    if (!enabled) return;

    const now = performance.now();
    const entry = {
      step: "total",
      total_ms: Math.round((now - startedAt) * 10) / 10,
      marks: marks.length,
      ...meta,
      ...extra,
    };
    console.log(`[${label}:timing]`, JSON.stringify(entry));
  }

  mark("start", meta);
  return { mark, end };
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function isMissingMirrorGroupColumn(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`;
  return (
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    message.toLowerCase().includes("mirror_group_num")
  );
}

function normalizeGuildCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9_-]{2,24}$/.test(code) ? code : null;
}

function normalizeRecordScope(value) {
  const scope = String(value || "").trim().toLowerCase();
  return ["enemy", "ally", "both"].includes(scope) ? scope : null;
}

function getGvgServerConfig() {
  const serverUrl = String(
    process.env.GVG_SERVER_URL ||
      process.env.GVG_VPS_URL ||
      DEFAULT_GVG_SERVER_URL
  ).replace(/\/$/, "");
  const token = process.env.GVG_API_TOKEN || process.env.GVG_SERVER_TOKEN || "";

  return { serverUrl, token };
}

async function requestGvgVps(pathname, options = {}) {
  const { serverUrl, token } = getGvgServerConfig();

  if (!token) {
    const error = new Error("GVG_API_TOKEN manquant cote serveur");
    error.statusCode = 500;
    throw error;
  }

  const response = await fetch(new URL(pathname, serverUrl).toString(), {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      "X-GVG-Token": token,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(data?.detail || data?.error || `Erreur VPS ${response.status}`);
    error.statusCode = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

function extractStoragePathFromPublicUrl(url) {
  if (!url) return null;

  const marker = "/storage/v1/object/public/gvg-images/";
  const index = String(url).indexOf(marker);

  if (index === -1) return null;

  return String(url).slice(index + marker.length);
}

function isValidGuild(value) {
  return normalizeGuildCode(value) !== null;
}

function normalizeRunChampionName(name) {
  if (!name) return null;
  return String(name)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\d+$/, "");
}

function normalizeRunPos(pos) {
  if (!pos) return null;
  return String(pos).trim().toUpperCase();
}

function normalizeRunDir(dir) {
  if (!dir) return null;
  const value = String(dir).trim().toUpperCase();

  if (["N", "NORD", "NORTH", "UP"].includes(value)) return "N";
  if (["S", "SUD", "SOUTH", "DOWN"].includes(value)) return "S";
  if (["E", "EST", "EAST", "RIGHT"].includes(value)) return "E";
  if (["O", "OUEST", "W", "WEST", "LEFT"].includes(value)) return "O";

  return value || null;
}

function buildRunQueryItemsFromHeroes(heroes) {
  return (Array.isArray(heroes) ? heroes : [])
    .map((hero) => ({
      champion: normalizeRunChampionName(hero?.champion || hero?.name),
      position: normalizeRunPos(hero?.position),
      direction: normalizeRunDir(hero?.direction),
    }))
    .filter((item) => item.champion && item.position && item.direction);
}

function runSlotMatchesQuery(slot, query) {
  return (
    normalizeRunChampionName(slot?.champion) === query.champion &&
    normalizeRunPos(slot?.position) === query.position &&
    normalizeRunDir(slot?.direction) === query.direction
  );
}

function runStratMatchesAllQueries(stratSlots, queryItems) {
  return (queryItems || []).every((query) =>
    (stratSlots || []).some((slot) => runSlotMatchesQuery(slot, query))
  );
}

async function fetchRunSlotsByChampions(supabaseClient, champions, timing) {
  const uniq = [...new Set((champions || []).filter(Boolean))];
  if (!uniq.length) return [];

  const all = [];
  const chunks = chunkArray(uniq, SUPABASE_IN_CHUNK_SIZE);

  for (const [chunkIndex, chunk] of chunks.entries()) {
    for (let from = 0; ; from += 1000) {
      const to = from + 999;
      const { data, error } = await supabaseClient
        .from("defence_slot")
        .select("strat_id, champion, position, direction")
        .in("champion", chunk)
        .range(from, to);

      if (error) throw error;

      all.push(...(data || []));
      if (!data || data.length < 1000) break;
    }

    timing?.mark("supabase:defence_slot_by_champions:chunk", {
      chunk: chunkIndex + 1,
      chunks: chunks.length,
      champions: chunk.length,
      rows_so_far: all.length,
    });
  }

  return all;
}

async function fetchRunScopedStratsByIdsBulk(supabaseClient, stratIds, scope, matcher, timing) {
  const uniq = [...new Set((stratIds || []).filter(Boolean))];
  if (!uniq.length) return [];

  let all = [];
  let missingGuildCode = false;
  const chunks = chunkArray(uniq, SUPABASE_ID_CHUNK_SIZE);

  for (const [chunkIndex, chunk] of chunks.entries()) {
    let { data, error } = await supabaseClient
      .from("defence_strat")
      .select("id, guild_code")
      .in("id", chunk);

    if (error) {
      if (!isMissingGuildCodeColumn(error)) throw error;
      missingGuildCode = true;
      break;
    }

    all.push(...(data || []));
    timing?.mark("supabase:defence_strat_scope:chunk", {
      chunk: chunkIndex + 1,
      chunks: chunks.length,
      ids: chunk.length,
      rows_so_far: all.length,
    });
  }

  if (missingGuildCode) {
    if (!scope?.isPaladin) return [];

    all = [];
    for (const [chunkIndex, chunk] of chunks.entries()) {
      const fallback = await supabaseClient
        .from("defence_strat")
        .select("id")
        .in("id", chunk);

      if (fallback.error) throw fallback.error;

      all.push(...((fallback.data || []).map((strat) => ({ ...strat, guild_code: null }))));
      timing?.mark("supabase:defence_strat_scope_fallback:chunk", {
        chunk: chunkIndex + 1,
        chunks: chunks.length,
        ids: chunk.length,
        rows_so_far: all.length,
      });
    }
  }

  return all.filter((strat) => matcher(strat, scope));
}

async function fetchRunBoycottedIdsBulk(supabaseClient, stratIds, targetGuildCode, timing) {
  const uniq = [...new Set((stratIds || []).filter(Boolean))];
  if (!uniq.length || !targetGuildCode) return new Set();

  const all = [];
  const chunks = chunkArray(uniq, SUPABASE_ID_CHUNK_SIZE);

  for (const [chunkIndex, chunk] of chunks.entries()) {
    const { data, error } = await supabaseClient
      .from("defence_strat_boycotts")
      .select("strat_id")
      .eq("guild_code", targetGuildCode)
      .in("strat_id", chunk);

    if (error) {
      if (isMissingRunBoycottTable(error)) return new Set();
      throw error;
    }

    all.push(...(data || []));
    timing?.mark("supabase:defence_strat_boycotts:chunk", {
      chunk: chunkIndex + 1,
      chunks: chunks.length,
      ids: chunk.length,
      rows_so_far: all.length,
    });
  }

  return new Set(all.map((row) => String(row.strat_id)));
}

function buildRunSlotIndexes(slots) {
  const hitMap = new Map();
  const slotsByStrat = new Map();

  for (const slot of slots || []) {
    const stratId = slot.strat_id;
    const champion = normalizeRunChampionName(slot.champion);
    if (!stratId || !champion) continue;

    if (!hitMap.has(stratId)) hitMap.set(stratId, new Set());
    hitMap.get(stratId).add(champion);

    if (!slotsByStrat.has(stratId)) slotsByStrat.set(stratId, []);
    slotsByStrat.get(stratId).push(slot);
  }

  return { hitMap, slotsByStrat };
}

function countMatchingRunsFromIndexes(queryItems, activeIds, hitMap, slotsByStrat, { limit = 1 } = {}) {
  if (!queryItems.length || !activeIds?.length) return 0;

  let count = 0;
  for (const stratId of activeIds) {
    const hits = hitMap.get(stratId);
    if (!hits) continue;

    const hasRelevantChampion = queryItems.some((query) => hits.has(query.champion));
    if (!hasRelevantChampion) continue;

    if (runStratMatchesAllQueries(slotsByStrat.get(stratId) || [], queryItems)) {
      count += 1;
      if (count >= limit) return count;
    }
  }

  return count;
}

async function buildRunAvailabilityForDefenses(req, defenses, guild, timing) {
  const items = Array.isArray(defenses) ? defenses : [];
  if (!items.length) return { items: [], visibleScope: null };

  const queryByDefenseId = new Map();
  const allChampions = [];

  for (const defense of items) {
    const queryItems = buildRunQueryItemsFromHeroes(defense?.heroes);
    queryByDefenseId.set(defense.id, queryItems);
    allChampions.push(...queryItems.map((item) => item.champion));
  }

  const uniqueChampions = [...new Set(allChampions.filter(Boolean))];
  timing?.mark("availability:queries_built", {
    defenses: items.length,
    unique_champions: uniqueChampions.length,
  });

  const ownerScope = getRunScopeForGvgGuild(guild);
  const visibleScope = await resolveRunScope(supabase, req, req.portalMember);
  timing?.mark("supabase:resolve_run_scope", {
    owner_space: ownerScope?.spaceKey,
    visible_space: visibleScope?.spaceKey,
    visible_is_paladin: Boolean(visibleScope?.isPaladin),
    visible_is_admin: Boolean(visibleScope?.isAdmin),
    visible_is_leader: Boolean(visibleScope?.isLeader),
  });

  const canReadExternalRuns =
    (visibleScope?.isPaladin && (visibleScope?.isAdmin || visibleScope?.isLeader)) ||
    (!visibleScope?.isPaladin && visibleScope?.canAccessPaladinRuns);

  const slotRows = await fetchRunSlotsByChampions(supabase, uniqueChampions, timing);
  const { hitMap, slotsByStrat } = buildRunSlotIndexes(slotRows);
  const candidateIds = [...hitMap.keys()];
  timing?.mark("availability:slot_indexes", {
    slot_rows: slotRows.length,
    candidate_strats: candidateIds.length,
  });

  const [ownedScopedStrats, visibleScopedStrats] = await Promise.all([
    fetchRunScopedStratsByIdsBulk(supabase, candidateIds, ownerScope, stratMatchesRunScope, timing),
    canReadExternalRuns
      ? fetchRunScopedStratsByIdsBulk(
          supabase,
          candidateIds,
          visibleScope,
          stratMatchesRunReadScope,
          timing
        )
      : Promise.resolve(null),
  ]);
  timing?.mark("availability:scopes_filtered", {
    owned_strats: ownedScopedStrats.length,
    visible_strats: visibleScopedStrats ? visibleScopedStrats.length : ownedScopedStrats.length,
  });

  const targetGuildCode = items[0]?.guild || guild;
  const allScopedIds = [
    ...ownedScopedStrats.map((strat) => strat.id),
    ...((visibleScopedStrats || []).map((strat) => strat.id)),
  ];
  const boycottedIds = await fetchRunBoycottedIdsBulk(supabase, allScopedIds, targetGuildCode, timing);
  timing?.mark("availability:boycotts_loaded", {
    boycotted: boycottedIds.size,
    target_guild: targetGuildCode,
  });

  const ownedActiveIds = ownedScopedStrats
    .map((strat) => strat.id)
    .filter((stratId) => !boycottedIds.has(String(stratId)));
  const visibleActiveIds = (visibleScopedStrats || ownedScopedStrats)
    .map((strat) => strat.id)
    .filter((stratId) => !boycottedIds.has(String(stratId)));

  return {
    visibleScope,
    items: items.map((defense) => {
      const queryItems = queryByDefenseId.get(defense.id) || [];
      const ownedRunCount = countMatchingRunsFromIndexes(
        queryItems,
        ownedActiveIds,
        hitMap,
        slotsByStrat,
        { limit: 1 }
      );
      const visibleRunCount = canReadExternalRuns
        ? countMatchingRunsFromIndexes(queryItems, visibleActiveIds, hitMap, slotsByStrat, { limit: 1 })
        : ownedRunCount;

      const currentStatus = String(defense.status || "").toLowerCase();
      const effectiveStatus = ["def", "strat"].includes(currentStatus)
        ? ownedRunCount > 0
          ? "strat"
          : "def"
        : defense.status;

      return {
        ...defense,
        stored_status: defense.status,
        status: effectiveStatus,
        owned_run_count: ownedRunCount,
        visible_run_count: visibleRunCount,
        has_owned_run: ownedRunCount > 0,
        has_visible_run: visibleRunCount > 0,
      };
    }),
  };
}

async function syncDerivedGvgStatuses(items) {
  const staleItems = (Array.isArray(items) ? items : []).filter((item) => {
    const storedStatus = String(item?.stored_status || "").toLowerCase();
    const effectiveStatus = String(item?.status || "").toLowerCase();
    return (
      item?.id &&
      ["def", "strat"].includes(storedStatus) &&
      ["def", "strat"].includes(effectiveStatus) &&
      storedStatus !== effectiveStatus
    );
  });

  if (!staleItems.length) return null;

  const updated = [];
  for (const item of staleItems) {
    const { error } = await supabase
      .from("gvg_defense")
      .update({
        status: item.status,
        repro_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id);

    if (error) throw error;
    updated.push(item);
  }

  const reproCandidates = updated.filter(
    (item) => String(item.status || "").toLowerCase() === "def"
  );
  const discordRepro = reproCandidates.length
    ? await notifyDiscordReproRequestsForDefenses(supabase, reproCandidates)
    : null;

  return {
    updated: updated.length,
    discord_repro: discordRepro,
  };
}

function buildGvgDefenseListQuery(selectColumns, guild) {
  return supabase
    .from("gvg_defense")
    .select(selectColumns)
    .eq("guild", guild)
    .order("bastion", { ascending: true })
    .order("type", { ascending: true })
    .order("tower", { ascending: true, nullsFirst: true })
    .order("team", { ascending: true })
    .order("created_at", { ascending: true });
}

async function resolveGvgActionScope(req, guild, options = {}) {
  const normalizedGuild = normalizeGuildCode(guild);
  if (!normalizedGuild) {
    return { error: "guild manquante ou invalide", status: 400 };
  }

  const scope = await resolveRunScope(supabase, req, req.portalMember);
  if (!scope.canUseGvg) {
    return { error: "abonnement insuffisant pour acceder a la GVG", status: 403 };
  }

  if (!canUseRunTargetGuild(scope, normalizedGuild)) {
    return { error: "guilde hors perimetre", status: 403 };
  }

  if (options.adminOnly && !isPortalAdminRole(req.portalMember?.role)) {
    return { error: "acces admin requis", status: 403 };
  }

  return { scope, guild: normalizedGuild };
}

async function loadGvgDefenseForAction(req, res, id, selectColumns, options = {}) {
  const { data, error } = await supabase
    .from("gvg_defense")
    .select(selectColumns)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[gvg-data:access] read error:", error);
    res.status(500).json({ error: "read failed" });
    return null;
  }

  if (!data) {
    res.status(404).json({ error: "defense introuvable" });
    return null;
  }

  const access = await resolveGvgActionScope(req, data.guild, options);
  if (access.error) {
    res.status(access.status || 403).json({ error: access.error });
    return null;
  }

  return { defense: data, scope: access.scope, guild: access.guild };
}

async function handleList(req, res) {
  const guild = normalizeGuildCode(req.query?.guild);
  const timing = createTimingLogger("gvg-data:list", {
    guild: guild || null,
    has_member_id: Boolean(req.query?.memberId || req.query?.member_id),
    has_discord_id: Boolean(req.query?.discordId || req.query?.discord_id),
  });

  if (!guild) {
    timing.end({ error: "invalid_guild" });
    return res.status(400).json({ error: "guild manquante ou invalide" });
  }

  timing.mark("params_read", { guild });

  const visibleScope = await resolveRunScope(supabase, req, req.portalMember);
  if (!visibleScope.canUseGvg) {
    timing.end({ error: "license_gvg_denied" });
    return res.status(403).json({ error: "abonnement insuffisant pour acceder a la GVG" });
  }
  if (!canUseRunTargetGuild(visibleScope, guild)) {
    timing.end({ error: "guild_scope_denied" });
    return res.status(403).json({ error: "guilde hors perimetre" });
  }

  let mirrorGroupSchemaReady = true;
  let { data, error } = await buildGvgDefenseListQuery(
    GVG_DEFENSE_LIST_SELECT_WITH_MIRROR,
    guild
  );
  timing.mark("supabase:gvg_defense:list", {
    rows: data?.length || 0,
    error: error?.code || null,
    with_mirror: true,
  });

  if (error && isMissingMirrorGroupColumn(error)) {
    mirrorGroupSchemaReady = false;
    const fallback = await buildGvgDefenseListQuery(GVG_DEFENSE_LIST_SELECT_BASE, guild);
    data = fallback.data?.map((item) => ({ ...item, mirror_group_num: null })) || null;
    error = fallback.error;
    timing.mark("supabase:gvg_defense:list_fallback", {
      rows: data?.length || 0,
      error: error?.code || null,
    });
  }

  if (error) {
    console.error("[gvg-data:list] select error:", error);
    timing.end({ error: "gvg_defense_select" });
    return res.status(500).json({ error: "erreur lecture gvg" });
  }

  let items = data || [];

  try {
    const availability = await buildRunAvailabilityForDefenses(req, items, guild, timing);
    items = availability.items;
    timing.mark("availability:done", { rows: items.length });
  } catch (availabilityError) {
    console.error("[gvg-data:list] run availability error:", availabilityError);
    timing.mark("availability:error", {
      message: availabilityError?.message || "unknown",
    });
  }

  let statusSync = null;
  try {
    statusSync = await syncDerivedGvgStatuses(items);
    timing.mark("status_sync:done", {
      updated: statusSync?.updated || 0,
      discord_repro: statusSync?.discord_repro ? true : false,
    });
  } catch (syncError) {
    console.error("[gvg-data:list] status sync error:", syncError);
    timing.mark("status_sync:error", {
      message: syncError?.message || "unknown",
    });
  }

  const payload = {
    success: true,
    guild,
    items,
    status_sync: statusSync,
    mirror_group_schema_ready: mirrorGroupSchemaReady,
    schema_warning: mirrorGroupSchemaReady
      ? null
      : "Colonne mirror_group_num absente sur gvg_defense.",
  };
  timing.mark("response:built", {
    items: items.length,
    bytes_estimate: Buffer.byteLength(JSON.stringify(payload), "utf8"),
  });
  timing.end({ status: 200, items: items.length });

  return res.status(200).json(payload);
}

async function handleUpdate(req, res) {
  const { id, action, watcher } = req.body || {};

  if (!id || !action) {
    return res.status(400).json({ error: "id ou action manquant" });
  }

  if (!["repro", "cancel"].includes(action)) {
    return res.status(400).json({ error: "action invalide" });
  }

  const actorName = req.portalMember?.watcher_name || watcher || "Joueur";
  const updatePayload =
    action === "repro"
      ? {
          status: "repro",
          repro_by: actorName,
          updated_at: new Date().toISOString(),
        }
      : {
          status: "def",
          repro_by: null,
          updated_at: new Date().toISOString(),
        };

  const access = await loadGvgDefenseForAction(req, res, id, "id, guild, is_ally, heroes, status");
  if (!access) return;
  const targetDefense = access.defense;

  const targetIds =
    action === "repro"
      ? await findMatchingReproDefenseIds(targetDefense)
      : [targetDefense.id];

  const { data, error } = await supabase
    .from("gvg_defense")
    .update(updatePayload)
    .in("id", targetIds)
    .select("id, status, repro_by");

  if (error) {
    console.error("[gvg-data:update] supabase error:", error);
    return res.status(500).json({
      error: error.message || "update failed",
      details: error,
    });
  }

  const updatedRows = Array.isArray(data) ? data : [];
  const item = updatedRows.find((row) => String(row.id) === String(id)) || updatedRows[0] || null;

  if (!item) {
    return res.status(404).json({ error: "defense introuvable" });
  }

  return res.status(200).json({
    success: true,
    item,
    items: updatedRows,
    updated_ids: updatedRows.map((row) => row.id),
    updated_count: updatedRows.length,
  });
}

async function handleDelete(req, res) {
  const { id } = req.body || {};

  if (!id) {
    return res.status(400).json({ error: "id manquant" });
  }

  const access = await loadGvgDefenseForAction(req, res, id, "id, guild, image_url", {
    adminOnly: true,
  });
  if (!access) return;
  const defense = access.defense;

  if (!defense) {
    return res.status(404).json({ error: "défense introuvable" });
  }

  const storagePath = extractStoragePathFromPublicUrl(defense.image_url);

  if (storagePath) {
    const { error: storageError } = await supabase.storage
      .from("gvg-images")
      .remove([storagePath]);

    if (storageError) {
      console.error("[gvg-data:delete] storage error:", storageError);
      return res.status(500).json({ error: "storage delete failed" });
    }
  }

  const { error: deleteError } = await supabase
    .from("gvg_defense")
    .delete()
    .eq("id", id)
    .eq("guild", access.guild);

  if (deleteError) {
    console.error("[gvg-data:delete] db delete error:", deleteError);
    return res.status(500).json({ error: "delete failed" });
  }

  return res.status(200).json({ success: true });
}

async function handleImportGroups(req, res) {
  try {
    const { guild, data } = req.body;
    const normalizedGuild = normalizeGuildCode(guild);

    if (!normalizedGuild || !data?.map) {
      return res.status(400).json({ error: "data invalide" });
    }

    const access = await resolveGvgActionScope(req, normalizedGuild, { adminOnly: true });
    if (access.error) {
      return res.status(access.status || 403).json({ error: access.error });
    }

    const entries = Object.entries(data.map);

    for (const [key, value] of entries) {
      const groupNum = value?.num;

      if (!groupNum) continue;

      const match = key.match(/^b(\d+)_(t(\d+)|fort)_team(\d)$/);
      if (!match) continue;

      const bastion = Number(match[1]);
      const isFort = key.includes("fort");
      const tower = isFort ? null : Number(match[3]);
      const type = isFort ? "fortress" : "tower";
      const team = Number(match[4]);

      let query = supabase
        .from("gvg_defense")
        .update({ group_num: groupNum })
        .eq("guild", normalizedGuild)
        .eq("bastion", bastion)
        .eq("type", type)
        .eq("team", team);

      if (tower === null) {
        query = query.is("tower", null);
      } else {
        query = query.eq("tower", tower);
      }

      await query;
    }

    return res.json({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}

function normalizeGroupChampionName(name) {
  if (!name) return null;

  return String(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\d+$/, "")
    .replace(/[^a-z0-9]/g, "")
    .trim() || null;
}

function normalizeGroupPosition(position) {
  return String(position || "").trim().toUpperCase() || null;
}

function normalizeGroupDirection(direction) {
  const value = String(direction || "").trim().toUpperCase();

  if (["N", "NORD", "NORTH", "UP"].includes(value)) return "N";
  if (["S", "SUD", "SOUTH", "DOWN"].includes(value)) return "S";
  if (["E", "EST", "EAST", "RIGHT"].includes(value)) return "E";
  if (["O", "OUEST", "W", "WEST", "LEFT"].includes(value)) return "O";

  return value || null;
}

function makeGroupDefenseKey(defense) {
  if (defense.type === "fortress") {
    return `b${defense.bastion}_fort_team${defense.team}`;
  }

  return `b${defense.bastion}_t${defense.tower}_team${defense.team}`;
}

function makeDefenseSignature(defense) {
  const heroes = Array.isArray(defense?.heroes) ? defense.heroes : [];

  const slots = heroes
    .map((hero) => {
      const champion = normalizeGroupChampionName(hero?.champion || hero?.name);
      const position = normalizeGroupPosition(hero?.position);
      const direction = normalizeGroupDirection(hero?.direction);

      if (!champion || !position || !direction) return null;

      return `${position}:${direction}:${champion}`;
    })
    .filter(Boolean)
    .sort();

  if (slots.length !== 5) return null;

  return slots.join("|");
}

function canReceivePropagatedRepro(defense) {
  const status = String(defense?.status || "").toLowerCase();
  return !status || status === "def" || status === "repro";
}

async function findMatchingReproDefenseIds(targetDefense) {
  const targetId = targetDefense?.id;
  if (!targetId) return [];

  const signature = makeDefenseSignature(targetDefense);
  const guild = normalizeGuildCode(targetDefense?.guild);

  if (!signature || !guild) return [targetId];

  const { data, error } = await supabase
    .from("gvg_defense")
    .select("id, heroes, status, is_ally")
    .eq("guild", guild);

  if (error) {
    console.error("[gvg-data:update] matching read error:", error);
    throw error;
  }

  const ids = new Set([targetId]);

  for (const defense of data || []) {
    if (!defense?.id) continue;
    if ((defense?.is_ally === true) !== (targetDefense?.is_ally === true)) continue;
    if (!canReceivePropagatedRepro(defense)) continue;
    if (makeDefenseSignature(defense) !== signature) continue;
    ids.add(defense.id);
  }

  return [...ids];
}

function buildGroupEntry(num, signature, defenses) {
  return {
    num,
    signature,
    ids: defenses.map((item) => item.id),
    keys: defenses.map((item) => makeGroupDefenseKey(item)),
  };
}

async function handleCalculateGroups(req, res) {
  try {
    const guild = normalizeGuildCode(req.body?.guild);

    if (!guild) {
      return res.status(400).json({ error: "guild manquante ou invalide" });
    }

    const access = await resolveGvgActionScope(req, guild, { adminOnly: true });
    if (access.error) {
      return res.status(access.status || 403).json({ error: access.error });
    }

    const { data: defenses, error: readError } = await supabase
      .from("gvg_defense")
      .select("id, guild, bastion, type, tower, team, heroes, is_ally")
      .eq("guild", guild);

    if (readError) {
      console.error("[gvg-data:calculate_groups] read error:", readError);
      return res.status(500).json({ error: "erreur lecture groupes" });
    }

    const enemyBySignature = new Map();
    const allyBySignature = new Map();

    for (const defense of defenses || []) {
      const signature = makeDefenseSignature(defense);
      if (!signature) continue;

      const target = defense.is_ally === true ? allyBySignature : enemyBySignature;
      if (!target.has(signature)) target.set(signature, []);
      target.get(signature).push(defense);
    }

    const enemyGroups = [];
    let nextEnemyGroup = 1;

    for (const [signature, groupDefenses] of enemyBySignature.entries()) {
      if (groupDefenses.length < 2) continue;
      enemyGroups.push(buildGroupEntry(nextEnemyGroup, signature, groupDefenses));
      nextEnemyGroup += 1;
    }

    const mirrorGroups = [];
    const mirrorMap = {};
    let nextMirrorGroup = 1;

    for (const [signature, enemyDefenses] of enemyBySignature.entries()) {
      const allyDefenses = allyBySignature.get(signature) || [];
      if (!enemyDefenses.length || !allyDefenses.length) continue;

      const group = {
        num: nextMirrorGroup,
        signature,
        enemy_ids: enemyDefenses.map((item) => item.id),
        enemy_keys: enemyDefenses.map((item) => makeGroupDefenseKey(item)),
        ally_ids: allyDefenses.map((item) => item.id),
        ally_keys: allyDefenses.map((item) => makeGroupDefenseKey(item)),
      };

      for (const id of [...group.enemy_ids, ...group.ally_ids]) {
        mirrorMap[String(id)] = {
          num: group.num,
          enemy_keys: group.enemy_keys,
          ally_keys: group.ally_keys,
        };
      }

      mirrorGroups.push(group);
      nextMirrorGroup += 1;
    }

    const updatedAt = new Date().toISOString();
    let mirrorGroupSchemaReady = true;
    let clearError = null;

    const clearWithMirror = await supabase
      .from("gvg_defense")
      .update({ group_num: null, mirror_group_num: null, updated_at: updatedAt })
      .eq("guild", guild);
    clearError = clearWithMirror.error;

    if (clearError && isMissingMirrorGroupColumn(clearError)) {
      mirrorGroupSchemaReady = false;
      const clearWithoutMirror = await supabase
        .from("gvg_defense")
        .update({ group_num: null, updated_at: updatedAt })
        .eq("guild", guild);
      clearError = clearWithoutMirror.error;
    }

    if (clearError) {
      console.error("[gvg-data:calculate_groups] clear error:", clearError);
      return res.status(500).json({ error: "erreur reset groupes" });
    }

    for (const group of enemyGroups) {
      const { error: updateError } = await supabase
        .from("gvg_defense")
        .update({ group_num: group.num, updated_at: updatedAt })
        .in("id", group.ids);

      if (updateError) {
        console.error("[gvg-data:calculate_groups] update error:", updateError);
        return res.status(500).json({ error: "erreur mise a jour groupes" });
      }
    }

    if (mirrorGroupSchemaReady) {
      for (const group of mirrorGroups) {
        const ids = [...group.enemy_ids, ...group.ally_ids];
        const { error: updateMirrorError } = await supabase
          .from("gvg_defense")
          .update({ mirror_group_num: group.num, updated_at: updatedAt })
          .in("id", ids);

        if (updateMirrorError) {
          console.error("[gvg-data:calculate_groups] mirror update error:", updateMirrorError);
          return res.status(500).json({ error: "erreur mise a jour groupes allie/ennemi" });
        }
      }
    }

    return res.status(200).json({
      success: true,
      guild,
      enemy_groups: enemyGroups,
      mirror_groups: mirrorGroups,
      mirror_map: mirrorMap,
      updated_enemy_groups: enemyGroups.length,
      matched_mirror_groups: mirrorGroups.length,
      mirror_group_schema_ready: mirrorGroupSchemaReady,
      schema_warning: mirrorGroupSchemaReady
        ? null
        : "Colonne mirror_group_num absente sur gvg_defense : badge vert non persistant.",
    });
  } catch (error) {
    console.error("[gvg-data:calculate_groups] error:", error);
    return res.status(500).json({ error: error?.message || "erreur calcul groupes" });
  }
}

async function handleReproCandidates(req, res) {
  const { defenseId } = req.body || {};

  if (!defenseId) {
    return res.status(400).json({ error: "defenseId manquant" });
  }

  const access = await loadGvgDefenseForAction(req, res, defenseId, "id, guild, heroes");
  if (!access) return;
  const defense = access.defense;
  const defenseError = null;

  if (defenseError) {
    console.error("[gvg-data:repro-candidates] defense error:", defenseError);
    return res.status(500).json({ error: "erreur lecture défense" });
  }

  if (!defense) {
    return res.status(404).json({ error: "défense introuvable" });
  }

const heroes = Array.isArray(defense.heroes) ? defense.heroes : [];

const heroNames = heroes
  .map((hero) => String(hero?.champion || "").trim())
  .filter(Boolean);

if (!heroNames.length) {
  return res.status(200).json({
    success: true,
    heroes: [],
    candidates: [],
  });
}

const { data: championsData, error: championsError } = await supabase
  .from("champions")
  .select("id, name")
  .in("name", heroNames);

  if (championsError) {
    console.error("[gvg-data:repro-candidates] champions error:", championsError);
    return res.status(500).json({ error: "erreur lecture champions" });
  }

const championsByName = new Map(
  (championsData || []).map((row) => [String(row.name || "").trim(), row])
);

const orderedHeroes = heroNames.map((name) => {
  const champion = championsByName.get(name);

  return {
    champion_id: champion?.id ? String(champion.id) : name,
    champion_name: name,
  };
});

  const { data: members, error: membersError } = await supabase
    .from("guild_members")
    .select("id, watcher_name")
    .eq("guild_code", defense.guild)
    .order("watcher_name", { ascending: true });

  if (membersError) {
    console.error("[gvg-data:repro-candidates] members error:", membersError);
    return res.status(500).json({ error: "erreur lecture membres" });
  }

  const memberIds = (members || []).map((member) => member.id).filter(Boolean);

  if (!memberIds.length) {
    return res.status(200).json({
      success: true,
      heroes: orderedHeroes,
      candidates: [],
    });
  }

const championIds = orderedHeroes
  .map((hero) => hero.champion_id)
  .filter((id) => /^\d+$/.test(String(id)));

const { data: awakenings, error: awakeningsError } = await supabase
  .from("member_awakenings")
  .select("member_id, champion_id, awakening_level")
  .in("member_id", memberIds)
  .in("champion_id", championIds);

  if (awakeningsError) {
    console.error("[gvg-data:repro-candidates] awakenings error:", awakeningsError);
    return res.status(500).json({ error: "erreur lecture éveils" });
  }

  const awakeningsByMember = new Map();

  for (const row of awakenings || []) {
    const memberKey = String(row.member_id);
    const championKey = String(row.champion_id);

    if (!awakeningsByMember.has(memberKey)) {
      awakeningsByMember.set(memberKey, new Map());
    }

    awakeningsByMember
      .get(memberKey)
      .set(championKey, Number(row.awakening_level ?? -1));
  }

  const candidates = (members || []).map((member) => {
    const memberAwakenings = awakeningsByMember.get(String(member.id)) || new Map();

    const heroesStatus = orderedHeroes.map((hero) => ({
      champion_id: hero.champion_id,
      champion_name: hero.champion_name,
      awakening: memberAwakenings.has(hero.champion_id)
        ? memberAwakenings.get(hero.champion_id)
        : -1,
    }));

    const canRepro = heroesStatus.every((hero) => hero.awakening >= 0);

    return {
      memberId: member.id,
      name: member.watcher_name || "Inconnu",
      canRepro,
      heroes: heroesStatus,
    };
  });

  candidates.sort((a, b) => {
    if (a.canRepro !== b.canRepro) {
      return a.canRepro ? -1 : 1;
    }

    return String(a.name).localeCompare(String(b.name), "fr", {
      sensitivity: "base",
    });
  });

  return res.status(200).json({
    success: true,
    heroes: orderedHeroes,
    candidates,
  });
}

async function handlePanelOpen(req, res) {
  const { id } = req.body || {};

  if (!id) {
    return res.status(400).json({ error: "id manquant" });
  }

  const access = await loadGvgDefenseForAction(req, res, id, GVG_DEFENSE_LIST_SELECT_BASE);
  if (!access) return;
  const defense = access.defense;

  let discordReproCleanup = null;
  let discordReproWarning = null;

  if (defense.record_status) {
    try {
      discordReproCleanup = await cleanupDiscordReproRequestForDefenseId(supabase, id, {
        reason: "portal_panel_open_already_open",
        source: "gvg-data:panel_open",
        notifyReproducer: true,
      });
    } catch (cleanupError) {
      discordReproWarning = cleanupError?.message || "nettoyage Discord repro impossible";
      console.error("[gvg-data:panel_open] discord repro cleanup error:", cleanupError);
    }

    return res.status(200).json({
      success: true,
      item: defense,
      already_open: true,
      discord_repro_cleanup: discordReproCleanup,
      discord_repro_warning: discordReproWarning,
    });
  }

  const { data, error } = await supabase
    .from("gvg_defense")
    .update({
      record_status: "open",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id, record_status")
    .maybeSingle();

  if (error) {
    console.error("[gvg-data:panel_open] update error:", error);
    return res.status(500).json({ error: "update failed" });
  }

  try {
    discordReproCleanup = await cleanupDiscordReproRequestForDefenseId(supabase, id, {
      reason: "portal_panel_open",
      source: "gvg-data:panel_open",
      notifyReproducer: true,
    });
  } catch (cleanupError) {
    discordReproWarning = cleanupError?.message || "nettoyage Discord repro impossible";
    console.error("[gvg-data:panel_open] discord repro cleanup error:", cleanupError);
  }

  return res.status(200).json({
    success: true,
    item: data,
    discord_repro_cleanup: discordReproCleanup,
    discord_repro_warning: discordReproWarning,
  });
}

async function handleRecordToggle(req, res) {
  const { id } = req.body || {};

  if (!id) {
    return res.status(400).json({ error: "id manquant" });
  }

  const access = await loadGvgDefenseForAction(req, res, id, "id, guild, record_status", {
    adminOnly: true,
  });
  if (!access) return;
  const defense = access.defense;

  if (!defense.record_status) {
    return res.status(400).json({ error: "défense non ouverte dans le panel" });
  }

  if (defense.record_status === "record" || defense.record_status === "push") {
    return res.status(400).json({ error: "statut verrouillé" });
  }

  const nextStatus =
    defense.record_status === "a_record" ? "open" : "a_record";

  const { data, error } = await supabase
    .from("gvg_defense")
    .update({
      record_status: nextStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id, record_status")
    .maybeSingle();

  if (error) {
    console.error("[gvg-data:record_toggle] update error:", error);
    return res.status(500).json({ error: "update failed" });
  }

  return res.status(200).json({
    success: true,
    item: data,
  });
}

async function handleRecordSkip(req, res) {
  const { id } = req.body || {};

  if (!id) {
    return res.status(400).json({ error: "id manquant" });
  }

  const access = await loadGvgDefenseForAction(req, res, id, "id, guild, record_status", {
    adminOnly: true,
  });
  if (!access) return;
  const defense = access.defense;

  if (defense.record_status === "record" || defense.record_status === "push") {
    return res.status(400).json({ error: "statut verrouillé" });
  }

  const { data, error } = await supabase
    .from("gvg_defense")
    .update({
      record_status: "pas_record",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id, record_status")
    .maybeSingle();

  if (error) {
    console.error("[gvg-data:record_skip] update error:", error);
    return res.status(500).json({ error: "update failed" });
  }

  if (!data) {
    return res.status(404).json({ error: "défense introuvable" });
  }

  let discordReproCleanup = null;
  let discordReproWarning = null;

  try {
    discordReproCleanup = await cleanupDiscordReproRequestForDefenseId(supabase, id, {
      reason: "portal_record_skip",
      source: "gvg-data:record_skip",
      notifyReproducer: true,
    });
  } catch (cleanupError) {
    discordReproWarning = cleanupError?.message || "nettoyage Discord repro impossible";
    console.error("[gvg-data:record_skip] discord repro cleanup error:", cleanupError);
  }

  return res.status(200).json({
    success: true,
    item: data,
    discord_repro_cleanup: discordReproCleanup,
    discord_repro_warning: discordReproWarning,
  });
}

async function handlePanelUpdateFields(req, res) {
  const { id, record_comment, attack_code } = req.body || {};

  if (!id) {
    return res.status(400).json({ error: "id manquant" });
  }

  const access = await loadGvgDefenseForAction(req, res, id, "id, guild", {
    adminOnly: true,
  });
  if (!access) return;

  const payload = {
    updated_at: new Date().toISOString(),
  };

  if (record_comment !== undefined) {
    payload.record_comment = String(record_comment || "").trim() || null;
  }

  if (attack_code !== undefined) {
    payload.attack_code = String(attack_code || "").trim() || null;
  }

  const { data, error } = await supabase
    .from("gvg_defense")
    .update(payload)
    .eq("id", id)
    .select("id, record_comment, attack_code")
    .maybeSingle();

  if (error) {
    console.error("[gvg-data:panel_update_fields] update error:", error);
    return res.status(500).json({ error: "update failed" });
  }

  if (!data) {
    return res.status(404).json({ error: "défense introuvable" });
  }

  return res.status(200).json({
    success: true,
    item: data,
  });
}

function makeRecordPlanItem(defense) {
  const defKey = makeDefKey(defense);
  const side = defense.is_ally === true ? "ally" : "enemy";

  return {
    id: String(defense.id),
    key: side === "ally" ? `${defKey}_ally` : defKey,
    def_key: defKey,
    side,
    guild: normalizeGuildCode(defense.guild) || String(defense.guild || "").toUpperCase(),
    bastion: Number(defense.bastion),
    type: String(defense.type || ""),
    tower: defense.tower === null || defense.tower === undefined ? null : Number(defense.tower),
    team: Number(defense.team),
    attack_code: defense.attack_code || null,
    record_comment: defense.record_comment || null,
  };
}

function recordSessionItemHasVideo(item) {
  const status = String(item?.status || "").toLowerCase();
  return Boolean(
    item?.video_file ||
      item?.youtube_url ||
      ["uploaded", "youtube_uploading", "youtube_uploaded", "youtube_error"].includes(status)
  );
}

function buildUploadedRecordItemKeys(sessions) {
  const uploaded = new Set();

  for (const session of sessions || []) {
    for (const item of session?.items || []) {
      if (!recordSessionItemHasVideo(item)) {
        continue;
      }

      const id = String(item?.id || item?.defense_id || "").trim().toLowerCase();
      if (id) uploaded.add(`id:${id}`);
    }
  }

  return uploaded;
}

async function loadExistingRecordSessionsForPlan(guild) {
  try {
    const params = new URLSearchParams({
      guild,
      limit: "100",
    });
    const vps = await requestGvgVps(`/api/v1/record/sessions?${params.toString()}`);
    return vps?.sessions || [];
  } catch (error) {
    console.warn("[gvg-data:record_session_create] existing sessions unavailable:", error?.message || error);
    return [];
  }
}

async function handleCreateRecordSession(req, res) {
  const body = req.body || {};
  const guild = normalizeGuildCode(body.guild);
  const scope = normalizeRecordScope(body.scope || body.side);
  const sessionId = String(body.session_id || body.sessionId || "").trim();
  const source = String(body.source || "panel").trim() || "panel";

  if (!guild) {
    return res.status(400).json({ error: "guild invalide" });
  }

  if (!scope) {
    return res.status(400).json({ error: "scope invalide: enemy, ally ou both attendu" });
  }

  if (!/^[A-Za-z0-9_-]{12,96}$/.test(sessionId)) {
    return res.status(400).json({ error: "session_id invalide" });
  }

  const access = await resolveGvgActionScope(req, guild, { adminOnly: true });
  if (access.error) {
    return res.status(access.status || 403).json({ error: access.error });
  }

  let query = supabase
    .from("gvg_defense")
    .select(`
      id,
      guild,
      bastion,
      type,
      tower,
      team,
      is_ally,
      record_status,
      record_comment,
      attack_code
    `)
    .eq("guild", guild)
    .eq("record_status", "a_record");

  if (scope === "ally") {
    query = query.eq("is_ally", true);
  } else if (scope === "enemy") {
    query = query.or("is_ally.is.false,is_ally.is.null");
  }

  const { data, error } = await query
    .order("is_ally", { ascending: true })
    .order("bastion", { ascending: true })
    .order("type", { ascending: true })
    .order("tower", { ascending: true, nullsFirst: true })
    .order("team", { ascending: true });

  if (error) {
    console.error("[gvg-data:record_session_create] supabase error:", error);
    return res.status(500).json({ error: "lecture gvg_defense impossible" });
  }

  const existingSessions = await loadExistingRecordSessionsForPlan(guild);
  const uploadedKeys = buildUploadedRecordItemKeys(existingSessions);
  const allItems = (data || []).map(makeRecordPlanItem);
  const items = allItems.filter((item) => {
    const id = String(item.id || "").toLowerCase();
    return !uploadedKeys.has(`id:${id}`);
  });

  if (!items.length) {
    return res.status(200).json({
      success: true,
      session_id: sessionId,
      guild,
      scope,
      count: 0,
      items: [],
      skipped_existing: allItems.length,
      message: allItems.length
        ? "Toutes les videos attendues sont deja recues par le VPS."
        : "Aucune defense a record pour cette selection.",
    });
  }

  try {
    const vps = await requestGvgVps("/api/v1/record/sessions", {
      method: "POST",
      body: {
        session_id: sessionId,
        guild,
        side: scope,
        source,
        items,
      },
    });

    return res.status(200).json({
      success: true,
      session_id: sessionId,
      guild,
      scope,
      count: items.length,
      items,
      skipped_existing: allItems.length - items.length,
      protocol_url: `paladin-gvg-record://start?guild=${encodeURIComponent(guild)}&side=${encodeURIComponent(scope)}&session=${encodeURIComponent(sessionId)}`,
      vps,
    });
  } catch (error) {
    console.error("[gvg-data:record_session_create] VPS error:", error);
    return res.status(error.statusCode || 500).json({
      error: error.message || "creation session record VPS impossible",
      details: error.data || undefined,
    });
  }
}

async function handleRecordSessions(req, res) {
  const body = req.body || {};
  const guild = normalizeGuildCode(body.guild || req.query?.guild);
  const rawLimit = Number(body.limit || req.query?.limit || 20);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 100)) : 20;

  if (!guild) {
    return res.status(400).json({ error: "guild invalide" });
  }

  const access = await resolveGvgActionScope(req, guild, { adminOnly: true });
  if (access.error) {
    return res.status(access.status || 403).json({ error: access.error });
  }

  try {
    const params = new URLSearchParams({
      guild,
      limit: String(limit),
    });
    const vps = await requestGvgVps(`/api/v1/record/sessions?${params.toString()}`);
    const sessions = vps?.sessions || [];
    const syncedYoutube = await syncRecordYoutubeLinksFromSessions(guild, sessions);

    return res.status(200).json({
      success: true,
      guild,
      sessions,
      synced_youtube: syncedYoutube,
    });
  } catch (error) {
    console.error("[gvg-data:record_sessions] VPS error:", error);
    return res.status(error.statusCode || 500).json({
      error: error.message || "lecture sessions record VPS impossible",
      details: error.data || undefined,
    });
  }
}

async function syncRecordYoutubeLinksFromSessions(guild, sessions) {
  const normalizedGuild = normalizeGuildCode(guild);
  if (!normalizedGuild) {
    return { updated: 0, candidates: 0, items: [] };
  }

  const candidatesById = new Map();

  for (const session of sessions || []) {
    for (const item of session?.items || []) {
      const id = String(item?.id || item?.defense_id || "").trim();
      const youtubeUrl = String(item?.youtube_url || "").trim();

      if (!id || !youtubeUrl) {
        continue;
      }

      candidatesById.set(id, {
        id,
        youtube_url: youtubeUrl,
        session_id: session?.session_id || null,
        item_key: item?.key || null,
      });
    }
  }

  const results = [];

  for (const item of candidatesById.values()) {
    const { data, error } = await supabase
      .from("gvg_defense")
      .update({
        youtube_url: item.youtube_url,
        record_status: "record",
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id)
      .eq("guild", normalizedGuild)
      .neq("record_status", "push")
      .select("id, youtube_url, record_status")
      .maybeSingle();

    if (error) {
      console.error("[gvg-data:record_youtube_sync] update error:", error);
      throw new Error("erreur synchronisation YouTube");
    }

    if (data) {
      results.push(data);
    }
  }

  return {
    updated: results.length,
    candidates: candidatesById.size,
    items: results,
  };
}

async function handleRecordYoutubeUpload(req, res) {
  const body = req.body || {};
  const guild = normalizeGuildCode(body.guild);
  const sessionId = String(body.session_id || body.sessionId || "").trim() || null;
  const rawLimit = Number(body.limit || 8);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 50)) : 8;

  if (!guild) {
    return res.status(400).json({ error: "guild invalide" });
  }

  const access = await resolveGvgActionScope(req, guild, { adminOnly: true });
  if (access.error) {
    return res.status(access.status || 403).json({ error: access.error });
  }

  try {
    const vps = await requestGvgVps("/api/v1/record/youtube/upload", {
      method: "POST",
      body: {
        guild,
        session_id: sessionId,
        limit,
      },
    });

    const params = new URLSearchParams({
      guild,
      limit: "100",
    });
    const sessionsResponse = await requestGvgVps(`/api/v1/record/sessions?${params.toString()}`);
    const sessions = sessionsResponse?.sessions || [];
    const syncedYoutube = await syncRecordYoutubeLinksFromSessions(guild, sessions);

    return res.status(200).json({
      success: true,
      guild,
      vps,
      sessions,
      synced_youtube: syncedYoutube,
    });
  } catch (error) {
    console.error("[gvg-data:record_youtube_upload] VPS error:", error);
    return res.status(error.statusCode || 500).json({
      error: error.message || "upload YouTube VPS impossible",
      details: error.data || undefined,
    });
  }
}

async function handleRecordOk(req, res) {
  const { guild } = req.body || {};

  if (!isValidGuild(guild)) {
    return res.status(400).json({ error: "guild manquante ou invalide" });
  }

  const normalizedGuild = String(guild).toUpperCase();

  const access = await resolveGvgActionScope(req, normalizedGuild, { adminOnly: true });
  if (access.error) {
    return res.status(access.status || 403).json({ error: access.error });
  }

  if (!UPLOADED_DIR) {
    return res.status(500).json({
      error: "YOUTUBE_UPLOADED_DIR manquant cote serveur",
    });
  }

  let filenames = [];
  try {
    filenames = fs.readdirSync(UPLOADED_DIR).filter((name) => /\.mp4$/i.test(name));
  } catch (error) {
    console.error("[gvg-data:record_ok] read dir error:", error);
    return res.status(500).json({ error: "impossible de lire le dossier uploaded" });
  }

const { data: defenses, error: readError } = await supabase
  .from("gvg_defense")
  .select("id, guild, bastion, type, tower, team, record_status, youtube_url, is_ally")
  .eq("guild", normalizedGuild)
  .in("record_status", ["pas_record", "a_record", "record"]);

  if (readError) {
    console.error("[gvg-data:record_ok] read defenses error:", readError);
    return res.status(500).json({ error: "erreur lecture gvg_defense" });
  }

  const updates = [];
const usedFiles = new Set();

for (const defense of defenses || []) {
  const defKey =
    defense.type === "fortress"
      ? `b${defense.bastion}_fort_team${defense.team}`
      : `b${defense.bastion}_t${defense.tower}_team${defense.team}`;

  const expectedPrefix = defense.is_ally
    ? `${defKey.toLowerCase()}_ally__`
    : `${defKey.toLowerCase()}__`;

  const matchedFile = filenames.find((name) => {
    const lower = name.toLowerCase();

    if (usedFiles.has(name)) return false;

    return lower.startsWith(expectedPrefix);
  });

  if (!matchedFile) continue;

  const match = matchedFile.match(/__(.+)\.mp4$/i);
  if (!match) continue;

  const videoId = String(match[1] || "").trim();
  if (!videoId) continue;

  usedFiles.add(matchedFile);

  updates.push({
    id: defense.id,
    youtube_url: `https://youtu.be/${videoId}`,
    record_status: "record",
    filename: matchedFile,
  });
}

  if (!updates.length) {
    return res.status(200).json({
      success: true,
      updated: 0,
      deleted: 0,
      items: [],
    });
  }

  const results = [];
  let deletedCount = 0;

  for (const item of updates) {
    const { data, error } = await supabase
      .from("gvg_defense")
 .update({
  youtube_url: item.youtube_url,
  record_status: item.record_status,
  updated_at: new Date().toISOString(),
})
      .eq("id", item.id)
      .select("id, youtube_url, record_status")
      .maybeSingle();

    if (error) {
      console.error("[gvg-data:record_ok] update error:", error);
      return res.status(500).json({ error: "erreur mise à jour record_ok" });
    }

    if (data) {
      results.push(data);

      const filePath = path.join(UPLOADED_DIR, item.filename);

      try {
        fs.unlinkSync(filePath);
        deletedCount += 1;
      } catch (deleteError) {
        console.error("[gvg-data:record_ok] delete file error:", deleteError);
      }
    }
  }

  return res.status(200).json({
    success: true,
    updated: results.length,
    deleted: deletedCount,
    items: results,
  });
}


function makeDefKey(defense) {
  if (defense.type === "fortress") {
    return `b${defense.bastion}_fort_team${defense.team}`;
  }

  return `b${defense.bastion}_t${defense.tower}_team${defense.team}`;
}

function makeStratName(defense) {
  if (defense.type === "fortress") {
    return `B${defense.bastion} Fort - Team ${defense.team}`;
  }

  return `B${defense.bastion} Tower ${defense.tower} - Team ${defense.team}`;
}

function normalizeChampionName(name) {
  if (!name) return null;

  return String(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .trim() || null;
}

function heroesToSlots(stratId, heroes) {
  const arr = Array.isArray(heroes) ? heroes : [];

  return arr
    .map((hero) => {
      if (!hero || typeof hero !== "object") return null;

      const champion = normalizeChampionName(hero.champion || hero.name);
      if (!champion) return null;

      const position = hero.position ? String(hero.position).toUpperCase().trim() : null;
      const direction = hero.direction ? String(hero.direction).toUpperCase().trim() : null;

      if (!position || !direction) return null;

      return {
        strat_id: stratId,
        champion,
        position,
        direction,
      };
    })
    .filter(Boolean);
}

function missingRunScopeColumnResponse(res) {
  return res.status(500).json({
    error: "Colonne defence_strat.guild_code manquante. Ajoute-la dans Supabase pour isoler les banques de runs externes.",
  });
}

async function findExistingRunStrat(defKey, youtubeUrl, runScope) {
  let { data, error } = await supabase
    .from("defence_strat")
    .select("id, guild_code")
    .eq("def_key", defKey)
    .eq("youtube_url", youtubeUrl);

  if (error) {
    if (!isMissingGuildCodeColumn(error)) throw error;
    if (!runScope.isPaladin) {
      const missingColumnError = new Error("missing defence_strat.guild_code");
      missingColumnError.missingGuildCodeColumn = true;
      throw missingColumnError;
    }

    const fallback = await supabase
      .from("defence_strat")
      .select("id")
      .eq("def_key", defKey)
      .eq("youtube_url", youtubeUrl)
      .limit(1);

    if (fallback.error) throw fallback.error;
    return fallback.data?.[0] || null;
  }

  return (data || []).find((strat) => stratMatchesRunScope(strat, runScope)) || null;
}

async function handlePushToBase(req, res) {
  const { guild } = req.body || {};

  if (!isValidGuild(guild)) {
    return res.status(400).json({ error: "guild manquante ou invalide" });
  }

  const normalizedGuild = String(guild).toUpperCase();
  const access = await resolveGvgActionScope(req, normalizedGuild, { adminOnly: true });
  if (access.error) {
    return res.status(access.status || 403).json({ error: access.error });
  }
  const runScope = access.scope;

  const { data: defenses, error: readError } = await supabase
    .from("gvg_defense")
    .select(`
      id,
      guild,
      bastion,
      type,
      tower,
      team,
      heroes,
      youtube_url,
      record_comment,
      attack_code,
      record_status
    `)
    .eq("guild", normalizedGuild)
    .eq("record_status", "record");

  if (readError) {
    console.error("[gvg-data:push_to_base] read defenses error:", readError);
    return res.status(500).json({ error: "erreur lecture gvg_defense" });
  }

  if (!defenses?.length) {
    return res.status(200).json({
      success: true,
      pushed: 0,
      items: [],
    });
  }

  const results = [];

  for (const defense of defenses) {
    if (!defense.youtube_url) {
      continue;
    }

    const defKey = makeDefKey(defense);
    const stratName = makeStratName(defense);

    let existingStrat = null;

    try {
      existingStrat = await findExistingRunStrat(defKey, defense.youtube_url, runScope);
    } catch (existingError) {
      console.error("[gvg-data:push_to_base] read defence_strat error:", existingError);
      if (existingError?.missingGuildCodeColumn) return missingRunScopeColumnResponse(res);
      return res.status(500).json({ error: "erreur lecture defence_strat" });
    }

    let stratId = existingStrat?.id || null;

    if (!stratId) {
      const insertPayload = {
        name: stratName,
        commentaire: defense.record_comment || null,
        youtube_url: defense.youtube_url,
        def_key: defKey,
        attack_code: defense.attack_code || null,
        guild_code: runScope.stratGuildCode,
      };

      let { data: insertedStrat, error: insertStratError } = await supabase
        .from("defence_strat")
        .insert(insertPayload)
        .select("id")
        .single();

      if (insertStratError && isMissingGuildCodeColumn(insertStratError) && runScope.isPaladin) {
        const fallbackPayload = { ...insertPayload };
        delete fallbackPayload.guild_code;

        const fallback = await supabase
          .from("defence_strat")
          .insert(fallbackPayload)
          .select("id")
          .single();

        insertedStrat = fallback.data;
        insertStratError = fallback.error;
      }

      if (insertStratError && isMissingGuildCodeColumn(insertStratError) && !runScope.isPaladin) {
        return missingRunScopeColumnResponse(res);
      }

      if (insertStratError || !insertedStrat?.id) {
        console.error("[gvg-data:push_to_base] insert defence_strat error:", insertStratError);
        return res.status(500).json({ error: "erreur insertion defence_strat" });
      }

      stratId = insertedStrat.id;
    } else {
      const updatePayload = {
        name: stratName,
        commentaire: defense.record_comment || null,
        attack_code: defense.attack_code || null,
      };

      if (!runScope.isPaladin) {
        updatePayload.guild_code = runScope.stratGuildCode;
      }

      let { error: updateStratError } = await supabase
        .from("defence_strat")
        .update(updatePayload)
        .eq("id", stratId);

      if (updateStratError && isMissingGuildCodeColumn(updateStratError) && runScope.isPaladin) {
        delete updatePayload.guild_code;
        const fallback = await supabase
          .from("defence_strat")
          .update(updatePayload)
          .eq("id", stratId);
        updateStratError = fallback.error;
      }

      if (updateStratError && isMissingGuildCodeColumn(updateStratError) && !runScope.isPaladin) {
        return missingRunScopeColumnResponse(res);
      }

      if (updateStratError) {
        console.error("[gvg-data:push_to_base] update defence_strat error:", updateStratError);
        return res.status(500).json({ error: "erreur mise à jour defence_strat" });
      }

      const { error: deleteSlotsError } = await supabase
        .from("defence_slot")
        .delete()
        .eq("strat_id", stratId);

      if (deleteSlotsError) {
        console.error("[gvg-data:push_to_base] delete defence_slot error:", deleteSlotsError);
        return res.status(500).json({ error: "erreur suppression defence_slot" });
      }
    }

    const slots = heroesToSlots(stratId, defense.heroes);

    if (slots.length) {
      const { error: insertSlotsError } = await supabase
        .from("defence_slot")
        .insert(slots);

      if (insertSlotsError) {
        console.error("[gvg-data:push_to_base] insert defence_slot error:", insertSlotsError);
        return res.status(500).json({ error: "erreur insertion defence_slot" });
      }
    }

    const { data: updatedDefense, error: updateDefenseError } = await supabase
      .from("gvg_defense")
      .update({
        record_status: "push",
        updated_at: new Date().toISOString(),
      })
      .eq("id", defense.id)
      .select("id, record_status, youtube_url")
      .maybeSingle();

    if (updateDefenseError) {
      console.error("[gvg-data:push_to_base] update gvg_defense error:", updateDefenseError);
      return res.status(500).json({ error: "erreur update gvg_defense" });
    }

    if (updatedDefense) {
      results.push(updatedDefense);
    }
  }

  return res.status(200).json({
    success: true,
    pushed: results.length,
    items: results,
  });
}

async function handlePanelReturn(req, res) {
  const { id } = req.body || {};

  if (!id) {
    return res.status(400).json({ error: "id manquant" });
  }

  const access = await loadGvgDefenseForAction(req, res, id, "id, guild", {
    adminOnly: true,
  });
  if (!access) return;

  const { data, error } = await supabase
    .from("gvg_defense")
    .update({
      record_status: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(GVG_DEFENSE_LIST_SELECT_BASE)
    .maybeSingle();

  if (error) {
    console.error("[gvg-data:panel_return] update error:", error);
    return res.status(500).json({ error: "erreur retour panel" });
  }

  if (!data) {
    return res.status(404).json({ error: "défense introuvable" });
  }

  let discordReproReopen = null;
  let discordReproWarning = null;

  try {
    discordReproReopen = await reopenDiscordReproRequestForDefense(supabase, data, {
      reason: "portal_panel_return",
      source: "gvg-data:panel_return",
      createIfMissing: true,
    });
  } catch (reopenError) {
    discordReproWarning = reopenError?.message || "reouverture Discord repro impossible";
    console.error("[gvg-data:panel_return] discord repro reopen error:", reopenError);
  }

  return res.status(200).json({
    success: true,
    item: data,
    discord_repro_reopen: discordReproReopen,
    discord_repro_warning: discordReproWarning,
  });
}

export default async function handler(req, res) {
  applyPortalCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    if (!verifyPortalRequestOrigin(req)) {
      return res.status(403).json({ error: "origine de requete refusee" });
    }

    const sessionCheck = await requirePortalSession(req, supabase);
    if (sessionCheck.error) {
      return res.status(sessionCheck.status || 401).json({ error: sessionCheck.error });
    }
    req.portalMember = sessionCheck.member;

    if (req.method === "GET") {
      return await handleList(req, res);
    }

if (req.method === "POST") {
  const action = req.body?.action;

  if (action === "repro" || action === "cancel") {
    return await handleUpdate(req, res);
  }

  if (action === "delete") {
    return await handleDelete(req, res);
  }

  if (action === "repro_candidates") {
    return await handleReproCandidates(req, res);
  }

  if (action === "import_groups") {
    return await handleImportGroups(req, res);
  }

  if (action === "calculate_groups") {
    return await handleCalculateGroups(req, res);
  }

  if (action === "panel_open") {
    return await handlePanelOpen(req, res);
  }

  if (action === "record_toggle") {
    return await handleRecordToggle(req, res);
  }

  if (action === "record_skip") {
    return await handleRecordSkip(req, res);
  }

  if (action === "record_session_create") {
    return await handleCreateRecordSession(req, res);
  }

  if (action === "record_sessions") {
    return await handleRecordSessions(req, res);
  }

if (action === "panel_update_fields") {
  return await handlePanelUpdateFields(req, res);
}

if (action === "record_ok") {
  return await handleRecordOk(req, res);
}

if (action === "record_youtube_upload") {
  return await handleRecordYoutubeUpload(req, res);
}

if (action === "push_to_base") {
  return await handlePushToBase(req, res);
}

if (action === "panel_return") {
  return await handlePanelReturn(req, res);
}

  return res.status(400).json({ error: "action invalide" });
}

    return res.status(405).json({ error: "method not allowed" });
  } catch (err) {
    console.error("[gvg-data] server error:", err);
    return res.status(500).json({ error: err?.message || "server error" });
  }
}
