/* global process */
import { createClient } from "@supabase/supabase-js";
import {
  applyPortalCorsHeaders,
  isPortalAdminRole,
  isPortalCommunityRole,
  isPortalLeaderRole,
  normalizePortalText,
  readJsonBody,
  requirePortalSession,
  sendPortalJson,
  verifyPortalRequestOrigin,
} from "./_portal-auth.js";
import {
  COMMUNITY_SPACE_KEY,
  PALADIN_CLUSTER_GUILD_CODES,
  PALADIN_SPACE_KEY,
  getGuildSpaceKey,
  isPaladinGuildCode,
  normalizeGuildCode,
  normalizeGuildCodeKey,
} from "../src/lib/guildScope.js";

const SAFE_MEMBER_SELECT =
  "id, role, discord_id, watcher_name, guild_code, assignment, community_access_type, community_status, preferred_language";
const SAFE_MEMBER_SELECT_FALLBACK = "id, role, discord_id, watcher_name, guild_code, assignment";
const PB_ENTRY_SELECT_WITH_AWAKENING = `
  id,
  member_id,
  member_name,
  slot_index,
  champion_id,
  pb_raw,
  updated_at,
  awakening_level,
  champions (*)
`;
const PB_ENTRY_SELECT_FALLBACK = `
  id,
  member_id,
  member_name,
  slot_index,
  champion_id,
  pb_raw,
  updated_at,
  champions (*)
`;

function createSupabaseAdminClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Configuration Supabase serveur manquante.");
  return createClient(url, key, { auth: { persistSession: false } });
}

function cleanText(value) {
  return String(value || "").trim();
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sendJson(req, res, status, payload) {
  return sendPortalJson(res, status, payload, req);
}

function isMissingColumn(error, columnName) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return error?.code === "PGRST204" || error?.code === "42703" || message.includes(String(columnName || "").toLowerCase());
}

function isActorLeader(actor) {
  return isPortalLeaderRole(actor?.role);
}

function isActorAdmin(actor) {
  return isPortalAdminRole(actor?.role);
}

function isCommunityMember(member) {
  return member?.community_access_type === "community" || isPortalCommunityRole(member?.role);
}

function getMemberGuildCode(member) {
  return isCommunityMember(member) ? COMMUNITY_SPACE_KEY : normalizeGuildCode(member?.guild_code || "G1");
}

function getMemberName(member) {
  return member?.watcher_name || member?.discord_id || "Joueur";
}

function getMemberSpaceKey(member) {
  if (isCommunityMember(member)) return COMMUNITY_SPACE_KEY;
  return getGuildSpaceKey(getMemberGuildCode(member));
}

function canViewMember(actor, target) {
  if (!actor || !target) return false;
  if (isActorLeader(actor)) return true;
  if (String(actor.id) === String(target.id)) return true;
  if (isCommunityMember(actor) || isCommunityMember(target)) return false;
  return getMemberSpaceKey(actor) === getMemberSpaceKey(target);
}

function canEditMember(actor, target) {
  if (!actor || !target) return false;
  if (isActorLeader(actor)) return true;
  if (String(actor.id) === String(target.id)) return true;
  if (isCommunityMember(actor) || isCommunityMember(target)) return false;
  return isActorAdmin(actor) && getMemberSpaceKey(actor) === getMemberSpaceKey(target);
}

function serializeMember(member) {
  return {
    id: member.id,
    role: member.role || "member",
    discord_id: member.discord_id || "",
    discordId: member.discord_id || "",
    watcher_name: member.watcher_name || "",
    watcherName: member.watcher_name || "",
    name: member.watcher_name || member.discord_id || "Joueur",
    guild_code: getMemberGuildCode(member),
    guildCode: getMemberGuildCode(member),
    assignment: member.assignment || "",
    community_access_type: member.community_access_type || "",
    community_status: member.community_status || "",
    preferred_language: member.preferred_language || "",
  };
}

function normalizePbRaw(value) {
  const clean = cleanText(value).replace(/\s+/g, "").replace(",", ".");
  if (!clean) return "";
  const numeric = Number(clean);
  if (!Number.isFinite(numeric) || numeric < 0) return "";
  return String(numeric);
}

function normalizeAwakeningLevel(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(5, Math.max(0, Math.round(numeric)));
}

function validateUuid(value) {
  const clean = cleanText(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean)
    ? clean
    : "";
}

