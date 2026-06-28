import { createClient } from "@supabase/supabase-js";
import {
  canUseRunTargetGuild,
  getRunScopeForGvgGuild,
  getRunTargetGuildCode,
  isMissingGuildCodeColumn,
  isMissingRunBoycottTable,
  resolveRunScope,
  stratMatchesRunReadScope,
  stratMatchesRunScope,
} from "../src/lib/runScopeServer.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function normalizePos(pos) {
  if (!pos) return null;
  const p = String(pos).trim().toUpperCase();
  return /^[A-Z]\d{1,2}$/.test(p) ? p : null;
}

function normalizeChampionName(name) {
  if (!name) return null;
  return String(name)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\d+$/, "");
}

function normalizeDir(dir) {
  if (!dir) return null;
  const d = String(dir).trim().toUpperCase();

  if (["N", "NORD", "NORTH"].includes(d)) return "N";
  if (["S", "SUD", "SOUTH"].includes(d)) return "S";
  if (["E", "EST", "EAST"].includes(d)) return "E";
  if (["O", "OUEST", "WEST", "W"].includes(d)) return "O";

  return null;
}

function normalizeGvgGuildKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 24);
}

function normalizeChampion(champion) {
  return normalizeChampionName(champion);
}

function normalizeSlots(slots) {
  return Array.isArray(slots)
    ? slots.map((slot) => ({
        position: String(slot?.position || "").trim().toUpperCase(),
        hero: String(slot?.hero || "").trim().toLowerCase(),
        direction: String(slot?.direction || "").trim().toUpperCase(),
      }))
    : [];
}

function makeMissingGuildCodeError() {
  const error = new Error(
    "Colonne defence_strat.guild_code manquante. Ajoute-la dans Supabase pour activer les banques de runs externes."
  );
  error.statusCode = 500;
  return error;
}

function makeMissingBoycottTableError() {
  const error = new Error(
    "Table defence_strat_boycotts manquante. Ajoute-la dans Supabase pour activer le boycott de runs par guilde."
  );
  error.statusCode = 500;
  return error;
}

