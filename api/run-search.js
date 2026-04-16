import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

function normalizePos(pos) {
  if (!pos) return null;
  const p = String(pos).trim().toUpperCase();
  return /^[A-H][1-8]$/.test(p) ? p : null;
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

  if (d === "↑") return "N";
  if (d === "↓") return "S";
  if (d === "→") return "E";
  if (d === "←") return "O";

  return null;
}

function normalizeChampion(ch) {
  return normalizeChampionName(ch);
}

async function fetchCandidateStratIdsByChampionsStrict(
  supabaseClient,
  champions,
  { maxCandidates = 800 } = {}
) {
  const uniq = [...new Set((champions || []).filter(Boolean).map(normalizeChampion))];
  if (!uniq.length) return [];

  const orFilter = uniq.map((c) => `champion.eq.${c}`).join(",");

  const { data, error } = await supabaseClient
    .from("defence_slot")
    .select("strat_id, champion")
    .or(orFilter);

  if (error) throw error;

  const hitMap = new Map();
  for (const row of data || []) {
    const sid = row.strat_id;
    const ch = normalizeChampion(row.champion);
    if (!hitMap.has(sid)) hitMap.set(sid, new Set());
    hitMap.get(sid).add(ch);
  }

  return [...hitMap.entries()]
    .map(([sid, set]) => ({ sid, hits: set.size }))
    .sort((a, b) => b.hits - a.hits)
    .slice(0, maxCandidates)
    .map((x) => x.sid);
}

function slotMatchesQuery(slot, q) {
  const chSlot = normalizeChampion(slot.champion);
  const chQ = normalizeChampion(q.champion);

  if (chSlot !== chQ) return false;

  if (q.position) {
    const posSlot = normalizePos(slot.position);
    const posQ = normalizePos(q.position);
    if (posSlot !== posQ) return false;
  }

  if (q.direction) {
    const dirSlot = normalizeDir(slot.direction);
    const dirQ = normalizeDir(q.direction);
    if (dirSlot !== dirQ) return false;
  }

  return true;
}

function stratMatchesAllQueries(stratSlots, queryItems) {
  return (queryItems || []).every((q) =>
    (stratSlots || []).some((s) => slotMatchesQuery(s, q))
  );
}

async function fetchAllSlotsForStratIds(supabaseClient, stratIds, pageSize = 1000) {
  let all = [];

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;

    const { data, error } = await supabaseClient
      .from("defence_slot")
      .select("strat_id, champion, position, direction")
      .in("strat_id", stratIds)
      .range(from, to);

    if (error) throw error;

    all = all.concat(data || []);
    if (!data || data.length < pageSize) break;
  }

  return all;
}

async function searchDefenceStrict(
  supabaseClient,
  queryItems,
  { limit = 10, maxCandidates = 50000 } = {}
) {
  if (!queryItems?.length) return [];

  const normQuery = queryItems
    .map((q) => ({
      champion: normalizeChampion(q.champion),
      position: normalizePos(q.position),
      direction: normalizeDir(q.direction),
    }))
    .filter((q) => q.champion);

  if (!normQuery.length) return [];

  const champions = normQuery.map((q) => q.champion);

  const stratIds = await fetchCandidateStratIdsByChampionsStrict(
    supabaseClient,
    champions,
    { maxCandidates }
  );

  if (!stratIds.length) return [];

  const { data: strats, error: e1 } = await supabaseClient
    .from("defence_strat")
    .select("id, commentaire, youtube_url, created_at, attack_code")
    .in("id", stratIds);

  if (e1) throw e1;

  const slots = await fetchAllSlotsForStratIds(supabaseClient, stratIds, 1000);

  const slotsByStrat = new Map();
  for (const s of slots || []) {
    if (!slotsByStrat.has(s.strat_id)) slotsByStrat.set(s.strat_id, []);
    slotsByStrat.get(s.strat_id).push({
      champion: normalizeChampion(s.champion),
      position: s.position ?? null,
      direction: s.direction ?? null,
    });
  }

  const matched = (strats || [])
    .map((s) => {
      const stratSlots = slotsByStrat.get(s.id) || [];

      if (!stratMatchesAllQueries(stratSlots, normQuery)) return null;

      return {
        strat_id: s.id,
        commentaire: s.commentaire,
        youtube_url: s.youtube_url,
        created_at: s.created_at,
        attack_code: s.attack_code ?? null,
        slots: stratSlots,
      };
    })
    .filter(Boolean);

  matched.sort((a, b) => {
    const da = a.created_at ? new Date(a.created_at).getTime() : 0;
    const db = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (db !== da) return db - da;
    return a.strat_id - b.strat_id;
  });

  return matched.slice(0, limit);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    const { queryItems } = req.body || {};

    if (!Array.isArray(queryItems) || !queryItems.length) {
      return res.status(400).json({ error: "queryItems manquant" });
    }

    const results = await searchDefenceStrict(supabase, queryItems, {
      limit: 10,
    });

    return res.status(200).json(results);
  } catch (err) {
    console.error("[api/run-search]", err);
    return res.status(500).json({ error: "server error" });
  }
}