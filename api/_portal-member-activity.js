import { getGuildDisplayName } from "../src/lib/guildDisplay.js";
import {
  PALADIN_CLUSTER_GUILD_CODES,
  getGuildSpaceKey,
  isPaladinGuildCode,
  normalizeGuildCode,
  normalizeGuildCodeKey,
} from "../src/lib/guildScope.js";
import {
  loadDiscordCapabilitiesForOrganization,
  resolvePortalActorOrganization,
} from "./_portal-discord-capabilities.js";
import {
  ACTIVITY_STATUS_KNOWN_DATE,
  ACTIVITY_STATUS_NEVER,
  ACTIVITY_STATUS_UNKNOWN_DATE,
  getMemberActivityFreshnessTone,
  isMemberActivityFreshnessActionRequired,
} from "../src/lib/memberActivityFreshness.js";

export {
  ACTIVITY_STATUS_KNOWN_DATE,
  ACTIVITY_STATUS_NEVER,
  ACTIVITY_STATUS_UNKNOWN_DATE,
  getMemberActivityFreshnessTone,
  isMemberActivityFreshnessActionRequired,
};

export const PORTAL_MEMBER_ACTIVITY_TABLE = "portal_member_activity_state";
export const PORTAL_MEMBER_REMINDERS_TABLE = "portal_member_reminders";
export const PORTAL_MEMBER_ACTIVITY_HEARTBEAT_THROTTLE_MS = 5 * 60 * 1000;
export const MEMBER_ACTIVITY_REMINDER_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
export const PORTAL_MEMBER_ACTIVITY_MIGRATION_MESSAGE =
  "Le suivi d'activite necessite la migration portal_member_activity_state.";
export const MEMBER_ACTIVITY_REMINDER_TYPES = Object.freeze({
  SITE_PRESENCE: "site_presence",
  PB: "pb",
  DEMONIC: "demonic",
  HERO_BOX: "hero_box",
});
export const MEMBER_ACTIVITY_REMINDER_TYPE_KEYS = Object.freeze(Object.values(MEMBER_ACTIVITY_REMINDER_TYPES));

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
const PB_HISTORY_SELECT = "member_id, champion_id, pb_raw, updated_at";
const PB_HISTORY_SELECT_FALLBACK = "member_id, champion_id, pb_raw";
const HERO_BOX_HISTORY_SELECT = "member_id, champion_id, awakening_level";
const DEMONIC_HISTORY_SELECT = "member_id, monster_id, level, updated_at";
const DEMONIC_HISTORY_SELECT_FALLBACK = "member_id, monster_id, level";
const REPRO_HISTORY_SELECT = "member_id, created_at, updated_at";
const REPRO_HISTORY_SELECT_FALLBACK = "member_id, created_at";
const ACTIVITY_LOG_HISTORY_SELECT = "id, actor_member_id, target_member_id, action_type, created_at";
const MEMBER_REMINDER_SELECT =
  "id, organization_id, guild_code, member_id, reminder_type, sent_by_member_id, sent_by_name, discord_user_id, message, status, error_message, created_at, updated_at";
const PB_ACTIVITY_LOG_TYPES = new Set(["pb_update", "pb_hero_update"]);
const DEMONIC_ACTIVITY_LOG_TYPES = new Set(["demon_monster_update"]);
const HERO_BOX_ACTIVITY_LOG_TYPES = new Set(["hero_box_update", "hero_box_bulk_a5"]);
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

function normalizeActivityDate(value) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString();
}

function maxActivityDate(...values) {
  let best = null;
  let bestTime = Number.NEGATIVE_INFINITY;

  values.flat().forEach((value) => {
    const normalized = normalizeActivityDate(value);
    if (!normalized) return;
    const timestamp = Date.parse(normalized);
    if (timestamp > bestTime) {
      best = normalized;
      bestTime = timestamp;
    }
  });

  return best;
}

function pickRowActivityDate(row) {
  return maxActivityDate(row?.updated_at, row?.created_at);
}

