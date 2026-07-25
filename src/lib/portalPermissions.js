const COMMUNITY_ROLES = new Set(["community_member", "content_creator"]);
const COMMUNITY_MAIN_TABS = new Set([
  "home",
  "hero-box",
  "soul-stones",
  "demon-monsters",
  "personal-best",
  "support-project",
]);
const COMMUNITY_HOME_TARGETS = new Set([
  "",
  "hero-box",
  "soul-stones",
  "demon-monsters",
  "personal-best",
]);

export function normalizePortalRole(role) {
  return String(role || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function isPortalCommunityRole(role) {
  return COMMUNITY_ROLES.has(normalizePortalRole(role));
}

export function isPortalCommunitySession(session) {
  const accessType = String(
    session?.accessType ||
      session?.access_type ||
      session?.communityAccessType ||
      session?.community_access_type ||
      "",
  )
    .trim()
    .toLowerCase();

  return accessType === "community" || isPortalCommunityRole(session?.role);
}

export function canShowPortalNavItem(item, session, portalAccess) {
  if (isPortalCommunitySession(session)) {
    return COMMUNITY_MAIN_TABS.has(item.id);
  }

  if (item.id === "home" || item.id === "settings") return true;
  if (item.id === "support-project") return true;
  if (item.id === "gvg") return Boolean(portalAccess?.canUseGvg);
  if (item.id === "run-search") return Boolean(portalAccess?.canSearchRuns);
  return Boolean(portalAccess?.canUsePortalCore);
}

export function canShowPortalPve(session, portalAccess) {
  if (isPortalCommunitySession(session)) return true;
  return Boolean(portalAccess?.canUsePortalCore);
}

export function canShowPortalAdminItem({ item, session, isAdminUser, isLeaderUser, isPaladinUser, portalAccess }) {
  if (isPortalCommunitySession(session)) return false;
  if (!isAdminUser) return false;
  if (item.paladinOnly && !isPaladinUser) return false;
  if (item.leaderOnly) return Boolean(isLeaderUser);
  if (!portalAccess?.canUsePortalCore) return false;
  if (item.id === "run-add" || item.id === "run-edit") return Boolean(portalAccess?.canManageOwnRuns);
  if (item.id === "launcher") return Boolean(portalAccess?.canUseLauncher);
  if (item.id === "validation") return Boolean(portalAccess?.canUseValidation);
  if (item.adminOnly) return Boolean(isAdminUser);
  return true;
}

export function canShowPortalHomeCard(card, session) {
  if (!isPortalCommunitySession(session)) return true;
  return COMMUNITY_HOME_TARGETS.has(card.target || "");
}
