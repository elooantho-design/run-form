import { createClient } from "@supabase/supabase-js";
import {
  applyPortalCorsHeaders,
  requirePortalSession,
  verifyPortalRequestOrigin,
} from "./_portal-auth.js";
import {
  canUseRunTargetGuild,
  isMissingGuildCodeColumn,
  isMissingRunBoycottTable,
  resolveRunScope,
  stratMatchesRunReadScope,
} from "../src/lib/runScopeServer.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const GVG_POSITION_GRIDS = {
  tower: { rows: 7, cols: 10 },
  fortress: { rows: 8, cols: 11 },
};

function normalizeGvgMapType(mapType) {
  const value = String(mapType || "").trim().toLowerCase();
  if (value === "fortress" || value === "bastion") return "fortress";
  if (value === "tower" || value === "tour") return "tower";
  return "tower";
}

export function normalizeGvgPosition(pos, mapType = "tower") {
  if (!pos) return null;
  const p = String(pos).trim().toUpperCase();
  const match = /^([A-Z])([1-9]\d?)$/.exec(p);
  if (!match) return null;

  const grid = GVG_POSITION_GRIDS[normalizeGvgMapType(mapType)] || GVG_POSITION_GRIDS.tower;
  const row = match[1].charCodeAt(0) - "A".charCodeAt(0) + 1;
  const col = Number(match[2]);

  return row >= 1 && row <= grid.rows && col >= 1 && col <= grid.cols ? p : null;
}

function normalizePos(pos, mapType = "tower") {
  return normalizeGvgPosition(pos, mapType);
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
    const posSlot = normalizePos(slot.position, q.mapType);
    const posQ = normalizePos(q.position, q.mapType);
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
  { limit = 10, maxCandidates = 50000, scope = null, targetGuildCode = "", mapType = "tower" } = {}
) {
  if (!queryItems?.length) return [];

  const normalizedMapType = normalizeGvgMapType(mapType);
  const normQuery = queryItems
    .map((q) => ({
      champion: normalizeChampion(q.champion),
      position: normalizePos(q.position, normalizedMapType),
      direction: normalizeDir(q.direction),
      mapType: normalizedMapType,
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

  let { data: strats, error: e1 } = await supabaseClient
    .from("defence_strat")
    .select("id, commentaire, youtube_url, created_at, attack_code, guild_code")
    .in("id", stratIds);

  if (e1) {
    if (!isMissingGuildCodeColumn(e1)) throw e1;
    if (!scope?.isPaladin) {
      throw new Error("Colonne defence_strat.guild_code manquante pour isoler les banques de runs externes.");
    }

    const fallback = await supabaseClient
      .from("defence_strat")
      .select("id, commentaire, youtube_url, created_at, attack_code")
      .in("id", stratIds);

    if (fallback.error) throw fallback.error;
    strats = (fallback.data || []).map((strat) => ({ ...strat, guild_code: null }));
  }

  strats = (strats || []).filter((strat) => stratMatchesRunReadScope(strat, scope));

  if (targetGuildCode && strats.length) {
    const scopedIds = strats.map((strat) => strat.id).filter(Boolean);
    const { data: boycottRows, error: boycottError } = await supabaseClient
      .from("defence_strat_boycotts")
      .select("strat_id")
      .eq("guild_code", targetGuildCode)
      .in("strat_id", scopedIds);

    if (boycottError) {
      if (!isMissingRunBoycottTable(boycottError)) throw boycottError;
    } else {
      const boycottedIds = new Set((boycottRows || []).map((row) => String(row.strat_id)));
      strats = strats.filter((strat) => !boycottedIds.has(String(strat.id)));
    }
  }

  const scopedStratIds = strats.map((strat) => strat.id).filter(Boolean);

  if (!scopedStratIds.length) return [];

  const slots = await fetchAllSlotsForStratIds(supabaseClient, scopedStratIds, 1000);

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
        guild_code: s.guild_code ?? null,
        boycott: false,
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
  applyPortalCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (!verifyPortalRequestOrigin(req)) {
    return res.status(403).json({ error: "origine de requete refusee" });
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    const sessionCheck = await requirePortalSession(req, supabase);
    if (sessionCheck.error) {
      return res.status(sessionCheck.status || 401).json({ error: sessionCheck.error });
    }
    req.portalMember = sessionCheck.member;

    const gvgDefenseId = req.query?.gvgDefenseId;

    if (!gvgDefenseId) {
      return res.status(400).json({ error: "gvgDefenseId manquant" });
    }

    const { data: defense, error: defenseError } = await supabase
      .from("gvg_defense")
      .select("id, guild, heroes, type")
      .eq("id", gvgDefenseId)
      .maybeSingle();

    if (defenseError) {
      console.error("[gvg-strat-search] defense error:", defenseError);
      return res.status(500).json({ error: "erreur lecture défense" });
    }

    if (!defense) {
      return res.status(404).json({ error: "défense introuvable" });
    }

    const queryItems = (Array.isArray(defense.heroes) ? defense.heroes : [])
      .map((hero) => ({
        champion: hero?.champion,
        position: hero?.position,
        direction: hero?.direction,
      }))
      .filter((hero) => hero.champion);

    const defenseMapType = normalizeGvgMapType(defense.type);
    const invalidPositions = queryItems
      .filter((hero) => hero.position)
      .map((hero) => String(hero.position || "").trim().toUpperCase())
      .filter((position) => !normalizePos(position, defenseMapType));

    if (invalidPositions.length) {
      return res.status(400).json({
        error: `position invalide pour ${defenseMapType}`,
        invalidPositions,
      });
    }

    const scope = await resolveRunScope(supabase, req, req.portalMember);

    if (!scope.canUseGvg || !scope.canSearchRuns) {
      return res.status(403).json({ error: "abonnement insuffisant pour consulter les strats GVG" });
    }

    if (!canUseRunTargetGuild(scope, defense.guild)) {
      return res.status(403).json({ error: "guilde hors perimetre" });
    }

    const results = await searchDefenceStrict(supabase, queryItems, {
      limit: 10,
      scope,
      targetGuildCode: defense.guild,
      mapType: defenseMapType,
    });

    return res.status(200).json({
      success: true,
      items: results,
    });
  } catch (err) {
    console.error("[gvg-strat-search]", err);
    return res.status(500).json({ error: "server error" });
  }
}
