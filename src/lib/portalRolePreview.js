export const PORTAL_REAL_VIEW_MODE = "real";

export const PORTAL_ROLE_PREVIEW_OPTIONS = [
  { id: PORTAL_REAL_VIEW_MODE, role: null, labelKey: "rolePreview.real", fallbackLabel: "Ma vue reelle" },
  { id: "member", role: "member", labelKey: "rolePreview.member", fallbackLabel: "Membre" },
  { id: "officer", role: "officer", labelKey: "rolePreview.officer", fallbackLabel: "Officier" },
  { id: "admin", role: "admin", labelKey: "rolePreview.admin", fallbackLabel: "Administrateur" },
  { id: "leader", role: "leader", labelKey: "rolePreview.leader", fallbackLabel: "Leader" },
  {
    id: "community_member",
    role: "community_member",
    labelKey: "rolePreview.communityMember",
    fallbackLabel: "Membre de la communaute",
  },
  {
    id: "content_creator",
    role: "content_creator",
    labelKey: "rolePreview.contentCreator",
    fallbackLabel: "Createur de contenu",
  },
];

const PREVIEW_ROLES = new Set(
  PORTAL_ROLE_PREVIEW_OPTIONS.map((option) => option.role).filter(Boolean),
);

const ROLE_ALIASES = new Map([
  ["membre", "member"],
  ["member", "member"],
  ["officier", "officer"],
  ["officer", "officer"],
  ["admin", "admin"],
  ["administrateur", "admin"],
  ["administrator", "admin"],
  ["leader", "leader"],
  ["communitymember", "community_member"],
  ["community_member", "community_member"],
  ["membredelacommunaute", "community_member"],
  ["membrecommunaute", "community_member"],
  ["contentcreator", "content_creator"],
  ["content_creator", "content_creator"],
  ["createurdecontenu", "content_creator"],
  ["creatricedecontenu", "content_creator"],
]);

function normalizeRoleText(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeAliasKey(value) {
  return normalizeRoleText(value).replace(/[^a-z0-9_]+/g, "");
}

export function normalizePortalRolePreviewRole(value) {
  const raw = normalizeRoleText(value);
  if (!raw) return "";
  if (PREVIEW_ROLES.has(raw)) return raw;

  return ROLE_ALIASES.get(normalizeAliasKey(value)) || "";
}

export function normalizePortalRolePreviewMode(value) {
  const raw = normalizeRoleText(value);
  if (!raw || raw === PORTAL_REAL_VIEW_MODE || raw === "real_view" || raw === "ma_vue_reelle") {
    return PORTAL_REAL_VIEW_MODE;
  }

  return normalizePortalRolePreviewRole(value) || PORTAL_REAL_VIEW_MODE;
}

export function getPortalRolePreviewOption(value) {
  const mode = normalizePortalRolePreviewMode(value);
  return (
    PORTAL_ROLE_PREVIEW_OPTIONS.find((option) => option.id === mode || option.role === mode) ||
    PORTAL_ROLE_PREVIEW_OPTIONS[0]
  );
}

export function getPortalSessionServerRole(session) {
  return (
    session?.serverRole ||
    session?.server_role ||
    session?.realRole ||
    session?.real_role ||
    session?.actualRole ||
    session?.actual_role ||
    session?.role ||
    ""
  );
}

export function isPortalRolePreviewManagerSession(session) {
  const role = normalizePortalRolePreviewRole(getPortalSessionServerRole(session));
  return Boolean(
    session?.isLeader ||
      session?.leader ||
      session?.isAdmin ||
      session?.admin ||
      role === "leader" ||
      role === "admin",
  );
}

function getPreviewGuildValue(session, isCommunityPreview) {
  if (isCommunityPreview) return "COMMUNITY";
  return session?.guildCode || session?.guild_code || session?.guild || "";
}

export function buildPortalRolePreviewSession(realSession, previewMode) {
  const normalizedMode = normalizePortalRolePreviewMode(previewMode);
  if (!realSession || normalizedMode === PORTAL_REAL_VIEW_MODE) return realSession;

  const previewRole = normalizedMode;
  const serverRole = getPortalSessionServerRole(realSession);
  const isCommunityPreview = previewRole === "community_member" || previewRole === "content_creator";
  const isLeaderPreview = previewRole === "leader";
  const isAdminPreview = previewRole === "admin" || isLeaderPreview;
  const previewGuild = getPreviewGuildValue(realSession, isCommunityPreview);
  const previewAccessType = isCommunityPreview ? "community" : "guild";
  const previewCommunityAccessType = isCommunityPreview ? "community" : "";

  return {
    ...realSession,
    role: previewRole,
    guild: previewGuild,
    guildCode: previewGuild,
    guild_code: previewGuild,
    accessType: previewAccessType,
    access_type: previewAccessType,
    communityAccessType: previewCommunityAccessType,
    community_access_type: previewCommunityAccessType,
    communityStatus: isCommunityPreview ? "active" : realSession?.communityStatus || realSession?.community_status || "",
    community_status: isCommunityPreview ? "active" : realSession?.community_status || realSession?.communityStatus || "",
    isAdmin: isAdminPreview,
    admin: isAdminPreview,
    isLeader: isLeaderPreview,
    leader: isLeaderPreview,
    rolePreviewActive: true,
    rolePreviewMode: normalizedMode,
    rolePreviewActualRole: serverRole,
    serverRole,
    server_role: serverRole,
    realRole: serverRole,
    real_role: serverRole,
  };
}
