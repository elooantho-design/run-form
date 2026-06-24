export function normalizeChampionLookupKey(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function getChampionFieldValue(champion, fieldNames) {
  for (const fieldName of fieldNames) {
    const value = champion?.[fieldName];
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length > 0) return value;
      continue;
    }
    if (String(value).trim()) return value;
  }

  return "";
}

export function getChampionEnglishName(champion) {
  return String(
    getChampionFieldValue(champion, [
      "English name",
      "english name",
      "english_name",
      "EnglishName",
      "englishName",
      "english",
      "English",
    ]) || "",
  ).trim();
}

export function getChampionPortalDisplayName(champion) {
  return String(
    getChampionFieldValue(champion, [
      "PortalName",
      "portalName",
      "portal_name",
      "portalname",
      "display_name",
      "displayName",
      "name",
    ]) || "",
  ).trim();
}

export function getChampionTechnicalName(champion) {
  return String(champion?.name || "").trim();
}

export function getChampionDisplayName(champion, language = "fr") {
  const technicalName = getChampionTechnicalName(champion);
  const portalName = getChampionPortalDisplayName(champion) || technicalName;
  const englishName = getChampionEnglishName(champion);

  return language === "en" && englishName ? englishName : portalName;
}

export function buildChampionDisplayMap(champions = []) {
  const map = new Map();

  for (const champion of champions || []) {
    const technicalName = getChampionTechnicalName(champion);
    const portalName = getChampionPortalDisplayName(champion) || technicalName;
    const englishName = getChampionEnglishName(champion);
    const entry = {
      id: champion?.id || null,
      technicalName,
      portalName,
      englishName,
      displayFr: portalName || technicalName,
      displayEn: englishName || portalName || technicalName,
    };

    const keys = [technicalName, portalName, englishName, champion?.id].filter(Boolean);
    for (const key of keys) {
      const normalizedKey = normalizeChampionLookupKey(key);
      if (normalizedKey) map.set(normalizedKey, entry);
    }
  }

  return map;
}

export function translateChampionName(name, championDisplayMap, language = "fr") {
  const rawName = String(name || "").trim();
  if (!rawName) return "";

  const entry = championDisplayMap?.get?.(normalizeChampionLookupKey(rawName));
  if (!entry) return rawName;

  return language === "en" ? entry.displayEn || rawName : entry.displayFr || rawName;
}
