/* global process */
import { randomInt } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  applyPortalCorsHeaders,
  hashPortalPassword,
  readJsonBody,
  requirePortalSession,
  requirePortalAdminSession,
  requirePortalLeaderSession,
  sendPortalJson,
  updatePortalMemberPassword,
  verifyCurrentPortalPasswordForSession,
  verifyPortalRequestOrigin,
} from "./_portal-auth.js";
import {
  buildLinkedAccountSummary,
  cleanLinkedAccountText,
  getEffectiveDiscordId,
  getLinkedAccountRole,
  getPrimaryMemberId,
  validateSecondaryLink,
} from "../src/lib/linkedAccounts.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const PASSWORD_LENGTH = 12;
const TEMPORARY_PASSWORD_PREFIX = "TMP-";
const MAX_MEMBER_ROWS = 600;
const MAX_SUGGESTIONS = 20;
const DISCORD_API_BASE = "https://discord.com/api/v10";
const DEFENSE_FOLLOWUP_TABLE = "guild_defense_discord_followups";
const COMMUNITY_REQUESTS_TABLE = "portal_community_access_requests";
const TODO_STATUS = "\u00c0 faire";
const VERIFY_STATUS = "\u00c0 v\u00e9rifier";
const VALID_STATUS = "Valid\u00e9";
const DISCORD_STATUS_TODO = "\u274c";
const DISCORD_STATUS_VERIFY = "\u26a0\uFE0F";
const DISCORD_STATUS_DONE = "\u2705";
const DEFENSE_STATUSES = new Set([TODO_STATUS, VERIFY_STATUS, VALID_STATUS]);
const COMMUNITY_ROLES = new Set(["community_member", "content_creator"]);
const COMMUNITY_STATUSES = new Set(["active", "inactive"]);
const COMMUNITY_REQUEST_STATUSES = new Set(["pending", "accepted", "refused"]);
const ROSTER_STATUSES = new Set(["active", "non_roster", "inactive"]);
const EMPTY_DEFENSE_SLOT = "--";
const DEFAULT_MEMBER_PASSWORD = "motdepassemembre";
const HERO_SEARCH_PAGE_SIZE = 1000;
const HERO_SEARCH_MAX_REQUIREMENTS = 10;
const SAFE_MEMBER_SELECT =
  "id, watcher_name, discord_id, guild_code, assignment, status, defense_1, defense_2, created_at, awakening_status, personal_forum_post_url, role, preferred_language, community_access_type, community_status, password_change_required";
const EDIT_MEMBER_SELECT =
  "id, watcher_name, discord_id, guild_code, assignment, status, defense_1, defense_2, created_at, awakening_status, personal_forum_post_url, role, preferred_language, community_access_type, community_status, password_change_required, roster_status, primary_member_id";
const HERO_SEARCH_MEMBER_SELECT =
  "id, watcher_name, discord_id, guild_code, role, community_access_type, community_status";
const SAFE_MEMBER_SELECT_WITH_AWAKENINGS = `
  id,
  watcher_name,
  discord_id,
  guild_code,
  assignment,
  status,
  defense_1,
  defense_2,
  awakening_status,
  personal_forum_post_url,
  role,
  preferred_language,
  community_access_type,
  community_status,
  member_awakenings (
    awakening_level,
    champion_id,
    champions (
      name
    )
  )
`;
const DEFENSE_SELECT = `
  id,
  name,
  tier,
  type,
  faction,
  guild_code,
  is_global,
  is_hidden,
  source_defense_id,
  sort_order,
  image_url,
  created_at,
  guild_defense_slots (
    slot_index,
    champion_id,
    champions (
      id,
      name,
      portal_name,
      english_name
    )
  ),
  guild_defense_conditions (
    id,
    champion_id,
    min_awakening,
    champions (
      id,
      name,
      portal_name,
      english_name
    )
  )
`;
const CHAMPION_SAFE_SELECT =
  "id, name, portal_name, english_name, rarity, faction, role, lord";

function sendJson(res, status, payload) {
  sendPortalJson(res, status, payload, res._portalReq || null);
}

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeText(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isAdminRole(role) {
  return ["admin", "administrateur", "leader"].includes(
    normalizeText(role)
  );
}

function isLeaderRole(role) {
  return normalizeText(role) === "leader";
}

function isCommunityRole(role) {
  return COMMUNITY_ROLES.has(normalizeText(role));
}

function normalizeCommunityRole(role) {
  const normalized = normalizeText(role);
  return COMMUNITY_ROLES.has(normalized) ? normalized : "community_member";
}

function normalizeCommunityStatus(status) {
  const normalized = normalizeText(status);
  return COMMUNITY_STATUSES.has(normalized) ? normalized : "active";
}

function normalizeCommunityRequestStatus(status) {
  const normalized = normalizeText(status);
  return COMMUNITY_REQUEST_STATUSES.has(normalized) ? normalized : "pending";
}

function normalizeRosterStatus(status) {
  const normalized = normalizeText(status);
  return ROSTER_STATUSES.has(normalized) ? normalized : "active";
}

function normalizeGuildCode(value) {
  return cleanText(value).toUpperCase().replace(/\s+/g, "_");
}

function isPaladinGuildCode(value) {
  return /^G[1-7]$/.test(normalizeGuildCode(value));
}

function isMissingFollowupTable(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes(DEFENSE_FOLLOWUP_TABLE)
  );
}

function isMissingOptionalTable(error, tableName) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return error?.code === "42P01" || error?.code === "PGRST205" || message.includes(String(tableName || "").toLowerCase());
}

function isMissingColumn(error, columnName) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return (
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    message.includes(String(columnName || "").toLowerCase())
  );
}

function getMemberName(member) {
  return member?.watcher_name || member?.discord_id || "Joueur";
}

function serializeMember(member) {
  return {
    id: member.id,
    name: getMemberName(member),
    discordId: member.discord_id || "",
    guildCode: member.guild_code || "",
    role: member.role || "Joueur",
  };
}

function serializeCommunityMember(member) {
  return {
    id: member.id,
    watcherName: member.watcher_name || "",
    name: getMemberName(member),
    discordId: member.discord_id || "",
    preferredLanguage: member.preferred_language || "fr",
    role: normalizeCommunityRole(member.role),
    status: normalizeCommunityStatus(member.community_status),
    guildCode: member.guild_code || "",
    accessType: member.community_access_type || (isCommunityRole(member.role) ? "community" : ""),
    createdAt: member.created_at || null,
  };
}

function serializeCommunityRequest(row) {
  return {
    id: row.id,
    discordContact: row.discord_contact || "",
    preferredLanguage: row.preferred_language || "fr",
    guildName: row.guild_name || "",
    message: row.message || "",
    status: normalizeCommunityRequestStatus(row.status),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    handledAt: row.handled_at || null,
    handledByMemberId: row.handled_by_member_id || null,
    handledByName: row.handled_by_name || "",
    createdMemberId: row.created_member_id || null,
    metadata: row.metadata || {},
  };
}

function generatePassword() {
  let password = "";

  for (let index = 0; index < PASSWORD_LENGTH; index += 1) {
    password += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  }

  return `${TEMPORARY_PASSWORD_PREFIX}${password}`;
}

async function readBody(req) {
  return readJsonBody(req);
}

async function requireAdmin(req, adminPassword) {
  const sessionCheck = await requirePortalAdminSession(req, supabase, { includePassword: true });
  if (sessionCheck.error) {
    return { error: sessionCheck.error, status: sessionCheck.status };
  }

  if (!adminPassword) {
    return { error: "Mot de passe admin obligatoire.", status: 401 };
  }

  const passwordOk = await verifyCurrentPortalPasswordForSession(supabase, sessionCheck, adminPassword);
  if (!passwordOk) {
    return { error: "Mot de passe admin incorrect.", status: 403 };
  }

  return { admin: sessionCheck.member };
}

async function requireAdminById(req) {
  const sessionCheck = await requirePortalAdminSession(req, supabase);
  if (sessionCheck.error) return { error: sessionCheck.error, status: sessionCheck.status };
  return { admin: sessionCheck.member };
}

async function requireLeaderById(req) {
  const sessionCheck = await requirePortalLeaderSession(req, supabase);
  if (sessionCheck.error) return { error: sessionCheck.error, status: sessionCheck.status };
  return { leader: sessionCheck.member };
}

async function initializeMemberData(memberId, memberName) {
  const warnings = [];
  const { data: champions, error: championsError } = await supabase
    .from("champions")
    .select("id, name")
    .order("name", { ascending: true });

  if (championsError) {
    warnings.push("Initialisation des eveils impossible.");
  } else {
    const awakeningRows = (champions || [])
      .filter((champion) => champion.id)
      .map((champion) => ({
        member_id: memberId,
        champion_id: champion.id,
        awakening_level: -1,
      }));

    if (awakeningRows.length) {
      const { error } = await supabase.from("member_awakenings").insert(awakeningRows);
      if (error) warnings.push("Initialisation des eveils impossible.");
    }
  }

  const pbRows = [1, 2, 3, 4, 5].map((slotIndex) => ({
    member_id: memberId,
    member_name: memberName,
    slot_index: slotIndex,
    pb_raw: 0,
    champion_id: null,
  }));

  const { error: pbError } = await supabase.from("member_pb_entries").insert(pbRows);
  if (pbError) warnings.push("Initialisation des PB impossible.");

  return warnings;
}

function isCommunityAccount(member) {
  return (
    member?.community_access_type === "community" ||
    isCommunityRole(member?.role) ||
    (!member?.guild_code && isCommunityRole(member?.role))
  );
}

function getGuildSpaceKeyLocal(value) {
  const code = normalizeGuildCode(value);
  if (!code) return "";
  if (isPaladinGuildCode(code)) return "PALADIN";

  const match = code.match(/^(.+?)(?:_?G\d+)$/i);
  return (match?.[1] || code).replace(/_+$/g, "") || code;
}

function sameGuildSpace(left, right) {
  const leftSpace = getGuildSpaceKeyLocal(left);
  const rightSpace = getGuildSpaceKeyLocal(right);
  return Boolean(leftSpace && rightSpace && leftSpace === rightSpace);
}

function canViewGuildCode(actor, guildCode, { leaderSeesAll = false } = {}) {
  if (!actor || isCommunityAccount(actor)) return false;
  if (leaderSeesAll && isLeaderRole(actor?.role)) return true;

  const actorGuild = normalizeGuildCode(actor?.guild_code);
  const targetGuild = normalizeGuildCode(guildCode);
  if (!actorGuild || !targetGuild) return false;

  if (isPaladinGuildCode(actorGuild)) return isPaladinGuildCode(targetGuild);
  return sameGuildSpace(actorGuild, targetGuild);
}

function canViewDefense(actor, defense, { guildCode = "", leaderSeesAll = false } = {}) {
  if (!actor || isCommunityAccount(actor)) return false;
  if (leaderSeesAll && isLeaderRole(actor?.role)) return true;

  const actorGuild = normalizeGuildCode(guildCode || actor?.guild_code);
  if (!actorGuild) return false;

  const defenseGuild = normalizeGuildCode(defense?.guild_code);
  if (defense?.is_global || !defenseGuild) return isPaladinGuildCode(actorGuild);
  if (isPaladinGuildCode(actorGuild)) return isPaladinGuildCode(defenseGuild);
  return sameGuildSpace(actorGuild, defenseGuild);
}

function serializeManagedMember(row) {
  const awakenings = {};

  (row?.member_awakenings || []).forEach((entry) => {
    const heroName = entry?.champions?.name;
    if (heroName) {
      awakenings[heroName] = entry.awakening_level;
    }
  });

  return {
    id: row.id,
    name: row.watcher_name || row.discord_id || "Joueur",
    discordId: row.discord_id || "",
    guildCode: row.guild_code || "",
    assignment: row.assignment || "Tour",
    status: row.status || TODO_STATUS,
    awakeningStatus: row.awakening_status || "En attente",
    personalForumPostUrl: row.personal_forum_post_url || "",
    role: row.role || "member",
    preferredLanguage: row.preferred_language || "fr",
    communityAccessType: row.community_access_type || "",
    communityStatus: row.community_status || "",
    defense1: row.defense_1 || EMPTY_DEFENSE_SLOT,
    defense2: row.defense_2 || EMPTY_DEFENSE_SLOT,
    awakenings,
  };
}

function serializeEditableMember(row) {
  if (!row) return null;

  return {
    id: row.id,
    watcherName: row.watcher_name || "",
    name: getMemberName(row),
    discordId: row.discord_id || "",
    guildCode: row.guild_code || "",
    role: row.role || "member",
    rosterStatus: normalizeRosterStatus(row.roster_status),
    assignment: row.assignment || "",
    status: row.status || "",
    awakeningStatus: row.awakening_status || "",
    personalForumPostUrl: row.personal_forum_post_url || "",
    preferredLanguage: row.preferred_language || "fr",
    communityAccessType: row.community_access_type || "",
    communityStatus: row.community_status || "",
    primaryMemberId: row.primary_member_id || null,
    linkedAccountRole: getLinkedAccountRole(row),
  };
}

function serializeEditableMemberSuggestion(row) {
  return {
    id: row.id,
    watcherName: row.watcher_name || "",
    name: getMemberName(row),
    guildCode: row.guild_code || "",
    role: row.role || "member",
    rosterStatus: normalizeRosterStatus(row.roster_status),
    primaryMemberId: row.primary_member_id || null,
    linkedAccountRole: getLinkedAccountRole(row),
  };
}

async function loadEditableMemberById(memberId) {
  const { data, error } = await supabase
    .from("guild_members")
    .select(EDIT_MEMBER_SELECT)
    .eq("id", memberId)
    .maybeSingle();

  if (error) {
    if (isMissingColumn(error, "primary_member_id")) {
      const missing = new Error("Migration comptes secondaires non executee : colonne primary_member_id manquante.");
      missing.statusCode = 428;
      throw missing;
    }
    throw new Error(error.message || "Chargement du membre impossible.");
  }

  return data || null;
}

