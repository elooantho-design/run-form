function getApiBaseUrl() {
  return String(import.meta.env?.VITE_API_BASE_URL || "").replace(/\/$/, "");
}

export const PORTAL_PRESENCE_HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

function getSessionMemberId(session) {
  return session?.memberId || session?.id || null;
}

function getSessionName(session) {
  return session?.watcherName || session?.memberName || session?.name || session?.discordId || "Systeme";
}

export async function logPortalActivity(session, payload) {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/portal-activity`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actorMemberId: getSessionMemberId(session),
        actorName: getSessionName(session),
        ...payload,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.warn("Log activite non enregistre:", text);
    }
  } catch (error) {
    console.warn("Log activite non enregistre:", error);
  }
}

export async function touchPortalPresence() {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/portal-activity`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "heartbeat" }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.warn("Presence Portal non enregistree:", text);
    }
  } catch (error) {
    console.warn("Presence Portal non enregistree:", error);
  }
}
