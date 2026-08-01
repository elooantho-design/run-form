export const PORTAL_LANGUAGES = [
  { code: "fr", label: "Francais", shortLabel: "FR", flagLabel: "France" },
  { code: "en", label: "English", shortLabel: "EN", flagLabel: "United Kingdom" },
];

export function getPortalSupportedLanguageCodes() {
  return PORTAL_LANGUAGES.map((language) => language.code);
}

export function normalizePortalLanguageCode(value, fallback = "fr") {
  const normalized = String(value || "").trim().toLowerCase();
  return getPortalSupportedLanguageCodes().includes(normalized) ? normalized : fallback;
}
