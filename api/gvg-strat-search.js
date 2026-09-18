/* global process */
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
import {
  buildGvgActivityContextId,
  touchPortalMemberActivityState,
} from "./_portal-member-activity.js";
import {
  buildGvgStrategyCriteriaFromHeroes,
  compareGvgStrategySearchResults,
  gvgStrategyMatchesSearchCriteria,
  normalizeGvgStrategyChampionName,
  normalizeGvgStrategyDirection,
  normalizeGvgStrategyMapType,
  normalizeGvgStrategyPosition,
} from "../src/lib/gvgStrategySearch.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

function normalizeGvgMapType(mapType) {
  return normalizeGvgStrategyMapType(mapType);
}

export function normalizeGvgPosition(pos, mapType = "tower") {
  return normalizeGvgStrategyPosition(pos, mapType);
}

function normalizePos(pos, mapType = "tower") {
  return normalizeGvgPosition(pos, mapType);
}

function normalizeChampionName(name) {
  return normalizeGvgStrategyChampionName(name);
}

function normalizeDir(dir) {
  return normalizeGvgStrategyDirection(dir);
}

function normalizeChampion(ch) {
  return normalizeChampionName(ch);
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
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
  const ids = [...new Set((stratIds || []).filter(Boolean))];
  if (!ids.length) return [];

  let all = [];

  for (const chunk of chunkArray(ids, 500)) {
    for (let from = 0; ; from += pageSize) {
      const to = from + pageSize - 1;

      const { data, error } = await supabaseClient
        .from("defence_slot")
        .select("strat_id, champion, position, direction")
        .in("strat_id", chunk)
        .range(from, to);

      if (error) throw error;

      all = all.concat(data || []);
      if (!data || data.length < pageSize) break;
    }
  }

  return all;
}

export async function searchDefenceStrict(
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

const STRAT_SEARCH_SELECT = "id, name, def_key, commentaire, youtube_url, created_at, attack_code, guild_code";
const STRAT_SEARCH_SELECT_FALLBACK = "id, name, def_key, commentaire, youtube_url, created_at, attack_code";

function isMissingOptionalLikeTable(error) {
  const message = String(error?.message || error?.details || "");
  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    message.includes("defence_strat_likes")
  );
}

async function fetchFlexibleStrats(supabaseClient, stratIds, { scope = null, maxCandidates = 50000 } = {}) {
  let query = supabaseClient.from("defence_strat").select(STRAT_SEARCH_SELECT);

  if (Array.isArray(stratIds)) {
    if (!stratIds.length) return [];
    query = query.in("id", stratIds);
  } else {
    query = query.order("created_at", { ascending: false }).limit(maxCandidates);
  }

  let { data, error } = await query;

  if (error) {
    if (!isMissingGuildCodeColumn(error)) throw error;
    if (!scope?.isPaladin) {
      throw new Error("Colonne defence_strat.guild_code manquante pour isoler les banques de runs externes.");
    }

    let fallbackQuery = supabaseClient.from("defence_strat").select(STRAT_SEARCH_SELECT_FALLBACK);
    if (Array.isArray(stratIds)) {
      fallbackQuery = fallbackQuery.in("id", stratIds);
    } else {
      fallbackQuery = fallbackQuery.order("created_at", { ascending: false }).limit(maxCandidates);
    }

    const fallback = await fallbackQuery;
    if (fallback.error) throw fallback.error;
    data = (fallback.data || []).map((strat) => ({ ...strat, guild_code: null }));
  }

  return (data || []).filter((strat) => stratMatchesRunReadScope(strat, scope));
}

async function filterBoycottedStrats(supabaseClient, strats, targetGuildCode) {
  if (!targetGuildCode || !strats?.length) return strats || [];

  const stratIds = strats.map((strat) => strat.id).filter(Boolean);
  if (!stratIds.length) return [];

  const { data, error } = await supabaseClient
    .from("defence_strat_boycotts")
    .select("strat_id")
    .eq("guild_code", targetGuildCode)
    .in("strat_id", stratIds);

  if (error) {
    if (isMissingRunBoycottTable(error)) return strats;
    throw error;
  }

  const boycottedIds = new Set((data || []).map((row) => String(row.strat_id)));
  return strats.filter((strat) => !boycottedIds.has(String(strat.id)));
}

async function fetchStratLikeCounts(supabaseClient, stratIds) {
  const ids = [...new Set((stratIds || []).filter(Boolean))];
  if (!ids.length) return new Map();

  let { data, error } = await supabaseClient
    .from("defence_strat_likes")
    .select("strat_id, value")
    .in("strat_id", ids);

  if (error) {
    if (!isMissingOptionalLikeTable(error)) throw error;

    const fallback = await supabaseClient
      .from("defence_strat_likes")
      .select("strat_id")
      .in("strat_id", ids);

    if (fallback.error) {
      if (isMissingOptionalLikeTable(fallback.error)) return new Map();
      throw fallback.error;
    }

    data = fallback.data || [];
  }

  const counts = new Map();
  for (const row of data || []) {
    const stratId = row?.strat_id;
    if (!stratId) continue;
    if (row.value !== undefined && row.value !== null && Number(row.value) <= 0) continue;
    counts.set(String(stratId), (counts.get(String(stratId)) || 0) + 1);
  }

  return counts;
}

