function getApiBaseUrl() {
  return String(import.meta.env?.VITE_API_BASE_URL || "").replace(/\/$/, "");
}

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
