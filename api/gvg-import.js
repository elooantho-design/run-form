import { createClient } from "@supabase/supabase-js";
import {
  getRunScopeForGvgGuild,
  isMissingGuildCodeColumn,
  isMissingRunBoycottTable,
  stratMatchesRunReadScope,
} from "../src/lib/runScopeServer.js";
import { notifyDiscordReproRequestsForDefenses } from "../src/lib/discordReproServer.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

function normalizeGuildCode(value) {
  const code = String(value || "").trim().toUpperCase().replace(/\s+/g, "_");
  return /^[A-Z0-9_-]{2,24}$/.test(code) ? code : null;
}

function isValidGuild(value) {
  return normalizeGuildCode(value) !== null;
}

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

function makeMissingGuildCodeError() {
  const error = new Error(
    "Colonne defence_strat.guild_code manquante. Ajoute-la dans Supabase pour isoler les banques de runs externes."
  );
  error.statusCode = 500;
  return error;
}

async function fetchScopedStratIds(supabaseClient, stratIds, runScope) {
  if (!stratIds?.length) return [];

  let { data, error } = await supabaseClient
    .from("defence_strat")
    .select("id, guild_code")
    .in("id", stratIds);

  if (error) {
    if (!isMissingGuildCodeColumn(error)) throw error;
    if (!runScope?.isPaladin) throw makeMissingGuildCodeError();

    const fallback = await supabaseClient
      .from("defence_strat")
      .select("id")
      .in("id", stratIds);

    if (fallback.error) throw fallback.error;
    data = (fallback.data || []).map((strat) => ({ ...strat, guild_code: null }));
  }

  const scopedIds = (data || [])
    .filter((strat) => stratMatchesRunReadScope(strat, runScope))
    .map((strat) => strat.id)
    .filter(Boolean);

  if (!scopedIds.length) return [];

  const { data: boycottRows, error: boycottError } = await supabaseClient
    .from("defence_strat_boycotts")
    .select("strat_id")
    .eq("guild_code", runScope.guildCode)
    .in("strat_id", scopedIds);

  if (boycottError) {
    if (isMissingRunBoycottTable(boycottError)) return scopedIds;
    throw boycottError;
  }

  const boycottedIds = new Set((boycottRows || []).map((row) => String(row.strat_id)));
  return scopedIds.filter((stratId) => !boycottedIds.has(String(stratId)));
}

async function hasMatchingStrat(supabaseClient, heroes, runScope) {
  const queryItems = buildQueryItemsFromHeroes(heroes);
  if (!queryItems.length) return false;

  const champions = queryItems.map((item) => item.champion);

  const stratIds = await fetchCandidateStratIdsByChampionsStrict(
    supabaseClient,
    champions
  );

  if (!stratIds.length) return false;

  const scopedStratIds = await fetchScopedStratIds(supabaseClient, stratIds, runScope);
  if (!scopedStratIds.length) return false;

  const slots = await fetchAllSlotsForStratIds(supabaseClient, scopedStratIds, 1000);

  const slotsByStrat = new Map();
  for (const slot of slots || []) {
    if (!slotsByStrat.has(slot.strat_id)) slotsByStrat.set(slot.strat_id, []);
    slotsByStrat.get(slot.strat_id).push({
      champion: slot.champion,
      position: slot.position,
      direction: slot.direction,
    });
  }

  for (const stratId of scopedStratIds) {
    const stratSlots = slotsByStrat.get(stratId) || [];
    if (stratMatchesAllQueries(stratSlots, queryItems)) {
      return true;
    }
  }

  return false;
}

export async function importGvgItems({ guild, items, is_ally = false }) {
  const isAlly = is_ally === true;

  if (!isValidGuild(guild)) {
    const error = new Error("guild manquante ou invalide");
    error.statusCode = 400;
    throw error;
  }

  if (!Array.isArray(items) || !items.length) {
    const error = new Error("items manquants");
    error.statusCode = 400;
    throw error;
  }

  const normalizedGuild = normalizeGuildCode(guild);
  const runScope = getRunScopeForGvgGuild(normalizedGuild);
  const rows = [];

  for (const item of items) {
    const meta = parseDefenseMeta(item?.def);

    if (!meta.bastion || !meta.team || !meta.type) {
      continue;
    }

    const heroes = Array.isArray(item?.compo) ? item.compo : [];
    const stratFound = await hasMatchingStrat(supabase, heroes, runScope);

    rows.push({
      guild: normalizedGuild,
      bastion: meta.bastion,
      type: meta.type,
      tower: meta.type === "tower" ? meta.tower : null,
      team: meta.team,
      defense_key: item?.def_key_sha1 || null,
      raw_name: String(item?.def || ""),
      heroes,
      image_url: item?.image_url || null,
      status: stratFound ? "strat" : "def",
      repro_by: null,
      is_ally: isAlly,
      record_status: isAlly ? "pas_record" : null,
    });
  }

  if (!rows.length) {
    const error = new Error("aucune defense exploitable");
    error.statusCode = 400;
    throw error;
  }

  const { data, error } = await supabase
    .from("gvg_defense")
    .insert(rows)
    .select("id, guild, bastion, type, tower, team, status, raw_name, heroes, image_url, is_ally");

  if (error) {
    console.error("[api/gvg-import:helper] insert error:", error);
    const wrapped = new Error(error.message || "erreur insertion gvg");
    wrapped.statusCode = 500;
    throw wrapped;
  }

  const discordRepro = await notifyDiscordReproRequestsForDefenses(supabase, data || []);

  return {
    success: true,
    guild: normalizedGuild,
    inserted: data?.length || 0,
    discord_repro: discordRepro,
  };
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
    const { guild, items, is_ally } = req.body || {};
    const isAlly = is_ally === true;

    if (!isValidGuild(guild)) {
      return res.status(400).json({ error: "guild manquante ou invalide" });
    }

    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: "items manquants" });
    }

    const normalizedGuild = normalizeGuildCode(guild);
    const runScope = getRunScopeForGvgGuild(normalizedGuild);

    const rows = [];

    for (const item of items) {
      const meta = parseDefenseMeta(item?.def);

      if (!meta.bastion || !meta.team || !meta.type) {
        continue;
      }

      const heroes = Array.isArray(item?.compo) ? item.compo : [];
      const stratFound = await hasMatchingStrat(supabase, heroes, runScope);

      rows.push({
        guild: normalizedGuild,
        bastion: meta.bastion,
        type: meta.type,
        tower: meta.type === "tower" ? meta.tower : null,
        team: meta.team,
        defense_key: item?.def_key_sha1 || null,
        raw_name: String(item?.def || ""),
        heroes,
        image_url: item?.image_url || null,
        status: stratFound ? "strat" : "def",
        repro_by: null,
        is_ally: isAlly,
        record_status: isAlly ? "pas_record" : null,
      });
    }

    if (!rows.length) {
      return res.status(400).json({ error: "aucune défense exploitable" });
    }

    const { data, error } = await supabase
      .from("gvg_defense")
      .insert(rows)
      .select("id, guild, bastion, type, tower, team, status, raw_name, heroes, image_url, is_ally");

    if (error) {
      console.error("[api/gvg-import] insert error:", error);
      return res.status(500).json({ error: "erreur insertion gvg" });
    }

    const discordRepro = await notifyDiscordReproRequestsForDefenses(supabase, data || []);

    return res.status(200).json({
      success: true,
      guild: normalizedGuild,
      inserted: data?.length || 0,
      discord_repro: discordRepro,
    });
  } catch (err) {
    console.error("[api/gvg-import]", err);
    return res.status(500).json({ error: "server error" });
  }
}