function buildActivityValue({ stateDate = null, historicalDate = null, hasHistoricalData = false } = {}) {
  const value = maxActivityDate(stateDate, historicalDate);
  if (value) return { value, status: ACTIVITY_STATUS_KNOWN_DATE };
  if (hasHistoricalData) return { value: null, status: ACTIVITY_STATUS_UNKNOWN_DATE };
  return { value: null, status: ACTIVITY_STATUS_NEVER };
}

function ensureEvidence(evidenceByMemberId, memberId) {
  const key = cleanText(memberId);
  if (!key) return null;
  if (!evidenceByMemberId.has(key)) {
    evidenceByMemberId.set(key, {
      lastSeen: { date: null, hasData: false },
      pb: { date: null, hasData: false },
      demonic: { date: null, hasData: false },
      heroBox: { date: null, hasData: false },
      repro: { date: null, hasData: false },
    });
  }
  return evidenceByMemberId.get(key);
}

function mergeEvidence(evidenceByMemberId, memberId, key, { date = null, hasData = true } = {}) {
  const evidence = ensureEvidence(evidenceByMemberId, memberId);
  if (!evidence?.[key]) return;
  evidence[key] = {
    hasData: Boolean(evidence[key].hasData || hasData),
    date: maxActivityDate(evidence[key].date, date),
  };
}

function getHistoricalEvidence(historicalEvidenceByMemberId, memberId) {
  const key = cleanText(memberId);
  if (!key) return {};
  if (historicalEvidenceByMemberId instanceof Map) return historicalEvidenceByMemberId.get(key) || {};
  return historicalEvidenceByMemberId?.[key] || {};
}

function hasMeaningfulPbEntry(row) {
  const rawText = cleanText(row?.pb_raw).replace(/\s/g, "");
  const rawNumber = Number(String(row?.pb_raw ?? "").replace(/[^\d.-]/g, ""));
  const zeroLike = /^0+([.,]0+)?$/.test(rawText);
  return Boolean(row?.champion_id || (rawText && !zeroLike) || (Number.isFinite(rawNumber) && rawNumber > 0));
}

function hasMeaningfulHeroBoxEntry(row) {
  const level = Number(row?.awakening_level);
  return Number.isFinite(level) && level >= 0;
}

