export const PALADIN_CLUSTER_GUILD_CODES = ["G1", "G2", "G3", "G4", "G5", "G6", "G7"];
export const PALADIN_SPACE_KEY = "PALADIN";
export const COMMUNITY_SPACE_KEY = "COMMUNITY";

function normalizeRoleValue(role) {
  return String(role || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function isCommunitySession(session) {
  const accessType = String(
    session?.accessType ||
      session?.access_type ||
      session?.communityAccessType ||
      session?.community_access_type ||
      ""
  )
    .trim()
    .toLowerCase();

  const role = normalizeRoleValue(session?.role);
  return accessType === "community" || role === "community_member" || role === "content_creator";
}

export function normalizeGuildCode(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function normalizeGuildCodeKey(value) {
  return normalizeGuildCode(value).toUpperCase();
}

export function normalizeGvgGuildCode(value) {
  return normalizeGuildCodeKey(value)
    .replace(/\s+/g, "_")
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 24);
}

export function isPaladinGuildCode(value) {
  return PALADIN_CLUSTER_GUILD_CODES.includes(normalizeGuildCodeKey(value));
}

export function getGuildSpaceKey(guildCode) {
  const code = normalizeGuildCodeKey(guildCode);
  if (!code || isPaladinGuildCode(code)) return PALADIN_SPACE_KEY;

  const spacedMatch = code.match(/^([A-Z0-9]+)[\s_-]+G\d+$/);
  if (spacedMatch?.[1]) return spacedMatch[1];

  return code;
}

export function getGuildSpaceLabel(guildCode) {
  const key = getGuildSpaceKey(guildCode);
  if (key === PALADIN_SPACE_KEY) return "Paladin";

  return key
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function getControlBrand(session) {
  if (isCommunitySession(session)) return "Community Control";
  return `${getGuildSpaceLabel(session?.guildCode || session?.guild_code || session?.guild)} Control`;
}

export function isSameGuildSpace(leftGuildCode, rightGuildCode) {
  return getGuildSpaceKey(leftGuildCode) === getGuildSpaceKey(rightGuildCode);
}

export function getSessionGuildCode(session) {
  if (isCommunitySession(session)) return COMMUNITY_SPACE_KEY;
  return normalizeGuildCode(session?.guildCode || session?.guild_code || session?.guild || "G1");
}

export function getSessionGuildSpaceKey(session) {
  return getGuildSpaceKey(getSessionGuildCode(session));
}

export function isPaladinSession(session) {
  if (isCommunitySession(session)) return false;
  return getSessionGuildSpaceKey(session) === PALADIN_SPACE_KEY;
}

export function isExternalRunGuildCode(guildCode) {
  const code = normalizeGuildCode(guildCode);
  return Boolean(code && !isPaladinGuildCode(code));
}

export function isPaladinAdminSession(session) {
  const rawGuildCode = normalizeGuildCode(
    session?.guildCode || session?.guild_code || session?.guild || ""
  );
  if (!isPaladinGuildCode(rawGuildCode)) return false;

  const role = String(session?.role || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  return Boolean(
    session?.isAdmin === true ||
      session?.admin === true ||
      session?.isLeader === true ||
      session?.leader === true ||
      role.includes("admin") ||
      role.includes("administrateur") ||
      role === "leader"
  );
}

export function getVisibleGvgGuildCodes(session) {
  if (isCommunitySession(session)) return [];
  if (isPaladinSession(session)) return PALADIN_CLUSTER_GUILD_CODES;

  const guildCode = normalizeGvgGuildCode(getSessionGuildCode(session));
  return guildCode ? [guildCode] : [];
}

export function getGvgGuildLabel(guildCode) {
  return normalizeGuildCode(guildCode).replace(/[_-]+/g, " ");
}

export function isLeaderSession(session) {
  const role = String(session?.role || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  return Boolean(session?.isLeader || session?.leader || role === "leader");
}

export function filterByGuildScope(rows, session, getGuildCode, options = {}) {
  const { leaderSeesAll = true } = options;
  if (isCommunitySession(session)) {
    const sessionMemberId = String(session?.memberId || session?.id || "");
    return (rows || []).filter((row) => String(row?.id || row?.member_id || "") === sessionMemberId);
  }

  if (leaderSeesAll && isLeaderSession(session)) return rows || [];

  const sessionGuildCode = getSessionGuildCode(session);
  const sessionSpaceKey = getGuildSpaceKey(sessionGuildCode);

  return (rows || []).filter((row) => {
    const rowGuildCode = normalizeGuildCode(getGuildCode(row));
    if (!rowGuildCode) return sessionSpaceKey === PALADIN_SPACE_KEY;
    return getGuildSpaceKey(rowGuildCode) === sessionSpaceKey;
  });
}

export function getGuildScopeDescription(session) {
  if (isCommunitySession(session)) {
    return "Espace communaute";
  }

  const guildCode = getSessionGuildCode(session);
  if (isPaladinGuildCode(guildCode)) {
    return "Cluster Paladin G1-G7";
  }

  return `Espace externe ${getGuildSpaceLabel(guildCode)}`;
}