async function fetchBoycottedStratIds(supabaseClient, stratIds, targetGuildCode) {
  if (!stratIds?.length || !targetGuildCode) return new Set();

  const { data, error } = await supabaseClient
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

async function applyBoycottStatus(supabaseClient, strats, targetGuildCode) {
  const stratIds = (strats || []).map((strat) => strat.id).filter(Boolean);
  const boycottedIds = await fetchBoycottedStratIds(supabaseClient, stratIds, targetGuildCode);

  return (strats || []).map((strat) => ({
    ...strat,
    boycott: boycottedIds.has(String(strat.id)),
  }));
}

async function fetchScopedStratsByIds(
  supabaseClient,
  stratIds,
  scope,
  { matcher = stratMatchesRunScope } = {}
) {
  if (!stratIds?.length) return [];

  const { data, error } = await supabaseClient
    .from("defence_strat")
    .select("id, commentaire, youtube_url, created_at, attack_code, guild_code")
    .in("id", stratIds);

  if (error) {
    if (!isMissingGuildCodeColumn(error)) throw error;
    if (!scope?.isPaladin) throw makeMissingGuildCodeError();

    const fallback = await supabaseClient
      .from("defence_strat")
      .select("id, commentaire, youtube_url, created_at, attack_code")
      .in("id", stratIds);

    if (fallback.error) throw fallback.error;
    return (fallback.data || []).map((strat) => ({ ...strat, guild_code: null }));
  }

  return (data || []).filter((strat) => matcher(strat, scope));
}

async function fetchScopedStratById(
  supabaseClient,
  stratId,
  scope,
  { matcher = stratMatchesRunScope } = {}
) {
  const { data, error } = await supabaseClient
    .from("defence_strat")
    .select("id, commentaire, youtube_url, attack_code, guild_code")
    .eq("id", stratId)
    .maybeSingle();

  if (error) {
    if (!isMissingGuildCodeColumn(error)) throw error;
    if (!scope?.isPaladin) throw makeMissingGuildCodeError();

    const fallback = await supabaseClient
      .from("defence_strat")
      .select("id, commentaire, youtube_url, attack_code")
      .eq("id", stratId)
      .maybeSingle();

    if (fallback.error) throw fallback.error;
    const fallbackData = fallback.data ? { ...fallback.data, guild_code: null } : null;
    if (!fallbackData || !matcher(fallbackData, scope)) return null;
    return fallbackData;
  }

  if (!data || !matcher(data, scope)) return null;
  return data;
}

async function fetchCandidateStratIdsByChampionsStrict(
  supabaseClient,
  champions,
  { maxCandidates = 800 } = {}
) {
  const uniq = [...new Set((champions || []).filter(Boolean).map(normalizeChampion))];
  if (!uniq.length) return [];

  const orFilter = uniq.map((champion) => `champion.eq.${champion}`).join(",");

  const { data, error } = await supabaseClient
    .from("defence_slot")
    .select("strat_id, champion")
    .or(orFilter);

  if (error) throw error;

  const hitMap = new Map();

  for (const row of data || []) {
    const stratId = row.strat_id;
    const champion = normalizeChampion(row.champion);

    if (!hitMap.has(stratId)) hitMap.set(stratId, new Set());
    hitMap.get(stratId).add(champion);
  }

  return [...hitMap.entries()]
    .map(([stratId, set]) => ({ stratId, hits: set.size }))
    .sort((a, b) => b.hits - a.hits)
    .slice(0, maxCandidates)
    .map((item) => item.stratId);
}

function slotMatchesQuery(slot, query) {
  const slotChampion = normalizeChampion(slot.champion);
  const queryChampion = normalizeChampion(query.champion);

  if (slotChampion !== queryChampion) return false;

  if (query.position) {
    const slotPosition = normalizePos(slot.position);
    const queryPosition = normalizePos(query.position);
    if (slotPosition !== queryPosition) return false;
  }

  if (query.direction) {
    const slotDirection = normalizeDir(slot.direction);
    const queryDirection = normalizeDir(query.direction);
    if (slotDirection !== queryDirection) return false;
  }

  return true;
}

function stratMatchesAllQueries(stratSlots, queryItems) {
  return (queryItems || []).every((query) =>
    (stratSlots || []).some((slot) => slotMatchesQuery(slot, query))
  );
}

async function fetchAllSlotsForStratIds(supabaseClient, stratIds, pageSize = 1000) {
  let allSlots = [];

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;

    const { data, error } = await supabaseClient
      .from("defence_slot")
      .select("strat_id, champion, position, direction")
      .in("strat_id", stratIds)
      .range(from, to);

    if (error) throw error;

    allSlots = allSlots.concat(data || []);
    if (!data || data.length < pageSize) break;
  }

  return allSlots;
}

async function searchDefenceStrict(
  supabaseClient,
  queryItems,
  {
    limit = 10,
    maxCandidates = 50000,
    scope = null,
    includeBoycotted = false,
    targetGuildCode = "",
    matcher = stratMatchesRunReadScope,
  } = {}
) {
  if (!queryItems?.length) return [];

  const normalizedQuery = queryItems
    .map((query) => ({
      champion: normalizeChampion(query.champion),
      position: normalizePos(query.position),
      direction: normalizeDir(query.direction),
    }))
    .filter((query) => query.champion);

  if (!normalizedQuery.length) return [];

  const champions = normalizedQuery.map((query) => query.champion);
  const stratIds = await fetchCandidateStratIdsByChampionsStrict(
    supabaseClient,
    champions,
    { maxCandidates }
  );

  if (!stratIds.length) return [];

  const strats = await fetchScopedStratsByIds(supabaseClient, stratIds, scope, {
    matcher,
  });
  const scopedStratsWithBoycott = await applyBoycottStatus(supabaseClient, strats, targetGuildCode);
  const visibleStrats = includeBoycotted
    ? scopedStratsWithBoycott
    : scopedStratsWithBoycott.filter((strat) => strat.boycott !== true);
  const scopedStratIds = visibleStrats.map((strat) => strat.id).filter(Boolean);

  if (!scopedStratIds.length) return [];

  const slots = await fetchAllSlotsForStratIds(supabaseClient, scopedStratIds, 1000);
  const slotsByStrat = new Map();

  for (const slot of slots || []) {
    if (!slotsByStrat.has(slot.strat_id)) slotsByStrat.set(slot.strat_id, []);
    slotsByStrat.get(slot.strat_id).push({
      champion: normalizeChampion(slot.champion),
      position: slot.position ?? null,
      direction: slot.direction ?? null,
    });
  }

  const matched = (visibleStrats || [])
    .map((strat) => {
      const stratSlots = slotsByStrat.get(strat.id) || [];
      if (!stratMatchesAllQueries(stratSlots, normalizedQuery)) return null;

      return {
        strat_id: strat.id,
        commentaire: strat.commentaire,
        youtube_url: strat.youtube_url,
        created_at: strat.created_at,
        attack_code: strat.attack_code ?? null,
        guild_code: strat.guild_code ?? null,
        boycott: strat.boycott === true,
        slots: stratSlots,
      };
    })
    .filter(Boolean);

  matched.sort((a, b) => {
    const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
    const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (dateB !== dateA) return dateB - dateA;
    return a.strat_id - b.strat_id;
  });

  return matched.slice(0, limit);
}