export async function searchDefenceFlexible(
  supabaseClient,
  criteria,
  { limit = 25, maxCandidates = 50000, scope = null, targetGuildCode = "", mapType = "tower" } = {}
) {
  const normalizedMapType = normalizeGvgMapType(mapType);
  const normalizedCriteria = (criteria || [])
    .map((line) => {
      const champion = normalizeChampion(line?.champion);
      const position = normalizePos(line?.position, normalizedMapType);
      const direction = normalizeDir(line?.direction);
      return {
        champion,
        position,
        direction,
        matchChampion: line?.matchChampion !== false && Boolean(champion),
        matchPosition: line?.matchPosition !== false && Boolean(position),
        matchDirection: line?.matchDirection !== false && Boolean(direction),
      };
    })
    .filter((line) => line.champion || line.position || line.direction);

  if (!normalizedCriteria.length) return [];

  const requiredChampions = normalizedCriteria
    .filter((line) => line.matchChampion && line.champion)
    .map((line) => line.champion);
  const candidateStratIds = requiredChampions.length
    ? await fetchCandidateStratIdsByChampionsStrict(supabaseClient, requiredChampions, { maxCandidates })
    : null;

  let strats = await fetchFlexibleStrats(supabaseClient, candidateStratIds, { scope, maxCandidates });
  strats = await filterBoycottedStrats(supabaseClient, strats, targetGuildCode);

  const scopedStratIds = strats.map((strat) => strat.id).filter(Boolean);
  if (!scopedStratIds.length) return [];

  const [slots, likeCounts] = await Promise.all([
    fetchAllSlotsForStratIds(supabaseClient, scopedStratIds, 1000),
    fetchStratLikeCounts(supabaseClient, scopedStratIds),
  ]);

  const slotsByStrat = new Map();
  for (const slot of slots || []) {
    if (!slotsByStrat.has(slot.strat_id)) slotsByStrat.set(slot.strat_id, []);
    slotsByStrat.get(slot.strat_id).push({
      champion: slot.champion,
      position: slot.position ?? null,
      direction: slot.direction ?? null,
    });
  }

  const matched = (strats || [])
    .map((strat) => {
      const stratSlots = slotsByStrat.get(strat.id) || [];
      if (!gvgStrategyMatchesSearchCriteria(normalizedCriteria, strat, stratSlots, normalizedMapType)) return null;

      return {
        strat_id: strat.id,
        name: strat.name || null,
        def_key: strat.def_key || null,
        commentaire: strat.commentaire,
        youtube_url: strat.youtube_url,
        created_at: strat.created_at,
        attack_code: strat.attack_code ?? null,
        guild_code: strat.guild_code ?? null,
        likes_count: likeCounts.get(String(strat.id)) || 0,
        boycott: false,
        slots: stratSlots,
      };
    })
    .filter(Boolean);

  matched.sort(compareGvgStrategySearchResults);
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

  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    const sessionCheck = await requirePortalSession(req, supabase);
    if (sessionCheck.error) {
      return res.status(sessionCheck.status || 401).json({ error: sessionCheck.error });
    }
    req.portalMember = sessionCheck.member;

    const flexibleSearch = req.method === "POST";
    const gvgDefenseId = flexibleSearch
      ? req.body?.gvgDefenseId || req.body?.defenseId
      : req.query?.gvgDefenseId;

    if (!gvgDefenseId) {
      return res.status(400).json({ error: "gvgDefenseId manquant" });
    }

    const { data: defense, error: defenseError } = await supabase
      .from("gvg_defense")
      .select("id, guild, heroes, type, created_at")
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

    if (flexibleSearch) {
      const criteriaOverrides = Array.isArray(req.body?.criteria) ? req.body.criteria : [];
      const criteria = buildGvgStrategyCriteriaFromHeroes(
        defense.heroes,
        defenseMapType,
        criteriaOverrides
      );

      const results = await searchDefenceFlexible(supabase, criteria, {
        limit: 25,
        scope,
        targetGuildCode: defense.guild,
        mapType: defenseMapType,
      });

      return res.status(200).json({
        success: true,
        items: results,
        criteria,
      });
    }

    const results = await searchDefenceStrict(supabase, queryItems, {
      limit: 10,
      scope,
      targetGuildCode: defense.guild,
      mapType: defenseMapType,
    });

    if (results.length) {
      await touchPortalMemberActivityState(supabase, sessionCheck.member.id, {
        last_gvg_strat_view_at: new Date().toISOString(),
        last_gvg_strat_context_id: buildGvgActivityContextId(defense),
      });
    }

    return res.status(200).json({
      success: true,
      items: results,
    });
  } catch (err) {
    console.error("[gvg-strat-search]", err);
    return res.status(500).json({ error: "server error" });
  }
}