async function loadEditableMembersByIds(memberIds) {
  const ids = [...new Set((memberIds || []).map(cleanText).filter(Boolean))];
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from("guild_members")
    .select(EDIT_MEMBER_SELECT)
    .in("id", ids);

  if (error) {
    if (isMissingColumn(error, "primary_member_id")) {
      const missing = new Error("Migration comptes secondaires non executee : colonne primary_member_id manquante.");
      missing.statusCode = 428;
      throw missing;
    }
    throw new Error(error.message || "Chargement des membres lies impossible.");
  }

  return data || [];
}

async function loadEditableMemberProfile(memberId, admin) {
  const member = await loadEditableMemberById(memberId);
  if (!member) return null;

  if (!canAdminManageTarget(admin, member)) {
    const error = new Error("Ce joueur n'est pas dans ton perimetre.");
    error.statusCode = 403;
    throw error;
  }

  let primary = null;
  let secondaries = [];
  let linkedAccounts = [];

  const primaryMemberId = getPrimaryMemberId(member);
  if (primaryMemberId) {
    const rows = await loadEditableMembersByIds([primaryMemberId]);
    primary = rows[0] || null;
  }

  const rootId = primary?.id || member.id;
  const { data: secondaryRows, error: secondariesError } = await supabase
    .from("guild_members")
    .select(EDIT_MEMBER_SELECT)
    .eq("primary_member_id", rootId)
    .order("watcher_name", { ascending: true });

  if (secondariesError) {
    if (isMissingColumn(secondariesError, "primary_member_id")) {
      const missing = new Error("Migration comptes secondaires non executee : colonne primary_member_id manquante.");
      missing.statusCode = 428;
      throw missing;
    }
    throw new Error(secondariesError.message || "Chargement des comptes lies impossible.");
  }

  secondaries = secondaryRows || [];
  linkedAccounts = [primary || member, ...secondaries]
    .filter(Boolean)
    .filter((row) => canAdminManageTarget(admin, row))
    .map(serializeEditableMemberSuggestion);

  const visiblePrimary = primary && canAdminManageTarget(admin, primary) ? primary : null;

  return {
    member: serializeEditableMember(member),
    primary: visiblePrimary ? serializeEditableMemberSuggestion(visiblePrimary) : null,
    linkedAccounts,
    linkedSummary: buildLinkedAccountSummary(member, {
      primary: visiblePrimary,
      linkedAccounts,
    }),
    effectiveDiscordId: getEffectiveDiscordId(member, visiblePrimary),
  };
}

function serializeDefenseBlock(row) {
  return {
    id: row.id,
    blockType: row.block_type,
    content: row.content,
    sortOrder: row.sort_order ?? 9999,
  };
}

function serializeDefenseRow(row, blocksByDefenseId = new Map()) {
  const slots = [...(row?.guild_defense_slots || [])]
    .sort((a, b) => (a.slot_index ?? 0) - (b.slot_index ?? 0))
    .map((slot) => slot?.champions?.name || "")
    .filter(Boolean);

  const conditions = (row?.guild_defense_conditions || []).map((condition) => ({
    id: condition.id,
    championId: condition.champion_id,
    minAwakening: condition.min_awakening,
    label: `${condition.champions?.name || "Hero"} A${condition.min_awakening} minimum`,
  }));

  return {
    id: row.id,
    name: row.name,
    tier: row.tier,
    type: row.type,
    faction: row.faction || "",
    guildCode: row.guild_code || "",
    isGlobal: Boolean(row.is_global),
    isHidden: Boolean(row.is_hidden),
    sourceDefenseId: row.source_defense_id || null,
    sortOrder: row.sort_order ?? 9999,
    slots,
    conditions,
    infoBlocks: blocksByDefenseId.get(String(row.id)) || [],
    image: row.image_url || "",
  };
}

function serializeVoteRow(row) {
  return {
    id: row.id,
    defenseId: row.defense_id,
    memberId: row.member_id,
    value: row.value,
    createdAt: row.created_at,
  };
}

function sortByName(rows) {
  return [...rows].sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || ""), "fr", {
      numeric: true,
      sensitivity: "base",
    })
  );
}

async function loadDefenseBlocks(defenseIds) {
  const ids = [...new Set((defenseIds || []).map(cleanText).filter(Boolean))];
  if (ids.length === 0) return new Map();

  const { data, error } = await supabase
    .from("guild_defense_blocks")
    .select("id, defense_id, block_type, content, sort_order")
    .in("defense_id", ids)
    .order("sort_order", { ascending: true });

  if (error) {
    throw new Error(error.message || "Chargement des infos defenses impossible.");
  }

  return (data || []).reduce((grouped, block) => {
    const key = String(block.defense_id);
    const previous = grouped.get(key) || [];
    grouped.set(key, [...previous, serializeDefenseBlock(block)]);
    return grouped;
  }, new Map());
}

async function loadVisibleDefenses(actor, { guildCode = "", leaderSeesAll = false } = {}) {
  const { data, error } = await supabase
    .from("guild_defenses")
    .select(DEFENSE_SELECT)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message || "Chargement des defenses impossible.");
  }

  const rows = (data || []).filter((row) =>
    canViewDefense(actor, row, { guildCode, leaderSeesAll })
  );
  const blocksByDefenseId = await loadDefenseBlocks(rows.map((row) => row.id));

  return rows
    .map((row) => serializeDefenseRow(row, blocksByDefenseId))
    .sort((a, b) => {
      if ((a.sortOrder ?? 9999) !== (b.sortOrder ?? 9999)) {
        return (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999);
      }
      return String(a.name || "").localeCompare(String(b.name || ""), "fr", {
        sensitivity: "base",
      });
    });
}

async function loadDefenseVotes(defenses) {
  const defenseIds = [...new Set((defenses || []).flatMap((defense) => {
    const ids = [defense?.id, defense?.sourceDefenseId].filter(Boolean);
    return ids.map(String);
  }))];
  if (defenseIds.length === 0) return [];

  const { data, error } = await supabase
    .from("cluster_defense_likes")
    .select("id, defense_id, member_id, value, created_at")
    .in("defense_id", defenseIds);

  if (error) {
    throw new Error(error.message || "Chargement des votes defenses impossible.");
  }

  return (data || []).map(serializeVoteRow);
}

async function loadSafeMemberById(memberId, select = SAFE_MEMBER_SELECT) {
  const { data, error } = await supabase
    .from("guild_members")
    .select(select)
    .eq("id", memberId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Chargement du membre impossible.");
  }

  return data || null;
}

function normalizeMemberPatch(patch) {
  const payload = {};
  const allowed = {
    watcher_name: "watcher_name",
    name: "watcher_name",
    discord_id: "discord_id",
    discordId: "discord_id",
    guild_code: "guild_code",
    guildCode: "guild_code",
    assignment: "assignment",
    status: "status",
    awakening_status: "awakening_status",
    awakeningStatus: "awakening_status",
    personal_forum_post_url: "personal_forum_post_url",
    personalForumPostUrl: "personal_forum_post_url",
    defense_1: "defense_1",
    defense1: "defense_1",
    defense_2: "defense_2",
    defense2: "defense_2",
    role: "role",
    preferred_language: "preferred_language",
    preferredLanguage: "preferred_language",
  };

  Object.entries(patch || {}).forEach(([key, value]) => {
    const dbKey = allowed[key];
    if (!dbKey) return;
    payload[dbKey] = typeof value === "string" ? cleanText(value) : value;
  });

  if (payload.guild_code !== undefined) payload.guild_code = normalizeGuildCode(payload.guild_code);
  if (payload.defense_1 === "") payload.defense_1 = EMPTY_DEFENSE_SLOT;
  if (payload.defense_2 === "") payload.defense_2 = EMPTY_DEFENSE_SLOT;
  if (payload.status && !DEFENSE_STATUSES.has(payload.status)) {
    delete payload.status;
  }

  return payload;
}

async function deleteRowsIfPresent(table, column, value) {
  const { error } = await supabase.from(table).delete().eq(column, value);
  if (error && !isMissingFollowupTable(error)) {
    throw new Error(error.message || `Suppression ${table} impossible.`);
  }
}

function canAdminManageTarget(admin, target) {
  if (isLeaderRole(admin?.role)) return true;

  const adminGuild = normalizeGuildCode(admin?.guild_code);
  const targetGuild = normalizeGuildCode(target?.guild_code);
  if (!adminGuild || !targetGuild) return false;

  if (isPaladinGuildCode(adminGuild) && isPaladinGuildCode(targetGuild)) return true;
  return adminGuild === targetGuild;
}

function getDiscordBotToken() {
  return String(
    process.env.DISCORD_BOT_TOKEN ||
      process.env.DISCORD_DEFENSE_BOT_TOKEN ||
      process.env.DISCORD_TOKEN ||
      ""
  ).trim();
}