async function selectMembersWithFallback(supabase) {
  let { data, error } = await supabase.from("guild_members").select(SAFE_MEMBER_SELECT).order("watcher_name", { ascending: true });
  if (isMissingColumn(error, "community_access_type") || isMissingColumn(error, "preferred_language")) {
    const fallback = await supabase.from("guild_members").select(SAFE_MEMBER_SELECT_FALLBACK).order("watcher_name", { ascending: true });
    data = (fallback.data || []).map((member) => ({
      ...member,
      community_access_type: isPortalCommunityRole(member?.role) ? "community" : "",
      community_status: "",
      preferred_language: "",
    }));
    error = fallback.error;
  }
  if (error) throw error;
  return data || [];
}

async function fetchMemberById(supabase, memberId) {
  const cleanId = validateUuid(memberId);
  if (!cleanId) return null;
  let { data, error } = await supabase.from("guild_members").select(SAFE_MEMBER_SELECT).eq("id", cleanId).maybeSingle();
  if (isMissingColumn(error, "community_access_type") || isMissingColumn(error, "preferred_language")) {
    const fallback = await supabase.from("guild_members").select(SAFE_MEMBER_SELECT_FALLBACK).eq("id", cleanId).maybeSingle();
    data = fallback.data
      ? {
          ...fallback.data,
          community_access_type: isPortalCommunityRole(fallback.data?.role) ? "community" : "",
          community_status: "",
          preferred_language: "",
        }
      : null;
    error = fallback.error;
  }
  if (error) throw error;
  return data || null;
}

function filterMembersForActor(members, actor, options = {}) {
  const targetGuildCode = normalizeGuildCodeKey(options.guildCode);

  if (isActorLeader(actor)) {
    if (!targetGuildCode) return members;
    return members.filter((member) => normalizeGuildCodeKey(member.guild_code) === targetGuildCode);
  }

  if (isCommunityMember(actor)) {
    return members.filter((member) => String(member.id) === String(actor.id));
  }

  const actorGuildCode = normalizeGuildCodeKey(actor.guild_code || "G1");
  const actorSpaceKey = getMemberSpaceKey(actor);

  if (targetGuildCode && isPaladinGuildCode(targetGuildCode) && actorSpaceKey === PALADIN_SPACE_KEY) {
    return members.filter((member) => normalizeGuildCodeKey(member.guild_code) === targetGuildCode);
  }

  return members.filter((member) => {
    if (isCommunityMember(member)) return false;
    const rowGuildCode = normalizeGuildCodeKey(member.guild_code);
    if (!rowGuildCode) return actorSpaceKey === PALADIN_SPACE_KEY;
    if (actorSpaceKey === PALADIN_SPACE_KEY) return PALADIN_CLUSTER_GUILD_CODES.includes(rowGuildCode);
    return getGuildSpaceKey(rowGuildCode) === actorSpaceKey && (!targetGuildCode || rowGuildCode === targetGuildCode);
  });
}

async function getScopedMembers(supabase, actor, options = {}) {
  const allMembers = await selectMembersWithFallback(supabase);
  return filterMembersForActor(allMembers, actor, options).map(serializeMember);
}

function pickSelectedMemberForActor(members, actor, requestedId) {
  const requestedKey = String(requestedId || "");
  if (requestedKey) {
    const requestedMember = members.find((member) => String(member.id) === requestedKey);
    if (requestedMember) return requestedMember;
  }

  const actorKey = String(actor?.id || "");
  if (actorKey) {
    const actorMember = members.find((member) => String(member.id) === actorKey);
    if (actorMember) return actorMember;
  }

  return members[0] || null;
}

async function handleHeroBoxBase(req, res, supabase, actor) {
  const [members, championsResult] = await Promise.all([
    getScopedMembers(supabase, actor),
    supabase.from("champions").select("*"),
  ]);

  if (championsResult.error) throw championsResult.error;
  return sendJson(req, res, 200, { ok: true, members, champions: championsResult.data || [] });
}

async function handleHeroAwakenings(req, res, supabase, actor, body) {
  const target = await fetchMemberById(supabase, body.memberId || body.member_id);
  if (!canViewMember(actor, target)) {
    return sendJson(req, res, 403, { ok: false, error: "Acces joueur refuse." });
  }

  const championIds = parseJsonArray(body.championIds || body.champion_ids)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  let query = supabase.from("member_awakenings").select("champion_id, awakening_level").eq("member_id", target.id);
  if (championIds.length) query = query.in("champion_id", championIds);
  const { data, error } = await query;
  if (error) throw error;
  return sendJson(req, res, 200, { ok: true, awakenings: data || [] });
}

