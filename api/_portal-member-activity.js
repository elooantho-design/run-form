import { getGuildDisplayName } from "../src/lib/guildDisplay.js";
import {
  PALADIN_CLUSTER_GUILD_CODES,
  getGuildSpaceKey,
  isPaladinGuildCode,
  normalizeGuildCode,
  normalizeGuildCodeKey,
} from "../src/lib/guildScope.js";

export const PORTAL_MEMBER_ACTIVITY_TABLE = "portal_member_activity_state";
export const PORTAL_MEMBER_ACTIVITY_HEARTBEAT_THROTTLE_MS = 5 * 60 * 1000;
export const PORTAL_MEMBER_ACTIVITY_MIGRATION_MESSAGE =
  "Le suivi d'activite necessite la migration portal_member_activity_state.";

const MEMBER_SELECT_WITH_ROSTER =
  "id, watcher_name, discord_id, guild_code, role, community_access_type, community_status, roster_status, primary_member_id";
const MEMBER_SELECT_FALLBACK =
  "id, watcher_name, discord_id, guild_code, role, community_access_type, community_status, primary_member_id";
const ACTIVITY_STATE_SELECT = `
  member_id,
  last_seen_at,
  last_pb_update_at,
  last_demonic_update_at,
  last_hero_box_update_at,
  last_gvg_strat_view_at,
  last_gvg_strat_context_id,
  last_gvg_repro_at,
  created_at,
  updated_at
`;
const GVG_CONTEXT_SELECT = "guild, created_at";
const ACTIVITY_TIMESTAMP_FIELDS = new Set([
  "last_seen_at",
  "last_pb_update_at",
  "last_demonic_update_at",
  "last_hero_box_update_at",
  "last_gvg_strat_view_at",
  "last_gvg_repro_at",
]);
const INACTIVE_ROSTER_STATUSES = new Set(["inactive", "non_roster"]);
const COMMUNITY_ROLES = new Set(["community_member", "content_creator"]);

function cleanText(value, fallback = "") {
  return String(value || fallback).trim();
}

function normalizeRole(role) {
  return cleanText(role)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeDateDayKey(value) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return "unknown";
  return new Date(timestamp).toISOString().slice(0, 10);
}

function makeGuildKey(value) {
  return normalizeGuildCodeKey(value);
}

function readContextForGuild(contexts, guildCode) {
  const key = makeGuildKey(guildCode);
  if (!key) return "";
  if (contexts instanceof Map) return contexts.get(key) || "";
  return contexts?.[key] || "";
}

function compareGuilds(left, right) {
  const leftCode = makeGuildKey(left?.guildCode || left?.guild_code);
  const rightCode = makeGuildKey(right?.guildCode || right?.guild_code);
  const leftPaladinIndex = PALADIN_CLUSTER_GUILD_CODES.indexOf(leftCode);
  const rightPaladinIndex = PALADIN_CLUSTER_GUILD_CODES.indexOf(rightCode);

  if (leftPaladinIndex !== -1 || rightPaladinIndex !== -1) {
    if (leftPaladinIndex === -1) return 1;
    if (rightPaladinIndex === -1) return -1;
    return leftPaladinIndex - rightPaladinIndex;
  }

  return leftCode.localeCompare(rightCode, "fr", { numeric: true, sensitivity: "base" });
}

export function isMissingPortalMemberActivityState(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes(PORTAL_MEMBER_ACTIVITY_TABLE) ||
    message.includes("portal_member_activity_state") ||
    (error?.code === "PGRST204" &&
      (message.includes("last_seen_at") ||
        message.includes("last_pb_update_at") ||
        message.includes("last_demonic_update_at") ||
        message.includes("last_hero_box_update_at") ||
        message.includes("last_gvg_strat_view_at") ||
        message.includes("last_gvg_repro_at"))) ||
    message.includes("could not find the table")
  );
}

export function isCommunityActivityAccount(member) {
  const accessType = cleanText(
    member?.community_access_type || member?.communityAccessType || member?.access_type || member?.accessType,
  ).toLowerCase();
  const role = normalizeRole(member?.role);
  return accessType === "community" || COMMUNITY_ROLES.has(role);
}

export function isCurrentGuildActivityMember(member) {
  if (!member?.id) return false;
  if (!normalizeGuildCode(member?.guild_code || member?.guildCode)) return false;
  if (isCommunityActivityAccount(member)) return false;

  const rosterStatus = cleanText(member?.roster_status || member?.rosterStatus).toLowerCase();
  if (INACTIVE_ROSTER_STATUSES.has(rosterStatus)) return false;

  return true;
}