async function handleAdd(req, res) {
  const { mode, youtubeUrl, attackCode, commentaire, slots } = req.body || {};
  const scope = await resolveRunScope(supabase, req);
  const normalizedSlots = normalizeSlots(slots);

  if (!youtubeUrl || !String(youtubeUrl).trim()) {
    return res.status(400).json({ error: "youtubeUrl manquant" });
  }

  if (!["tour", "bastion"].includes(String(mode || "").toLowerCase())) {
    return res.status(400).json({ error: "mode invalide" });
  }

  if (normalizedSlots.length !== 5) {
    return res.status(400).json({ error: "il faut exactement 5 slots" });
  }

  const hasIncompleteSlot = normalizedSlots.some(
    (slot) => !slot.position || !slot.hero || !slot.direction
  );

  if (hasIncompleteSlot) {
    return res.status(400).json({
      error: "chaque slot doit avoir une position, un heros et une direction",
    });
  }

  const stratPayload = {
    youtube_url: String(youtubeUrl).trim(),
    commentaire: String(commentaire || "").trim() || null,
    attack_code: String(attackCode || "").trim() || null,
    guild_code: scope.stratGuildCode,
  };

  let { data: stratRow, error: stratError } = await supabase
    .from("defence_strat")
    .insert(stratPayload)
    .select("id, youtube_url, commentaire, attack_code, guild_code")
    .single();

  if (stratError && isMissingGuildCodeColumn(stratError) && scope.isPaladin) {
    const fallbackPayload = { ...stratPayload };
    delete fallbackPayload.guild_code;

    const fallback = await supabase
      .from("defence_strat")
      .insert(fallbackPayload)
      .select("id, youtube_url, commentaire, attack_code")
      .single();

    stratRow = fallback.data ? { ...fallback.data, guild_code: null } : null;
    stratError = fallback.error;
  }

  if (stratError && isMissingGuildCodeColumn(stratError) && !scope.isPaladin) {
    return res.status(500).json({ error: makeMissingGuildCodeError().message });
  }

  if (stratError || !stratRow?.id) {
    return res.status(500).json({
      error: stratError?.message || "erreur creation defence_strat",
    });
  }

  const slotRows = normalizedSlots.map((slot) => ({
    strat_id: stratRow.id,
    champion: slot.hero,
    position: slot.position,
    direction: slot.direction,
  }));

  const { error: slotsError } = await supabase.from("defence_slot").insert(slotRows);

  if (slotsError) {
    return res.status(500).json({
      error: slotsError.message || "erreur creation defence_slot",
    });
  }

  return res.status(200).json({
    ok: true,
    strat_id: stratRow.id,
  });
}

async function handleSearch(req, res) {
  const { queryItems, includeBoycotted = false, targetGuildCode } = req.body || {};
  const scope = await resolveRunScope(supabase, req);
  const boycottGuildCode = getRunTargetGuildCode(scope, targetGuildCode);

  if (!Array.isArray(queryItems) || !queryItems.length) {
    return res.status(400).json({ error: "queryItems manquant" });
  }

  const results = await searchDefenceStrict(supabase, queryItems, {
    limit: 10,
    scope,
    includeBoycotted: includeBoycotted === true,
    targetGuildCode: boycottGuildCode,
  });

  return res.status(200).json(results);
}

