export function requestDiscordNativeNavigation(uri, { windowRef = typeof window === "undefined" ? null : window } = {}) {
  const target = typeof uri === "string" ? uri.trim() : "";
  if (!target.startsWith("discord://") || /[\r\n]/.test(target)) {
    throw new Error("Lien natif Discord invalide.");
  }
  if (!windowRef?.location) throw new Error("Ouverture native Discord indisponible dans cet environnement.");
  try {
    // Keep the synchronous handoff used by Guild Management; no web fallback or launch guarantee.
    windowRef.location.href = target;
  } catch {
    throw new Error("Ouverture Discord bloquée. Vérifie que l'application est installée et que les liens discord:// sont autorisés.");
  }
  return { requested: true };
}