export function buildGvgActivityContextId(input = {}) {
  const guildCode = normalizeGuildCode(input.guild || input.guild_code || input.guildCode);
  const guildKey = makeGuildKey(guildCode);
  if (!guildKey) return "";

  const dayKey = normalizeDateDayKey(input.created_at || input.createdAt || input.updated_at || input.updatedAt);
  return `gvg:${guildKey}:${dayKey}`;
}

export function buildCurrentGvgContextsByGuild(defenses = []) {
  const latestByGuild = new Map();

  (defenses || []).forEach((defense) => {
    const guildKey = makeGuildKey(defense?.guild);
    if (!guildKey) return;

    const currentTime = Date.parse(defense?.created_at || "");
    const previousTime = Date.parse(latestByGuild.get(guildKey)?.created_at || "");
    if (!latestByGuild.has(guildKey) || (Number.isFinite(currentTime) && currentTime > previousTime)) {
      latestByGuild.set(guildKey, defense);
    }
  });

  const contexts = {};
  latestByGuild.forEach((defense, guildKey) => {
    contexts[guildKey] = buildGvgActivityContextId(defense);
  });
  return contexts;
}

export function buildPortalMemberActivityOverview({
  guilds = [],
  members = [],
  states = [],
  currentGvgContextsByGuild = {},
} = {}) {
  const stateByMemberId = new Map(
    (states || [])
      .filter((state) => state?.member_id)
      .map((state) => [String(state.member_id), state]),
  );
  const guildRowsByKey = new Map();
  const sourceGuilds = guilds.length
    ? guilds
    : Array.from(new Set((members || []).map((member) => normalizeGuildCode(member?.guild_code || member?.guildCode)).filter(Boolean)))
        .map((guildCode) => ({ guild_code: guildCode }));

  sourceGuilds.forEach((guild) => {
    const guildCode = normalizeGuildCode(guild?.guild_code || guild?.guildCode || guild?.code);
    const guildKey = makeGuildKey(guildCode);
    if (!guildKey || guildRowsByKey.has(guildKey)) return;

    guildRowsByKey.set(guildKey, {
      guildCode,
      guildKey,
      displayName: guild?.display_name || guild?.displayName || getGuildDisplayName({ guildCode }),
      currentGvgContextId: readContextForGuild(currentGvgContextsByGuild, guildCode),
      members: [],
      summary: {
        totalMembers: 0,
        seenMembers: 0,
        neverSeenMembers: 0,
        pbFilled: 0,
        pbMissing: 0,
        demonicFilled: 0,
        demonicMissing: 0,
        heroBoxFilled: 0,
        heroBoxMissing: 0,
        currentGvgStratViewed: 0,
        currentGvgStratMissing: 0,
        reproFilled: 0,
        reproMissing: 0,
      },
    });
  });

  (members || [])
    .filter(isCurrentGuildActivityMember)
    .forEach((member) => {
      const guildCode = normalizeGuildCode(member?.guild_code || member?.guildCode);
      const guildKey = makeGuildKey(guildCode);
      if (!guildRowsByKey.has(guildKey)) return;

      const state = stateByMemberId.get(String(member.id)) || {};
      const currentGvgContextId = readContextForGuild(currentGvgContextsByGuild, guildCode);
      const viewedCurrentGvgStrat = Boolean(
        state.last_gvg_strat_view_at &&
          currentGvgContextId &&
          state.last_gvg_strat_context_id === currentGvgContextId,
      );
      const row = {
        memberId: member.id,
        id: member.id,
        name: member.watcher_name || member.watcherName || member.discord_id || "Joueur",
        watcherName: member.watcher_name || member.watcherName || "",
        discordId: member.discord_id || member.discordId || "",
        guildCode,
        role: member.role || "member",
        rosterStatus: member.roster_status || member.rosterStatus || "",
        lastSeenAt: state.last_seen_at || null,
        lastPbUpdateAt: state.last_pb_update_at || null,
        lastDemonicUpdateAt: state.last_demonic_update_at || null,
        lastHeroBoxUpdateAt: state.last_hero_box_update_at || null,
        lastGvgStratViewAt: state.last_gvg_strat_view_at || null,
        lastGvgStratContextId: state.last_gvg_strat_context_id || null,
        currentGvgContextId,
        viewedCurrentGvgStrat,
        currentGvgStratViewedAt: viewedCurrentGvgStrat ? state.last_gvg_strat_view_at : null,
        lastGvgReproAt: state.last_gvg_repro_at || null,
      };

      guildRowsByKey.get(guildKey).members.push(row);
    });

  const guildRows = Array.from(guildRowsByKey.values())
    .sort(compareGuilds)
    .map((guild) => {
      guild.members.sort((left, right) =>
        String(left.name || "").localeCompare(String(right.name || ""), "fr", {
          numeric: true,
          sensitivity: "base",
        }),
      );

      guild.members.forEach((member) => {
        guild.summary.totalMembers += 1;
        if (member.lastSeenAt) guild.summary.seenMembers += 1;
        else guild.summary.neverSeenMembers += 1;
        if (member.lastPbUpdateAt) guild.summary.pbFilled += 1;
        else guild.summary.pbMissing += 1;
        if (member.lastDemonicUpdateAt) guild.summary.demonicFilled += 1;
        else guild.summary.demonicMissing += 1;
        if (member.lastHeroBoxUpdateAt) guild.summary.heroBoxFilled += 1;
        else guild.summary.heroBoxMissing += 1;
        if (member.viewedCurrentGvgStrat) guild.summary.currentGvgStratViewed += 1;
        else guild.summary.currentGvgStratMissing += 1;
        if (member.lastGvgReproAt) guild.summary.reproFilled += 1;
        else guild.summary.reproMissing += 1;
      });

      return guild;
    });

  const summary = guildRows.reduce(
    (total, guild) => {
      Object.entries(guild.summary).forEach(([key, value]) => {
        total[key] = (total[key] || 0) + value;
      });
      return total;
    },
    {
      totalMembers: 0,
      seenMembers: 0,
      neverSeenMembers: 0,
      pbFilled: 0,
      pbMissing: 0,
      demonicFilled: 0,
      demonicMissing: 0,
      heroBoxFilled: 0,
      heroBoxMissing: 0,
      currentGvgStratViewed: 0,
      currentGvgStratMissing: 0,
      reproFilled: 0,
      reproMissing: 0,
    },
  );

  return { guilds: guildRows, summary };
}

