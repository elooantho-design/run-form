export const SUMMON_FAMILY_VALUES = ["blue", "ancient", "exclusive", "collab", "event"];

export const SUMMON_FAMILY_FILTERS = ["nascent", "ancient", "exclusive", "collab", "event"];

const summonFamilyAliases = new Map([
  ["blue", "blue"],
  ["bleu", "blue"],
  ["naissante", "blue"],
  ["ancient", "ancient"],
  ["ancien", "ancient"],
  ["exclusive", "exclusive"],
  ["exclusif", "exclusive"],
  ["collab", "collab"],
  ["collaboration", "collab"],
  ["event", "event"],
  ["evenement", "event"],
]);

function normalizePlainText(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function normalizeSummonFamily(value) {
  const normalized = normalizePlainText(value).replace(/[^a-z0-9]+/g, "");
  return summonFamilyAliases.get(normalized) || "";
}

export function getChampionSummonFamily(champion) {
  return normalizeSummonFamily(
    champion?.summon_family ??
      champion?.summonFamily ??
      champion?.SummonFamily ??
      champion?.summon_family_code ??
      "",
  );
}

export function isHeroOwnedForSummonFamilyFilter(state) {
  if (typeof state?.owned === "boolean") return state.owned;
  const awakening = Number(state?.awakening);
  return Number.isFinite(awakening) && awakening >= 0;
}

export function isNascentSummonHero(hero, state) {
  return (
    hero?.rarity === "legendary" &&
    hero?.summonFamily === "blue" &&
    !isHeroOwnedForSummonFamilyFilter(state)
  );
}

export function heroMatchesSummonFamilyFilter(hero, state, filter) {
  const normalizedFilter = String(filter || "all").trim();
  if (!normalizedFilter || normalizedFilter === "all") return true;
  if (normalizedFilter === "nascent") return isNascentSummonHero(hero, state);
  if (!SUMMON_FAMILY_VALUES.includes(normalizedFilter)) return true;
  return hero?.summonFamily === normalizedFilter;
}

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
