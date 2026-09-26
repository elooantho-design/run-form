import { getChampionFieldValue, normalizeChampionLookupKey } from "./championDisplay.js";
import { buildPublicHeroUrl } from "./vpsAssets.js";

const CHAMPION_IMAGE_FIELDS = [
  "image_file",
  "imageFile",
  "portrait",
  "hero_image",
  "heroImage",
];

function unique(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }

  return result;
}

export function normalizeHeroPortraitFileName(value, { stripTrailingDigits = false } = {}) {
  let normalized = String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

  if (stripTrailingDigits) {
    normalized = normalized.replace(/\d+$/, "");
  }

  return normalized ? `${normalized}.png` : "";
}

function buildSources(fileNames) {
  return unique(
    fileNames.flatMap((fileName) => [
      fileName ? `/heroes/${fileName}` : "",
      buildPublicHeroUrl(fileName),
    ]),
  );
}

export function getChampionPortraitFileNames(champion) {
  const explicitImage = getChampionFieldValue(champion, CHAMPION_IMAGE_FIELDS);
  const technicalName = String(champion?.name || "").trim();
  const portalName = getChampionFieldValue(champion, [
    "portal_name",
    "portalName",
    "PortalName",
    "display_name",
    "displayName",
  ]);
  const englishName = getChampionFieldValue(champion, [
    "english_name",
    "englishName",
    "English name",
    "english",
    "English",
  ]);

  return unique(
    [explicitImage, technicalName, portalName, englishName]
      .map((value) => normalizeHeroPortraitFileName(value))
      .filter(Boolean),
  );
}

export function getChampionPortraitImageSources(champion) {
  return buildSources(getChampionPortraitFileNames(champion));
}

export function getHeroPortraitFileNames(heroName, championDisplayMap) {
  const rawName = String(heroName || "").trim();
  if (!rawName) return [];

  const entry = championDisplayMap?.get?.(normalizeChampionLookupKey(rawName));
  if (entry) {
    return unique(
      [
        entry.imageFile,
        entry.technicalName,
        entry.portalName,
        entry.englishName,
        rawName,
      ]
        .flatMap((value) => [
          normalizeHeroPortraitFileName(value),
          normalizeHeroPortraitFileName(value, { stripTrailingDigits: true }),
        ])
        .filter(Boolean),
    );
  }

  return unique(
    [
      normalizeHeroPortraitFileName(rawName, { stripTrailingDigits: true }),
      normalizeHeroPortraitFileName(rawName),
    ].filter(Boolean),
  );
}

export function getHeroPortraitImageSources(heroName, championDisplayMap) {
  return buildSources(getHeroPortraitFileNames(heroName, championDisplayMap));
}