async function selectPortalGuildRows(supabase, actor) {
  const actorGuildCode = normalizeGuildCode(actor?.guild_code || actor?.guildCode);
  if (!actorGuildCode || isCommunityActivityAccount(actor)) return [];

  const { data: actorGuild, error: actorGuildError } = await supabase
    .from("portal_guilds")
    .select("id, organization_id, guild_code, display_name, is_active")
    .eq("guild_code", actorGuildCode)
    .eq("is_active", true)
    .maybeSingle();

  if (actorGuildError && !isMissingPortalMemberActivityState(actorGuildError)) throw actorGuildError;

  if (actorGuild?.organization_id) {
    const { data, error } = await supabase
      .from("portal_guilds")
      .select("id, organization_id, guild_code, display_name, is_active")
      .eq("organization_id", actorGuild.organization_id)
      .eq("is_active", true)
      .order("guild_code", { ascending: true });
    if (error) throw error;
    return data || [];
  }

  if (isPaladinGuildCode(actorGuildCode)) {
    return PALADIN_CLUSTER_GUILD_CODES.map((guildCode) => ({
      guild_code: guildCode,
      display_name: getGuildDisplayName({ guildCode }),
    }));
  }

  return [{ guild_code: actorGuildCode, display_name: getGuildDisplayName({ guildCode: actorGuildCode }) }];
}

async function selectMembersForGuilds(supabase, guildCodes) {
  if (!guildCodes.length) return { data: [], error: null };

  let { data, error } = await supabase
    .from("guild_members")
    .select(MEMBER_SELECT_WITH_ROSTER)
    .in("guild_code", guildCodes)
    .order("watcher_name", { ascending: true })
    .limit(1200);

  if (error?.code === "PGRST204" || `${error?.message || ""}`.includes("roster_status")) {
    const fallback = await supabase
      .from("guild_members")
      .select(MEMBER_SELECT_FALLBACK)
      .in("guild_code", guildCodes)
      .order("watcher_name", { ascending: true })
      .limit(1200);
    data = fallback.data;
    error = fallback.error;
  }

  return { data: data || [], error };
}

async function selectActivityStates(supabase, memberIds) {
  if (!memberIds.length) return { data: [], error: null };

  return await supabase
    .from(PORTAL_MEMBER_ACTIVITY_TABLE)
    .select(ACTIVITY_STATE_SELECT)
    .in("member_id", memberIds)
    .limit(1200);
}

async function selectCurrentGvgContexts(supabase, guildCodes) {
  if (!guildCodes.length) return {};

  const { data, error } = await supabase
    .from("gvg_defense")
    .select(GVG_CONTEXT_SELECT)
    .in("guild", guildCodes)
    .order("created_at", { ascending: false })
    .limit(600);

  if (error) return {};
  return buildCurrentGvgContextsByGuild(data || []);
}