async function handleSetHeroAwakening(req, res, supabase, actor, body) {
  const target = await fetchMemberById(supabase, body.memberId || body.member_id);
  if (!canEditMember(actor, target)) {
    return sendJson(req, res, 403, { ok: false, error: "Modification eveil refusee." });
  }

  const championId = Number(body.championId || body.champion_id);
  if (!Number.isFinite(championId)) return sendJson(req, res, 400, { ok: false, error: "Champion invalide." });

  const awakeningLevel = normalizeAwakeningLevel(body.awakeningLevel ?? body.awakening_level);
  const { error } = await supabase.from("member_awakenings").upsert(
    {
      member_id: target.id,
      champion_id: championId,
      awakening_level: awakeningLevel,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "member_id,champion_id" },
  );
  if (error) throw error;
  return sendJson(req, res, 200, { ok: true, awakening: { champion_id: championId, awakening_level: awakeningLevel } });
}

async function handleBulkHeroAwakening(req, res, supabase, actor, body) {
  const target = await fetchMemberById(supabase, body.memberId || body.member_id);
  if (!canEditMember(actor, target)) {
    return sendJson(req, res, 403, { ok: false, error: "Modification eveils refusee." });
  }

  const now = new Date().toISOString();
  const rows = parseJsonArray(body.entries)
    .map((entry) => ({
      member_id: target.id,
      champion_id: Number(entry.championId || entry.champion_id),
      awakening_level: normalizeAwakeningLevel(entry.awakeningLevel ?? entry.awakening_level),
      updated_at: now,
    }))
    .filter((entry) => Number.isFinite(entry.champion_id));

  if (!rows.length) return sendJson(req, res, 400, { ok: false, error: "Aucun eveil valide." });
  const { error } = await supabase.from("member_awakenings").upsert(rows, { onConflict: "member_id,champion_id" });
  if (error) throw error;
  return sendJson(req, res, 200, { ok: true, count: rows.length });
}

async function handlePersonalBest(req, res, supabase, actor, body) {
  const guildCode = normalizeGuildCode(body.guildCode || body.guild_code);
  const [members, championsResult] = await Promise.all([
    getScopedMembers(supabase, actor, { guildCode }),
    supabase.from("champions").select("*"),
  ]);

  if (championsResult.error) throw championsResult.error;
  const memberIds = members.map((member) => member.id);
  if (!memberIds.length) {
    return sendJson(req, res, 200, {
      ok: true,
      members,
      champions: championsResult.data || [],
      entries: [],
      pbAwakeningColumnReady: true,
    });
  }

  const awakeningsResult = await supabase
    .from("member_awakenings")
    .select(
      `
        member_id,
        awakening_level,
        champion_id,
        champions (*)
      `,
    )
    .in("member_id", memberIds);
  if (awakeningsResult.error) throw awakeningsResult.error;

  const awakeningsByMember = new Map();
  (awakeningsResult.data || []).forEach((row) => {
    const key = String(row.member_id || "");
    if (!awakeningsByMember.has(key)) awakeningsByMember.set(key, []);
    awakeningsByMember.get(key).push(row);
  });
  const enrichedMembers = members.map((member) => ({
    ...member,
    awakenings: awakeningsByMember.get(String(member.id)) || [],
  }));

  let { data, error } = await supabase
    .from("member_pb_entries")
    .select(PB_ENTRY_SELECT_WITH_AWAKENING)
    .in("member_id", memberIds)
    .order("member_name", { ascending: true })
    .order("slot_index", { ascending: true });
  let pbAwakeningColumnReady = true;
  if (isMissingColumn(error, "awakening_level")) {
    const fallback = await supabase
      .from("member_pb_entries")
      .select(PB_ENTRY_SELECT_FALLBACK)
      .in("member_id", memberIds)
      .order("member_name", { ascending: true })
      .order("slot_index", { ascending: true });
    data = fallback.data;
    error = fallback.error;
    pbAwakeningColumnReady = false;
  }

  if (error) throw error;
  return sendJson(req, res, 200, {
    ok: true,
    members: enrichedMembers,
    champions: championsResult.data || [],
    entries: data || [],
    pbAwakeningColumnReady,
  });
}

async function fetchPbEntryWithMember(supabase, entryId) {
  const cleanId = validateUuid(entryId);
  if (!cleanId) return null;
  const { data, error } = await supabase.from("member_pb_entries").select("id, member_id").eq("id", cleanId).maybeSingle();
  if (error) throw error;
  if (!data?.member_id) return null;
  const member = await fetchMemberById(supabase, data.member_id);
  return { entry: data, member };
}

