export async function fetchPortalChampions() {
  const response = await fetch("/api/portal-champions", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "list" }),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload?.error || "Chargement champions impossible.");
  }

  return payload?.champions || [];
}