export async function loadPortalMemberActivityOverview(supabase, actor) {
  const guildRows = await selectPortalGuildRows(supabase, actor);
  const allowedGuildCodes = guildRows
    .map((guild) => normalizeGuildCode(guild.guild_code || guild.guildCode))
    .filter(Boolean);
  const actorSpaceKey = getGuildSpaceKey(actor?.guild_code || actor?.guildCode);
  const scopedGuildCodes = allowedGuildCodes.filter((guildCode) => {
    if (isPaladinGuildCode(actor?.guild_code || actor?.guildCode) && isPaladinGuildCode(guildCode)) return true;
    return getGuildSpaceKey(guildCode) === actorSpaceKey;
  });

  const membersResult = await selectMembersForGuilds(supabase, scopedGuildCodes);
  if (membersResult.error) throw membersResult.error;

  const members = membersResult.data || [];
  const memberIds = members.filter(isCurrentGuildActivityMember).map((member) => member.id);
  const currentGvgContextsByGuild = await selectCurrentGvgContexts(supabase, scopedGuildCodes);
  const statesResult = await selectActivityStates(supabase, memberIds);
  const activityStateReady = !isMissingPortalMemberActivityState(statesResult.error);

  if (statesResult.error && activityStateReady) throw statesResult.error;

  const overview = buildPortalMemberActivityOverview({
    guilds: guildRows.filter((guild) => scopedGuildCodes.includes(normalizeGuildCode(guild.guild_code || guild.guildCode))),
    members,
    states: activityStateReady ? statesResult.data || [] : [],
    currentGvgContextsByGuild,
  });

  return {
    ...overview,
    activityStateReady,
    migrationRequired: !activityStateReady,
    warning: activityStateReady ? "" : PORTAL_MEMBER_ACTIVITY_MIGRATION_MESSAGE,
    currentGvgContextsByGuild,
  };
}

export async function touchPortalMemberActivityState(supabase, memberId, fields = {}, options = {}) {
  const cleanMemberId = cleanText(memberId);
  if (!cleanMemberId) return { ok: false, skipped: true, reason: "missing_member_id" };

  const now = cleanText(options.now) || new Date().toISOString();
  const row = { member_id: cleanMemberId, updated_at: now };

  Object.entries(fields || {}).forEach(([key, value]) => {
    if (ACTIVITY_TIMESTAMP_FIELDS.has(key)) row[key] = value || now;
    if (key === "last_gvg_strat_context_id") row[key] = value || null;
  });

  if (Object.keys(row).length <= 2) return { ok: false, skipped: true, reason: "empty_fields" };

  const { error } = await supabase
    .from(PORTAL_MEMBER_ACTIVITY_TABLE)
    .upsert(row, { onConflict: "member_id" });

  if (error) {
    if (options.ignoreMissing !== false && isMissingPortalMemberActivityState(error)) {
      return { ok: false, missing: true, error: error.message || PORTAL_MEMBER_ACTIVITY_MIGRATION_MESSAGE };
    }
    throw error;
  }

  return { ok: true, touched: true };
}

export async function touchPortalMemberLastSeen(supabase, memberId, options = {}) {
  const cleanMemberId = cleanText(memberId);
  if (!cleanMemberId) return { ok: false, skipped: true, reason: "missing_member_id" };

  const now = cleanText(options.now) || new Date().toISOString();
  const throttleMs = Number(options.throttleMs || PORTAL_MEMBER_ACTIVITY_HEARTBEAT_THROTTLE_MS);
  const { data, error } = await supabase
    .from(PORTAL_MEMBER_ACTIVITY_TABLE)
    .select("member_id, last_seen_at")
    .eq("member_id", cleanMemberId)
    .maybeSingle();

  if (error && !isMissingPortalMemberActivityState(error)) throw error;
  if (error && isMissingPortalMemberActivityState(error)) {
    return { ok: false, missing: true, error: error.message || PORTAL_MEMBER_ACTIVITY_MIGRATION_MESSAGE };
  }

  const previousTime = Date.parse(data?.last_seen_at || "");
  const nextTime = Date.parse(now);
  if (Number.isFinite(previousTime) && Number.isFinite(nextTime) && nextTime - previousTime < throttleMs) {
    return { ok: true, touched: false, throttled: true };
  }

  return touchPortalMemberActivityState(supabase, cleanMemberId, { last_seen_at: now }, { ...options, now });
}
