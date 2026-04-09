import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

function parseDefenseMeta(defName) {
  const value = String(defName || "").toLowerCase();

  const bastionMatch = value.match(/bastion_(\d+)/);
  const teamMatch = value.match(/team_(\d+)/);
  const towerMatch = value.match(/tower_(\d+)/);

  const bastion = bastionMatch ? Number(bastionMatch[1]) : null;
  const team = teamMatch ? Number(teamMatch[1]) : null;
  const tower = towerMatch ? Number(towerMatch[1]) : null;
  const type = value.includes("fortress")
    ? "fortress"
    : value.includes("tower")
      ? "tower"
      : null;

  return { bastion, team, tower, type };
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

function normalizePos(pos) {
  if (!pos) return null;
  return String(pos).trim().toUpperCase();
}

function normalizeDir(dir) {
  if (!dir) return null;
  const d = String(dir).trim().toUpperCase();

  if (["N", "NORD", "NORTH", "↑"].includes(d)) return "N";
  if (["S", "SUD", "SOUTH", "↓"].includes(d)) return "S";
  if (["E", "EST", "EAST", "→"].includes(d)) return "E";
  if (["O", "OUEST", "WEST", "W", "←"].includes(d)) return "O";

  return d;
}

function buildQueryItemsFromHeroes(heroes) {
  return (heroes || [])
    .map((hero) => ({
      champion: normalizeChampionName(hero?.champion),
      position: normalizePos(hero?.position),
      direction: normalizeDir(hero?.direction),
    }))
    .filter((item) => item.champion && item.position && item.direction);
}

function slotMatchesQuery(slot, q) {
  const slotChampion = normalizeChampionName(slot?.champion);
  const slotPosition = normalizePos(slot?.position);
  const slotDirection = normalizeDir(slot?.direction);

  return (
    slotChampion === q.champion &&
    slotPosition === q.position &&
    slotDirection === q.direction
  );
}

function stratMatchesAllQueries(stratSlots, queryItems) {
  return (queryItems || []).every((q) =>
    (stratSlots || []).some((slot) => slotMatchesQuery(slot, q))
  );
}

async function fetchCandidateStratIdsByChampionsStrict(supabaseClient, champions) {
  const uniq = [...new Set((champions || []).filter(Boolean))];
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
    const ch = normalizeChampionName(row.champion);

    if (!hitMap.has(sid)) hitMap.set(sid, new Set());
    hitMap.get(sid).add(ch);
  }

  return [...hitMap.entries()]
    .map(([sid, set]) => ({ sid, hits: set.size }))
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 800)
    .map((x) => x.sid);
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

async function hasMatchingStrat(supabaseClient, heroes) {
  const queryItems = buildQueryItemsFromHeroes(heroes);
  if (!queryItems.length) return false;

  const champions = queryItems.map((item) => item.champion);

  const stratIds = await fetchCandidateStratIdsByChampionsStrict(
    supabaseClient,
    champions
  );

  if (!stratIds.length) return false;

  const slots = await fetchAllSlotsForStratIds(supabaseClient, stratIds, 1000);

  const slotsByStrat = new Map();
  for (const slot of slots || []) {
    if (!slotsByStrat.has(slot.strat_id)) slotsByStrat.set(slot.strat_id, []);
    slotsByStrat.get(slot.strat_id).push({
      champion: slot.champion,
      position: slot.position,
      direction: slot.direction,
    });
  }

  for (const stratId of stratIds) {
    const stratSlots = slotsByStrat.get(stratId) || [];
    if (stratMatchesAllQueries(stratSlots, queryItems)) {
      return true;
    }
  }

  return false;
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
    const { guild, items } = req.body || {};

    if (!guild || !["G1", "G2"].includes(String(guild).toUpperCase())) {
      return res.status(400).json({ error: "guild manquante ou invalide" });
    }

    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: "items manquants" });
    }

    const normalizedGuild = String(guild).toUpperCase();

    const rows = [];

    for (const item of items) {
      const meta = parseDefenseMeta(item?.def);

      if (!meta.bastion || !meta.team || !meta.type) {
        continue;
      }

      const heroes = Array.isArray(item?.compo) ? item.compo : [];
      const stratFound = await hasMatchingStrat(supabase, heroes);

      rows.push({
        guild: normalizedGuild,
        bastion: meta.bastion,
        type: meta.type,
        tower: meta.type === "tower" ? meta.tower : null,
        team: meta.team,
        defense_key: item?.def_key_sha1 || null,
        raw_name: String(item?.def || ""),
        heroes,
        status: stratFound ? "strat" : "def",
        repro_by: null,
      });
    }

    if (!rows.length) {
      return res.status(400).json({ error: "aucune défense exploitable" });
    }

    const { data, error } = await supabase
      .from("gvg_defense")
      .insert(rows)
      .select("id, guild, bastion, type, tower, team, status");

    if (error) {
      console.error("[api/gvg-import] insert error:", error);
      return res.status(500).json({ error: "erreur insertion gvg" });
    }

    return res.status(200).json({
      success: true,
      guild: normalizedGuild,
      inserted: data?.length || 0,
    });
  } catch (err) {
    console.error("[api/gvg-import]", err);
    return res.status(500).json({ error: "server error" });
  }
}