async function discordRequest(pathname, options = {}) {
  const token = getDiscordBotToken();
  if (!token) {
    const error = new Error("DISCORD_BOT_TOKEN manquant.");
    error.statusCode = 500;
    throw error;
  }

  const response = await fetch(`${DISCORD_API_BASE}${pathname}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bot ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 204) return null;

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.message || `Discord HTTP ${response.status}`);
    error.statusCode = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function serializeDiscordWarning(error, extra = {}) {
  const retryAfter = Number(error?.payload?.retry_after ?? error?.data?.retry_after ?? 0);
  const statusCode = error?.statusCode ?? error?.status ?? null;
  const retryText =
    statusCode === 429 && Number.isFinite(retryAfter) && retryAfter > 0
      ? ` Reessaie dans ${Math.ceil(retryAfter)}s.`
      : "";

  return {
    ...extra,
    statusCode,
    retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    message: `${error?.message || "Discord request failed"}${retryText}`,
  };
}

function buildDiscordStatusChannelName(currentName, targetName, statusEmoji) {
  const cleanCurrent = cleanText(currentName);
  const cleanTarget = cleanText(targetName);
  const strippedCurrent = cleanCurrent
    .replace(/^\s*(?:\u2705|\u274c|\u26a0\uFE0F?|\u26a0)\s*(?:[-\u2013\u2014]\s*)?/u, "")
    .trim();
  const baseName = strippedCurrent || cleanTarget || cleanCurrent || "Joueur";

  return `${statusEmoji} - ${baseName}`.slice(0, 100);
}

function getDiscordStatusEmoji(status) {
  if (status === VERIFY_STATUS) return DISCORD_STATUS_VERIFY;
  if (status === VALID_STATUS) return DISCORD_STATUS_DONE;
  return DISCORD_STATUS_TODO;
}

async function renameDiscordChannelStatus(channelId, targetName, statusEmoji) {
  if (!channelId) return { skipped: true, reason: "missing_channel" };

  const channel = await discordRequest(`/channels/${encodeURIComponent(channelId)}`, {
    method: "GET",
  });
  const before = cleanText(channel?.name);
  const after = buildDiscordStatusChannelName(before, targetName, statusEmoji);

  if (!after || before === after) {
    return { skipped: true, reason: "already_named", channelId, before, after };
  }

  await discordRequest(`/channels/${encodeURIComponent(channelId)}`, {
    method: "PATCH",
    body: { name: after },
  });

  return { renamed: true, channelId, before, after };
}

function parseDiscordChannelId(value) {
  const raw = cleanText(value);
  if (!raw) return "";
  if (/^\d{15,25}$/.test(raw)) return raw;

  try {
    const parsed = new URL(raw);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const channelsIndex = parts.findIndex((part) => part === "channels");
    if (channelsIndex >= 0 && parts[channelsIndex + 2]) {
      return parts[channelsIndex + 2];
    }
  } catch {
    return "";
  }

  return "";
}

function splitDiscordMessage(content) {
  const limit = 1800;
  const lines = String(content || "").split("\n");
  const chunks = [];
  let current = "";

  lines.forEach((line) => {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > limit && current) {
      chunks.push(current);
      current = line;
      return;
    }
    current = next;
  });

  if (current) chunks.push(current);
  return chunks.length ? chunks : ["Message vide."];
}

async function sendDiscordMessages(channelId, content) {
  const chunks = splitDiscordMessage(content);
  const sent = [];

  for (const chunk of chunks) {
    const message = await discordRequest(`/channels/${encodeURIComponent(channelId)}/messages`, {
      method: "POST",
      body: {
        content: chunk,
        allowed_mentions: { parse: [] },
      },
    });
    sent.push(message?.id || null);
  }

  return sent;
}

async function sendDiscordDm(userId, content) {
  const channel = await discordRequest("/users/@me/channels", {
    method: "POST",
    body: { recipient_id: String(userId) },
  });

  if (!channel?.id) {
    const error = new Error("Salon MP Discord introuvable.");
    error.statusCode = 500;
    throw error;
  }

  return sendDiscordMessages(channel.id, content);
}

function normalizeDefenseName(value) {
  const cleanValue = cleanText(value);
  return cleanValue && cleanValue !== "--" && cleanValue !== "—" ? cleanValue : "";
}

function formatDefenseBlocks(defense) {
  const blocks = [...(defense.guild_defense_blocks || [])]
    .sort((a, b) => (a.sort_order ?? 9999) - (b.sort_order ?? 9999))
    .map((block) => cleanText(block.content))
    .filter(Boolean);

  return blocks.length ? blocks.map((block) => `  - ${block}`).join("\n") : "  - Aucune consigne particuliere";
}

function formatDefenseConditions(defense) {
  const conditions = [...(defense.guild_defense_conditions || [])]
    .map((condition) => {
      const hero = condition.champions?.name || "Hero";
      const awakening = condition.min_awakening ?? 0;
      return `${hero} A${awakening} minimum`;
    })
    .filter(Boolean);

  return conditions.length ? conditions.map((condition) => `  - ${condition}`).join("\n") : "  - Aucune condition";
}

function formatDefenseHeroes(defense) {
  const heroes = [...(defense.guild_defense_slots || [])]
    .sort((a, b) => (a.slot_index ?? 0) - (b.slot_index ?? 0))
    .map((slot) => slot.champions?.name)
    .filter(Boolean);

  return heroes.length ? heroes.join(", ") : "Non renseigne";
}

function pickDefenseForGuild(rows, name, guildCode) {
  const matching = rows.filter((row) => row.name === name);
  const normalizedGuild = normalizeGuildCode(guildCode);

  return (
    matching.find((row) => normalizeGuildCode(row.guild_code) === normalizedGuild) ||
    matching.find((row) => row.is_global) ||
    matching[0] ||
    null
  );
}

function buildDefenseMessage({ target, defenses, missingNames, actor }) {
  const targetName = getMemberName(target);
  const guildCode = target.guild_code || "-";
  const actorName = getMemberName(actor);

  const lines = [
    `**Defenses assignees - ${targetName} (${guildCode})**`,
    `Envoye par ${actorName}.`,
    "",
    "Voici les defenses a preparer :",
  ];

  defenses.forEach((defense, index) => {
    lines.push("");
    lines.push(`**Defense ${index + 1} - ${defense.name}**`);
    lines.push(`Type : ${defense.type || "-"} | Tier : ${defense.tier || "-"}`);
    lines.push(`Heros : ${formatDefenseHeroes(defense)}`);
    lines.push("Conditions :");
    lines.push(formatDefenseConditions(defense));
    lines.push("Infos :");
    lines.push(formatDefenseBlocks(defense));
    if (defense.image_url) lines.push(`Image : ${defense.image_url}`);
  });

  missingNames.forEach((name) => {
    lines.push("");
    lines.push(`**${name}**`);
    lines.push("Defense assignee mais informations introuvables dans Portal.");
  });

  return lines.join("\n");
}

async function loadMembers() {
  return supabase
    .from("guild_members")
    .select("id, role, discord_id, watcher_name, guild_code")
    .order("watcher_name", { ascending: true })
    .limit(MAX_MEMBER_ROWS);
}

async function handleSearch(body, res) {
  const adminPassword = cleanText(body.adminPassword || body.admin_password);
  const adminCheck = await requireAdmin(res._portalReq, adminPassword);

  if (adminCheck.error) {
    sendJson(res, adminCheck.status, { error: adminCheck.error });
    return;
  }

  const query = normalizeText(body.query);
  if (query.length < 2) {
    sendJson(res, 200, { members: [] });
    return;
  }

  const { data, error } = await loadMembers();

  if (error) {
    sendJson(res, 500, { error: error.message || "Recherche joueur impossible." });
    return;
  }

  const members = (data || [])
    .filter((member) => {
      const haystack = normalizeText(
        `${member.watcher_name || ""} ${member.discord_id || ""} ${member.guild_code || ""}`
      );
      return haystack.includes(query);
    })
    .slice(0, MAX_SUGGESTIONS)
    .map(serializeMember);

  sendJson(res, 200, { members });
}

async function handleMembersList(body, res) {
  const adminCheck = await requireAdminById(res._portalReq);

  if (adminCheck.error) {
    sendJson(res, adminCheck.status, { error: adminCheck.error });
    return;
  }

  const { data, error } = await supabase
    .from("guild_members")
    .select(SAFE_MEMBER_SELECT)
    .order("watcher_name", { ascending: true })
    .limit(MAX_MEMBER_ROWS);

  if (error) {
    sendJson(res, 500, { error: error.message || "Chargement membres impossible." });
    return;
  }

  const members = (data || [])
    .filter((member) => !isCommunityAccount(member))
    .filter((member) => canViewGuildCode(adminCheck.admin, member.guild_code, { leaderSeesAll: true }))
    .map(serializeMember);

  sendJson(res, 200, { members });
}

async function handleReset(body, res) {
  const adminPassword = cleanText(body.adminPassword || body.admin_password);
  const memberId = cleanText(body.memberId || body.member_id);
  const adminCheck = await requireAdmin(res._portalReq, adminPassword);

  if (adminCheck.error) {
    sendJson(res, adminCheck.status, { error: adminCheck.error });
    return;
  }

  if (!memberId) {
    sendJson(res, 400, { error: "Joueur manquant." });
    return;
  }

  const { data: target, error: targetError } = await supabase
    .from("guild_members")
    .select("id, role, discord_id, watcher_name, guild_code")
    .eq("id", memberId)
    .maybeSingle();

  if (targetError) {
    sendJson(res, 500, { error: targetError.message || "Joueur introuvable." });
    return;
  }

  if (!target) {
    sendJson(res, 404, { error: "Joueur introuvable." });
    return;
  }

  if (isAdminRole(target.role) && !isLeaderRole(adminCheck.admin?.role)) {
    sendJson(res, 403, { error: "Les comptes admin ne peuvent etre reinitialises que par le leader." });
    return;
  }

  const temporaryPassword = generatePassword();
  try {
    await updatePortalMemberPassword(supabase, target.id, hashPortalPassword(temporaryPassword), {
      passwordChangeRequired: true,
    });
  } catch (updateError) {
    sendJson(res, 500, { error: updateError.message || "Reset du mot de passe impossible." });
    return;
  }

  const adminName = getMemberName(adminCheck.admin);
  const targetName = getMemberName(target);

  await supabase.from("portal_activity_logs").insert({
    actor_member_id: adminCheck.admin.id,
    actor_name: adminName,
    target_member_id: target.id,
    target_name: targetName,
    action_type: "player_password_reset",
    entity_type: "guild_members",
    entity_id: target.id,
    summary: `${adminName} a genere un nouveau mot de passe pour ${targetName}`,
    metadata: {
      targetDiscordId: target.discord_id || "",
      targetGuildCode: target.guild_code || "",
    },
  });

  sendJson(res, 200, {
    member: serializeMember(target),
    temporaryPassword,
  });
}

async function handleExternalAccountRequest(body, req, res) {
  const discordContact = cleanText(body.discordContact || body.discord_contact || body.discordId || body.discord_id);
  const preferredLanguage = cleanText(body.preferredLanguage || body.preferred_language || body.language || "fr") || "fr";
  const guildName = cleanText(body.guildName || body.guild_name || body.guild || "");

  if (discordContact.length < 2) {
    sendJson(res, 400, { error: "Contact Discord obligatoire." });
    return;
  }

  if (discordContact.length > 120 || guildName.length > 120) {
    sendJson(res, 400, { error: "Demande trop longue." });
    return;
  }

  const cleanLanguage = ["fr", "en"].includes(preferredLanguage.toLowerCase())
    ? preferredLanguage.toLowerCase()
    : "fr";

  let existingMember = null;
  if (/^\d{15,25}$/.test(discordContact)) {
    const { data, error } = await supabase
      .from("guild_members")
      .select("id, watcher_name, discord_id, guild_code")
      .eq("discord_id", discordContact)
      .maybeSingle();

    if (error) {
      sendJson(res, 500, { error: error.message || "Verification du compte impossible." });
      return;
    }

    existingMember = data || null;
  }

  if (existingMember) {
    sendJson(res, 409, {
      error: "Un compte existe deja pour cet ID Discord. Utilise mot de passe oublie ou contacte un admin.",
      member: serializeMember(existingMember),
    });
    return;
  }

  const { data: members, error: leadersError } = await supabase
    .from("guild_members")
    .select("id, role, watcher_name, discord_id, guild_code")
    .limit(MAX_MEMBER_ROWS);

  if (leadersError) {
    sendJson(res, 500, { error: leadersError.message || "Chargement leaders impossible." });
    return;
  }

  const leaders = (members || []).filter((member) => isLeaderRole(member.role) && member.discord_id);
  const sourceIp = cleanText(
    req.headers["x-forwarded-for"] ||
      req.headers["x-real-ip"] ||
      req.socket?.remoteAddress ||
      ""
  ).split(",")[0] || "";
  const summary = `Nouvelle demande de compte externe : ${discordContact}`;

  const { data: requestRow, error: requestError } = await supabase
    .from(COMMUNITY_REQUESTS_TABLE)
    .insert({
      discord_contact: discordContact,
      preferred_language: cleanLanguage,
      guild_name: guildName || null,
      status: "pending",
      source_ip: sourceIp || null,
      metadata: {
        source: "portal_login",
      },
    })
    .select("id, created_at")
    .maybeSingle();

  if (requestError) {
    sendJson(res, 500, { error: requestError.message || "Enregistrement de la demande impossible." });
    return;
  }

  const { data: logRow, error: logError } = await supabase
    .from("portal_activity_logs")
    .insert({
      actor_name: "Demande externe",
      target_name: discordContact,
      action_type: "external_account_request",
      entity_type: "external_access",
      entity_id: discordContact,
      summary,
      metadata: {
        requestId: requestRow?.id || null,
        discordContact,
        preferredLanguage: cleanLanguage,
        guildName,
        sourceIp,
      },
    })
    .select("id, created_at")
    .maybeSingle();

  if (logError) {
    sendJson(res, 500, { error: logError.message || "Enregistrement de la demande impossible." });
    return;
  }

  const warnings = [];
  const dmMessageIds = [];
  const leaderMessage = [
    "**Nouvelle demande de compte Portal**",
    "",
    `Contact Discord : ${discordContact}`,
    `Langue : ${cleanLanguage.toUpperCase()}`,
    `Guilde indiquee : ${guildName || "-"}`,
    `Demande : ${requestRow?.id || "-"}`,
    `Log Portal : ${logRow?.id || "-"}`,
  ].join("\n");

  for (const leader of leaders) {
    try {
      const sentIds = await sendDiscordDm(leader.discord_id, leaderMessage);
      dmMessageIds.push(...sentIds.filter(Boolean));
    } catch (discordError) {
      warnings.push(
        serializeDiscordWarning(discordError, {
          type: "external_request_dm_failed",
          leaderId: leader.id,
          leaderName: getMemberName(leader),
        })
      );
    }
  }

  if (!leaders.length) {
    warnings.push({
      type: "missing_leader_discord_id",
      message: "Aucun leader avec ID Discord trouve pour recevoir le MP.",
    });
  }

  if (dmMessageIds.length || warnings.length) {
    await supabase
      .from("portal_activity_logs")
      .update({
        metadata: {
          discordContact,
          requestId: requestRow?.id || null,
          preferredLanguage: cleanLanguage,
          guildName,
          sourceIp,
          dmMessageIds,
          warnings,
        },
      })
      .eq("id", logRow?.id);
  }

  sendJson(res, 200, {
    ok: true,
    requestId: requestRow?.id || null,
    logId: logRow?.id || null,
    notifiedLeaders: dmMessageIds.length,
    warnings,
  });
}

async function handleCommunityList(body, res) {
  const leaderCheck = await requireLeaderById(res._portalReq);

  if (leaderCheck.error) {
    sendJson(res, leaderCheck.status, { error: leaderCheck.error });
    return;
  }

  const [requestsResult, membersResult] = await Promise.all([
    supabase
      .from(COMMUNITY_REQUESTS_TABLE)
      .select(
        "id, created_at, updated_at, discord_contact, preferred_language, guild_name, message, status, handled_at, handled_by_member_id, handled_by_name, created_member_id, metadata",
      )
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("guild_members")
      .select(
        "id, watcher_name, discord_id, guild_code, role, created_at, preferred_language, community_access_type, community_status",
      )
      .is("guild_code", null)
      .order("watcher_name", { ascending: true })
      .limit(MAX_MEMBER_ROWS),
  ]);

  if (requestsResult.error) {
    sendJson(res, 500, { error: requestsResult.error.message || "Chargement des demandes impossible." });
    return;
  }

  if (membersResult.error) {
    sendJson(res, 500, { error: membersResult.error.message || "Chargement des membres communaute impossible." });
    return;
  }

  const members = (membersResult.data || []).filter(
    (member) => member.community_access_type === "community" || isCommunityRole(member.role),
  );

  sendJson(res, 200, {
    requests: (requestsResult.data || []).map(serializeCommunityRequest),
    members: members.map(serializeCommunityMember),
  });
}

async function handleCommunityUpdateRequest(body, res) {
  const requestId = cleanText(body.requestId || body.request_id);
  const nextStatus = normalizeCommunityRequestStatus(body.status);
  const leaderCheck = await requireLeaderById(res._portalReq);

  if (leaderCheck.error) {
    sendJson(res, leaderCheck.status, { error: leaderCheck.error });
    return;
  }

  if (!requestId) {
    sendJson(res, 400, { error: "Demande manquante." });
    return;
  }

  const updatePayload = {
    status: nextStatus,
    handled_at: nextStatus === "pending" ? null : new Date().toISOString(),
    handled_by_member_id: nextStatus === "pending" ? null : leaderCheck.leader.id,
    handled_by_name: nextStatus === "pending" ? null : getMemberName(leaderCheck.leader),
  };

  const { data, error } = await supabase
    .from(COMMUNITY_REQUESTS_TABLE)
    .update(updatePayload)
    .eq("id", requestId)
    .select(
      "id, created_at, updated_at, discord_contact, preferred_language, guild_name, message, status, handled_at, handled_by_member_id, handled_by_name, created_member_id, metadata",
    )
    .maybeSingle();

  if (error) {
    sendJson(res, 500, { error: error.message || "Mise a jour de la demande impossible." });
    return;
  }

  if (!data) {
    sendJson(res, 404, { error: "Demande introuvable." });
    return;
  }

  await supabase.from("portal_activity_logs").insert({
    actor_member_id: leaderCheck.leader.id,
    actor_name: getMemberName(leaderCheck.leader),
    target_name: data.discord_contact || "",
    action_type: "community_request_update",
    entity_type: COMMUNITY_REQUESTS_TABLE,
    entity_id: data.id,
    summary: `${getMemberName(leaderCheck.leader)} a passe une demande communaute en ${nextStatus}`,
    metadata: { status: nextStatus },
  });

  sendJson(res, 200, { request: serializeCommunityRequest(data) });
}

async function handleCommunityCreateMember(body, res) {
  const requestId = cleanText(body.requestId || body.request_id);
  const watcherName = cleanText(body.watcherName || body.watcher_name || body.name);
  const discordId = cleanText(body.discordId || body.discord_id);
  const role = normalizeCommunityRole(body.role);
  const preferredLanguage = ["fr", "en"].includes(cleanText(body.preferredLanguage || body.preferred_language).toLowerCase())
    ? cleanText(body.preferredLanguage || body.preferred_language).toLowerCase()
    : "fr";
  const leaderCheck = await requireLeaderById(res._portalReq);

  if (leaderCheck.error) {
    sendJson(res, leaderCheck.status, { error: leaderCheck.error });
    return;
  }

  if (!watcherName || !discordId) {
    sendJson(res, 400, { error: "Pseudo et ID Discord obligatoires." });
    return;
  }

  if (watcherName.length > 80 || discordId.length > 120) {
    sendJson(res, 400, { error: "Informations trop longues." });
    return;
  }

  const { data: existingMember, error: existingError } = await supabase
    .from("guild_members")
    .select("id, watcher_name, discord_id, guild_code, role")
    .eq("discord_id", discordId)
    .maybeSingle();

  if (existingError) {
    sendJson(res, 500, { error: existingError.message || "Verification du compte impossible." });
    return;
  }

  if (existingMember) {
    sendJson(res, 409, {
      error: "Un compte existe deja pour cet ID Discord.",
      member: serializeMember(existingMember),
    });
    return;
  }

  const temporaryPassword = generatePassword();
  const { data: member, error: insertError } = await supabase
    .from("guild_members")
    .insert({
      watcher_name: watcherName,
      discord_id: discordId,
      guild_code: null,
      role,
      password: hashPortalPassword(temporaryPassword),
      password_change_required: true,
      assignment: "Communaut\u00e9",
      status: "Actif",
      awakening_status: "En attente",
      defense_1: "\u2014",
      defense_2: "\u2014",
      community_access_type: "community",
      community_status: "active",
      preferred_language: preferredLanguage,
    })
    .select("id, watcher_name, discord_id, guild_code, role, created_at, preferred_language, community_access_type, community_status")
    .maybeSingle();

  if (insertError) {
    sendJson(res, 500, { error: insertError.message || "Creation du membre communaute impossible." });
    return;
  }

  const warnings = await initializeMemberData(member.id, watcherName);

  let updatedRequest = null;
  if (requestId) {
    const { data: requestRow } = await supabase
      .from(COMMUNITY_REQUESTS_TABLE)
      .update({
        status: "accepted",
        handled_at: new Date().toISOString(),
        handled_by_member_id: leaderCheck.leader.id,
        handled_by_name: getMemberName(leaderCheck.leader),
        created_member_id: member.id,
      })
      .eq("id", requestId)
      .select(
        "id, created_at, updated_at, discord_contact, preferred_language, guild_name, message, status, handled_at, handled_by_member_id, handled_by_name, created_member_id, metadata",
      )
      .maybeSingle();

    updatedRequest = requestRow || null;
  }

  await supabase.from("portal_activity_logs").insert({
    actor_member_id: leaderCheck.leader.id,
    actor_name: getMemberName(leaderCheck.leader),
    target_member_id: member.id,
    target_name: watcherName,
    action_type: "community_member_create",
    entity_type: "guild_members",
    entity_id: member.id,
    summary: `${getMemberName(leaderCheck.leader)} a cree le compte communaute de ${watcherName}`,
    metadata: { role, preferredLanguage, requestId: requestId || null },
  });

  sendJson(res, 200, {
    member: serializeCommunityMember(member),
    request: updatedRequest ? serializeCommunityRequest(updatedRequest) : null,
    temporaryPassword,
    warnings,
  });
}

async function handleCommunityUpdateMember(body, res) {
  const memberId = cleanText(body.memberId || body.member_id);
  const watcherName = cleanText(body.watcherName || body.watcher_name || body.name);
  const discordId = cleanText(body.discordId || body.discord_id);
  const role = normalizeCommunityRole(body.role);
  const status = normalizeCommunityStatus(body.status || body.community_status);
  const preferredLanguage = ["fr", "en"].includes(cleanText(body.preferredLanguage || body.preferred_language).toLowerCase())
    ? cleanText(body.preferredLanguage || body.preferred_language).toLowerCase()
    : "fr";
  const leaderCheck = await requireLeaderById(res._portalReq);

  if (leaderCheck.error) {
    sendJson(res, leaderCheck.status, { error: leaderCheck.error });
    return;
  }

  if (!memberId || !watcherName || !discordId) {
    sendJson(res, 400, { error: "Membre, pseudo et ID Discord obligatoires." });
    return;
  }

  const { data: target, error: targetError } = await supabase
    .from("guild_members")
    .select("id, watcher_name, discord_id, guild_code, role, community_access_type")
    .eq("id", memberId)
    .maybeSingle();

  if (targetError) {
    sendJson(res, 500, { error: targetError.message || "Chargement du membre impossible." });
    return;
  }

  if (!target || target.guild_code || (target.community_access_type !== "community" && !isCommunityRole(target.role))) {
    sendJson(res, 404, { error: "Membre communaute introuvable." });
    return;
  }

  const { data: duplicate, error: duplicateError } = await supabase
    .from("guild_members")
    .select("id")
    .eq("discord_id", discordId)
    .neq("id", memberId)
    .maybeSingle();

  if (duplicateError) {
    sendJson(res, 500, { error: duplicateError.message || "Verification ID Discord impossible." });
    return;
  }

  if (duplicate) {
    sendJson(res, 409, { error: "Cet ID Discord est deja utilise par un autre compte." });
    return;
  }

  const { data: member, error: updateError } = await supabase
    .from("guild_members")
    .update({
      watcher_name: watcherName,
      discord_id: discordId,
      role,
      community_access_type: "community",
      community_status: status,
      preferred_language: preferredLanguage,
    })
    .eq("id", memberId)
    .select("id, watcher_name, discord_id, guild_code, role, created_at, preferred_language, community_access_type, community_status")
    .maybeSingle();

  if (updateError) {
    sendJson(res, 500, { error: updateError.message || "Mise a jour du membre impossible." });
    return;
  }

  await supabase.from("portal_activity_logs").insert({
    actor_member_id: leaderCheck.leader.id,
    actor_name: getMemberName(leaderCheck.leader),
    target_member_id: member.id,
    target_name: watcherName,
    action_type: "community_member_update",
    entity_type: "guild_members",
    entity_id: member.id,
    summary: `${getMemberName(leaderCheck.leader)} a modifie ${watcherName}`,
    metadata: { role, status, preferredLanguage },
  });

  sendJson(res, 200, { member: serializeCommunityMember(member) });
}

async function handleCommunityResetMemberPassword(body, res) {
  const memberId = cleanText(body.memberId || body.member_id);
  const leaderCheck = await requireLeaderById(res._portalReq);

  if (leaderCheck.error) {
    sendJson(res, leaderCheck.status, { error: leaderCheck.error });
    return;
  }

  if (!memberId) {
    sendJson(res, 400, { error: "Membre obligatoire." });
    return;
  }

  const { data: target, error: targetError } = await supabase
    .from("guild_members")
    .select("id, watcher_name, discord_id, guild_code, role, created_at, preferred_language, community_access_type, community_status")
    .eq("id", memberId)
    .maybeSingle();

  if (targetError) {
    sendJson(res, 500, { error: targetError.message || "Chargement du membre impossible." });
    return;
  }

  if (!target || target.guild_code || (target.community_access_type !== "community" && !isCommunityRole(target.role))) {
    sendJson(res, 404, { error: "Membre communaute introuvable." });
    return;
  }

  const temporaryPassword = generatePassword();
  try {
    await updatePortalMemberPassword(supabase, target.id, hashPortalPassword(temporaryPassword), {
      passwordChangeRequired: true,
    });
  } catch (error) {
    sendJson(res, 500, { error: error?.message || "Reinitialisation du mot de passe impossible." });
    return;
  }

  await supabase.from("portal_activity_logs").insert({
    actor_member_id: leaderCheck.leader.id,
    actor_name: getMemberName(leaderCheck.leader),
    target_member_id: target.id,
    target_name: getMemberName(target),
    action_type: "community_member_password_reset",
    entity_type: "guild_members",
    entity_id: target.id,
    summary: `${getMemberName(leaderCheck.leader)} a regenere le mot de passe provisoire de ${getMemberName(target)}`,
    metadata: { role: target.role || "", communityStatus: normalizeCommunityStatus(target.community_status) },
  });

  sendJson(res, 200, {
    member: serializeCommunityMember(target),
    temporaryPassword,
  });
}

async function handleMyDefensesLoad(body, res) {
  const sessionCheck = await requirePortalSession(res._portalReq, supabase);
  if (sessionCheck.error) {
    sendJson(res, sessionCheck.status, { error: sessionCheck.error });
    return;
  }

  const actor = sessionCheck.member;
  if (isCommunityAccount(actor)) {
    sendJson(res, 403, { error: "Compte communaute : acces defenses indisponible." });
    return;
  }

  const [membersResult, defenses, championsResult] = await Promise.all([
    supabase
      .from("guild_members")
      .select(SAFE_MEMBER_SELECT)
      .order("watcher_name", { ascending: true })
      .limit(MAX_MEMBER_ROWS),
    loadVisibleDefenses(actor, { leaderSeesAll: true }),
    supabase.from("champions").select(CHAMPION_SAFE_SELECT),
  ]);

  if (membersResult.error) {
    sendJson(res, 500, { error: membersResult.error.message || "Chargement joueurs impossible." });
    return;
  }

  if (championsResult.error) {
    sendJson(res, 500, { error: championsResult.error.message || "Chargement heros impossible." });
    return;
  }

  const members = (membersResult.data || [])
    .filter((member) => canViewGuildCode(actor, member.guild_code, { leaderSeesAll: true }))
    .filter((member) => !isCommunityAccount(member))
    .map(serializeManagedMember);
  const defenseVotes = await loadDefenseVotes(defenses);

  sendJson(res, 200, {
    members,
    defenses,
    defenseVotes,
    champions: championsResult.data || [],
  });
}

async function handleMemberAwakeningsLoad(body, res) {
  const memberId = cleanText(body.memberId || body.member_id);
  const sessionCheck = await requirePortalSession(res._portalReq, supabase);
  if (sessionCheck.error) {
    sendJson(res, sessionCheck.status, { error: sessionCheck.error });
    return;
  }

  if (!memberId) {
    sendJson(res, 400, { error: "Joueur manquant." });
    return;
  }

  const actor = sessionCheck.member;
  if (isCommunityAccount(actor)) {
    sendJson(res, 403, { error: "Compte communaute : acces premium indisponible." });
    return;
  }

  const target = await loadSafeMemberById(memberId);
  if (!target || !canViewGuildCode(actor, target.guild_code, { leaderSeesAll: true })) {
    sendJson(res, 404, { error: "Joueur introuvable dans ton perimetre." });
    return;
  }

  const { data, error } = await supabase
    .from("member_awakenings")
    .select(`
      awakening_level,
      champion_id,
      champions (
        name
      )
    `)
    .eq("member_id", target.id);

  if (error) {
    sendJson(res, 500, { error: error.message || "Chargement eveils impossible." });
    return;
  }

  const awakenings = {};
  (data || []).forEach((entry) => {
    const heroName = entry?.champions?.name;
    if (heroName) awakenings[heroName] = entry.awakening_level;
  });

  sendJson(res, 200, { memberId: target.id, awakenings });
}

async function handleMemberDefenseAssign(body, res) {
  const memberId = cleanText(body.memberId || body.member_id);
  const slot = Number(body.slot);
  const defenseName = cleanText(body.defenseName || body.defense_name || body.name) || EMPTY_DEFENSE_SLOT;
  const sessionCheck = await requirePortalSession(res._portalReq, supabase);

  if (sessionCheck.error) {
    sendJson(res, sessionCheck.status, { error: sessionCheck.error });
    return;
  }

  if (!memberId || ![1, 2].includes(slot)) {
    sendJson(res, 400, { error: "Joueur ou slot manquant." });
    return;
  }

  const actor = sessionCheck.member;
  if (isCommunityAccount(actor)) {
    sendJson(res, 403, { error: "Compte communaute : action non autorisee." });
    return;
  }

  const target = await loadSafeMemberById(memberId, SAFE_MEMBER_SELECT_WITH_AWAKENINGS);
  if (!target) {
    sendJson(res, 404, { error: "Joueur introuvable." });
    return;
  }

  const selfEdit = String(actor.id) === String(target.id);
  const adminEdit = isAdminRole(actor.role) && canAdminManageTarget(actor, target);
  if (!selfEdit && !adminEdit) {
    sendJson(res, 403, { error: "Tu ne peux pas modifier ce joueur." });
    return;
  }

  if (defenseName !== EMPTY_DEFENSE_SLOT) {
    const defenses = await loadVisibleDefenses(target, { guildCode: target.guild_code });
    const defenseAllowed = defenses.some((defense) => String(defense.name) === defenseName);
    if (!defenseAllowed) {
      sendJson(res, 403, { error: "Defense hors perimetre du joueur." });
      return;
    }
  }

  const column = slot === 1 ? "defense_1" : "defense_2";
  const { data: updated, error } = await supabase
    .from("guild_members")
    .update({ [column]: defenseName })
    .eq("id", target.id)
    .select(SAFE_MEMBER_SELECT_WITH_AWAKENINGS)
    .maybeSingle();

  if (error) {
    sendJson(res, 500, { error: error.message || "Affectation defense impossible." });
    return;
  }

  const actorName = getMemberName(actor);
  const targetName = getMemberName(updated || target);
  await supabase.from("portal_activity_logs").insert({
    actor_member_id: actor.id,
    actor_name: actorName,
    target_member_id: target.id,
    target_name: targetName,
    action_type: defenseName === EMPTY_DEFENSE_SLOT ? "defense_unassign" : "defense_assign",
    entity_type: "defense",
    entity_id: defenseName === EMPTY_DEFENSE_SLOT ? null : defenseName,
    summary:
      defenseName === EMPTY_DEFENSE_SLOT
        ? `${targetName} : defense ${slot} retiree`
        : `${targetName} : defense ${slot} affectee a ${defenseName}`,
    metadata: { slot, defenseName, guildCode: target.guild_code || "" },
  });

  sendJson(res, 200, { member: serializeManagedMember(updated || target) });
}

async function handleDefenseVote(body, res) {
  const defenseId = cleanText(body.defenseId || body.defense_id);
  const value = Number(body.value);
  const sessionCheck = await requirePortalSession(res._portalReq, supabase);

  if (sessionCheck.error) {
    sendJson(res, sessionCheck.status, { error: sessionCheck.error });
    return;
  }

  if (!defenseId || ![-1, 1].includes(value)) {
    sendJson(res, 400, { error: "Vote invalide." });
    return;
  }

  const actor = sessionCheck.member;
  if (isCommunityAccount(actor)) {
    sendJson(res, 403, { error: "Compte communaute : action non autorisee." });
    return;
  }

  const { data: defense, error: defenseError } = await supabase
    .from("guild_defenses")
    .select("id, guild_code, is_global, source_defense_id")
    .eq("id", defenseId)
    .maybeSingle();

  if (defenseError) {
    sendJson(res, 500, { error: defenseError.message || "Chargement defense impossible." });
    return;
  }

  if (!defense || !canViewDefense(actor, defense, { leaderSeesAll: true })) {
    sendJson(res, 404, { error: "Defense introuvable dans ton perimetre." });
    return;
  }

  const targetDefenseId = defense.source_defense_id || defense.id;
  const { data: existingVote, error: existingError } = await supabase
    .from("cluster_defense_likes")
    .select("id, value")
    .eq("defense_id", targetDefenseId)
    .eq("member_id", actor.id)
    .maybeSingle();

  if (existingError) {
    sendJson(res, 500, { error: existingError.message || "Verification vote impossible." });
    return;
  }

  if (existingVote?.id && existingVote.value === value) {
    const { error } = await supabase.from("cluster_defense_likes").delete().eq("id", existingVote.id);
    if (error) {
      sendJson(res, 500, { error: error.message || "Suppression vote impossible." });
      return;
    }
  } else if (existingVote?.id) {
    const { error } = await supabase
      .from("cluster_defense_likes")
      .update({ value })
      .eq("id", existingVote.id);
    if (error) {
      sendJson(res, 500, { error: error.message || "Mise a jour vote impossible." });
      return;
    }
  } else {
    const { error } = await supabase.from("cluster_defense_likes").insert({
      defense_id: targetDefenseId,
      member_id: actor.id,
      value,
    });
    if (error) {
      sendJson(res, 500, { error: error.message || "Ajout vote impossible." });
      return;
    }
  }

  const defenses = await loadVisibleDefenses(actor, { leaderSeesAll: true });
  const defenseVotes = await loadDefenseVotes(defenses);
  sendJson(res, 200, { defenseVotes });
}

function normalizeHeroSearchRequirements(requirements) {
  const byChampionId = new Map();

  (Array.isArray(requirements) ? requirements : []).forEach((requirement) => {
    const championId = cleanText(requirement?.championId || requirement?.champion_id);
    if (!championId) return;

    const rawAwakening = Number(requirement?.minAwakening ?? requirement?.min_awakening ?? 0);
    const minAwakening = Number.isFinite(rawAwakening)
      ? Math.max(0, Math.min(5, Math.trunc(rawAwakening)))
      : 0;
    const existing = byChampionId.get(championId);
    if (!existing || minAwakening > existing.minAwakening) {
      byChampionId.set(championId, { championId, minAwakening });
    }
  });

  return [...byChampionId.values()].slice(0, HERO_SEARCH_MAX_REQUIREMENTS);
}

async function loadHeroSearchMembers(actor, { scope, guildCode }) {
  const rows = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("guild_members")
      .select(HERO_SEARCH_MEMBER_SELECT)
      .order("guild_code", { ascending: true })
      .order("watcher_name", { ascending: true })
      .range(from, from + HERO_SEARCH_PAGE_SIZE - 1);

    if (error) {
      throw new Error(error.message || "Chargement joueurs impossible.");
    }

    rows.push(...(data || []));
    if (!data || data.length < HERO_SEARCH_PAGE_SIZE) break;
    from += HERO_SEARCH_PAGE_SIZE;
  }

  return rows
    .filter((member) => canViewGuildCode(actor, member.guild_code, { leaderSeesAll: true }))
    .filter((member) => !isCommunityAccount(member))
    .filter((member) => {
      if (scope !== "guild") return true;
      return normalizeGuildCode(member.guild_code) === guildCode;
    });
}

async function loadHeroSearchAwakenings(championIds) {
  if (!championIds.length) return [];

  const rows = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("member_awakenings")
      .select("member_id, champion_id, awakening_level")
      .in("champion_id", championIds)
      .order("champion_id", { ascending: true })
      .order("member_id", { ascending: true })
      .range(from, from + HERO_SEARCH_PAGE_SIZE - 1);

    if (error) {
      throw new Error(error.message || "Chargement eveils impossible.");
    }

    rows.push(...(data || []));
    if (!data || data.length < HERO_SEARCH_PAGE_SIZE) break;
    from += HERO_SEARCH_PAGE_SIZE;
  }

  return rows;
}

async function handleHeroAvailabilitySearch(body, res) {
  const adminCheck = await requireAdminById(res._portalReq);
  if (adminCheck.error) {
    sendJson(res, adminCheck.status, { error: adminCheck.error });
    return;
  }

  const actor = adminCheck.admin;
  const scope = normalizeText(body.scope) === "all" ? "all" : "guild";
  const guildCode = normalizeGuildCode(body.guildCode || body.guild_code || actor.guild_code);
  const requirements = normalizeHeroSearchRequirements(body.requirements);

  if (!requirements.length) {
    sendJson(res, 400, { error: "Selectionne au moins un heros." });
    return;
  }

  if (scope === "guild" && (!guildCode || !canViewGuildCode(actor, guildCode, { leaderSeesAll: true }))) {
    sendJson(res, 403, { error: "Guilde hors perimetre." });
    return;
  }

  const championIds = requirements.map((requirement) => requirement.championId);
  const { data: champions, error: championsError } = await supabase
    .from("champions")
    .select(CHAMPION_SAFE_SELECT)
    .in("id", championIds);

  if (championsError) {
    sendJson(res, 500, { error: championsError.message || "Chargement heros impossible." });
    return;
  }

  const championById = new Map((champions || []).map((champion) => [String(champion.id), champion]));
  const missingChampion = requirements.find((requirement) => !championById.has(String(requirement.championId)));
  if (missingChampion) {
    sendJson(res, 400, { error: "Un heros selectionne est introuvable dans Portal." });
    return;
  }

  let searchMembers = [];
  let awakeningRows = [];
  try {
    searchMembers = await loadHeroSearchMembers(actor, { scope, guildCode });
    awakeningRows = await loadHeroSearchAwakenings(championIds);
  } catch (error) {
    sendJson(res, 500, { error: error?.message || "Recherche impossible." });
    return;
  }

  const visibleMemberIds = new Set(searchMembers.map((member) => String(member.id)));
  const awakeningByMemberAndChampion = new Map();

  awakeningRows.forEach((entry) => {
    const memberId = String(entry?.member_id || "");
    const championId = String(entry?.champion_id || "");
    if (!visibleMemberIds.has(memberId) || !championId) return;

    const level = Number(entry?.awakening_level ?? -1);
    const safeLevel = Number.isFinite(level) ? level : -1;
    const key = `${memberId}:${championId}`;
    awakeningByMemberAndChampion.set(key, Math.max(awakeningByMemberAndChampion.get(key) ?? -1, safeLevel));
  });

  const mappedRequirements = requirements.map((requirement) => {
    const champion = championById.get(String(requirement.championId));
    return {
      championId: requirement.championId,
      heroName: champion?.portal_name || champion?.name || "Hero",
      technicalName: champion?.name || "",
      minAwakening: requirement.minAwakening,
    };
  });

  const results = searchMembers
    .map((member) => {
      const matches = mappedRequirements.map((requirement) => {
        const key = `${member.id}:${requirement.championId}`;
        return {
          ...requirement,
          awakening: awakeningByMemberAndChampion.get(key) ?? -1,
        };
      });

      const hasAllHeroes = matches.every((match) => Number(match.awakening) >= Number(match.minAwakening));
      if (!hasAllHeroes) return null;

      return {
        memberId: member.id,
        name: getMemberName(member),
        guildCode: member.guild_code || "",
        matches,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const guildCompare = String(left.guildCode || "").localeCompare(String(right.guildCode || ""), "fr", {
        sensitivity: "base",
      });
      if (scope === "all" && guildCompare !== 0) return guildCompare;
      return String(left.name || "").localeCompare(String(right.name || ""), "fr", { sensitivity: "base" });
    });

  sendJson(res, 200, {
    ok: true,
    scope,
    guildCode,
    requirements: mappedRequirements,
    results,
  });
}

async function handleGuildManagementLoad(body, res) {
  const activeGuildCode = normalizeGuildCode(body.guildCode || body.guild_code);
  const adminCheck = await requireAdminById(res._portalReq);

  if (adminCheck.error) {
    sendJson(res, adminCheck.status, { error: adminCheck.error });
    return;
  }

  if (!activeGuildCode || !canViewGuildCode(adminCheck.admin, activeGuildCode, { leaderSeesAll: true })) {
    sendJson(res, 403, { error: "Guilde hors perimetre." });
    return;
  }

  const [membersResult, defenses, championsResult] = await Promise.all([
    supabase
      .from("guild_members")
      .select(SAFE_MEMBER_SELECT_WITH_AWAKENINGS)
      .order("watcher_name", { ascending: true })
      .limit(MAX_MEMBER_ROWS),
    loadVisibleDefenses(adminCheck.admin, { guildCode: activeGuildCode, leaderSeesAll: true }),
    supabase.from("champions").select(CHAMPION_SAFE_SELECT),
  ]);

  if (membersResult.error) {
    sendJson(res, 500, { error: membersResult.error.message || "Chargement joueurs impossible." });
    return;
  }

  if (championsResult.error) {
    sendJson(res, 500, { error: championsResult.error.message || "Chargement heros impossible." });
    return;
  }

  const members = (membersResult.data || [])
    .filter((member) => canViewGuildCode(adminCheck.admin, member.guild_code, { leaderSeesAll: true }))
    .filter((member) => !isCommunityAccount(member))
    .map(serializeManagedMember);
  const defenseVotes = await loadDefenseVotes(defenses);

  sendJson(res, 200, { members, defenses, defenseVotes, champions: championsResult.data || [] });
}

async function handleGuildMemberUpdate(body, res) {
  const memberId = cleanText(body.memberId || body.member_id);
  const patch = normalizeMemberPatch(body.patch || body);
  const adminCheck = await requireAdminById(res._portalReq);

  if (adminCheck.error) {
    sendJson(res, adminCheck.status, { error: adminCheck.error });
    return;
  }

  if (!memberId || Object.keys(patch).length === 0) {
    sendJson(res, 400, { error: "Membre ou modification manquante." });
    return;
  }

  const target = await loadSafeMemberById(memberId, SAFE_MEMBER_SELECT_WITH_AWAKENINGS);
  if (!target) {
    sendJson(res, 404, { error: "Joueur introuvable." });
    return;
  }

  if (!canAdminManageTarget(adminCheck.admin, target)) {
    sendJson(res, 403, { error: "Ce joueur n'est pas dans ton perimetre." });
    return;
  }

  if (patch.role && !isLeaderRole(adminCheck.admin.role)) {
    sendJson(res, 403, { error: "Seul le leader peut modifier les roles." });
    return;
  }

  if (patch.guild_code && !canViewGuildCode(adminCheck.admin, patch.guild_code, { leaderSeesAll: true })) {
    sendJson(res, 403, { error: "Guilde cible hors perimetre." });
    return;
  }

  if (patch.defense_1 && patch.defense_1 !== EMPTY_DEFENSE_SLOT) {
    const defenses = await loadVisibleDefenses(target, { guildCode: target.guild_code });
    if (!defenses.some((defense) => String(defense.name) === String(patch.defense_1))) {
      sendJson(res, 403, { error: "Defense 1 hors perimetre du joueur." });
      return;
    }
  }

  if (patch.defense_2 && patch.defense_2 !== EMPTY_DEFENSE_SLOT) {
    const defenses = await loadVisibleDefenses(target, { guildCode: target.guild_code });
    if (!defenses.some((defense) => String(defense.name) === String(patch.defense_2))) {
      sendJson(res, 403, { error: "Defense 2 hors perimetre du joueur." });
      return;
    }
  }

  const { data: updated, error } = await supabase
    .from("guild_members")
    .update(patch)
    .eq("id", target.id)
    .select(SAFE_MEMBER_SELECT_WITH_AWAKENINGS)
    .maybeSingle();

  if (error) {
    sendJson(res, 500, { error: error.message || "Mise a jour membre impossible." });
    return;
  }

  await supabase.from("portal_activity_logs").insert({
    actor_member_id: adminCheck.admin.id,
    actor_name: getMemberName(adminCheck.admin),
    target_member_id: target.id,
    target_name: getMemberName(updated || target),
    action_type: "guild_member_update",
    entity_type: "guild_members",
    entity_id: target.id,
    summary: `${getMemberName(adminCheck.admin)} a modifie ${getMemberName(updated || target)}`,
    metadata: { fields: Object.keys(patch), guildCode: updated?.guild_code || target.guild_code || "" },
  });

  sendJson(res, 200, { member: serializeManagedMember(updated || target) });
}

function normalizeMemberEditPatch(patch) {
  const payload = {};
  const allowed = {
    watcher_name: "watcher_name",
    watcherName: "watcher_name",
    name: "watcher_name",
    guild_code: "guild_code",
    guildCode: "guild_code",
    role: "role",
    roster_status: "roster_status",
    rosterStatus: "roster_status",
    discord_id: "discord_id",
    discordId: "discord_id",
    personal_forum_post_url: "personal_forum_post_url",
    personalForumPostUrl: "personal_forum_post_url",
  };

  Object.entries(patch || {}).forEach(([key, value]) => {
    const dbKey = allowed[key];
    if (!dbKey) return;
    payload[dbKey] = typeof value === "string" ? cleanText(value) : value;
  });

  if (payload.guild_code !== undefined) {
    payload.guild_code = payload.guild_code ? normalizeGuildCode(payload.guild_code) : null;
  }

  if (payload.roster_status !== undefined) {
    const rosterStatus = normalizeText(payload.roster_status);
    if (!ROSTER_STATUSES.has(rosterStatus)) {
      const error = new Error("Statut roster invalide.");
      error.statusCode = 400;
      throw error;
    }
    payload.roster_status = rosterStatus;
  }

  return payload;
}

async function handleMemberEditSearch(body, res) {
  const query = cleanLinkedAccountText(body.query || body.search || body.term).slice(0, 80);
  const adminCheck = await requireAdminById(res._portalReq);

  if (adminCheck.error) {
    sendJson(res, adminCheck.status, { error: adminCheck.error });
    return;
  }

  if (query.length < 2) {
    sendJson(res, 200, { results: [] });
    return;
  }

  const { data, error } = await supabase
    .from("guild_members")
    .select(EDIT_MEMBER_SELECT)
    .ilike("watcher_name", `%${query}%`)
    .order("watcher_name", { ascending: true })
    .limit(80);

  if (error) {
    if (isMissingColumn(error, "primary_member_id")) {
      sendJson(res, 428, { error: "Migration comptes secondaires non executee : colonne primary_member_id manquante." });
      return;
    }
    sendJson(res, 500, { error: error.message || "Recherche membre impossible." });
    return;
  }

  const results = (data || [])
    .filter((member) => canAdminManageTarget(adminCheck.admin, member))
    .slice(0, MAX_SUGGESTIONS)
    .map(serializeEditableMemberSuggestion);

  sendJson(res, 200, { results });
}

async function handleMemberEditLoad(body, res) {
  const memberId = cleanText(body.memberId || body.member_id);
  const adminCheck = await requireAdminById(res._portalReq);

  if (adminCheck.error) {
    sendJson(res, adminCheck.status, { error: adminCheck.error });
    return;
  }

  if (!memberId) {
    sendJson(res, 400, { error: "Membre manquant." });
    return;
  }

  try {
    const profile = await loadEditableMemberProfile(memberId, adminCheck.admin);
    if (!profile) {
      sendJson(res, 404, { error: "Joueur introuvable." });
      return;
    }
    sendJson(res, 200, { profile });
  } catch (error) {
    sendJson(res, error?.statusCode || 500, { error: error?.message || "Chargement fiche joueur impossible." });
  }
}

async function handleMemberEditUpdate(body, res) {
  const memberId = cleanText(body.memberId || body.member_id);
  const adminCheck = await requireAdminById(res._portalReq);

  if (adminCheck.error) {
    sendJson(res, adminCheck.status, { error: adminCheck.error });
    return;
  }

  if (!memberId) {
    sendJson(res, 400, { error: "Membre manquant." });
    return;
  }

  let patch;
  try {
    patch = normalizeMemberEditPatch(body.patch || {});
  } catch (error) {
    sendJson(res, error?.statusCode || 400, { error: error?.message || "Modification invalide." });
    return;
  }

  if (Object.keys(patch).length === 0) {
    sendJson(res, 400, { error: "Aucune modification fournie." });
    return;
  }

  try {
    const target = await loadEditableMemberById(memberId);
    if (!target) {
      sendJson(res, 404, { error: "Joueur introuvable." });
      return;
    }

    if (!canAdminManageTarget(adminCheck.admin, target)) {
      sendJson(res, 403, { error: "Ce joueur n'est pas dans ton perimetre." });
      return;
    }

    if (patch.role && !isLeaderRole(adminCheck.admin.role)) {
      sendJson(res, 403, { error: "Seul le leader peut modifier les roles." });
      return;
    }

    if (patch.guild_code && !canViewGuildCode(adminCheck.admin, patch.guild_code, { leaderSeesAll: true })) {
      sendJson(res, 403, { error: "Guilde cible hors perimetre." });
      return;
    }

    let primary = null;
    if (getPrimaryMemberId(target)) {
      const rows = await loadEditableMembersByIds([getPrimaryMemberId(target)]);
      primary = rows[0] || null;
      if (!primary) {
        sendJson(res, 409, { error: "Compte principal introuvable pour ce secondaire." });
        return;
      }

      const inheritedDiscordId = cleanText(primary.discord_id);
      if (
        patch.discord_id !== undefined &&
        cleanText(patch.discord_id) !== inheritedDiscordId
      ) {
        sendJson(res, 400, {
          error: "Le Discord ID d'un compte secondaire est herite du compte principal.",
        });
        return;
      }
      patch.discord_id = inheritedDiscordId || null;
    }

    if (!getPrimaryMemberId(target) && patch.discord_id !== undefined && !isLeaderRole(adminCheck.admin.role)) {
      const { data: secondaries, error: secondariesError } = await supabase
        .from("guild_members")
        .select(EDIT_MEMBER_SELECT)
        .eq("primary_member_id", target.id);

      if (secondariesError) {
        sendJson(res, 500, { error: secondariesError.message || "Verification comptes secondaires impossible." });
        return;
      }

      const outOfScopeSecondary = (secondaries || []).find(
        (secondary) => !canAdminManageTarget(adminCheck.admin, secondary),
      );
      if (outOfScopeSecondary) {
        sendJson(res, 403, {
          error: "Ce Discord ID est partage avec un compte secondaire hors de ton perimetre.",
        });
        return;
      }
    }

    const { data: updated, error } = await supabase
      .from("guild_members")
      .update(patch)
      .eq("id", target.id)
      .select(EDIT_MEMBER_SELECT)
      .maybeSingle();

    if (error) {
      sendJson(res, 500, { error: error.message || "Mise a jour fiche joueur impossible." });
      return;
    }

    if (!updated) {
      sendJson(res, 404, { error: "Joueur introuvable." });
      return;
    }

    if (!getPrimaryMemberId(updated) && patch.discord_id !== undefined) {
      const { error: syncError } = await supabase
        .from("guild_members")
        .update({ discord_id: cleanText(updated.discord_id) || null })
        .eq("primary_member_id", updated.id);

      if (syncError) {
        sendJson(res, 500, { error: syncError.message || "Synchronisation Discord des comptes secondaires impossible." });
        return;
      }
    }

    await supabase.from("portal_activity_logs").insert({
      actor_member_id: adminCheck.admin.id,
      actor_name: getMemberName(adminCheck.admin),
      target_member_id: updated.id,
      target_name: getMemberName(updated),
      action_type: "guild_member_edit_profile",
      entity_type: "guild_members",
      entity_id: updated.id,
      summary: `${getMemberName(adminCheck.admin)} a modifie la fiche de ${getMemberName(updated)}`,
      metadata: { fields: Object.keys(patch), guildCode: updated.guild_code || "" },
    });

    const profile = await loadEditableMemberProfile(updated.id, adminCheck.admin);
    sendJson(res, 200, { profile });
  } catch (error) {
    sendJson(res, error?.statusCode || 500, { error: error?.message || "Mise a jour fiche joueur impossible." });
  }
}

async function countSecondaryChildren(memberId) {
  const { count, error } = await supabase
    .from("guild_members")
    .select("id", { count: "exact", head: true })
    .eq("primary_member_id", memberId);

  if (error) {
    if (isMissingColumn(error, "primary_member_id")) {
      const missing = new Error("Migration comptes secondaires non executee : colonne primary_member_id manquante.");
      missing.statusCode = 428;
      throw missing;
    }
    throw new Error(error.message || "Verification des comptes secondaires impossible.");
  }

  return count || 0;
}

async function handleMemberLinkSecondary(body, res) {
  const primaryMemberId = cleanText(body.primaryMemberId || body.primary_member_id);
  const secondaryMemberId = cleanText(body.secondaryMemberId || body.secondary_member_id);
  const adminCheck = await requireAdminById(res._portalReq);

  if (adminCheck.error) {
    sendJson(res, adminCheck.status, { error: adminCheck.error });
    return;
  }

  if (!primaryMemberId || !secondaryMemberId) {
    sendJson(res, 400, { error: "Compte principal ou secondaire manquant." });
    return;
  }

  try {
    const [primary, secondary] = await Promise.all([
      loadEditableMemberById(primaryMemberId),
      loadEditableMemberById(secondaryMemberId),
    ]);

    if (!primary || !secondary) {
      sendJson(res, 404, { error: "Compte introuvable." });
      return;
    }

    if (!canAdminManageTarget(adminCheck.admin, primary) || !canAdminManageTarget(adminCheck.admin, secondary)) {
      sendJson(res, 403, { error: "Tu dois avoir le droit de gerer les deux comptes pour les lier." });
      return;
    }

    const secondaryChildrenCount = await countSecondaryChildren(secondary.id);
    const validation = validateSecondaryLink({ primary, secondary, secondaryChildrenCount });
    if (!validation.ok) {
      sendJson(res, 400, { error: validation.errors[0] || "Lien de comptes invalide." });
      return;
    }

    const { error } = await supabase
      .from("guild_members")
      .update({
        primary_member_id: primary.id,
        discord_id: cleanText(primary.discord_id) || null,
      })
      .eq("id", secondary.id);

    if (error) {
      sendJson(res, 500, { error: error.message || "Lien compte secondaire impossible." });
      return;
    }

    await supabase.from("portal_activity_logs").insert({
      actor_member_id: adminCheck.admin.id,
      actor_name: getMemberName(adminCheck.admin),
      target_member_id: secondary.id,
      target_name: getMemberName(secondary),
      action_type: "guild_member_link_secondary",
      entity_type: "guild_members",
      entity_id: secondary.id,
      summary: `${getMemberName(secondary)} lie comme compte secondaire de ${getMemberName(primary)}`,
      metadata: { primaryMemberId: primary.id, secondaryMemberId: secondary.id },
    });

    const profile = await loadEditableMemberProfile(primary.id, adminCheck.admin);
    sendJson(res, 200, { profile });
  } catch (error) {
    sendJson(res, error?.statusCode || 500, { error: error?.message || "Lien compte secondaire impossible." });
  }
}

async function handleMemberUnlinkSecondary(body, res) {
  const memberId = cleanText(body.memberId || body.member_id);
  const adminCheck = await requireAdminById(res._portalReq);

  if (adminCheck.error) {
    sendJson(res, adminCheck.status, { error: adminCheck.error });
    return;
  }

  if (!memberId) {
    sendJson(res, 400, { error: "Compte secondaire manquant." });
    return;
  }

  try {
    const member = await loadEditableMemberById(memberId);
    if (!member) {
      sendJson(res, 404, { error: "Compte introuvable." });
      return;
    }

    if (!canAdminManageTarget(adminCheck.admin, member)) {
      sendJson(res, 403, { error: "Ce joueur n'est pas dans ton perimetre." });
      return;
    }

    const previousPrimaryId = getPrimaryMemberId(member);
    if (!previousPrimaryId) {
      sendJson(res, 400, { error: "Ce compte est deja autonome." });
      return;
    }

    const { data: updated, error } = await supabase
      .from("guild_members")
      .update({ primary_member_id: null })
      .eq("id", member.id)
      .select(EDIT_MEMBER_SELECT)
      .maybeSingle();

    if (error) {
      sendJson(res, 500, { error: error.message || "Deliaison impossible." });
      return;
    }

    await supabase.from("portal_activity_logs").insert({
      actor_member_id: adminCheck.admin.id,
      actor_name: getMemberName(adminCheck.admin),
      target_member_id: member.id,
      target_name: getMemberName(updated || member),
      action_type: "guild_member_unlink_secondary",
      entity_type: "guild_members",
      entity_id: member.id,
      summary: `${getMemberName(member)} redevient un compte autonome`,
      metadata: { previousPrimaryMemberId: previousPrimaryId },
    });

    const profile = await loadEditableMemberProfile(updated?.id || member.id, adminCheck.admin);
    sendJson(res, 200, { profile });
  } catch (error) {
    sendJson(res, error?.statusCode || 500, { error: error?.message || "Deliaison impossible." });
  }
}

async function handleGuildMemberDelete(body, res) {
  const memberId = cleanText(body.memberId || body.member_id);
  const adminCheck = await requireAdminById(res._portalReq);

  if (adminCheck.error) {
    sendJson(res, adminCheck.status, { error: adminCheck.error });
    return;
  }

  if (!memberId) {
    sendJson(res, 400, { error: "Membre manquant." });
    return;
  }

  const target = await loadSafeMemberById(memberId);
  if (!target) {
    sendJson(res, 404, { error: "Joueur introuvable." });
    return;
  }

  if (!canAdminManageTarget(adminCheck.admin, target)) {
    sendJson(res, 403, { error: "Ce joueur n'est pas dans ton perimetre." });
    return;
  }

  const { data: linkedSecondaries, error: linkedSecondariesError } = await supabase
    .from("guild_members")
    .select("id, watcher_name")
    .eq("primary_member_id", target.id)
    .limit(1);

  if (linkedSecondariesError && !isMissingColumn(linkedSecondariesError, "primary_member_id")) {
    sendJson(res, 500, { error: linkedSecondariesError.message || "Verification comptes secondaires impossible." });
    return;
  }

  if ((linkedSecondaries || []).length > 0) {
    sendJson(res, 409, {
      error: "Impossible de supprimer ce compte principal : delie d'abord ses comptes secondaires.",
    });
    return;
  }

  const { data: intersaisonAssignments, error: intersaisonAssignmentsError } = await supabase
    .from("intersaison_assignments")
    .select("id, campaign_id")
    .eq("member_id", target.id);

  if (intersaisonAssignmentsError && !isMissingOptionalTable(intersaisonAssignmentsError, "intersaison_assignments")) {
    sendJson(res, 500, { error: intersaisonAssignmentsError.message || "Chargement intersaison impossible." });
    return;
  }

  const intersaisonRows = intersaisonAssignmentsError ? [] : intersaisonAssignments || [];
  const intersaisonCampaignIds = [...new Set(intersaisonRows.map((row) => row.campaign_id).filter(Boolean))];

  if (intersaisonCampaignIds.length > 0) {
    const { data: activeCampaigns, error: activeCampaignsError } = await supabase
      .from("intersaison_campaigns")
      .select("id, label, status")
      .in("id", intersaisonCampaignIds)
      .eq("status", "active")
      .limit(1);

    if (activeCampaignsError && !isMissingOptionalTable(activeCampaignsError, "intersaison_campaigns")) {
      sendJson(res, 500, { error: activeCampaignsError.message || "Verification campagne intersaison impossible." });
      return;
    }

    if ((activeCampaigns || []).length > 0) {
      sendJson(res, 409, {
        error: "Impossible de supprimer ce membre : il participe a une campagne Inter-saison active.",
      });
      return;
    }
  }

  const { error: detachAssignmentsError } = await supabase
    .from("intersaison_assignments")
    .update({ member_id: null })
    .eq("member_id", target.id);
  if (detachAssignmentsError && !isMissingOptionalTable(detachAssignmentsError, "intersaison_assignments")) {
    sendJson(res, 500, { error: detachAssignmentsError.message || "Detachement intersaison impossible." });
    return;
  }

  const { error: detachNotesError } = await supabase
    .from("intersaison_notes")
    .update({ created_by_member_id: null })
    .eq("created_by_member_id", target.id);
  if (detachNotesError && !isMissingOptionalTable(detachNotesError, "intersaison_notes")) {
    sendJson(res, 500, { error: detachNotesError.message || "Detachement notes intersaison impossible." });
    return;
  }

  await deleteRowsIfPresent("cluster_defense_likes", "member_id", target.id);
  await deleteRowsIfPresent("member_awakenings", "member_id", target.id);
  await deleteRowsIfPresent("member_pb_entries", "member_id", target.id);
  await deleteRowsIfPresent("member_demonic_monsters", "member_id", target.id);
  await deleteRowsIfPresent("soul_stones", "member_id", target.id);
  await deleteRowsIfPresent("gvg_repro", "member_id", target.id);

  await supabase
    .from("gvg_discord_repro_requests")
    .update({
      reproducer_member_id: null,
      reproducer_discord_id: null,
      reproducer_name: null,
    })
    .eq("reproducer_member_id", target.id);

  await deleteRowsIfPresent("guild_members", "id", target.id);

  await supabase.from("portal_activity_logs").insert({
    actor_member_id: adminCheck.admin.id,
    actor_name: getMemberName(adminCheck.admin),
    target_member_id: null,
    target_name: getMemberName(target),
    action_type: "guild_member_delete",
    entity_type: "guild_members",
    entity_id: target.id,
    summary: `${getMemberName(target)} retire de ${target.guild_code || "sa guilde"}`,
    metadata: { guildCode: target.guild_code || "" },
  });

  sendJson(res, 200, { ok: true, memberId: target.id });
}

async function handleGuildMemberConvertCommunity(body, res) {
  const memberId = cleanText(body.memberId || body.member_id);
  const adminCheck = await requireAdminById(res._portalReq);

  if (adminCheck.error) {
    sendJson(res, adminCheck.status, { error: adminCheck.error });
    return;
  }

  if (!memberId) {
    sendJson(res, 400, { error: "Membre manquant." });
    return;
  }

  const target = await loadSafeMemberById(memberId);
  if (!target) {
    sendJson(res, 404, { error: "Joueur introuvable." });
    return;
  }

  if (!canAdminManageTarget(adminCheck.admin, target)) {
    sendJson(res, 403, { error: "Ce joueur n'est pas dans ton perimetre." });
    return;
  }

  if (isLeaderRole(target.role)) {
    sendJson(res, 403, { error: "Le compte leader ne peut pas etre converti en membre communaute." });
    return;
  }

  if (isAdminRole(target.role) && !isLeaderRole(adminCheck.admin?.role)) {
    sendJson(res, 403, { error: "Seul le leader peut convertir un compte admin en compte communaute." });
    return;
  }

  const previousGuildCode = target.guild_code || "";
  const { data: updated, error } = await supabase
    .from("guild_members")
    .update({
      guild_code: null,
      role: "community_member",
      community_access_type: "community",
      community_status: "active",
      assignment: "Communaut\u00e9",
      status: "Actif",
      defense_1: "\u2014",
      defense_2: "\u2014",
    })
    .eq("id", target.id)
    .select("id, watcher_name, discord_id, guild_code, role, created_at, preferred_language, community_access_type, community_status")
    .maybeSingle();

  if (error) {
    sendJson(res, 500, { error: error.message || "Conversion communaute impossible." });
    return;
  }

  if (!updated) {
    sendJson(res, 404, { error: "Joueur introuvable." });
    return;
  }

  await supabase.from("portal_activity_logs").insert({
    actor_member_id: adminCheck.admin.id,
    actor_name: getMemberName(adminCheck.admin),
    target_member_id: updated.id,
    target_name: getMemberName(updated),
    action_type: "guild_member_convert_community",
    entity_type: "guild_members",
    entity_id: updated.id,
    summary: `${getMemberName(adminCheck.admin)} a passe ${getMemberName(updated)} en compte communaute`,
    metadata: { previousGuildCode, role: updated.role, communityStatus: normalizeCommunityStatus(updated.community_status) },
  });

  sendJson(res, 200, { ok: true, member: serializeCommunityMember(updated) });
}

async function createOrAttachGuildMember({ actor, name, discordId, guildCode, role = "member", forumPostUrl = "" }) {
  const watcherName = cleanText(name);
  const cleanDiscordId = cleanText(discordId);
  const cleanGuildCode = normalizeGuildCode(guildCode);
  const cleanRole = cleanText(role) || "member";
  const cleanForumUrl = cleanText(forumPostUrl);

  if (!watcherName || !cleanDiscordId || !cleanGuildCode) {
    const error = new Error("Nom, ID Discord et guild code obligatoires.");
    error.statusCode = 400;
    throw error;
  }

  if (!canViewGuildCode(actor, cleanGuildCode, { leaderSeesAll: true })) {
    const error = new Error("Guilde hors perimetre.");
    error.statusCode = 403;
    throw error;
  }

  const { data: existingMember, error: existingError } = await supabase
    .from("guild_members")
    .select(SAFE_MEMBER_SELECT)
    .eq("discord_id", cleanDiscordId)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message || "Verification du joueur impossible.");
  }

  if (existingMember?.guild_code && !sameGuildSpace(existingMember.guild_code, cleanGuildCode)) {
    const error = new Error(`Ce joueur existe deja dans ${existingMember.guild_code}.`);
    error.statusCode = 409;
    throw error;
  }

  if (existingMember && !canAdminManageTarget(actor, existingMember) && !isLeaderRole(actor.role)) {
    const error = new Error("Ce joueur n'est pas dans ton perimetre.");
    error.statusCode = 403;
    throw error;
  }

  if (existingMember) {
    const { data, error } = await supabase
      .from("guild_members")
      .update({
        watcher_name: watcherName,
        guild_code: cleanGuildCode,
        role: cleanRole,
        community_access_type: null,
        community_status: null,
        ...(cleanForumUrl ? { personal_forum_post_url: cleanForumUrl } : {}),
      })
      .eq("id", existingMember.id)
      .select(SAFE_MEMBER_SELECT_WITH_AWAKENINGS)
      .maybeSingle();

    if (error) throw new Error(error.message || "Rattachement impossible.");
    return { member: serializeManagedMember(data), warnings: [], attached: true, temporaryPassword: null };
  }

  const { data, error } = await supabase
    .from("guild_members")
    .insert({
      watcher_name: watcherName,
      discord_id: cleanDiscordId,
      guild_code: cleanGuildCode,
      role: cleanRole,
      password: hashPortalPassword(DEFAULT_MEMBER_PASSWORD),
      password_change_required: true,
      assignment: "Tour",
      status: TODO_STATUS,
      awakening_status: "En attente",
      defense_1: EMPTY_DEFENSE_SLOT,
      defense_2: EMPTY_DEFENSE_SLOT,
      personal_forum_post_url: cleanForumUrl || null,
    })
    .select(SAFE_MEMBER_SELECT_WITH_AWAKENINGS)
    .maybeSingle();

  if (error) throw new Error(error.message || "Creation du joueur impossible.");

  const warnings = await initializeMemberData(data.id, data.watcher_name || watcherName);
  return {
    member: serializeManagedMember(data),
    warnings,
    attached: false,
    temporaryPassword: DEFAULT_MEMBER_PASSWORD,
  };
}

async function handleGuildMemberCreate(body, res) {
  const adminCheck = await requireAdminById(res._portalReq);

  if (adminCheck.error) {
    sendJson(res, adminCheck.status, { error: adminCheck.error });
    return;
  }

  try {
    const result = await createOrAttachGuildMember({
      actor: adminCheck.admin,
      name: body.name || body.watcherName || body.watcher_name,
      discordId: body.discordId || body.discord_id,
      guildCode: body.guildCode || body.guild_code || adminCheck.admin.guild_code,
      role: body.role || "member",
      forumPostUrl: body.forumPostUrl || body.personalForumPostUrl || body.personal_forum_post_url,
    });

    await supabase.from("portal_activity_logs").insert({
      actor_member_id: adminCheck.admin.id,
      actor_name: getMemberName(adminCheck.admin),
      target_member_id: result.member.id,
      target_name: result.member.name,
      action_type: result.attached ? "guild_member_attach" : "guild_member_create",
      entity_type: "guild_members",
      entity_id: result.member.id,
      summary: `${result.member.name} ${result.attached ? "rattache" : "ajoute"} a ${result.member.guildCode}`,
      metadata: { guildCode: result.member.guildCode, role: result.member.role },
    });

    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, error?.statusCode || 500, { error: error?.message || "Ajout impossible." });
  }
}

async function handleGuildsList(body, res) {
  const leaderCheck = await requireLeaderById(res._portalReq);

  if (leaderCheck.error) {
    sendJson(res, leaderCheck.status, { error: leaderCheck.error });
    return;
  }

  const { data, error } = await supabase
    .from("guild_members")
    .select(SAFE_MEMBER_SELECT)
    .order("guild_code", { ascending: true })
    .order("watcher_name", { ascending: true })
    .limit(MAX_MEMBER_ROWS);

  if (error) {
    sendJson(res, 500, { error: error.message || "Chargement guildes impossible." });
    return;
  }

  const members = (data || [])
    .filter((member) => !isCommunityAccount(member))
    .map(serializeManagedMember);
  sendJson(res, 200, { members });
}

async function handleGuildsCreateOrAttachMember(body, res) {
  const leaderCheck = await requireLeaderById(res._portalReq);

  if (leaderCheck.error) {
    sendJson(res, leaderCheck.status, { error: leaderCheck.error });
    return;
  }

  try {
    const result = await createOrAttachGuildMember({
      actor: leaderCheck.leader,
      name: body.name || body.watcherName || body.watcher_name,
      discordId: body.discordId || body.discord_id,
      guildCode: body.guildCode || body.guild_code,
      role: body.role || "member",
    });

    await supabase.from("portal_activity_logs").insert({
      actor_member_id: leaderCheck.leader.id,
      actor_name: getMemberName(leaderCheck.leader),
      target_member_id: result.member.id,
      target_name: result.member.name,
      action_type: result.attached ? "guild_member_attach" : "guild_member_create",
      entity_type: "guild_members",
      entity_id: result.member.id,
      summary: `${result.member.name} ${result.attached ? "rattache" : "ajoute"} a ${result.member.guildCode}`,
      metadata: { guildCode: result.member.guildCode, role: result.member.role },
    });

    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, error?.statusCode || 500, { error: error?.message || "Ajout impossible." });
  }
}

async function handleGuildsUpdateMember(body, res) {
  const memberId = cleanText(body.memberId || body.member_id);
  const patch = normalizeMemberPatch(body.patch || body);
  const leaderCheck = await requireLeaderById(res._portalReq);

  if (leaderCheck.error) {
    sendJson(res, leaderCheck.status, { error: leaderCheck.error });
    return;
  }

  if (!memberId || Object.keys(patch).length === 0) {
    sendJson(res, 400, { error: "Membre ou modification manquante." });
    return;
  }

  const allowedKeys = new Set(["role", "guild_code", "watcher_name", "discord_id"]);
  Object.keys(patch).forEach((key) => {
    if (!allowedKeys.has(key)) delete patch[key];
  });

  if (Object.keys(patch).length === 0) {
    sendJson(res, 400, { error: "Modification non autorisee." });
    return;
  }

  const { data, error } = await supabase
    .from("guild_members")
    .update(patch)
    .eq("id", memberId)
    .select(SAFE_MEMBER_SELECT)
    .maybeSingle();

  if (error) {
    sendJson(res, 500, { error: error.message || "Modification membre impossible." });
    return;
  }

  if (!data || isCommunityAccount(data)) {
    sendJson(res, 404, { error: "Membre introuvable." });
    return;
  }

  await supabase.from("portal_activity_logs").insert({
    actor_member_id: leaderCheck.leader.id,
    actor_name: getMemberName(leaderCheck.leader),
    target_member_id: data.id,
    target_name: getMemberName(data),
    action_type: "guilds_member_update",
    entity_type: "guild_members",
    entity_id: data.id,
    summary: `${getMemberName(data)} mis a jour depuis Guildes`,
    metadata: { fields: Object.keys(patch), guildCode: data.guild_code || "" },
  });

  sendJson(res, 200, { member: serializeManagedMember(data) });
}

async function handleUpdateDefenseStatus(body, res) {
  const memberId = cleanText(body.memberId || body.member_id);
  const status = cleanText(body.status);
  const adminCheck = await requireAdminById(res._portalReq);

  if (adminCheck.error) {
    sendJson(res, adminCheck.status, { error: adminCheck.error });
    return;
  }

  if (!memberId) {
    sendJson(res, 400, { error: "Joueur manquant." });
    return;
  }

  if (!DEFENSE_STATUSES.has(status)) {
    sendJson(res, 400, { error: "Statut defense invalide." });
    return;
  }

  const { data: target, error: targetError } = await supabase
    .from("guild_members")
    .select("id, role, discord_id, watcher_name, guild_code, personal_forum_post_url")
    .eq("id", memberId)
    .maybeSingle();

  if (targetError) {
    sendJson(res, 500, { error: targetError.message || "Joueur introuvable." });
    return;
  }

  if (!target) {
    sendJson(res, 404, { error: "Joueur introuvable." });
    return;
  }

  if (!canAdminManageTarget(adminCheck.admin, target)) {
    sendJson(res, 403, { error: "Ce joueur n'est pas dans ton perimetre." });
    return;
  }

  const { error: statusError } = await supabase
    .from("guild_members")
    .update({ status })
    .eq("id", target.id);

  if (statusError) {
    sendJson(res, 500, { error: statusError.message || "Mise a jour statut impossible." });
    return;
  }

  const warnings = [];
  let forumRename = null;
  const forumChannelId = parseDiscordChannelId(target.personal_forum_post_url);
  if (forumChannelId) {
    try {
      forumRename = await renameDiscordChannelStatus(
        forumChannelId,
        getMemberName(target),
        getDiscordStatusEmoji(status)
      );
    } catch (renameError) {
      warnings.push(serializeDiscordWarning(renameError, {
        type: "discord_channel_rename_failed",
        memberId: target.id,
        memberName: getMemberName(target),
      }));
    }
  }

  const adminName = getMemberName(adminCheck.admin);
  const targetName = getMemberName(target);

  await supabase.from("portal_activity_logs").insert({
    actor_member_id: adminCheck.admin.id,
    actor_name: adminName,
    target_member_id: target.id,
    target_name: targetName,
    action_type: "guild_management_status_update",
    entity_type: "guild_members",
    entity_id: target.id,
    summary: `${targetName} : statut defense passe a ${status}`,
    metadata: {
      guildCode: target.guild_code || "",
      status,
      forumRename,
      warnings,
    },
  });

  sendJson(res, 200, {
    ok: true,
    memberId: target.id,
    status,
    forumSkipped: !forumChannelId,
    forumRename,
    warnings,
  });
}

async function handleResetDefenseStatuses(body, res) {
  const memberIds = Array.isArray(body.memberIds || body.member_ids)
    ? [...new Set((body.memberIds || body.member_ids).map(cleanText).filter(Boolean))]
    : [];
  const adminCheck = await requireAdminById(res._portalReq);

  if (adminCheck.error) {
    sendJson(res, adminCheck.status, { error: adminCheck.error });
    return;
  }

  if (memberIds.length === 0) {
    sendJson(res, 400, { error: "Aucun joueur a remettre a faire." });
    return;
  }

  if (memberIds.length > MAX_MEMBER_ROWS) {
    sendJson(res, 400, { error: "Trop de joueurs dans la demande." });
    return;
  }

  const { data: targets, error: targetError } = await supabase
    .from("guild_members")
    .select("id, role, discord_id, watcher_name, guild_code, personal_forum_post_url")
    .in("id", memberIds);

  if (targetError) {
    sendJson(res, 500, { error: targetError.message || "Chargement joueurs impossible." });
    return;
  }

  const manageableTargets = (targets || []).filter((target) =>
    canAdminManageTarget(adminCheck.admin, target)
  );

  if (manageableTargets.length !== memberIds.length) {
    sendJson(res, 403, { error: "Certains joueurs ne sont pas dans ton perimetre." });
    return;
  }

  const manageableIds = manageableTargets.map((target) => target.id);
  const { error: statusError } = await supabase
    .from("guild_members")
    .update({ status: TODO_STATUS })
    .in("id", manageableIds);

  if (statusError) {
    sendJson(res, 500, { error: statusError.message || "Reset des statuts impossible." });
    return;
  }

  const warnings = [];
  const forumRenames = [];
  for (const target of manageableTargets) {
    const forumChannelId = parseDiscordChannelId(target.personal_forum_post_url);
    if (!forumChannelId) continue;

    try {
      const rename = await renameDiscordChannelStatus(
        forumChannelId,
        getMemberName(target),
        getDiscordStatusEmoji(TODO_STATUS)
      );
      forumRenames.push({ memberId: target.id, ...rename });
    } catch (renameError) {
      warnings.push(serializeDiscordWarning(renameError, {
        type: "discord_channel_rename_failed",
        memberId: target.id,
        memberName: getMemberName(target),
      }));
    }
  }

  const adminName = getMemberName(adminCheck.admin);
  const guildCode = cleanText(body.guildCode || body.guild_code);

  await supabase.from("portal_activity_logs").insert({
    actor_member_id: adminCheck.admin.id,
    actor_name: adminName,
    action_type: "guild_management_status_reset",
    entity_type: "guild_members",
    entity_id: guildCode || null,
    summary: `${adminName} a remis les statuts defense en A faire${guildCode ? ` (${guildCode})` : ""}`,
    metadata: {
      guildCode,
      count: manageableTargets.length,
      renamedCount: forumRenames.filter((rename) => rename?.renamed).length,
      warnings,
    },
  });

  sendJson(res, 200, {
    ok: true,
    memberIds: manageableIds,
    status: TODO_STATUS,
    forumRenames,
    warnings,
  });
}

async function handleSendDefenses(body, res) {
  const memberId = cleanText(body.memberId || body.member_id);
  const adminCheck = await requireAdminById(res._portalReq);

  if (adminCheck.error) {
    sendJson(res, adminCheck.status, { error: adminCheck.error });
    return;
  }

  if (!memberId) {
    sendJson(res, 400, { error: "Joueur manquant." });
    return;
  }

  const { data: target, error: targetError } = await supabase
    .from("guild_members")
    .select("id, role, discord_id, watcher_name, guild_code, defense_1, defense_2, personal_forum_post_url")
    .eq("id", memberId)
    .maybeSingle();

  if (targetError) {
    sendJson(res, 500, { error: targetError.message || "Joueur introuvable." });
    return;
  }

  if (!target) {
    sendJson(res, 404, { error: "Joueur introuvable." });
    return;
  }

  if (!canAdminManageTarget(adminCheck.admin, target)) {
    sendJson(res, 403, { error: "Ce joueur n'est pas dans ton perimetre." });
    return;
  }

  if (!target.discord_id) {
    sendJson(res, 400, { error: "ID Discord du joueur manquant." });
    return;
  }

  const defenseNames = [normalizeDefenseName(target.defense_1), normalizeDefenseName(target.defense_2)].filter(Boolean);
  if (defenseNames.length === 0) {
    sendJson(res, 400, { error: "Aucune defense assignee a ce joueur." });
    return;
  }

  const { data: defenseRows, error: defenseError } = await supabase
    .from("guild_defenses")
    .select(`
      id,
      name,
      tier,
      type,
      faction,
      guild_code,
      is_global,
      image_url,
      guild_defense_slots (
        slot_index,
        champions (
          name
        )
      ),
      guild_defense_conditions (
        min_awakening,
        champions (
          name
        )
      ),
      guild_defense_blocks (
        block_type,
        content,
        sort_order
      )
    `)
    .in("name", defenseNames);

  if (defenseError) {
    sendJson(res, 500, { error: defenseError.message || "Chargement defenses impossible." });
    return;
  }

  const defenses = [];
  const missingNames = [];
  const customContent = cleanText(body.customMessage || body.custom_message || body.message);

  defenseNames.forEach((name) => {
    const defense = pickDefenseForGuild(defenseRows || [], name, target.guild_code);
    if (defense) defenses.push(defense);
    else missingNames.push(name);
  });

  const content =
    customContent ||
    buildDefenseMessage({
      target,
      defenses,
      missingNames,
      actor: adminCheck.admin,
    });

  const dmMessageIds = await sendDiscordDm(target.discord_id, content);
  const forumPostUrl = cleanText(body.forumPostUrl || body.forum_post_url || target.personal_forum_post_url);
  const forumChannelId = parseDiscordChannelId(forumPostUrl);
  let forumMessageIds = [];
  const warnings = [];
  let forumRename = null;
  let followupTracking = null;
  let statusUpdated = false;

  if (forumChannelId) {
    forumMessageIds = await sendDiscordMessages(forumChannelId, content);

    try {
      forumRename = await renameDiscordChannelStatus(
        forumChannelId,
        getMemberName(target),
        getDiscordStatusEmoji(VERIFY_STATUS)
      );
    } catch (renameError) {
      warnings.push(serializeDiscordWarning(renameError, {
        type: "discord_channel_rename_failed",
        memberId: target.id,
        memberName: getMemberName(target),
      }));
    }
  }

  const { error: statusError } = await supabase
    .from("guild_members")
    .update({ status: VERIFY_STATUS })
    .eq("id", target.id);

  if (statusError) {
    warnings.push({
      type: "member_status_update_failed",
      message: statusError.message || "status update failed",
    });
  } else {
    statusUpdated = true;
  }

  if (forumChannelId && forumMessageIds.length > 0) {
    const followupUpdatedAt = new Date().toISOString();
    const { error: supersedeError } = await supabase
      .from(DEFENSE_FOLLOWUP_TABLE)
      .update({
        state: "deleted",
        updated_at: followupUpdatedAt,
        last_error: "superseded_by_new_defense_message",
      })
      .eq("member_id", target.id)
      .eq("discord_channel_id", forumChannelId)
      .eq("state", "pending");

    if (supersedeError && !isMissingFollowupTable(supersedeError)) {
      warnings.push({
        type: "followup_supersede_failed",
        message: supersedeError.message || "followup supersede failed",
      });
    }

    const { data: followupRow, error: followupError } = await supabase
      .from(DEFENSE_FOLLOWUP_TABLE)
      .insert({
        guild_code: normalizeGuildCode(target.guild_code),
        member_id: target.id,
        member_name: getMemberName(target),
        member_discord_id: target.discord_id || null,
        admin_member_id: adminCheck.admin.id,
        admin_name: getMemberName(adminCheck.admin),
        discord_channel_id: forumChannelId,
        discord_message_id: forumMessageIds[0] || null,
        discord_message_ids: forumMessageIds.filter(Boolean),
        dm_message_ids: dmMessageIds.filter(Boolean),
        forum_post_url: forumPostUrl || null,
        defense_names: defenseNames,
        message_content: content,
        thread_name_before: forumRename?.before || null,
        thread_name_after: forumRename?.after || null,
        state: "pending",
        updated_at: followupUpdatedAt,
      })
      .select("id")
      .maybeSingle();

    if (followupError) {
      warnings.push({
        type: isMissingFollowupTable(followupError)
          ? "missing_guild_defense_discord_followups_table"
          : "followup_tracking_failed",
        message: followupError.message || "followup tracking failed",
      });
    } else {
      followupTracking = { id: followupRow?.id || null };
    }
  }

  const adminName = getMemberName(adminCheck.admin);
  const targetName = getMemberName(target);

  await supabase.from("portal_activity_logs").insert({
    actor_member_id: adminCheck.admin.id,
    actor_name: adminName,
    target_member_id: target.id,
    target_name: targetName,
    action_type: "guild_management_defenses_sent",
    entity_type: "guild_members",
    entity_id: target.id,
    summary: `${adminName} a envoye les defenses de ${targetName} sur Discord`,
    metadata: {
      guildCode: target.guild_code || "",
      defenseNames,
      dmMessageIds,
      forumMessageIds,
      forumPostUrl: forumPostUrl || "",
      forumRename,
      followupTracking,
      statusUpdated,
      warnings,
    },
  });

  sendJson(res, 200, {
    ok: true,
    dmMessageIds,
    forumMessageIds,
    forumSkipped: !forumChannelId,
    forumRename,
    followupTracking,
    statusUpdated,
    warnings,
  });
}

export default async function handler(req, res) {
  try {
    res._portalReq = req;
    applyPortalCorsHeaders(req, res);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    if (!verifyPortalRequestOrigin(req)) {
      sendJson(res, 403, { error: "Origine de la requete refusee." });
      return;
    }

    const body = await readBody(req);
    const action = cleanText(body.action);

    if (action === "search") {
      await handleSearch(body, res);
      return;
    }

    if (action === "members-list") {
      await handleMembersList(body, res);
      return;
    }

    if (action === "reset") {
      await handleReset(body, res);
      return;
    }

    if (action === "external-account-request") {
      await handleExternalAccountRequest(body, req, res);
      return;
    }

    if (action === "community-list") {
      await handleCommunityList(body, res);
      return;
    }

    if (action === "community-update-request") {
      await handleCommunityUpdateRequest(body, res);
      return;
    }

    if (action === "community-create-member") {
      await handleCommunityCreateMember(body, res);
      return;
    }

    if (action === "community-update-member") {
      await handleCommunityUpdateMember(body, res);
      return;
    }

    if (action === "community-reset-member-password") {
      await handleCommunityResetMemberPassword(body, res);
      return;
    }

    if (action === "my-defenses-load") {
      await handleMyDefensesLoad(body, res);
      return;
    }

    if (action === "member-awakenings-load") {
      await handleMemberAwakeningsLoad(body, res);
      return;
    }

    if (action === "member-defense-assign") {
      await handleMemberDefenseAssign(body, res);
      return;
    }

    if (action === "defense-vote") {
      await handleDefenseVote(body, res);
      return;
    }

    if (action === "guild-management-load") {
      await handleGuildManagementLoad(body, res);
      return;
    }

    if (action === "hero-availability-search") {
      await handleHeroAvailabilitySearch(body, res);
      return;
    }

    if (action === "member-edit-search") {
      await handleMemberEditSearch(body, res);
      return;
    }

    if (action === "member-edit-load") {
      await handleMemberEditLoad(body, res);
      return;
    }

    if (action === "member-edit-update") {
      await handleMemberEditUpdate(body, res);
      return;
    }

    if (action === "member-link-secondary") {
      await handleMemberLinkSecondary(body, res);
      return;
    }

    if (action === "member-unlink-secondary") {
      await handleMemberUnlinkSecondary(body, res);
      return;
    }

    if (action === "guild-member-update") {
      await handleGuildMemberUpdate(body, res);
      return;
    }

    if (action === "guild-member-delete") {
      await handleGuildMemberDelete(body, res);
      return;
    }

    if (action === "guild-member-convert-community") {
      await handleGuildMemberConvertCommunity(body, res);
      return;
    }

    if (action === "guild-member-create") {
      await handleGuildMemberCreate(body, res);
      return;
    }

    if (action === "guilds-list") {
      await handleGuildsList(body, res);
      return;
    }

    if (action === "guilds-create-or-attach-member") {
      await handleGuildsCreateOrAttachMember(body, res);
      return;
    }

    if (action === "guilds-update-member") {
      await handleGuildsUpdateMember(body, res);
      return;
    }

    if (action === "send-defenses") {
      await handleSendDefenses(body, res);
      return;
    }

    if (action === "update-defense-status") {
      await handleUpdateDefenseStatus(body, res);
      return;
    }

    if (action === "reset-defense-statuses") {
      await handleResetDefenseStatuses(body, res);
      return;
    }

    sendJson(res, 400, { error: "Action inconnue." });
  } catch (error) {
    sendJson(res, 500, { error: error?.message || "Erreur acces joueurs." });
  }
}
