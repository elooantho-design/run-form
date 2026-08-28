export const PORTAL_SESSION_SYNC_CHANNEL = "paladin-portal-session-sync";
export const PORTAL_SESSION_SYNC_STORAGE_KEY = "paladinPortalSessionSync";
export const PORTAL_COSMETICS_SYNC_CHANNEL = "paladin-portal-cosmetics-sync";
export const PORTAL_COSMETICS_SYNC_STORAGE_KEY = "paladinPortalCosmeticsSync";

export function getPortalSessionMemberId(session) {
  return String(session?.memberId || session?.id || "").trim();
}

function normalizeSessionValue(value) {
  return String(value || "").trim();
}

export function getPortalSessionSignature(session) {
  if (!session) return "";
  return JSON.stringify({
    memberId: getPortalSessionMemberId(session),
    role: normalizeSessionValue(session.role),
    guildCode: normalizeSessionValue(session.guildCode || session.guild_code || session.guild),
    accessType: normalizeSessionValue(session.accessType || session.access_type),
    communityAccessType: normalizeSessionValue(session.communityAccessType || session.community_access_type),
    communityStatus: normalizeSessionValue(session.communityStatus || session.community_status),
    isAdmin: Boolean(session.isAdmin || session.admin),
    isLeader: Boolean(session.isLeader || session.leader),
    passwordChangeRequired: Boolean(session.passwordChangeRequired || session.password_change_required),
  });
}

export function arePortalSessionsEquivalent(currentSession, nextSession) {
  return JSON.stringify(currentSession ?? null) === JSON.stringify(nextSession ?? null);
}

export function reconcilePortalSession(currentSession, serverSession) {
  if (!serverSession) {
    return {
      session: null,
      changed: Boolean(currentSession),
      identityChanged: Boolean(currentSession),
      signatureChanged: Boolean(currentSession),
    };
  }

  const currentMemberId = getPortalSessionMemberId(currentSession);
  const nextMemberId = getPortalSessionMemberId(serverSession);
  const currentSignature = getPortalSessionSignature(currentSession);
  const nextSignature = getPortalSessionSignature(serverSession);

  return {
    session: serverSession,
    changed: currentSignature !== nextSignature,
    identityChanged: currentMemberId !== nextMemberId,
    signatureChanged: currentSignature !== nextSignature,
  };
}

export function createPortalSyncMessage(sourceId, reason = "changed") {
  return {
    type: "portal-sync",
    sourceId: normalizeSessionValue(sourceId),
    reason: normalizeSessionValue(reason) || "changed",
    issuedAt: Date.now(),
  };
}

export function shouldHandlePortalSyncMessage(message, ownSourceId) {
  if (!message || typeof message !== "object") return false;
  if (message.type !== "portal-sync") return false;
  if (normalizeSessionValue(message.sourceId) === normalizeSessionValue(ownSourceId)) return false;
  return true;
}