function hasMeaningfulDemonicEntry(row) {
  const level = Number(row?.level);
  return Number.isFinite(level) && level > 0;
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

export function buildHistoricalEvidenceByMember({
  pbEntries = [],
  heroBoxEntries = [],
  demonicEntries = [],
  reproEntries = [],
  activityLogs = [],
} = {}) {
  const evidenceByMemberId = new Map();

  (pbEntries || []).forEach((row) => {
    if (!hasMeaningfulPbEntry(row)) return;
    mergeEvidence(evidenceByMemberId, row?.member_id, "pb", {
      date: pickRowActivityDate(row),
    });
  });

  (heroBoxEntries || []).forEach((row) => {
    if (!hasMeaningfulHeroBoxEntry(row)) return;
    mergeEvidence(evidenceByMemberId, row?.member_id, "heroBox", {
      date: pickRowActivityDate(row),
    });
  });

  (demonicEntries || []).forEach((row) => {
    if (!hasMeaningfulDemonicEntry(row)) return;
    mergeEvidence(evidenceByMemberId, row?.member_id, "demonic", {
      date: pickRowActivityDate(row),
    });
  });

  (reproEntries || []).forEach((row) => {
    if (!row?.member_id) return;
    mergeEvidence(evidenceByMemberId, row.member_id, "repro", {
      date: pickRowActivityDate(row),
    });
  });

  (activityLogs || []).forEach((row) => {
    const date = normalizeActivityDate(row?.created_at);
    if (row?.actor_member_id) {
      mergeEvidence(evidenceByMemberId, row.actor_member_id, "lastSeen", { date });
    }

    let evidenceKey = "";
    if (PB_ACTIVITY_LOG_TYPES.has(row?.action_type)) evidenceKey = "pb";
    if (DEMONIC_ACTIVITY_LOG_TYPES.has(row?.action_type)) evidenceKey = "demonic";
    if (HERO_BOX_ACTIVITY_LOG_TYPES.has(row?.action_type)) evidenceKey = "heroBox";
    if (!evidenceKey) return;

    mergeEvidence(evidenceByMemberId, row?.actor_member_id, evidenceKey, { date });
    mergeEvidence(evidenceByMemberId, row?.target_member_id, evidenceKey, { date });
  });

  return evidenceByMemberId;
}

export function buildPortalMemberActivityOverview({
  guilds = [],
  members = [],
  states = [],
  currentGvgContextsByGuild = {},
  historicalEvidenceByMemberId = new Map(),
  lastSuccessfulRemindersByMemberId = new Map(),
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
      const history = getHistoricalEvidence(historicalEvidenceByMemberId, member.id);
      const currentGvgContextId = readContextForGuild(currentGvgContextsByGuild, guildCode);
      const viewedCurrentGvgStrat = Boolean(
        state.last_gvg_strat_view_at &&
          currentGvgContextId &&
          state.last_gvg_strat_context_id === currentGvgContextId,
      );
      const pbActivity = buildActivityValue({
        stateDate: state.last_pb_update_at,
        historicalDate: history.pb?.date,
        hasHistoricalData: history.pb?.hasData,
      });
      const demonicActivity = buildActivityValue({
        stateDate: state.last_demonic_update_at,
        historicalDate: history.demonic?.date,
        hasHistoricalData: history.demonic?.hasData,
      });
      const heroBoxActivity = buildActivityValue({
        stateDate: state.last_hero_box_update_at,
        historicalDate: history.heroBox?.date,
        hasHistoricalData: history.heroBox?.hasData,
      });
      const gvgReproActivity = buildActivityValue({
        stateDate: state.last_gvg_repro_at,
        historicalDate: history.repro?.date,
        hasHistoricalData: history.repro?.hasData,
      });
      const currentGvgStratActivity = viewedCurrentGvgStrat
        ? buildActivityValue({ stateDate: state.last_gvg_strat_view_at })
        : buildActivityValue();
      const lastSeenActivity = buildActivityValue({
        stateDate: maxActivityDate(
          state.last_seen_at,
          history.lastSeen?.date,
          pbActivity.value,
          demonicActivity.value,
          heroBoxActivity.value,
          currentGvgStratActivity.value,
          gvgReproActivity.value,
        ),
        hasHistoricalData: Boolean(
          history.lastSeen?.hasData ||
            pbActivity.status !== ACTIVITY_STATUS_NEVER ||
            demonicActivity.status !== ACTIVITY_STATUS_NEVER ||
            heroBoxActivity.status !== ACTIVITY_STATUS_NEVER ||
            currentGvgStratActivity.status !== ACTIVITY_STATUS_NEVER ||
            gvgReproActivity.status !== ACTIVITY_STATUS_NEVER,
        ),
      });
      const row = {
        memberId: member.id,
        id: member.id,
        name: member.watcher_name || member.watcherName || member.discord_id || "Joueur",
        watcherName: member.watcher_name || member.watcherName || "",
        discordId: member.discord_id || member.discordId || "",
        guildCode,
        role: member.role || "member",
        rosterStatus: member.roster_status || member.rosterStatus || "",
        lastSeenAt: lastSeenActivity.value,
        lastSeenStatus: lastSeenActivity.status,
        lastPbUpdateAt: pbActivity.value,
        pbStatus: pbActivity.status,
        lastDemonicUpdateAt: demonicActivity.value,
        demonicStatus: demonicActivity.status,
        lastHeroBoxUpdateAt: heroBoxActivity.value,
        heroBoxStatus: heroBoxActivity.status,
        lastGvgStratViewAt: state.last_gvg_strat_view_at || null,
        lastGvgStratContextId: state.last_gvg_strat_context_id || null,
        currentGvgContextId,
        viewedCurrentGvgStrat,
        currentGvgStratViewedAt: currentGvgStratActivity.value,
        gvgStratStatus: currentGvgStratActivity.status,
        lastGvgReproAt: gvgReproActivity.value,
        reproStatus: gvgReproActivity.status,
        lastReminders:
          lastSuccessfulRemindersByMemberId instanceof Map
            ? lastSuccessfulRemindersByMemberId.get(String(member.id)) || {}
            : lastSuccessfulRemindersByMemberId?.[member.id] || {},
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
        if (member.lastSeenStatus !== ACTIVITY_STATUS_NEVER) guild.summary.seenMembers += 1;
        else guild.summary.neverSeenMembers += 1;
        if (member.pbStatus !== ACTIVITY_STATUS_NEVER) guild.summary.pbFilled += 1;
        else guild.summary.pbMissing += 1;
        if (member.demonicStatus !== ACTIVITY_STATUS_NEVER) guild.summary.demonicFilled += 1;
        else guild.summary.demonicMissing += 1;
        if (member.heroBoxStatus !== ACTIVITY_STATUS_NEVER) guild.summary.heroBoxFilled += 1;
        else guild.summary.heroBoxMissing += 1;
        if (member.gvgStratStatus !== ACTIVITY_STATUS_NEVER) guild.summary.currentGvgStratViewed += 1;
        else guild.summary.currentGvgStratMissing += 1;
        if (member.reproStatus !== ACTIVITY_STATUS_NEVER) guild.summary.reproFilled += 1;
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

export const MEMBER_ACTIVITY_PROFILE_MODULES = Object.freeze([
  {
    key: "pb",
    valueKey: "lastPbUpdateAt",
    statusKey: "pbStatus",
    label: "PB",
  },
  {
    key: "demonic",
    valueKey: "lastDemonicUpdateAt",
    statusKey: "demonicStatus",
    label: "Monstres demoniaques",
  },
  {
    key: "heroBox",
    valueKey: "lastHeroBoxUpdateAt",
    statusKey: "heroBoxStatus",
    label: "Box heros",
  },
]);

export function buildPortalMemberActivityProfileStatus({
  member = {},
  state = {},
  historicalEvidence = {},
  now = Date.now(),
} = {}) {
  const pbActivity = buildActivityValue({
    stateDate: state.last_pb_update_at,
    historicalDate: historicalEvidence.pb?.date,
    hasHistoricalData: historicalEvidence.pb?.hasData,
  });
  const demonicActivity = buildActivityValue({
    stateDate: state.last_demonic_update_at,
    historicalDate: historicalEvidence.demonic?.date,
    hasHistoricalData: historicalEvidence.demonic?.hasData,
  });
  const heroBoxActivity = buildActivityValue({
    stateDate: state.last_hero_box_update_at,
    historicalDate: historicalEvidence.heroBox?.date,
    hasHistoricalData: historicalEvidence.heroBox?.hasData,
  });

  const modules = {
    pb: {
      key: "pb",
      label: "PB",
      updatedAt: pbActivity.value,
      status: pbActivity.status,
      tone: getMemberActivityFreshnessTone(pbActivity.value, pbActivity.status, now),
    },
    demonic: {
      key: "demonic",
      label: "Monstres demoniaques",
      updatedAt: demonicActivity.value,
      status: demonicActivity.status,
      tone: getMemberActivityFreshnessTone(demonicActivity.value, demonicActivity.status, now),
    },
    heroBox: {
      key: "heroBox",
      label: "Box heros",
      updatedAt: heroBoxActivity.value,
      status: heroBoxActivity.status,
      tone: getMemberActivityFreshnessTone(heroBoxActivity.value, heroBoxActivity.status, now),
    },
  };
  const actionRequiredModules = MEMBER_ACTIVITY_PROFILE_MODULES
    .map((module) => modules[module.key])
    .filter((module) => isMemberActivityFreshnessActionRequired(module.updatedAt, module.status, now));

  return {
    profileValid: actionRequiredModules.length === 0,
    actionRequired: actionRequiredModules.length > 0,
    actionRequiredCount: actionRequiredModules.length,
    actionRequiredModules: actionRequiredModules.map((module) => module.key),
    member: {
      memberId: member?.id || member?.memberId || "",
      name: member?.watcher_name || member?.watcherName || member?.discord_id || member?.discordId || "Joueur",
      guildCode: normalizeGuildCode(member?.guild_code || member?.guildCode),
    },
    modules,
  };
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

function isMissingHistoryTable(error, tableName) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  const table = String(tableName || "").toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes(`relation "public.${table}" does not exist`) ||
    message.includes(`relation "${table}" does not exist`) ||
    message.includes("could not find the table")
  );
}

export function isMissingPortalMemberRemindersTable(error) {
  return isMissingHistoryTable(error, PORTAL_MEMBER_REMINDERS_TABLE);
}

export function normalizeMemberActivityReminderType(value) {
  const normalized = cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return MEMBER_ACTIVITY_REMINDER_TYPE_KEYS.includes(normalized) ? normalized : "";
}

export function serializeMemberReminder(row = {}) {
  return {
    id: row.id || "",
    organizationId: row.organization_id || row.organizationId || "",
    guildCode: normalizeGuildCode(row.guild_code || row.guildCode),
    memberId: row.member_id || row.memberId || "",
    reminderType: normalizeMemberActivityReminderType(row.reminder_type || row.reminderType),
    sentByMemberId: row.sent_by_member_id || row.sentByMemberId || "",
    sentByName: row.sent_by_name || row.sentByName || "",
    discordUserId: row.discord_user_id || row.discordUserId || "",
    message: row.message || "",
    status: row.status || "",
    errorMessage: row.error_message || row.errorMessage || "",
    createdAt: row.created_at || row.createdAt || "",
    updatedAt: row.updated_at || row.updatedAt || "",
  };
}

export function isRecentSuccessfulMemberReminder(reminder, now = Date.now()) {
  if (!reminder || reminder.status !== "success") return false;
  const timestamp = Date.parse(reminder.createdAt || reminder.created_at || "");
  if (!Number.isFinite(timestamp)) return false;
  const nowMs = typeof now === "number" ? now : Date.parse(now);
  if (!Number.isFinite(nowMs)) return false;
  return nowMs - timestamp >= 0 && nowMs - timestamp < MEMBER_ACTIVITY_REMINDER_COOLDOWN_MS;
}

export function buildLastSuccessfulMemberRemindersByMemberId(rows = []) {
  const byMemberId = new Map();

  (rows || []).forEach((row) => {
    if (row?.status !== "success") return;
    const memberId = cleanText(row.member_id || row.memberId);
    const reminderType = normalizeMemberActivityReminderType(row.reminder_type || row.reminderType);
    if (!memberId || !reminderType) return;

    const serialized = serializeMemberReminder(row);
    const existing = byMemberId.get(memberId)?.[reminderType];
    const existingTime = Date.parse(existing?.createdAt || "");
    const nextTime = Date.parse(serialized.createdAt || "");
    if (!existing || (Number.isFinite(nextTime) && (!Number.isFinite(existingTime) || nextTime > existingTime))) {
      byMemberId.set(memberId, {
        ...(byMemberId.get(memberId) || {}),
        [reminderType]: serialized,
      });
    }
  });

  return byMemberId;
}

function isMissingHistoryColumn(error, columnName) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return error?.code === "PGRST204" || error?.code === "42703" || message.includes(String(columnName || "").toLowerCase());
}

async function selectHistoryRowsByColumn(supabase, tableName, selectClause, columnName, values, options = {}) {
  const cleanValues = Array.from(new Set((values || []).map((value) => cleanText(value)).filter(Boolean)));
  if (!cleanValues.length) return { data: [], error: null };

  let query = supabase
    .from(tableName)
    .select(selectClause)
    .in(columnName, cleanValues)
    .limit(options.limit || 5000);

  if (options.orderColumn) {
    query = query.order(options.orderColumn, { ascending: options.ascending !== false });
  }

  const { data, error } = await query;
  if (error && isMissingHistoryTable(error, tableName)) return { data: [], error: null, missing: true };
  return { data: data || [], error };
}

async function selectHistoryRowsWithFallback(supabase, tableName, selectClause, fallbackSelectClause, memberIds, missingColumnName) {
  let result = await selectHistoryRowsByColumn(supabase, tableName, selectClause, "member_id", memberIds);
  if (result.error && isMissingHistoryColumn(result.error, missingColumnName)) {
    result = await selectHistoryRowsByColumn(supabase, tableName, fallbackSelectClause, "member_id", memberIds);
  }
  if (result.error) throw result.error;
  return result.data || [];
}

async function selectActivityStates(supabase, memberIds) {
  if (!memberIds.length) return { data: [], error: null };

  return await supabase
    .from(PORTAL_MEMBER_ACTIVITY_TABLE)
    .select(ACTIVITY_STATE_SELECT)
    .in("member_id", memberIds)
    .limit(1200);
}

export async function selectLatestSuccessfulMemberReminders(supabase, organizationId, memberIds) {
  const cleanOrganizationId = cleanText(organizationId);
  const cleanMemberIds = Array.from(new Set((memberIds || []).map((memberId) => cleanText(memberId)).filter(Boolean)));
  if (!cleanOrganizationId || cleanMemberIds.length === 0) {
    return { data: [], error: null, schemaReady: Boolean(cleanOrganizationId) };
  }

  const { data, error } = await supabase
    .from(PORTAL_MEMBER_REMINDERS_TABLE)
    .select(MEMBER_REMINDER_SELECT)
    .eq("organization_id", cleanOrganizationId)
    .in("member_id", cleanMemberIds)
    .in("reminder_type", MEMBER_ACTIVITY_REMINDER_TYPE_KEYS)
    .eq("status", "success")
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(cleanMemberIds.length * MEMBER_ACTIVITY_REMINDER_TYPE_KEYS.length * 3, 100), 5000));

  if (error) {
    if (isMissingPortalMemberRemindersTable(error)) {
      return { data: [], error: null, schemaReady: false };
    }
    return { data: [], error, schemaReady: true };
  }

  return { data: data || [], error: null, schemaReady: true };
}

