import {
  getGuildSpaceKey,
  isPaladinGuildCode,
  normalizeGuildCode,
  normalizeGuildCodeKey,
  PALADIN_CLUSTER_GUILD_CODES,
  PALADIN_SPACE_KEY,
} from "../src/lib/guildScope.js";

function normalizeRoleValue(role) {
  return String(role || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function readSessionField(req, keys) {
  const bodySession = req?.body?.session && typeof req.body.session === "object" ? req.body.session : {};
  const sources = [bodySession, req?.body || {}, req?.query || {}];

  for (const source of sources) {
    for (const key of keys) {
      const value = source?.[key];
      if (value !== undefined && value !== null && String(value).trim()) return value;
    }
  }

  return "";
}

export function isMissingGuildCodeColumn(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return (
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    message.includes("guild_code") ||
    message.includes("defence_strat.guild_code")
  );
}

export async function resolveRunScope(supabase, req) {
  const memberId = readSessionField(req, ["memberId", "member_id"]);
  const discordId = readSessionField(req, ["discordId", "discord_id"]);
  const fallbackGuildCode = readSessionField(req, ["guildCode", "guild_code", "guild"]);
  const fallbackRole = readSessionField(req, ["role"]);

  let member = null;

  if (memberId || discordId) {
    let query = supabase
      .from("guild_members")
      .select("id, role, discord_id, watcher_name, guild_code")
      .limit(1);

    query = memberId ? query.eq("id", memberId) : query.eq("discord_id", discordId);

    const { data, error } = await query.maybeSingle();
    if (!error && data) member = data;
  }

  const guildCode = normalizeGuildCode(member?.guild_code || fallbackGuildCode || "G1");
  const role = member?.role || fallbackRole || "";
  const roleValue = normalizeRoleValue(role);
  const isLeader = roleValue === "leader";
  const spaceKey = getGuildSpaceKey(guildCode);
  const isPaladin = isLeader || spaceKey === PALADIN_SPACE_KEY;

  return {
    guildCode,
    role,
    spaceKey: isPaladin ? PALADIN_SPACE_KEY : spaceKey,
    isLeader,
    isPaladin,
    stratGuildCode: isPaladin ? null : guildCode,
  };
}

export function getRunScopeForGvgGuild(guild) {
  const guildCode = normalizeGuildCode(guild || "G1");
  const isPaladin = isPaladinGuildCode(guildCode);

  return {
    guildCode,
    role: "",
    spaceKey: isPaladin ? PALADIN_SPACE_KEY : getGuildSpaceKey(guildCode),
    isLeader: false,
    isPaladin,
    stratGuildCode: isPaladin ? null : guildCode,
  };
}

export function stratMatchesRunScope(strat, scope) {
  const stratGuildCode = normalizeGuildCode(strat?.guild_code);

  if (scope?.isPaladin) {
    return !stratGuildCode || PALADIN_CLUSTER_GUILD_CODES.includes(normalizeGuildCodeKey(stratGuildCode));
  }

  return Boolean(stratGuildCode && getGuildSpaceKey(stratGuildCode) === scope?.spaceKey);
}
