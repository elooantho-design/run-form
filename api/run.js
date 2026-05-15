import { createClient } from "@supabase/supabase-js";

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
  { limit = 10, maxCandidates = 50000 } = {}
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

  const { data: strats, error: stratsError } = await supabaseClient
    .from("defence_strat")
    .select("id, commentaire, youtube_url, created_at, attack_code")
    .in("id", stratIds);

  if (stratsError) throw stratsError;

  const slots = await fetchAllSlotsForStratIds(supabaseClient, stratIds, 1000);
  const slotsByStrat = new Map();

  for (const slot of slots || []) {
    if (!slotsByStrat.has(slot.strat_id)) slotsByStrat.set(slot.strat_id, []);
    slotsByStrat.get(slot.strat_id).push({
      champion: normalizeChampion(slot.champion),
      position: slot.position ?? null,
      direction: slot.direction ?? null,
    });
  }

  const matched = (strats || [])
    .map((strat) => {
      const stratSlots = slotsByStrat.get(strat.id) || [];
      if (!stratMatchesAllQueries(stratSlots, normalizedQuery)) return null;

      return {
        strat_id: strat.id,
        commentaire: strat.commentaire,
        youtube_url: strat.youtube_url,
        created_at: strat.created_at,
        attack_code: strat.attack_code ?? null,
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

  const { data: stratRow, error: stratError } = await supabase
    .from("defence_strat")
    .insert({
      youtube_url: String(youtubeUrl).trim(),
      commentaire: String(commentaire || "").trim() || null,
      attack_code: String(attackCode || "").trim() || null,
    })
    .select("id, youtube_url, commentaire, attack_code")
    .single();

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
  const { queryItems } = req.body || {};

  if (!Array.isArray(queryItems) || !queryItems.length) {
    return res.status(400).json({ error: "queryItems manquant" });
  }

  const results = await searchDefenceStrict(supabase, queryItems, {
    limit: 10,
  });

  return res.status(200).json(results);
}

async function handleGet(req, res) {
  const { id } = req.query || {};

  if (!id) {
    return res.status(400).json({ error: "id manquant" });
  }

  const { data: strat, error: stratError } = await supabase
    .from("defence_strat")
    .select("id, commentaire, youtube_url, attack_code")
    .eq("id", id)
    .single();

  if (stratError || !strat) {
    return res.status(404).json({ error: "run introuvable" });
  }

  const { data: slots, error: slotsError } = await supabase
    .from("defence_slot")
    .select("champion, position, direction")
    .eq("strat_id", id);

  if (slotsError) {
    return res.status(500).json({ error: "erreur slots" });
  }

  return res.status(200).json({
    strat_id: strat.id,
    commentaire: strat.commentaire,
    youtube_url: strat.youtube_url,
    attack_code: strat.attack_code,
    slots: slots || [],
  });
}

async function handleUpdate(req, res) {
  const { strat_id, youtubeUrl, attackCode, commentaire, slots } = req.body || {};

  if (!strat_id) {
    return res.status(400).json({ error: "strat_id manquant" });
  }

  if (!youtubeUrl?.trim()) {
    return res.status(400).json({ error: "youtubeUrl manquant" });
  }

  if (!Array.isArray(slots) || slots.length !== 5) {
    return res.status(400).json({ error: "5 slots obligatoires" });
  }

  const hasIncompleteSlot = slots.some(
    (slot) => !slot?.position || !slot?.hero || !slot?.direction
  );

  if (hasIncompleteSlot) {
    return res.status(400).json({
      error: "Chaque slot doit avoir position, hero, direction",
    });
  }

  const { error: updateStratError } = await supabase
    .from("defence_strat")
    .update({
      youtube_url: youtubeUrl.trim(),
      attack_code: attackCode?.trim() || null,
      commentaire: commentaire?.trim() || null,
    })
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

  const payload = slots.map((slot) => ({
    strat_id,
    champion: String(slot.hero).trim().toLowerCase(),
    position: String(slot.position).trim().toUpperCase(),
    direction: String(slot.direction).trim().toUpperCase(),
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

  if (!strat_id) {
    return res.status(400).json({ error: "strat_id manquant" });
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

    return res.status(400).json({ error: "action POST inconnue" });
  } catch (error) {
    console.error("[api/run]", error);
    return res.status(500).json({ error: error?.message || "server error" });
  }
}