async function selectHistoricalActivityEvidence(supabase, memberIds) {
  if (!memberIds.length) return new Map();

  const [pbEntries, heroBoxEntries, demonicEntries, reproEntries, actorLogsResult, targetLogsResult] = await Promise.all([
    selectHistoryRowsWithFallback(supabase, "member_pb_entries", PB_HISTORY_SELECT, PB_HISTORY_SELECT_FALLBACK, memberIds, "updated_at"),
    selectHistoryRowsWithFallback(
      supabase,
      "member_awakenings",
      HERO_BOX_HISTORY_SELECT,
      HERO_BOX_HISTORY_SELECT,
      memberIds,
      "updated_at",
    ),
    selectHistoryRowsWithFallback(
      supabase,
      "member_demonic_monsters",
      DEMONIC_HISTORY_SELECT,
      DEMONIC_HISTORY_SELECT_FALLBACK,
      memberIds,
      "updated_at",
    ),
    selectHistoryRowsWithFallback(supabase, "gvg_repro", REPRO_HISTORY_SELECT, REPRO_HISTORY_SELECT_FALLBACK, memberIds, "updated_at"),
    selectHistoryRowsByColumn(supabase, "portal_activity_logs", ACTIVITY_LOG_HISTORY_SELECT, "actor_member_id", memberIds, {
      limit: 5000,
      orderColumn: "created_at",
      ascending: false,
    }),
    selectHistoryRowsByColumn(supabase, "portal_activity_logs", ACTIVITY_LOG_HISTORY_SELECT, "target_member_id", memberIds, {
      limit: 5000,
      orderColumn: "created_at",
      ascending: false,
    }),
  ]);

  if (actorLogsResult.error) throw actorLogsResult.error;
  if (targetLogsResult.error) throw targetLogsResult.error;

  const activityLogsById = new Map();
  [...(actorLogsResult.data || []), ...(targetLogsResult.data || [])].forEach((row, index) => {
    const key = row?.id || `${row?.actor_member_id || ""}:${row?.target_member_id || ""}:${row?.action_type || ""}:${row?.created_at || ""}:${index}`;
    activityLogsById.set(String(key), row);
  });

  return buildHistoricalEvidenceByMember({
    pbEntries,
    heroBoxEntries,
    demonicEntries,
    reproEntries,
    activityLogs: Array.from(activityLogsById.values()),
  });
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
  const actorOrganization = await resolvePortalActorOrganization(supabase, actor);
  const currentGvgContextsByGuild = await selectCurrentGvgContexts(supabase, scopedGuildCodes);
  const [statesResult, historicalEvidenceByMemberId, remindersResult, discordCapabilityAccess] = await Promise.all([
    selectActivityStates(supabase, memberIds),
    selectHistoricalActivityEvidence(supabase, memberIds),
    selectLatestSuccessfulMemberReminders(supabase, actorOrganization.organizationId, memberIds),
    loadDiscordCapabilitiesForOrganization(supabase, actorOrganization.organizationId),
  ]);
  const activityStateReady = !isMissingPortalMemberActivityState(statesResult.error);

  if (statesResult.error && activityStateReady) throw statesResult.error;
  if (remindersResult.error) throw remindersResult.error;

  const overview = buildPortalMemberActivityOverview({
    guilds: guildRows.filter((guild) => scopedGuildCodes.includes(normalizeGuildCode(guild.guild_code || guild.guildCode))),
    members,
    states: activityStateReady ? statesResult.data || [] : [],
    currentGvgContextsByGuild,
    historicalEvidenceByMemberId,
    lastSuccessfulRemindersByMemberId: buildLastSuccessfulMemberRemindersByMemberId(remindersResult.data || []),
  });

  return {
    ...overview,
    organization: {
      id: actorOrganization.organizationId || "",
      key: actorOrganization.organizationKey || "",
      name: actorOrganization.organizationName || "",
      guildCodes: actorOrganization.guildCodes || [],
    },
    memberRemindersReady: remindersResult.schemaReady !== false,
    discordCapabilitiesReady: discordCapabilityAccess.schemaReady !== false,
    discordCapabilities: discordCapabilityAccess.capabilities,
    activityStateReady,
    migrationRequired: !activityStateReady,
    warning: activityStateReady ? "" : PORTAL_MEMBER_ACTIVITY_MIGRATION_MESSAGE,
    currentGvgContextsByGuild,
  };
}

export async function loadPortalMemberActivitySelfStatus(supabase, actor) {
  const memberId = cleanText(actor?.id || actor?.memberId);
  if (!memberId) {
    const error = new Error("Session Portal invalide.");
    error.statusCode = 401;
    throw error;
  }

  const [statesResult, historicalEvidenceByMemberId] = await Promise.all([
    selectActivityStates(supabase, [memberId]),
    selectHistoricalActivityEvidence(supabase, [memberId]),
  ]);
  const activityStateReady = !isMissingPortalMemberActivityState(statesResult.error);

  if (statesResult.error && activityStateReady) throw statesResult.error;

  const state = activityStateReady
    ? (statesResult.data || []).find((row) => String(row?.member_id || "") === String(memberId)) || {}
    : {};
  const profileStatus = buildPortalMemberActivityProfileStatus({
    member: actor,
    state,
    historicalEvidence: getHistoricalEvidence(historicalEvidenceByMemberId, memberId),
  });

  return {
    ...profileStatus,
    activityStateReady,
    migrationRequired: !activityStateReady,
    warning: activityStateReady ? "" : PORTAL_MEMBER_ACTIVITY_MIGRATION_MESSAGE,
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