async function handleUpdatePersonalBestHero(req, res, supabase, actor, body) {
  const resolved = await fetchPbEntryWithMember(supabase, body.entryId || body.entry_id);
  if (!resolved || !canEditMember(actor, resolved.member)) {
    return sendJson(req, res, 403, { ok: false, error: "Modification PB refusee." });
  }

  const championId = Number(body.championId || body.champion_id);
  if (!Number.isFinite(championId)) return sendJson(req, res, 400, { ok: false, error: "Champion invalide." });
  const { error } = await supabase
    .from("member_pb_entries")
    .update({ champion_id: championId, updated_at: new Date().toISOString() })
    .eq("id", resolved.entry.id);
  if (error) throw error;
  return sendJson(req, res, 200, { ok: true });
}

async function handleUpdatePersonalBestValue(req, res, supabase, actor, body) {
  const resolved = await fetchPbEntryWithMember(supabase, body.entryId || body.entry_id);
  if (!resolved || !canEditMember(actor, resolved.member)) {
    return sendJson(req, res, 403, { ok: false, error: "Modification PB refusee." });
  }

  const pbRaw = normalizePbRaw(body.pbRaw ?? body.pb_raw);
  if (!pbRaw) return sendJson(req, res, 400, { ok: false, error: "PB invalide." });
  const rawAwakening = body.awakeningLevel ?? body.awakening_level;
  const awakeningLevel =
    rawAwakening === null || rawAwakening === undefined || rawAwakening === "" ? null : normalizeAwakeningLevel(rawAwakening);
  const payload = { pb_raw: pbRaw, updated_at: new Date().toISOString(), awakening_level: awakeningLevel };
  let { error } = await supabase.from("member_pb_entries").update(payload).eq("id", resolved.entry.id);
  let pbAwakeningColumnReady = true;
  if (isMissingColumn(error, "awakening_level")) {
    const fallback = await supabase
      .from("member_pb_entries")
      .update({ pb_raw: pbRaw, updated_at: payload.updated_at })
      .eq("id", resolved.entry.id);
    error = fallback.error;
    pbAwakeningColumnReady = false;
  }
  if (error) throw error;
  return sendJson(req, res, 200, { ok: true, pbAwakeningColumnReady });
}

