const READ_ACTIONS = new Set(["list", "detail", "preview", "reminder-preview", "mine", "answer-form"]);

export async function requestGuildSurvey(action, { surveyId, expectedRevision, payload } = {}) {
  const readOnly = READ_ACTIONS.has(action);
  const query = new URLSearchParams({ action, ...(surveyId ? { surveyId } : {}) });
  const response = await fetch(`/api/portal-guild-surveys${readOnly ? `?${query}` : ""}`, {
    credentials: "include", method: readOnly ? "GET" : "POST", cache: "no-store",
    ...(readOnly ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, surveyId, expectedRevision, payload }) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok !== true) {
    const error = new Error(data.error || "Sondage indisponible.");
    error.status = response.status;
    throw error;
  }
  return data;
}