async function handleGet(req, res) {
  const { id, targetGuildCode } = req.query || {};
  const scope = await resolveRunScope(supabase, req);
  const boycottGuildCode = getRunTargetGuildCode(scope, targetGuildCode);

  if (!id) {
    return res.status(400).json({ error: "id manquant" });
  }

  const strat = await fetchScopedStratById(supabase, id, scope);

  if (!strat) {
    return res.status(404).json({ error: "run introuvable" });
  }

  const { data: slots, error: slotsError } = await supabase
    .from("defence_slot")
    .select("champion, position, direction")
    .eq("strat_id", id);

  if (slotsError) {
    return res.status(500).json({ error: "erreur slots" });
  }

  const [stratWithBoycott] = await applyBoycottStatus(supabase, [strat], boycottGuildCode);

  return res.status(200).json({
    strat_id: strat.id,
    commentaire: strat.commentaire,
    youtube_url: strat.youtube_url,
    attack_code: strat.attack_code,
    boycott: stratWithBoycott?.boycott === true,
    boycott_guild_code: boycottGuildCode,
    slots: slots || [],
  });
}

async function refreshGvgDefenseStatus(supabaseClient, gvgDefenseId, targetGuildCode) {
  if (!gvgDefenseId) return null;

  const { data: defense, error } = await supabaseClient
    .from("gvg_defense")
    .select("id, guild, heroes, status")
    .eq("id", gvgDefenseId)
    .maybeSingle();

  if (error || !defense) return null;

  if (
    targetGuildCode &&
    normalizeGvgGuildKey(defense.guild) !== normalizeGvgGuildKey(targetGuildCode)
  ) {
    return null;
  }

  const currentStatus = String(defense.status || "").toLowerCase();
  if (currentStatus && !["strat", "def"].includes(currentStatus)) {
    return { id: defense.id, status: defense.status, changed: false };
  }

  const queryItems = (Array.isArray(defense.heroes) ? defense.heroes : [])
    .map((hero) => ({
      champion: hero?.champion,
      position: hero?.position,
      direction: hero?.direction,
    }))
    .filter((hero) => hero.champion);

  const activeRuns = await searchDefenceStrict(supabaseClient, queryItems, {
    limit: 1,
    scope: getRunScopeForGvgGuild(defense.guild),
    includeBoycotted: false,
    targetGuildCode: defense.guild,
    matcher: stratMatchesRunScope,
  });

  const nextStatus = activeRuns.length ? "strat" : "def";
  if (nextStatus === defense.status) {
    return { id: defense.id, status: defense.status, changed: false };
  }

  const { error: updateError } = await supabaseClient
    .from("gvg_defense")
    .update({ status: nextStatus })
    .eq("id", defense.id);

  if (updateError) throw updateError;

  return { id: defense.id, status: nextStatus, changed: true };
}

async function handleBoycott(req, res) {
  const { strat_id, boycott = true, targetGuildCode, gvgDefenseId } = req.body || {};
  const scope = await resolveRunScope(supabase, req);

  if (!strat_id) {
    return res.status(400).json({ error: "strat_id manquant" });
  }

  if (targetGuildCode && !canUseRunTargetGuild(scope, targetGuildCode)) {
    return res.status(403).json({ error: "guilde cible hors perimetre" });
  }

  const boycottGuildCode = getRunTargetGuildCode(scope, targetGuildCode);
  const strat = await fetchScopedStratById(supabase, strat_id, scope, {
    matcher: stratMatchesRunReadScope,
  });

  if (!strat) {
    return res.status(404).json({ error: "run introuvable dans ce perimetre" });
  }

  if (boycott === true) {
    const payload = {
      strat_id,
      guild_code: boycottGuildCode,
      actor_member_id: scope.memberId || null,
      actor_name: scope.actorName || null,
    };

    const { error } = await supabase
      .from("defence_strat_boycotts")
      .upsert(payload, { onConflict: "strat_id,guild_code" });

    if (error) {
      if (isMissingRunBoycottTable(error)) {
        return res.status(500).json({ error: makeMissingBoycottTableError().message });
      }

      return res.status(500).json({ error: error.message || "erreur boycott run" });
    }
  } else {
    const { error } = await supabase
      .from("defence_strat_boycotts")
      .delete()
      .eq("strat_id", strat_id)
      .eq("guild_code", boycottGuildCode);

    if (error) {
      if (isMissingRunBoycottTable(error)) {
        return res.status(500).json({ error: makeMissingBoycottTableError().message });
      }

      return res.status(500).json({ error: error.message || "erreur reactivation run" });
    }
  }

  const gvgStatus = await refreshGvgDefenseStatus(supabase, gvgDefenseId, boycottGuildCode);

  return res.status(200).json({
    success: true,
    strat_id,
    guild_code: boycottGuildCode,
    boycott: boycott === true,
    gvg_status: gvgStatus?.status || null,
  });
}