async function handleDemonicMonsters(req, res, supabase, actor, body) {
  const members = await getScopedMembers(supabase, actor);
  const requestedId = validateUuid(body.memberId || body.member_id);
  const selectedMember = pickSelectedMemberForActor(members, actor, requestedId);

  const [monstersResult, entriesResult] = await Promise.all([
    supabase
      .from("demonic_monsters")
      .select("*")
      .eq("is_active", true)
      .order("rarity", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    selectedMember
      ? supabase
          .from("member_demonic_monsters")
          .select(
            `
              id,
              member_id,
              monster_id,
              level,
              demonic_monsters (
                id,
                name,
                slug,
                rarity
              )
            `,
          )
          .eq("member_id", selectedMember.id)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (monstersResult.error) throw monstersResult.error;
  if (entriesResult.error) throw entriesResult.error;
  return sendJson(req, res, 200, {
    ok: true,
    members,
    selectedMemberId: selectedMember?.id || null,
    monsters: monstersResult.data || [],
    entries: entriesResult.data || [],
  });
}

async function handleSetDemonicMonsterLevel(req, res, supabase, actor, body) {
  const target = await fetchMemberById(supabase, body.memberId || body.member_id);
  if (!canEditMember(actor, target)) {
    return sendJson(req, res, 403, { ok: false, error: "Modification monstre refusee." });
  }

  const monsterId = validateUuid(body.monsterId || body.monster_id);
  const level = Math.min(20, Math.max(0, Math.round(Number(body.level || 0))));
  if (!monsterId) return sendJson(req, res, 400, { ok: false, error: "Monstre invalide." });
  const { data, error } = await supabase
    .from("member_demonic_monsters")
    .upsert(
      {
        member_id: target.id,
        monster_id: monsterId,
        level,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "member_id,monster_id" },
    )
    .select(
      `
        id,
        member_id,
        monster_id,
        level,
        demonic_monsters (
          id,
          name,
          slug,
          rarity
        )
      `,
    )
    .single();
  if (error) throw error;
  return sendJson(req, res, 200, { ok: true, entry: data });
}

async function handleSoulStones(req, res, supabase, actor, body) {
  const members = await getScopedMembers(supabase, actor);
  const requestedId = validateUuid(body.memberId || body.member_id);
  const selectedMember = pickSelectedMemberForActor(members, actor, requestedId);
  const visibleMemberIds = new Set(members.map((member) => String(member.id)));

  const [stonesResult, rankingResult] = await Promise.all([
    selectedMember
      ? supabase
          .from("soul_stones")
          .select("id, member_id, watcher_name, type, created_at")
          .eq("member_id", selectedMember.id)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    supabase.rpc("get_soulstone_ranking"),
  ]);

  if (stonesResult.error) throw stonesResult.error;
  let rankingRows = [];
  if (!rankingResult.error) {
    rankingRows = (rankingResult.data || []).filter((row) => {
      const rowId = String(row.member_id || row.id || "");
      return visibleMemberIds.has(rowId);
    });
  }

  return sendJson(req, res, 200, {
    ok: true,
    members,
    selectedMemberId: selectedMember?.id || null,
    stones: stonesResult.data || [],
    rankingRows,
    rankingError: rankingResult.error?.message || "",
  });
}

async function handleAddSoulStone(req, res, supabase, actor, body) {
  const target = await fetchMemberById(supabase, body.memberId || body.member_id);
  if (!canEditMember(actor, target)) {
    return sendJson(req, res, 403, { ok: false, error: "Ajout pierre refuse." });
  }

  const stoneType = normalizePortalText(body.stoneType || body.stone_type);
  if (!["lord", "brute"].includes(stoneType)) {
    return sendJson(req, res, 400, { ok: false, error: "Type de pierre invalide." });
  }
  const { data, error } = await supabase
    .from("soul_stones")
    .insert({ member_id: target.id, watcher_name: getMemberName(target), type: stoneType })
    .select("id, member_id, watcher_name, type, created_at")
    .single();
  if (error) throw error;
  return sendJson(req, res, 200, { ok: true, stone: data });
}

async function handleRemoveSoulStone(req, res, supabase, actor, body) {
  const target = await fetchMemberById(supabase, body.memberId || body.member_id);
  if (!canEditMember(actor, target)) {
    return sendJson(req, res, 403, { ok: false, error: "Suppression pierre refusee." });
  }

  const stoneType = normalizePortalText(body.stoneType || body.stone_type);
  if (!["lord", "brute"].includes(stoneType)) {
    return sendJson(req, res, 400, { ok: false, error: "Type de pierre invalide." });
  }
  const { data: lastStone, error: lookupError } = await supabase
    .from("soul_stones")
    .select("id")
    .eq("member_id", target.id)
    .eq("type", stoneType)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!lastStone?.id) return sendJson(req, res, 200, { ok: true, removed: false });
  const { error } = await supabase.from("soul_stones").delete().eq("id", lastStone.id);
  if (error) throw error;
  return sendJson(req, res, 200, { ok: true, removed: true, stoneId: lastStone.id });
}

const HANDLERS = {
  heroBoxBase: handleHeroBoxBase,
  heroAwakenings: handleHeroAwakenings,
  setHeroAwakening: handleSetHeroAwakening,
  bulkHeroAwakening: handleBulkHeroAwakening,
  personalBest: handlePersonalBest,
  updatePersonalBestHero: handleUpdatePersonalBestHero,
  updatePersonalBestValue: handleUpdatePersonalBestValue,
  demonicMonsters: handleDemonicMonsters,
  setDemonicMonsterLevel: handleSetDemonicMonsterLevel,
  soulStones: handleSoulStones,
  addSoulStone: handleAddSoulStone,
  removeSoulStone: handleRemoveSoulStone,
};

export default async function handler(req, res) {
  applyPortalCorsHeaders(req, res);
  if (req.method === "OPTIONS") return sendJson(req, res, 204, {});
  if (!["GET", "POST"].includes(req.method)) return sendJson(req, res, 405, { ok: false, error: "Methode non autorisee." });
  if (!verifyPortalRequestOrigin(req)) return sendJson(req, res, 403, { ok: false, error: "Origine refusee." });

  let supabase;
  try {
    supabase = createSupabaseAdminClient();
  } catch (error) {
    return sendJson(req, res, 500, { ok: false, error: error.message || "Configuration serveur invalide." });
  }

  const sessionResult = await requirePortalSession(req, supabase);
  if (sessionResult.error) {
    return sendJson(req, res, sessionResult.status || 401, { ok: false, error: sessionResult.error });
  }

  try {
    const body = req.method === "POST" ? await readJsonBody(req) : {};
    const queryAction = new URL(req.url, "http://localhost").searchParams.get("action");
    const action = cleanText(body.action || queryAction);
    const handlerFn = HANDLERS[action];
    if (!handlerFn) return sendJson(req, res, 400, { ok: false, error: "Action inconnue." });
    return await handlerFn(req, res, supabase, sessionResult.member, body);
  } catch (error) {
    console.error("[portal-player-data]", error);
    return sendJson(req, res, 500, { ok: false, error: error.message || "Erreur serveur Portal." });
  }
}
