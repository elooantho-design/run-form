export const PALADIN_CLUSTER_GUILD_CODES = ["G1", "G2", "G3", "G4", "G5", "G6", "G7"];
export const PALADIN_SPACE_KEY = "PALADIN";

export function normalizeGuildCode(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function normalizeGuildCodeKey(value) {
  return normalizeGuildCode(value).toUpperCase();
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
  return `${getGuildSpaceLabel(session?.guildCode || session?.guild_code || session?.guild)} Control`;
}

export function isSameGuildSpace(leftGuildCode, rightGuildCode) {
  return getGuildSpaceKey(leftGuildCode) === getGuildSpaceKey(rightGuildCode);
}

export function getSessionGuildCode(session) {
  return normalizeGuildCode(session?.guildCode || session?.guild_code || session?.guild || "G1");
}

export function getSessionGuildSpaceKey(session) {
  return getGuildSpaceKey(getSessionGuildCode(session));
}

export function isPaladinSession(session) {
  return getSessionGuildSpaceKey(session) === PALADIN_SPACE_KEY;
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
  const guildCode = getSessionGuildCode(session);
  if (isPaladinGuildCode(guildCode)) {
    return "Cluster Paladin G1-G7";
  }

  return `Espace externe ${getGuildSpaceLabel(guildCode)}`;
}