async function handleUpdate(req, res) {
  const { strat_id, youtubeUrl, attackCode, commentaire, slots } = req.body || {};
  const scope = await resolveRunScope(supabase, req);

  if (!strat_id) {
    return res.status(400).json({ error: "strat_id manquant" });
  }

  if (!youtubeUrl?.trim()) {
    return res.status(400).json({ error: "youtubeUrl manquant" });
  }

  const normalizedSlots = normalizeSlots(slots);

  if (normalizedSlots.length !== 5) {
    return res.status(400).json({ error: "5 slots obligatoires" });
  }

  const hasIncompleteSlot = normalizedSlots.some(
    (slot) => !slot?.position || !slot?.hero || !slot?.direction
  );

  if (hasIncompleteSlot) {
    return res.status(400).json({
      error: "Chaque slot doit avoir position, hero, direction",
    });
  }

  const existingStrat = await fetchScopedStratById(supabase, strat_id, scope);
  if (!existingStrat) {
    return res.status(404).json({ error: "run introuvable pour cette guilde" });
  }

  const updatePayload = {
    youtube_url: youtubeUrl.trim(),
    attack_code: attackCode?.trim() || null,
    commentaire: commentaire?.trim() || null,
  };

  let { error: updateStratError } = await supabase
    .from("defence_strat")
    .update(updatePayload)
    .eq("id", strat_id);

  if (updateStratError) {
    return res.status(500).json({ error: "erreur update strat" });
  }

  const { error: deleteSlotsError } = await supabase
    .from("defence_slot")
    .delete()
    .eq("strat_id", strat_id);

  if (deleteSlotsError) {
    return res.status(500).json({ error: "erreur suppression slots" });
  }

  const payload = normalizedSlots.map((slot) => ({
    strat_id,
    champion: slot.hero,
    position: slot.position,
    direction: slot.direction,
  }));

  const { error: insertSlotsError } = await supabase
    .from("defence_slot")
    .insert(payload);

  if (insertSlotsError) {
    return res.status(500).json({ error: "erreur insertion slots" });
  }

  return res.status(200).json({
    success: true,
    strat_id,
  });
}

async function handleDelete(req, res) {
  const { strat_id } = req.body || {};
  const scope = await resolveRunScope(supabase, req);

  if (!strat_id) {
    return res.status(400).json({ error: "strat_id manquant" });
  }

  const existingStrat = await fetchScopedStratById(supabase, strat_id, scope);
  if (!existingStrat) {
    return res.status(404).json({ error: "run introuvable pour cette guilde" });
  }

  const { error: deleteSlotsError } = await supabase
    .from("defence_slot")
    .delete()
    .eq("strat_id", strat_id);

  if (deleteSlotsError) {
    return res.status(500).json({ error: "erreur suppression slots" });
  }

  const { error: deleteStratError } = await supabase
    .from("defence_strat")
    .delete()
    .eq("id", strat_id);

  if (deleteStratError) {
    return res.status(500).json({ error: "erreur suppression strat" });
  }

  return res.status(200).json({
    success: true,
    strat_id,
  });
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const action = String(
    req.query?.action || req.body?.action || (req.method === "GET" ? "get" : "")
  ).toLowerCase();

  try {
    if (req.method === "GET") {
      if (action === "get") return handleGet(req, res);
      return res.status(400).json({ error: "action GET inconnue" });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "method not allowed" });
    }

    if (action === "add") return handleAdd(req, res);
    if (action === "search") return handleSearch(req, res);
    if (action === "update") return handleUpdate(req, res);
    if (action === "delete") return handleDelete(req, res);
    if (action === "boycott") return handleBoycott(req, res);

    return res.status(400).json({ error: "action POST inconnue" });
  } catch (error) {
    console.error("[api/run]", error);
    return res.status(500).json({ error: error?.message || "server error" });
  }
}
