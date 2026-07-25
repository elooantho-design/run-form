import {
  getGuildSpaceKey,
  isPaladinGuildCode,
  normalizeGuildCode,
  normalizeGvgGuildCode,
  normalizeGuildCodeKey,
  PALADIN_CLUSTER_GUILD_CODES,
  PALADIN_SPACE_KEY,
} from "./guildScope.js";
import {
  DEFAULT_EXTERNAL_LICENSE_PLAN,
  getPaladinLicenseAccess,
  getPortalLicenseAccess,
} from "./portalLicensePlans.js";

function normalizeRoleValue(role) {
  return String(role || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isAdminRoleValue(roleValue) {
  return ["admin", "administrateur", "leader"].includes(roleValue);
}

function isMissingLicenseTable(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes("portal_guild_licenses")
  );
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

export function isMissingRunBoycottTable(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes("defence_strat_boycotts")
  );
}

function buildDeniedRunScope(member = null) {
  const guildCode = normalizeGuildCode(member?.guild_code || "");

  return {
    memberId: member?.id || "",
    actorName: member?.watcher_name || "",
    guildCode,
    role: member?.role || "",
    spaceKey: guildCode ? getGuildSpaceKey(guildCode) : "",
    isLeader: false,
    isAdmin: false,
    isPaladin: false,
    stratGuildCode: guildCode || null,
    license: null,
    licenseAccess: null,
    canUsePortalCore: false,
    canUseGvg: false,
    canSearchRuns: false,
    canManageOwnRuns: false,
    canBoycottRuns: false,
    canAccessPaladinRuns: false,
  };
}

export async function resolveRunScope(supabase, req, trustedMember = null) {
  const allowUntrustedFallback =
    process.env.PORTAL_ALLOW_UNTRUSTED_RUN_SCOPE === "1" &&
    process.env.NODE_ENV !== "production" &&
    !process.env.VERCEL;
  const memberId = allowUntrustedFallback ? readSessionField(req, ["memberId", "member_id"]) : "";
  const discordId = allowUntrustedFallback ? readSessionField(req, ["discordId", "discord_id"]) : "";
  const fallbackGuildCode = allowUntrustedFallback
    ? readSessionField(req, ["guildCode", "guild_code", "guild"])
    : "";
  const fallbackRole = allowUntrustedFallback ? readSessionField(req, ["role"]) : "";

  let member = trustedMember?.id ? trustedMember : null;

  if (!member && allowUntrustedFallback && (memberId || discordId)) {
    let query = supabase
      .from("guild_members")
      .select("id, role, discord_id, watcher_name, guild_code")
      .limit(1);

    query = memberId ? query.eq("id", memberId) : query.eq("discord_id", discordId);

    const { data, error } = await query.maybeSingle();
    if (!error && data) member = data;
  }

  if (!member && !allowUntrustedFallback) {
    return buildDeniedRunScope();
  }

  const guildCode = normalizeGuildCode(member?.guild_code || fallbackGuildCode || "G1");
  const role = member?.role || fallbackRole || "";
  const roleValue = normalizeRoleValue(role);
  const hasTrustedMemberRole = Boolean(member);
  const spaceKey = getGuildSpaceKey(guildCode);
  const isPaladin = spaceKey === PALADIN_SPACE_KEY;
  const isLeader = hasTrustedMemberRole && isPaladin && roleValue === "leader";
  const isAdmin = hasTrustedMemberRole && isPaladin && isAdminRoleValue(roleValue);
  let license = null;
  let licenseAccess = getPaladinLicenseAccess();

  if (!isPaladin) {
    const { data, error } = await supabase
      .from("portal_guild_licenses")
      .select("plan, status, trial_started_at, trial_ends_at, current_period_started_at, current_period_ends_at")
      .eq("guild_space_key", spaceKey)
      .maybeSingle();

    if (!error && data) {
      license = data;
      licenseAccess = getPortalLicenseAccess(data);
    } else if (error && !isMissingLicenseTable(error)) {
      console.error("[run-scope] license lookup error:", error);
      licenseAccess = getPortalLicenseAccess({ plan: DEFAULT_EXTERNAL_LICENSE_PLAN, status: "active" });
    } else {
      licenseAccess = getPortalLicenseAccess({ plan: DEFAULT_EXTERNAL_LICENSE_PLAN, status: "active" });
    }
  }

  return {
    memberId: member?.id || memberId || "",
    actorName: member?.watcher_name || "",
    guildCode,
    role,
    spaceKey: isPaladin ? PALADIN_SPACE_KEY : spaceKey,
    isLeader,
    isAdmin,
    isPaladin,
    stratGuildCode: isPaladin ? null : guildCode,
    license,
    licenseAccess,
    canUsePortalCore: isPaladin || licenseAccess.canUsePortalCore,
    canUseGvg: isPaladin || licenseAccess.canUseGvg,
    canSearchRuns: isPaladin || licenseAccess.canSearchRuns,
    canManageOwnRuns: isPaladin || licenseAccess.canManageOwnRuns,
    canBoycottRuns: isPaladin || licenseAccess.canBoycottRuns,
    canAccessPaladinRuns: isPaladin || licenseAccess.canAccessPaladinRuns,
  };
}

export function getRunScopeForGvgGuild(guild) {
  const guildCode = normalizeGuildCode(guild || "G1");
  const isPaladin = isPaladinGuildCode(guildCode);

  return {
    memberId: "",
    actorName: "",
    guildCode,
    role: "",
    spaceKey: isPaladin ? PALADIN_SPACE_KEY : getGuildSpaceKey(guildCode),
    isLeader: false,
    isAdmin: isPaladin,
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

export function stratMatchesRunReadScope(strat, scope) {
  const stratGuildCode = normalizeGuildCode(strat?.guild_code);

  if (scope?.isPaladin) {
    if (scope?.isAdmin || scope?.isLeader) return true;
    return !stratGuildCode || PALADIN_CLUSTER_GUILD_CODES.includes(normalizeGuildCodeKey(stratGuildCode));
  }

  if (stratGuildCode && getGuildSpaceKey(stratGuildCode) === scope?.spaceKey) return true;

  if (scope?.canAccessPaladinRuns) {
    return !stratGuildCode || PALADIN_CLUSTER_GUILD_CODES.includes(normalizeGuildCodeKey(stratGuildCode));
  }

  return false;
}

export function canUseRunTargetGuild(scope, guildCode) {
  const targetGuildCode = normalizeGuildCode(guildCode || scope?.guildCode);
  if (!targetGuildCode) return false;
  if (scope?.isLeader) return true;
  if (scope?.isPaladin) return PALADIN_CLUSTER_GUILD_CODES.includes(normalizeGuildCodeKey(targetGuildCode));
  return getGuildSpaceKey(targetGuildCode) === scope?.spaceKey;
}

export function getRunTargetGuildCode(scope, guildCode) {
  const targetGuildCode = normalizeGuildCode(guildCode || scope?.guildCode);
  if (canUseRunTargetGuild(scope, targetGuildCode)) return normalizeGvgGuildCode(targetGuildCode);
  return normalizeGvgGuildCode(scope?.guildCode || "G1");
}
