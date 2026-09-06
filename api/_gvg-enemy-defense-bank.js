/* global process */
import crypto from "node:crypto";
import {
  normalizeGuildCode,
  normalizeGuildCodeKey,
  normalizeGvgGuildCode,
} from "../src/lib/guildScope.js";

export const GVG_ENEMY_DEFENSE_BANK_MESSAGE = "Banque de defenses adverses non initialisee.";
export const GVG_ENEMY_DEFENSE_IMAGE_PREFIX = "enemy-defense-bank";
export const GVG_ENEMY_DEFENSE_ARCHIVE_ENDPOINT = "/api/v1/enemy-defense-bank/archive";

const DEFAULT_GVG_SERVER_URL = "http://152.228.128.157";
const DEFAULT_GVG_PUBLIC_ROOT_URL = "https://vps-aad12be0.vps.ovh.net";

const GVG_POSITION_GRIDS = {
  tower: { rows: 7, cols: 10 },
  fortress: { rows: 8, cols: 11 },
};

const OPENED_RECORD_STATUSES = new Set(["open", "a_record", "pas_record", "record", "push"]);
const SIMILARITY_HERO_COUNT = 5;
const ENEMY_SIMILARITY_TRACE_PREFIX = "[gvg-enemy-similarity-trace]";
const TEST_SIMI_HERO_KEYS = new Set(["countdracula", "brokkir", "eirlys", "erlis", "oren", "valara"]);

function traceEnemySimilarity(event, details = {}) {
  try {
    console.info(`${ENEMY_SIMILARITY_TRACE_PREFIX} ${event} ${JSON.stringify(details)}`);
  } catch {
    console.info(ENEMY_SIMILARITY_TRACE_PREFIX, event, details);
  }
}

function traceEnemySimilarityError(event, error, details = {}) {
  const payload = {
    ...details,
    code: error?.code || null,
    message: error?.message || String(error || ""),
    details: error?.details || null,
    hint: error?.hint || null,
  };

  try {
    console.error(`${ENEMY_SIMILARITY_TRACE_PREFIX} ${event} ${JSON.stringify(payload)}`);
  } catch {
    console.error(ENEMY_SIMILARITY_TRACE_PREFIX, event, payload);
  }
}

function shortTraceHash(value) {
  const text = String(value || "");
  return text ? text.slice(0, 12) : null;
}

function traceSample(items, mapper = (item) => item, max = 8) {
  const rows = Array.isArray(items) ? items : [];
  return {
    total: rows.length,
    sample: rows.slice(0, max).map(mapper),
  };
}

function summarizeReviewForTrace(row) {
  return {
    id: row?.id || null,
    enemy_defense_id: row?.enemy_defense_id || null,
    local_defense_id: row?.local_defense_id || null,
    organization_id: row?.organization_id || null,
    local_portal_guild_id: row?.local_portal_guild_id || null,
    local_guild_code: row?.local_guild_code || null,
    status: row?.status || null,
    enemy_identity_signature: shortTraceHash(row?.enemy_identity_signature),
    local_identity_signature: shortTraceHash(row?.local_identity_signature),
  };
}

export function normalizeGvgMapType(mapType) {
  const value = String(mapType || "").trim().toLowerCase();
  if (value === "fortress" || value === "forteresse" || value === "bastion") return "fortress";
  if (value === "tower" || value === "tour") return "tower";
  return "tower";
}

export function normalizeGvgChampionName(name) {
  if (!name) return null;
  const normalized = String(name)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\d+$/, "");
  return normalized || null;
}

const GVG_CHAMPION_SIMILARITY_ALIASES = new Map([
  ["comtedracula", "countdracula"],
  ["countdracula", "countdracula"],
  ["capitainereve", "captainreve"],
  ["captainreve", "captainreve"],
]);

export function normalizeGvgChampionSimilarityKey(name) {
  const normalized = normalizeGvgChampionName(name);
  if (!normalized) return null;

  const compact = normalized.replace(/[^a-z0-9]+/g, "").replace(/\d+$/, "");
  return GVG_CHAMPION_SIMILARITY_ALIASES.get(compact) || compact || null;
}

export function normalizeGvgDirection(direction) {
  if (!direction) return null;
  const value = String(direction).trim().toUpperCase();

  if (["N", "NORD", "NORTH"].includes(value)) return "N";
  if (["S", "SUD", "SOUTH"].includes(value)) return "S";
  if (["E", "EST", "EAST"].includes(value)) return "E";
  if (["O", "OUEST", "WEST", "W"].includes(value)) return "O";
  if (value === "↑") return "N";
  if (value === "↓") return "S";
  if (value === "→") return "E";
  if (value === "←") return "O";

  return null;
}

export function normalizeGvgPosition(position, mapType = "tower") {
  if (!position) return null;
  const value = String(position).trim().toUpperCase();
  const match = /^([A-Z])([1-9]\d?)$/.exec(value);
  if (!match) return null;

  const grid = GVG_POSITION_GRIDS[normalizeGvgMapType(mapType)] || GVG_POSITION_GRIDS.tower;
  const row = match[1].charCodeAt(0) - "A".charCodeAt(0) + 1;
  const col = Number(match[2]);

  return row >= 1 && row <= grid.rows && col >= 1 && col <= grid.cols ? value : null;
}

function normalizeHeroSlot(hero, mapType) {
  const champion = normalizeGvgChampionName(hero?.champion || hero?.name || hero?.hero);
  if (!champion) return null;

  return {
    champion,
    direction: normalizeGvgDirection(hero?.direction || hero?.dir) || null,
    position: normalizeGvgPosition(hero?.position || hero?.pos, mapType) || null,
  };
}

function sortCanonicalHeroSlots(left, right) {
  return (
    String(left.champion || "").localeCompare(String(right.champion || "")) ||
    String(left.position || "").localeCompare(String(right.position || "")) ||
    String(left.direction || "").localeCompare(String(right.direction || ""))
  );
}

export function buildEnemyDefenseCanonicalDefinition(defense) {
  const mapType = normalizeGvgMapType(defense?.type || defense?.map_type || defense?.mapType);
  const heroes = (Array.isArray(defense?.heroes) ? defense.heroes : [])
    .map((hero) => normalizeHeroSlot(hero, mapType))
    .filter(Boolean)
    .sort(sortCanonicalHeroSlots);

  if (!heroes.length) return null;

  return {
    version: 1,
    map_type: mapType,
    heroes,
  };
}

export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export function createEnemyDefenseFingerprint(defense) {
  const canonicalDefinition = buildEnemyDefenseCanonicalDefinition(defense);
  if (!canonicalDefinition) return null;
  return sha256Hex(stableStringify(canonicalDefinition));
}

function readLocalDefenseSlotChampion(slot) {
  return (
    slot?.champions?.name ||
    slot?.champions?.portal_name ||
    slot?.champions?.english_name ||
    slot?.champion ||
    slot?.name ||
    slot?.hero ||
    slot
  );
}

function isStructuredDefenseSlot(slot) {
  return Boolean(slot && typeof slot === "object" && !Array.isArray(slot));
}

function getDefenseHeroSlots(defense) {
  if (Array.isArray(defense?.guild_defense_slots)) return defense.guild_defense_slots;
  if (Array.isArray(defense?.detailedSlots)) return defense.detailedSlots;
  if (Array.isArray(defense?.detailed_slots)) return defense.detailed_slots;
  if (Array.isArray(defense?.slots)) return defense.slots;
  return [];
}

export function getDefenseDetailedSlots(defense) {
  if (Array.isArray(defense?.guild_defense_slots)) return defense.guild_defense_slots.filter(isStructuredDefenseSlot);
  if (Array.isArray(defense?.detailedSlots)) return defense.detailedSlots.filter(isStructuredDefenseSlot);
  if (Array.isArray(defense?.detailed_slots)) return defense.detailed_slots.filter(isStructuredDefenseSlot);
  if (Array.isArray(defense?.slots) && defense.slots.every(isStructuredDefenseSlot)) return defense.slots;
  return [];
}

function readLocalDefenseSlotPosition(slot, mapType) {
  return normalizeGvgPosition(slot?.position || slot?.pos, mapType) || null;
}

function readLocalDefenseSlotDirection(slot) {
  return normalizeGvgDirection(slot?.direction || slot?.dir) || null;
}

export function createDefenseSimilaritySignature({ mapType = "tower", heroes = [] } = {}) {
  const normalizedMapType = normalizeGvgMapType(mapType);
  const heroNames = (heroes || [])
    .map((hero) => (typeof hero === "string" ? hero : hero?.champion || hero?.name || hero?.hero || readLocalDefenseSlotChampion(hero)))
    .map(normalizeGvgChampionSimilarityKey)
    .filter(Boolean)
    .sort();

  if (heroNames.length !== SIMILARITY_HERO_COUNT) return null;

  return sha256Hex(
    stableStringify({
      version: 1,
      map_type: normalizedMapType,
      heroes: heroNames,
    }),
  );
}

export function createEnemyDefenseSimilaritySignature(defense) {
  const definition = defense?.canonical_definition || defense?.canonicalDefinition || buildEnemyDefenseCanonicalDefinition(defense);
  const heroes = Array.isArray(definition?.heroes) ? definition.heroes : [];
  return createDefenseSimilaritySignature({
    mapType: defense?.map_type || defense?.mapType || definition?.map_type,
    heroes,
  });
}

export function createLocalDefenseSimilaritySignature(defense) {
  const slots = getDefenseHeroSlots(defense);
  return createDefenseSimilaritySignature({
    mapType: defense?.type || defense?.map_type || defense?.mapType,
    heroes: slots.map(readLocalDefenseSlotChampion),
  });
}

export function createLocalDefenseReviewSignature(defense) {
  const mapType = normalizeGvgMapType(defense?.type || defense?.map_type || defense?.mapType);
  const slots = getDefenseDetailedSlots(defense)
    .map((slot) => {
      const champion = normalizeGvgChampionSimilarityKey(readLocalDefenseSlotChampion(slot));
      if (!champion) return null;

      return {
        champion,
        position: readLocalDefenseSlotPosition(slot, mapType),
        direction: readLocalDefenseSlotDirection(slot),
      };
    })
    .filter(Boolean)
    .sort(sortCanonicalHeroSlots);

  if (slots.length !== SIMILARITY_HERO_COUNT) return null;

  return sha256Hex(
    stableStringify({
      version: 1,
      map_type: mapType,
      heroes: slots,
    }),
  );
}

export function getEnemyDefenseHeroLayouts(defense) {
  const definition = defense?.canonical_definition || defense?.canonicalDefinition || buildEnemyDefenseCanonicalDefinition(defense);
  const mapType = normalizeGvgMapType(defense?.map_type || defense?.mapType || definition?.map_type);

  return (Array.isArray(definition?.heroes) ? definition.heroes : [])
    .map((hero) => ({
      champion: normalizeGvgChampionName(hero?.champion || hero?.name || hero?.hero),
      championKey: normalizeGvgChampionSimilarityKey(hero?.champion || hero?.name || hero?.hero),
      champion_key: normalizeGvgChampionSimilarityKey(hero?.champion || hero?.name || hero?.hero),
      label: hero?.champion || hero?.name || hero?.hero || "",
      position: normalizeGvgPosition(hero?.position || hero?.pos, mapType),
      direction: normalizeGvgDirection(hero?.direction || hero?.dir),
    }))
    .filter((hero) => hero.championKey);
}

export function getEnemyDefenseHeroLayoutByChampion(defense) {
  const layoutsByChampion = new Map();

  for (const layout of getEnemyDefenseHeroLayouts(defense)) {
    if (layout.champion && !layoutsByChampion.has(layout.champion)) layoutsByChampion.set(layout.champion, layout);
    if (layout.championKey && !layoutsByChampion.has(layout.championKey)) layoutsByChampion.set(layout.championKey, layout);
  }

  return layoutsByChampion;
}

function getLocalDefenseHeroKeys(defense) {
  return getDefenseHeroSlots(defense)
    .map((slot) => normalizeGvgChampionSimilarityKey(readLocalDefenseSlotChampion(slot)))
    .filter(Boolean)
    .sort();
}

function isTraceImportantLocalDefense(defense) {
  const nameKey = normalizeGvgChampionSimilarityKey(defense?.name || "");
  const heroKeys = getLocalDefenseHeroKeys(defense);
  const heroHitCount = heroKeys.filter((key) => TEST_SIMI_HERO_KEYS.has(key)).length;
  return String(nameKey || "").includes("testsimi") || heroHitCount >= 4;
}

function summarizeLocalDefenseForTrace(defense, extra = {}) {
  const mapType = normalizeGvgMapType(defense?.type || defense?.map_type || defense?.mapType);
  const heroKeys = getLocalDefenseHeroKeys(defense);

  return {
    id: defense?.id || null,
    name: defense?.name || "",
    guild_code: defense?.guild_code || "",
    organization_id: defense?.organization_id || "",
    type: mapType,
    source_defense_id: defense?.source_defense_id || null,
    source_enemy_defense_id: defense?.source_enemy_defense_id || null,
    heroes: heroKeys,
    hero_count: heroKeys.length,
    has_complete_layout: localDefenseHasCompleteLayout(defense),
    similarity_signature: shortTraceHash(createLocalDefenseSimilaritySignature(defense)),
    review_signature: shortTraceHash(createLocalDefenseReviewSignature(defense)),
    ...extra,
  };
}

function summarizeEnemyDefenseForTrace(defense, extra = {}) {
  const layouts = getEnemyDefenseHeroLayouts(defense);
  return {
    id: defense?.id || null,
    fingerprint: shortTraceHash(defense?.defense_fingerprint),
    map_type: normalizeGvgMapType(defense?.map_type || defense?.mapType || defense?.canonical_definition?.map_type),
    heroes: layouts.map((hero) => hero.championKey).filter(Boolean).sort(),
    hero_count: layouts.length,
    similarity_signature: shortTraceHash(createEnemyDefenseSimilaritySignature(defense)),
    image_url_present: Boolean(defense?.image_url || defense?.imageUrl),
    ...extra,
  };
}

export function localDefenseHasCompleteLayout(defense) {
  const mapType = normalizeGvgMapType(defense?.type || defense?.map_type || defense?.mapType);
  const slots = getDefenseDetailedSlots(defense);
  if (slots.length !== SIMILARITY_HERO_COUNT) return false;

  return slots.every((slot) => (
    normalizeGvgChampionSimilarityKey(readLocalDefenseSlotChampion(slot)) &&
    readLocalDefenseSlotPosition(slot, mapType) &&
    readLocalDefenseSlotDirection(slot)
  ));
}

export function localDefenseLayoutMatchesEnemy(localDefense, enemyDefense) {
  if (!localDefenseHasCompleteLayout(localDefense)) return false;

  const localMapType = normalizeGvgMapType(localDefense?.type || localDefense?.map_type || localDefense?.mapType);
  const enemyDefinition = enemyDefense?.canonical_definition || enemyDefense?.canonicalDefinition || buildEnemyDefenseCanonicalDefinition(enemyDefense);
  const enemyMapType = normalizeGvgMapType(enemyDefense?.map_type || enemyDefense?.mapType || enemyDefinition?.map_type);
  if (localMapType !== enemyMapType) return false;

  const enemyLayouts = new Map(
    getEnemyDefenseHeroLayouts(enemyDefense).map((layout) => [layout.championKey, layout]),
  );
  const slots = getDefenseDetailedSlots(localDefense);

  if (enemyLayouts.size !== SIMILARITY_HERO_COUNT || slots.length !== SIMILARITY_HERO_COUNT) return false;

  return slots.every((slot) => {
    const championKey = normalizeGvgChampionSimilarityKey(readLocalDefenseSlotChampion(slot));
    const enemyLayout = championKey ? enemyLayouts.get(championKey) : null;
    if (!enemyLayout) return false;
    return (
      readLocalDefenseSlotPosition(slot, localMapType) === enemyLayout.position &&
      readLocalDefenseSlotDirection(slot) === enemyLayout.direction
    );
  });
}

export function isEnemyDefenseOpened(defense) {
  const status = String(defense?.record_status || defense?.recordStatus || "").trim().toLowerCase();
  return OPENED_RECORD_STATUSES.has(status);
}

export function getEnemyDefenseSuccessRate(opened, encounters) {
  const total = Number(encounters) || 0;
  if (total <= 0) return 0;
  return ((Number(opened) || 0) / total) * 100;
}

export function getEnemyDefenseRateTone(rate) {
  const value = Number(rate) || 0;
  if (value <= 20) return "solid";
  if (value <= 50) return "warning";
  if (value <= 80) return "danger";
  return "critical";
}

export function sortEnemyDefenseBankRows(rows = []) {
  return [...rows].sort((left, right) => {
    const leftRate = getEnemyDefenseSuccessRate(left.opened, left.encounters);
    const rightRate = getEnemyDefenseSuccessRate(right.opened, right.encounters);
    if (leftRate !== rightRate) return leftRate - rightRate;

    const leftEncounters = Number(left.encounters) || 0;
    const rightEncounters = Number(right.encounters) || 0;
    if (leftEncounters !== rightEncounters) return rightEncounters - leftEncounters;

    const leftSeen = left.last_seen_at ? new Date(left.last_seen_at).getTime() : 0;
    const rightSeen = right.last_seen_at ? new Date(right.last_seen_at).getTime() : 0;
    if (leftSeen !== rightSeen) return rightSeen - leftSeen;

    return String(left.defense_fingerprint || "").localeCompare(String(right.defense_fingerprint || ""));
  });
}

function earlierDate(left, right) {
  if (!left) return right || null;
  if (!right) return left || null;
  return new Date(left).getTime() <= new Date(right).getTime() ? left : right;
}

function laterDate(left, right) {
  if (!left) return right || null;
  if (!right) return left || null;
  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

export function aggregateEnemyDefenseOccurrences(defenses = []) {
  const grouped = new Map();
  let skippedAlly = 0;
  let skippedInvalid = 0;

  for (const defense of defenses || []) {
    if (defense?.is_ally === true) {
      skippedAlly += 1;
      continue;
    }

    const canonicalDefinition = buildEnemyDefenseCanonicalDefinition(defense);
    if (!canonicalDefinition) {
      skippedInvalid += 1;
      continue;
    }

    const fingerprint = sha256Hex(stableStringify(canonicalDefinition));
    const opened = isEnemyDefenseOpened(defense) ? 1 : 0;
    const seenAt = defense?.updated_at || defense?.created_at || new Date().toISOString();
    const existing = grouped.get(fingerprint);

    if (existing) {
      existing.encounters += 1;
      existing.opened += opened;
      existing.first_seen_at = earlierDate(existing.first_seen_at, seenAt);
      existing.last_seen_at = laterDate(existing.last_seen_at, seenAt);
      existing.source_defense_ids.push(defense.id);
      if (!existing.source_image_url && defense?.image_url) existing.source_image_url = defense.image_url;
      continue;
    }

    grouped.set(fingerprint, {
      defense_fingerprint: fingerprint,
      canonical_definition: canonicalDefinition,
      map_type: canonicalDefinition.map_type,
      heroes_count: canonicalDefinition.heroes.length,
      source_image_url: defense?.image_url || null,
      source_defense_ids: [defense.id],
      encounters: 1,
      opened,
      first_seen_at: seenAt,
      last_seen_at: seenAt,
    });
  }

  return {
    entries: [...grouped.values()],
    skippedAlly,
    skippedInvalid,
    occurrences: (defenses || []).length - skippedAlly - skippedInvalid,
  };
}

export function buildSourceGvgKey(guild, defenses = []) {
  const defenseIds = (defenses || [])
    .filter((defense) => defense?.is_ally !== true)
    .map((defense) => String(defense?.id || ""))
    .filter(Boolean)
    .sort();

  return sha256Hex(
    stableStringify({
      version: 1,
      guild: normalizeGvgGuildCode(guild),
      defense_ids: defenseIds,
    }),
  );
}

function getStorageExtension(storagePath) {
  const match = String(storagePath || "").match(/\.([a-z0-9]+)(?:\?.*)?$/i);
  const extension = match?.[1]?.toLowerCase();
  if (extension === "webp") return "webp";
  return "webp";
}

export function getPermanentEnemyDefenseImagePath(fingerprint, sourceStoragePath = "") {
  return `${GVG_ENEMY_DEFENSE_IMAGE_PREFIX}/${fingerprint}.${getStorageExtension(sourceStoragePath)}`;
}

export function getGvgServerConfig() {
  const serverUrl = String(
    process.env.GVG_SERVER_URL ||
      process.env.GVG_VPS_URL ||
      DEFAULT_GVG_SERVER_URL,
  ).replace(/\/$/, "");
  const token = process.env.GVG_API_TOKEN || process.env.GVG_SERVER_TOKEN || "";

  return { serverUrl, token };
}

export function getGvgPublicRootUrl() {
  const raw = String(
    process.env.GVG_PUBLIC_ASSETS_BASE_URL ||
      process.env.VPS_PUBLIC_ASSETS_BASE_URL ||
      process.env.VITE_GVG_PUBLIC_ASSETS_BASE_URL ||
      process.env.VITE_ASSETS_BASE_URL ||
      DEFAULT_GVG_PUBLIC_ROOT_URL,
  ).trim();

  if (!raw || /^(0|false|off|disabled)$/i.test(raw)) return DEFAULT_GVG_PUBLIC_ROOT_URL;

  const withoutTrailingSlash = raw.replace(/\/+$/, "");
  return withoutTrailingSlash.replace(/\/assets$/i, "");
}

function encodeUrlPath(path) {
  return String(path || "")
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

export function getPermanentEnemyDefenseImageUrl(imageStoragePath) {
  const cleanedPath = String(imageStoragePath || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/^assets\//i, "");
  if (!cleanedPath) return "";
  return `${getGvgPublicRootUrl()}/assets/${encodeUrlPath(cleanedPath)}`;
}

function getAllowedVpsOrigins() {
  return [
    getGvgPublicRootUrl(),
    DEFAULT_GVG_PUBLIC_ROOT_URL,
    getGvgServerConfig().serverUrl,
  ]
    .map((value) => {
      try {
        return new URL(value).origin;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function normalizeVpsPreviewSourcePath(pathname) {
  let decodedPath = "";
  try {
    decodedPath = decodeURIComponent(String(pathname || "").trim()).replace(/\\/g, "/");
  } catch {
    return null;
  }
  const match = /^\/?public\/jobs\/([^/]+)\/([^/]+)\/previews\/([^/]+\.webp)$/i.exec(decodedPath);
  if (!match) return null;

  const [, guild, jobId, file] = match;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(guild)) return null;
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(jobId)) return null;
  if (!/^[A-Za-z0-9._-]{1,180}\.webp$/i.test(file)) return null;

  return `/public/jobs/${guild}/${jobId}/previews/${file}`;
}

function extractPreviewSourceFromGvgServerProxy(parsed) {
  const action = parsed.searchParams.get("action");
  if (action !== "preview") return null;

  const guild = parsed.searchParams.get("guild") || parsed.searchParams.get("sourceGuild");
  const jobId = parsed.searchParams.get("jobId") || parsed.searchParams.get("job_id");
  const file = parsed.searchParams.get("file");

  if (!guild || !jobId || !file) return null;
  return normalizeVpsPreviewSourcePath(`/public/jobs/${guild}/${jobId}/previews/${file}`);
}

function extractPreviewSourceFromApiRoute(pathname) {
  let decodedPath = "";
  try {
    decodedPath = decodeURIComponent(String(pathname || "").trim()).replace(/\\/g, "/");
  } catch {
    return null;
  }
  const match = /^\/api\/v1\/jobs\/([^/]+)\/([^/]+)\/preview\/([^/]+\.webp)$/i.exec(decodedPath);
  if (!match) return null;
  return normalizeVpsPreviewSourcePath(`/public/jobs/${match[1]}/${match[2]}/previews/${match[3]}`);
}

export function extractGvgVpsPreviewSourcePath(url) {
  const raw = String(url || "").trim();
  if (!raw) return null;

  const relativeSource = normalizeVpsPreviewSourcePath(raw);
  if (relativeSource) return relativeSource;

  try {
    const parsed = new URL(raw, "https://portal.local");
    if (parsed.origin === "https://portal.local" && parsed.pathname === "/api/gvg-server") {
      return extractPreviewSourceFromGvgServerProxy(parsed);
    }

    const allowedOrigins = new Set(getAllowedVpsOrigins());
    if (!allowedOrigins.has(parsed.origin)) return null;

    return (
      normalizeVpsPreviewSourcePath(parsed.pathname) ||
      extractPreviewSourceFromApiRoute(parsed.pathname)
    );
  } catch {
    return null;
  }
}

export function isPermanentEnemyDefenseImagePath(imageStoragePath, fingerprint = "") {
  const cleanPath = String(imageStoragePath || "").trim().replace(/^\/+/, "").replace(/^assets\//i, "");
  const expectedFingerprint = String(fingerprint || "").trim().toLowerCase();
  const match = /^enemy-defense-bank\/([0-9a-f]{64})\.webp$/i.exec(cleanPath);
  if (!match) return false;
  return !expectedFingerprint || match[1].toLowerCase() === expectedFingerprint;
}

export function isPermanentEnemyDefenseImageUrl(imageUrl, fingerprint = "") {
  if (!imageUrl) return false;

  try {
    const parsed = new URL(String(imageUrl));
    if (!getAllowedVpsOrigins().includes(parsed.origin)) return false;
    const path = decodeURIComponent(parsed.pathname || "").replace(/^\/+/, "");
    const expectedPath = getPermanentEnemyDefenseImagePath(String(fingerprint || "").toLowerCase(), "webp");
    return path === `assets/${expectedPath}`;
  } catch {
    return false;
  }
}

export function isEnemyDefenseBankSchemaMissing(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "42883" ||
    error?.code === "PGRST202" ||
    error?.code === "PGRST205" ||
    message.includes("gvg_enemy_defenses") ||
    message.includes("gvg_enemy_defense_guild_stats") ||
    message.includes("gvg_enemy_defense_processed_resets") ||
    message.includes("archive_gvg_enemy_defense_bank")
  );
}

function mentionsMissingLinksColumn(message, tableName, columnName) {
  const column = String(columnName || "").toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const table = String(tableName || "").toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    new RegExp(`\\b${table}\\b[^.]{0,160}\\b${column}\\b`, "i").test(message) ||
    new RegExp(`\\b${column}\\b[^.]{0,160}\\b${table}\\b`, "i").test(message) ||
    message.includes(`${tableName}.${columnName}`) ||
    message.includes(`"${tableName}"."${columnName}"`) ||
    message.includes(`'${tableName}'.'${columnName}'`)
  );
}

function hasMissingSchemaText(message) {
  return (
    message.includes("does not exist") ||
    message.includes("doesn't exist") ||
    message.includes("could not find") ||
    message.includes("not found") ||
    message.includes("schema cache")
  );
}

export function isEnemyDefenseLinksSchemaMissing(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  const code = String(error?.code || "");
  const missingSchemaText = hasMissingSchemaText(message);
  const missingTable = ["42P01", "PGRST205"].includes(code) && missingSchemaText;
  const missingFunction = ["42883", "PGRST202"].includes(code) && missingSchemaText;
  const missingColumn = ["42703", "PGRST204"].includes(code) && missingSchemaText;

  return (
    (missingTable && (
      message.includes("gvg_enemy_defense_similarity_reviews") ||
      message.includes("gvg_enemy_defense_strat_availability")
    )) ||
    (missingFunction && message.includes("gvg_enemy_defense_links_touch_updated_at")) ||
    (missingColumn && (
      mentionsMissingLinksColumn(message, "guild_defenses", "source_enemy_defense_id") ||
      mentionsMissingLinksColumn(message, "guild_defenses", "source_enemy_defense_fingerprint") ||
      mentionsMissingLinksColumn(message, "guild_defenses", "source_enemy_portal_guild_id") ||
      mentionsMissingLinksColumn(message, "guild_defenses", "source_enemy_label") ||
      mentionsMissingLinksColumn(message, "guild_defenses", "source_enemy_imported_at") ||
      mentionsMissingLinksColumn(message, "guild_defense_slots", "position") ||
      mentionsMissingLinksColumn(message, "guild_defense_slots", "direction")
    ))
  );
}

function markEnemySimilarityError(error, stage, context = {}) {
  if (error && typeof error === "object") {
    error.enemySimilarityStage = error.enemySimilarityStage || stage;
    error.enemySimilarityContext = {
      ...(error.enemySimilarityContext || {}),
      ...context,
    };
  }
  return error;
}

export function serializeEnemySimilarityError(error) {
  return {
    stage: error?.enemySimilarityStage || null,
    code: error?.code || null,
    message: error?.message || String(error || ""),
    details: error?.details || null,
    hint: error?.hint || null,
    context: error?.enemySimilarityContext || null,
  };
}

export function createBankNotInitializedError() {
  const error = new Error(GVG_ENEMY_DEFENSE_BANK_MESSAGE);
  error.statusCode = 428;
  return error;
}

function createSupabaseArchiveError(error) {
  if (error instanceof Error) return error;

  const wrapped = new Error(error?.message || "Archivage banque de defenses adverses impossible.");
  wrapped.statusCode = error?.statusCode || 500;
  wrapped.code = error?.code;
  wrapped.details = error?.details;
  wrapped.hint = error?.hint;
  wrapped.data = error;
  return wrapped;
}

export async function resolvePortalGuildForGvgGuild(supabase, gvgGuild) {
  const technicalGuild = normalizeGvgGuildCode(gvgGuild);
  if (!technicalGuild) {
    const error = new Error("Guilde GvG invalide.");
    error.statusCode = 400;
    throw error;
  }

  const { data, error } = await supabase
    .from("portal_guilds")
    .select("id, organization_id, guild_code, display_name, is_active")
    .eq("is_active", true);

  if (error) throw error;

  const portalGuild = (data || []).find((row) => normalizeGvgGuildCode(row.guild_code) === technicalGuild);
  if (!portalGuild?.id || !portalGuild.organization_id) {
    const missing = new Error(`Guilde Portal introuvable pour ${technicalGuild}.`);
    missing.statusCode = 428;
    throw missing;
  }

  return {
    id: portalGuild.id,
    organization_id: portalGuild.organization_id,
    guild_code: normalizeGuildCode(portalGuild.guild_code),
    display_name: portalGuild.display_name || portalGuild.guild_code,
    technical_guild: technicalGuild,
  };
}

export function normalizePortalGuildLookupKey(value) {
  return normalizeGvgGuildCode(value || normalizeGuildCodeKey(value));
}

async function loadPortalGuildsByOrganization(supabase, organizationId) {
  const { data, error } = await supabase
    .from("portal_guilds")
    .select("id, guild_code, display_name, organization_id, is_active")
    .eq("organization_id", organizationId)
    .eq("is_active", true);

  if (error) throw error;

  return data || [];
}

async function loadLocalDefenseSimilarityRows(supabase, organizationId) {
  const { data, error } = await supabase
    .from("guild_defenses")
    .select(`
      id,
      name,
      type,
      guild_code,
      organization_id,
      is_hidden,
      image_url,
      source_defense_id,
      source_guild_code,
      source_defense_name,
      source_enemy_defense_id,
      source_enemy_defense_fingerprint,
      guild_defense_slots (
        slot_index,
        champion_id,
        position,
        direction,
        champions (
          id,
          name,
          portal_name,
          english_name
        )
      )
    `)
    .eq("organization_id", organizationId)
    .or("is_hidden.is.null,is_hidden.eq.false")
    .limit(5000);

  if (error) {
    traceEnemySimilarityError("local_similarity_rows_select_error", error, { organization_id: organizationId || null });
    throw markEnemySimilarityError(error, "local_similarity_rows_select", {
      organization_id: organizationId || null,
    });
  }

  const rows = data || [];
  const importantRows = rows.filter(isTraceImportantLocalDefense);
  if (importantRows.length) {
    traceEnemySimilarity("local_similarity_rows_loaded", {
      organization_id: organizationId || null,
      rows: rows.length,
      important_rows: traceSample(importantRows, summarizeLocalDefenseForTrace, 12),
    });
  }

  return rows;
}

function getDefenseSourceId(defense) {
  return defense?.source_defense_id || defense?.sourceDefenseId || null;
}

function getDefenseId(defense) {
  return defense?.id ? String(defense.id) : "";
}

function resolveRootDefenseId(defenseId, defensesById) {
  let currentId = String(defenseId || "");
  const visited = new Set();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const current = defensesById.get(currentId);
    const sourceId = current ? getDefenseSourceId(current) : null;
    if (!sourceId) return currentId;
    currentId = String(sourceId);
  }

  return String(defenseId || "");
}

function getLineageDefenseIds(rootDefenseId, localRows = []) {
  const rowsById = new Map(localRows.map((row) => [getDefenseId(row), row]).filter(([id]) => id));
  return localRows
    .filter((row) => resolveRootDefenseId(row.id, rowsById) === String(rootDefenseId))
    .map((row) => String(row.id))
    .filter(Boolean);
}

function getPortalGuildIdForDefense(defense, portalGuildByKey = new Map()) {
  const guild = portalGuildByKey.get(normalizePortalGuildLookupKey(defense?.guild_code));
  return guild?.id || null;
}

function buildEnemyLinkPayload(enemyDefense, sourcePortalGuild) {
  const sourceGuildCode = sourcePortalGuild?.guild_code || sourcePortalGuild?.technical_guild || "";
  return {
    source_enemy_defense_id: enemyDefense.id,
    source_enemy_defense_fingerprint: enemyDefense.defense_fingerprint || "",
    source_enemy_portal_guild_id: sourcePortalGuild?.id || null,
    source_enemy_label: `Defense adverse ${sourceGuildCode}`.trim(),
    source_enemy_imported_at: new Date().toISOString(),
  };
}

function buildSlotLayoutUpdatesForDefense(localDefense, enemyDefense) {
  const mapType = normalizeGvgMapType(localDefense?.type || localDefense?.map_type || localDefense?.mapType);
  const layoutByChampion = getEnemyDefenseHeroLayoutByChampion(enemyDefense);

  return (localDefense?.guild_defense_slots || [])
    .map((slot) => {
      const championKey = normalizeGvgChampionSimilarityKey(readLocalDefenseSlotChampion(slot));
      const layout = championKey ? layoutByChampion.get(championKey) : null;
      if (!layout) return null;

      const nextPosition = normalizeGvgPosition(layout.position, mapType);
      const nextDirection = normalizeGvgDirection(layout.direction);
      if (!nextPosition || !nextDirection) return null;

      return {
        slotIndex: slot.slot_index,
        position: nextPosition,
        direction: nextDirection,
      };
    })
    .filter((slot) => slot?.slotIndex !== null && slot?.slotIndex !== undefined);
}

function buildLocalDefenseWithEnemyLayout(localDefense, enemyDefense) {
  const updatesBySlot = new Map(
    buildSlotLayoutUpdatesForDefense(localDefense, enemyDefense).map((slot) => [slot.slotIndex, slot]),
  );

  return {
    ...localDefense,
    guild_defense_slots: (localDefense?.guild_defense_slots || []).map((slot) => {
      const update = updatesBySlot.get(slot.slot_index);
      if (!update) return slot;
      return {
        ...slot,
        position: update.position,
        direction: update.direction,
      };
    }),
  };
}

async function applyEnemyLayoutToDefenseRows(supabase, defenseRows = [], enemyDefense, sourcePortalGuild) {
  const updatedIds = [];
  const skipped = [];
  const enemySignature = createEnemyDefenseSimilaritySignature(enemyDefense);
  const linkPayload = buildEnemyLinkPayload(enemyDefense, sourcePortalGuild);

  for (const defense of defenseRows) {
    const localSignature = createLocalDefenseSimilaritySignature(defense);
    if (!localSignature || localSignature !== enemySignature) {
      skipped.push({ id: defense.id, name: defense.name || "", reason: "diverged" });
      continue;
    }

    const slotUpdates = buildSlotLayoutUpdatesForDefense(defense, enemyDefense);
    if (slotUpdates.length !== SIMILARITY_HERO_COUNT) {
      skipped.push({ id: defense.id, name: defense.name || "", reason: "incomplete_layout_target" });
      continue;
    }

    const updateResults = await Promise.all(
      slotUpdates.map((slot) =>
        supabase
          .from("guild_defense_slots")
          .update({
            position: slot.position,
            direction: slot.direction,
          })
          .eq("defense_id", defense.id)
          .eq("slot_index", slot.slotIndex),
      ),
    );

    const slotError = updateResults.find((result) => result.error)?.error;
    if (slotError) throw slotError;
    updatedIds.push(String(defense.id));
  }

  if (updatedIds.length) {
    const { error } = await supabase
      .from("guild_defenses")
      .update(linkPayload)
      .in("id", updatedIds);
    if (error) throw error;
  }

  return { updatedIds, skipped };
}

async function upsertIdenticalReviewsForDefenses(supabase, defenseRows = [], enemyDefense, organizationId, portalGuildByKey, reviewer = {}) {
  if (!defenseRows.length) return { upserted: 0 };

  const enemySignature = createEnemyDefenseSimilaritySignature(enemyDefense);
  const rows = defenseRows
    .map((defense) => {
      const localSignature = createLocalDefenseReviewSignature(defense) || createLocalDefenseSimilaritySignature(defense);
      if (!localSignature) return null;

      return {
        enemy_defense_id: enemyDefense.id,
        local_defense_id: defense.id,
        organization_id: organizationId,
        local_portal_guild_id: getPortalGuildIdForDefense(defense, portalGuildByKey),
        local_guild_code: defense.guild_code || "",
        status: "identical",
        reviewed_by_member_id: reviewer.memberId || null,
        reviewed_by_name: reviewer.name || "Auto-match layout complet",
        reviewed_at: new Date().toISOString(),
        enemy_identity_signature: enemySignature,
        local_identity_signature: localSignature,
        updated_at: new Date().toISOString(),
      };
    })
    .filter(Boolean);

  if (!rows.length) return { upserted: 0 };

  const { error } = await supabase
    .from("gvg_enemy_defense_similarity_reviews")
    .upsert(rows, { onConflict: "enemy_defense_id,local_defense_id" });
  if (error) throw error;

  return { upserted: rows.length };
}

export async function enrichEnemyDefenseCompatibleLineage(
  supabase,
  { organizationId, localDefenseId, enemyDefense, sourcePortalGuild = null, reviewer = {} } = {},
) {
  if (!organizationId || !localDefenseId || !enemyDefense?.id) {
    return { updatedIds: [], skipped: [], rootDefenseId: null, identicalReviewsUpserted: 0 };
  }

  const [portalGuildRows, localRows] = await Promise.all([
    loadPortalGuildsByOrganization(supabase, organizationId),
    loadLocalDefenseSimilarityRows(supabase, organizationId),
  ]);
  const localRowsById = new Map(localRows.map((row) => [String(row.id), row]));
  const localDefense = localRowsById.get(String(localDefenseId));
  if (!localDefense) {
    return { updatedIds: [], skipped: [{ id: localDefenseId, reason: "local_missing" }], rootDefenseId: null, identicalReviewsUpserted: 0 };
  }

  const rootDefenseId = resolveRootDefenseId(localDefense.id, localRowsById);
  const lineageIds = new Set(getLineageDefenseIds(rootDefenseId, localRows));
  const lineageRows = localRows.filter((row) => lineageIds.has(String(row.id)));
  const { updatedIds, skipped } = await applyEnemyLayoutToDefenseRows(supabase, lineageRows, enemyDefense, sourcePortalGuild);
  const updatedRows = lineageRows
    .filter((row) => updatedIds.includes(String(row.id)))
    .map((row) => buildLocalDefenseWithEnemyLayout(row, enemyDefense));
  const portalGuildByKey = new Map(
    portalGuildRows.map((guild) => [normalizePortalGuildLookupKey(guild.guild_code), guild]),
  );
  const reviewResult = await upsertIdenticalReviewsForDefenses(
    supabase,
    updatedRows,
    enemyDefense,
    organizationId,
    portalGuildByKey,
    reviewer,
  );

  return {
    updatedIds,
    skipped,
    rootDefenseId,
    identicalReviewsUpserted: reviewResult.upserted,
  };
}

export async function detectEnemyDefenseSimilaritiesForArchive(
  supabase,
  {
    organizationId,
    enemyDefenses = [],
    sourcePortalGuild = null,
    localDefenseIds = [],
    applyAutoIdenticalLineage = true,
  } = {},
) {
  const localDefenseIdFilter = new Set((localDefenseIds || []).map(String).filter(Boolean));
  const enemies = (enemyDefenses || [])
    .filter((defense) => defense?.id)
    .map((defense) => ({
      ...defense,
      similarity_signature: createEnemyDefenseSimilaritySignature(defense),
    }))
    .filter((defense) => defense.similarity_signature);

  traceEnemySimilarity("detect_start", {
    organization_id: organizationId || null,
    source_portal_guild_id: sourcePortalGuild?.id || null,
    source_portal_guild_code: sourcePortalGuild?.guild_code || null,
    input_enemy_defenses: (enemyDefenses || []).length,
    signed_enemy_defenses: enemies.length,
    local_defense_ids: traceSample([...localDefenseIdFilter]),
    apply_auto_identical_lineage: Boolean(applyAutoIdenticalLineage),
    signed_enemy_sample: traceSample(enemies, summarizeEnemyDefenseForTrace, 12),
  });

  if (!organizationId || !enemies.length) {
    traceEnemySimilarity("detect_skipped", {
      reason: !organizationId ? "missing_organization" : "no_enemy_defenses",
      organization_id: organizationId || null,
      input_enemy_defenses: (enemyDefenses || []).length,
      signed_enemy_defenses: enemies.length,
    });

    return {
      ok: true,
      skipped: true,
      reason: !organizationId ? "missing_organization" : "no_enemy_defenses",
      pendingCreated: 0,
      pendingUpdated: 0,
      autoIdenticalCreated: 0,
      autoIdenticalUpdated: 0,
      candidatesScanned: 0,
    };
  }

  const [portalGuildRows, localRows] = await Promise.all([
    loadPortalGuildsByOrganization(supabase, organizationId),
    loadLocalDefenseSimilarityRows(supabase, organizationId),
  ]);
  const portalGuildByKey = new Map(
    portalGuildRows.map((guild) => [normalizePortalGuildLookupKey(guild.guild_code), guild]),
  );
  const enemiesBySignature = new Map();

  for (const enemy of enemies) {
    if (!enemiesBySignature.has(enemy.similarity_signature)) enemiesBySignature.set(enemy.similarity_signature, []);
    enemiesBySignature.get(enemy.similarity_signature).push(enemy);
  }

  const scopedLocalRows = localDefenseIdFilter.size
    ? localRows.filter((defense) => localDefenseIdFilter.has(String(defense.id)))
    : localRows;
  const localRowsWithSignatures = scopedLocalRows
    .map((defense) => ({
      ...defense,
      similarity_signature: createLocalDefenseSimilaritySignature(defense),
    }));
  const localCandidates = localRowsWithSignatures
    .filter((defense) => defense.similarity_signature && enemiesBySignature.has(defense.similarity_signature));
  const importantLocalRows = localRowsWithSignatures.filter(isTraceImportantLocalDefense);

  traceEnemySimilarity("detect_loaded_scope", {
    organization_id: organizationId || null,
    portal_guilds: traceSample(portalGuildRows, (guild) => ({
      id: guild.id,
      guild_code: guild.guild_code,
      display_name: guild.display_name,
      lookup_key: normalizePortalGuildLookupKey(guild.guild_code),
    }), 20),
    local_rows: localRows.length,
    scoped_local_rows: scopedLocalRows.length,
    local_defense_ids: traceSample([...localDefenseIdFilter]),
    enemy_signature_count: enemiesBySignature.size,
    enemy_signatures: Array.from(enemiesBySignature.entries()).slice(0, 12).map(([signature, rows]) => ({
      signature: shortTraceHash(signature),
      enemies: rows.map((enemy) => summarizeEnemyDefenseForTrace(enemy)),
    })),
    important_local_rows: traceSample(importantLocalRows, (defense) => summarizeLocalDefenseForTrace(defense, {
      local_signature_present: Boolean(defense.similarity_signature),
      matches_enemy_signature: Boolean(defense.similarity_signature && enemiesBySignature.has(defense.similarity_signature)),
    }), 20),
    local_candidates: traceSample(localCandidates, summarizeLocalDefenseForTrace, 12),
  });

  if (!localCandidates.length) {
    traceEnemySimilarity("detect_no_candidates", {
      organization_id: organizationId || null,
      signed_enemy_defenses: enemies.length,
      enemy_signature_count: enemiesBySignature.size,
      important_local_rows: traceSample(importantLocalRows, (defense) => summarizeLocalDefenseForTrace(defense, {
        local_signature_present: Boolean(defense.similarity_signature),
        matches_enemy_signature: Boolean(defense.similarity_signature && enemiesBySignature.has(defense.similarity_signature)),
      }), 20),
    });

    return {
      ok: true,
      pendingCreated: 0,
      pendingUpdated: 0,
      autoIdenticalCreated: 0,
      autoIdenticalUpdated: 0,
      candidatesScanned: 0,
    };
  }

  const enemyIds = enemies.map((enemy) => enemy.id);
  const localIds = localCandidates.map((defense) => defense.id).filter(Boolean);
  traceEnemySimilarity("detect_existing_reviews_select_start", {
    organization_id: organizationId || null,
    enemy_ids: traceSample(enemyIds),
    local_ids: traceSample(localIds),
  });

  const { data: existingRows, error: existingError } = await supabase
    .from("gvg_enemy_defense_similarity_reviews")
    .select("id, enemy_defense_id, local_defense_id, organization_id, local_portal_guild_id, local_guild_code, status, enemy_identity_signature, local_identity_signature")
    .in("enemy_defense_id", enemyIds)
    .in("local_defense_id", localIds);

  if (existingError) {
    traceEnemySimilarityError("detect_existing_reviews_select_error", existingError, {
      organization_id: organizationId || null,
      enemy_ids: traceSample(enemyIds),
      local_ids: traceSample(localIds),
    });
    throw markEnemySimilarityError(existingError, "detect_existing_reviews_select", {
      organization_id: organizationId || null,
      enemy_ids: traceSample(enemyIds),
      local_ids: traceSample(localIds),
    });
  }

  traceEnemySimilarity("detect_existing_reviews_select_done", {
    organization_id: organizationId || null,
    existing_reviews: traceSample(existingRows || [], summarizeReviewForTrace, 20),
  });

  const existingByPair = new Map(
    (existingRows || []).map((row) => [`${row.enemy_defense_id}:${row.local_defense_id}`, row]),
  );
  const rowsToUpsert = [];
  const autoIdenticalPairs = [];
  const pairTrace = [];
  let pendingCreated = 0;
  let pendingUpdated = 0;
  let autoIdenticalCreated = 0;
  let autoIdenticalUpdated = 0;

  for (const localDefense of localCandidates) {
    const matchingEnemies = enemiesBySignature.get(localDefense.similarity_signature) || [];
    const localGuild = portalGuildByKey.get(normalizePortalGuildLookupKey(localDefense.guild_code));
    const localReviewSignature = createLocalDefenseReviewSignature(localDefense) || localDefense.similarity_signature;

    for (const enemy of matchingEnemies) {
      const pairKey = `${enemy.id}:${localDefense.id}`;
      const existing = existingByPair.get(pairKey);
      const shouldAutoIdentify = localDefenseLayoutMatchesEnemy(localDefense, enemy);
      const nextStatus = shouldAutoIdentify ? "identical" : "pending";
      if (existing?.local_identity_signature === localReviewSignature) {
        if (existing.status === "different" || existing.status === nextStatus) {
          if (isTraceImportantLocalDefense(localDefense) || pairTrace.length < 12) {
            pairTrace.push({
              action: "skip_existing",
              pair: pairKey,
              existing_status: existing.status,
              next_status: nextStatus,
              should_auto_identify: shouldAutoIdentify,
              local: summarizeLocalDefenseForTrace(localDefense),
              enemy: summarizeEnemyDefenseForTrace(enemy),
              existing_review: summarizeReviewForTrace(existing),
            });
          }
          continue;
        }
      }

      const reviewRow = {
        enemy_defense_id: enemy.id,
        local_defense_id: localDefense.id,
        organization_id: organizationId,
        local_portal_guild_id: localGuild?.id || null,
        local_guild_code: localDefense.guild_code || localGuild?.guild_code || "",
        status: nextStatus,
        reviewed_by_member_id: null,
        reviewed_by_name: shouldAutoIdentify ? "Auto-match layout complet" : null,
        reviewed_at: shouldAutoIdentify ? new Date().toISOString() : null,
        enemy_identity_signature: enemy.similarity_signature,
        local_identity_signature: localReviewSignature,
        updated_at: new Date().toISOString(),
      };

      if (existing?.id) {
        reviewRow.id = existing.id;
      }

      rowsToUpsert.push(reviewRow);

      if (isTraceImportantLocalDefense(localDefense) || pairTrace.length < 12) {
        pairTrace.push({
          action: "upsert",
          pair: pairKey,
          existing_status: existing?.status || null,
          next_status: nextStatus,
          should_auto_identify: shouldAutoIdentify,
          local_review_signature: shortTraceHash(localReviewSignature),
          local: summarizeLocalDefenseForTrace(localDefense),
          enemy: summarizeEnemyDefenseForTrace(enemy),
          existing_review: existing ? summarizeReviewForTrace(existing) : null,
        });
      }

      if (shouldAutoIdentify) {
        autoIdenticalPairs.push({ localDefense, enemy });
        if (existing) autoIdenticalUpdated += 1;
        else autoIdenticalCreated += 1;
      } else if (existing) {
        pendingUpdated += 1;
      } else {
        pendingCreated += 1;
      }
    }
  }

  traceEnemySimilarity("detect_pairs_built", {
    organization_id: organizationId || null,
    rows_to_upsert: rowsToUpsert.length,
    pending_created: pendingCreated,
    pending_updated: pendingUpdated,
    auto_identical_created: autoIdenticalCreated,
    auto_identical_updated: autoIdenticalUpdated,
    pair_trace: pairTrace,
    upsert_rows: traceSample(rowsToUpsert, summarizeReviewForTrace, 20),
  });

  if (rowsToUpsert.length) {
    traceEnemySimilarity("detect_upsert_start", {
      organization_id: organizationId || null,
      rows_to_upsert: rowsToUpsert.length,
      upsert_rows: traceSample(rowsToUpsert, summarizeReviewForTrace, 20),
    });

    const { error: upsertError } = await supabase
      .from("gvg_enemy_defense_similarity_reviews")
      .upsert(rowsToUpsert, { onConflict: "enemy_defense_id,local_defense_id" });

    if (upsertError) {
      traceEnemySimilarityError("detect_upsert_error", upsertError, {
        organization_id: organizationId || null,
        rows_to_upsert: rowsToUpsert.length,
        upsert_rows: traceSample(rowsToUpsert, summarizeReviewForTrace, 20),
      });
      throw markEnemySimilarityError(upsertError, "detect_upsert", {
        organization_id: organizationId || null,
        rows_to_upsert: rowsToUpsert.length,
        upsert_rows: traceSample(rowsToUpsert, summarizeReviewForTrace, 20),
      });
    }

    traceEnemySimilarity("detect_upsert_done", {
      organization_id: organizationId || null,
      rows_upserted: rowsToUpsert.length,
    });
  } else {
    traceEnemySimilarity("detect_upsert_skipped", {
      organization_id: organizationId || null,
      reason: "no_rows_to_upsert",
    });
  }

  if (!applyAutoIdenticalLineage && autoIdenticalPairs.length) {
    traceEnemySimilarity("detect_auto_lineage_skipped", {
      organization_id: organizationId || null,
      reason: "disabled_for_recalculation",
      pairs: traceSample(autoIdenticalPairs, (pair) => ({
        local: summarizeLocalDefenseForTrace(pair.localDefense),
        enemy: summarizeEnemyDefenseForTrace(pair.enemy),
      }), 20),
    });
  }

  for (const pair of applyAutoIdenticalLineage ? autoIdenticalPairs : []) {
    traceEnemySimilarity("detect_auto_lineage_start", {
      organization_id: organizationId || null,
      local: summarizeLocalDefenseForTrace(pair.localDefense),
      enemy: summarizeEnemyDefenseForTrace(pair.enemy),
    });

    try {
      const lineageResult = await enrichEnemyDefenseCompatibleLineage(supabase, {
        organizationId,
        localDefenseId: pair.localDefense.id,
        enemyDefense: pair.enemy,
        sourcePortalGuild,
        reviewer: { name: "Auto-match layout complet" },
      });
      traceEnemySimilarity("detect_auto_lineage_done", {
        organization_id: organizationId || null,
        local_defense_id: pair.localDefense.id,
        enemy_defense_id: pair.enemy.id,
        result: lineageResult,
      });
    } catch (lineageError) {
      traceEnemySimilarityError("detect_auto_lineage_error", lineageError, {
        organization_id: organizationId || null,
        local: summarizeLocalDefenseForTrace(pair.localDefense),
        enemy: summarizeEnemyDefenseForTrace(pair.enemy),
      });
      throw markEnemySimilarityError(lineageError, "lineage", {
        organization_id: organizationId || null,
        local: summarizeLocalDefenseForTrace(pair.localDefense),
        enemy: summarizeEnemyDefenseForTrace(pair.enemy),
      });
    }
  }

  traceEnemySimilarity("detect_done", {
    organization_id: organizationId || null,
    pending_created: pendingCreated,
    pending_updated: pendingUpdated,
    auto_identical_created: autoIdenticalCreated,
    auto_identical_updated: autoIdenticalUpdated,
    candidates_scanned: rowsToUpsert.length,
  });

  return {
    ok: true,
    pendingCreated,
    pendingUpdated,
    autoIdenticalCreated,
    autoIdenticalUpdated,
    autoIdenticalLineageApplied: Boolean(applyAutoIdenticalLineage),
    autoIdenticalLineageSkipped: !applyAutoIdenticalLineage ? autoIdenticalPairs.length : 0,
    candidatesScanned: rowsToUpsert.length,
  };
}

export async function recalculateEnemyDefenseSimilarities(
  supabase,
  { organizationId, portalGuild = null, enemyDefenseId = "", localDefenseIds = [] } = {},
) {
  if (!organizationId) {
    return {
      ok: true,
      skipped: true,
      reason: "missing_organization",
      enemyDefensesScanned: 0,
      enemy_defenses_scanned: 0,
    };
  }

  let statsQuery = supabase
    .from("gvg_enemy_defense_guild_stats")
    .select("enemy_defense_id, organization_id, portal_guild_id, encounters, opened")
    .eq("organization_id", organizationId);

  if (portalGuild?.id) statsQuery = statsQuery.eq("portal_guild_id", portalGuild.id);
  if (enemyDefenseId) statsQuery = statsQuery.eq("enemy_defense_id", enemyDefenseId);

  const { data: statsRows, error: statsError } = await statsQuery;
  if (statsError) {
    throw markEnemySimilarityError(statsError, "recalculate_enemy_stats_select", {
      organization_id: organizationId || null,
      portal_guild_id: portalGuild?.id || null,
      enemy_defense_id: enemyDefenseId || null,
    });
  }

  const enemyIds = [...new Set((statsRows || []).map((row) => row.enemy_defense_id).filter(Boolean))];
  if (!enemyIds.length) {
    return {
      ok: true,
      skipped: true,
      reason: "no_enemy_defenses",
      enemyDefensesScanned: 0,
      enemy_defenses_scanned: 0,
    };
  }

  const { data: enemyRows, error: enemyError } = await supabase
    .from("gvg_enemy_defenses")
    .select("id, defense_fingerprint, canonical_definition, map_type")
    .in("id", enemyIds);

  if (enemyError) {
    throw markEnemySimilarityError(enemyError, "recalculate_enemy_defenses_select", {
      organization_id: organizationId || null,
      portal_guild_id: portalGuild?.id || null,
      enemy_ids: traceSample(enemyIds),
    });
  }

  const result = await detectEnemyDefenseSimilaritiesForArchive(supabase, {
    organizationId,
    enemyDefenses: enemyRows || [],
    sourcePortalGuild: portalGuild,
    localDefenseIds,
    applyAutoIdenticalLineage: false,
  });

  return {
    ...result,
    ok: result.ok !== false,
    enemyDefensesScanned: (enemyRows || []).length,
    enemy_defenses_scanned: (enemyRows || []).length,
    targetEnemyDefenseId: enemyDefenseId || null,
    target_enemy_defense_id: enemyDefenseId || null,
    targetLocalDefenseIds: localDefenseIds || [],
    target_local_defense_ids: localDefenseIds || [],
  };
}

export async function requestGvgVps(pathname, options = {}) {
  const { serverUrl, token } = getGvgServerConfig();

  if (!token) {
    const error = new Error("GVG_API_TOKEN manquant cote serveur");
    error.statusCode = 500;
    throw error;
  }

  const body = options.body !== undefined ? JSON.stringify(options.body) : undefined;
  const response = await fetch(new URL(pathname, `${serverUrl}/`).toString(), {
    method: options.method || "GET",
    headers: {
      "X-GVG-Token": token,
      "Content-Type": "application/json",
    },
    body,
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(data?.detail || data?.error || `Erreur VPS ${response.status}`);
    error.statusCode = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

export async function archiveEnemyDefenseImageOnVps({ sourcePath, fingerprint, extension = "webp" }, requestVps = requestGvgVps) {
  if (!sourcePath || !fingerprint) {
    const error = new Error("Image source ou fingerprint manquant.");
    error.statusCode = 500;
    throw error;
  }

  const data = await requestVps(GVG_ENEMY_DEFENSE_ARCHIVE_ENDPOINT, {
    method: "POST",
    body: {
      source_path: sourcePath,
      fingerprint,
      extension,
    },
  });

  const imageStoragePath =
    data?.image_storage_path ||
    data?.storage_path ||
    data?.permanent_path ||
    getPermanentEnemyDefenseImagePath(fingerprint, sourcePath);
  const imageUrl =
    data?.image_url ||
    data?.public_url ||
    data?.url ||
    getPermanentEnemyDefenseImageUrl(imageStoragePath);

  if (!imageUrl || !imageStoragePath) {
    const error = new Error(`Archive VPS incomplete pour la defense ${fingerprint}.`);
    error.statusCode = 502;
    error.data = data;
    throw error;
  }

  return {
    image_url: imageUrl,
    image_storage_path: imageStoragePath,
    copied: Boolean(data?.copied),
    already_exists: Boolean(data?.already_exists),
    size: data?.size ?? null,
    source_path: data?.source_path || sourcePath,
  };
}

export async function archiveEnemyDefensesBeforeGvgReset(supabase, { guild, defenses = [], archiveImageOnVps = archiveEnemyDefenseImageOnVps } = {}) {
  const enemyDefenses = (defenses || []).filter((defense) => defense?.is_ally !== true);

  traceEnemySimilarity("archive_start", {
    guild: guild || null,
    input_defenses: (defenses || []).length,
    enemy_defenses: enemyDefenses.length,
    enemy_input_sample: traceSample(enemyDefenses, (defense) => ({
      id: defense?.id || null,
      name: defense?.name || "",
      map_type: normalizeGvgMapType(defense?.type || defense?.map_type || defense?.mapType),
      heroes_count: Array.isArray(defense?.heroes) ? defense.heroes.length : 0,
      has_image_url: Boolean(defense?.image_url || defense?.imageUrl),
      fingerprint: shortTraceHash(createEnemyDefenseFingerprint(defense)),
      similarity_signature: shortTraceHash(createDefenseSimilaritySignature({
        mapType: defense?.type || defense?.map_type || defense?.mapType,
        heroes: Array.isArray(defense?.heroes) ? defense.heroes : [],
      })),
    }), 12),
  });

  if (!enemyDefenses.length) {
    traceEnemySimilarity("archive_skipped", {
      guild: guild || null,
      reason: "no_enemy_defenses",
    });

    return {
      skipped: true,
      reason: "no_enemy_defenses",
      occurrences: 0,
      unique_defenses: 0,
      images_archived: 0,
    };
  }

  let portalGuild;
  try {
    portalGuild = await resolvePortalGuildForGvgGuild(supabase, guild);
  } catch (resolveError) {
    traceEnemySimilarityError("archive_resolve_portal_guild_error", resolveError, { guild: guild || null });
    throw resolveError;
  }

  const sourceGvgKey = buildSourceGvgKey(guild, enemyDefenses);
  const aggregated = aggregateEnemyDefenseOccurrences(enemyDefenses);
  const fingerprints = aggregated.entries.map((entry) => entry.defense_fingerprint);

  traceEnemySimilarity("archive_aggregated", {
    guild: guild || null,
    portal_guild_id: portalGuild.id,
    portal_guild_code: portalGuild.guild_code,
    organization_id: portalGuild.organization_id,
    technical_guild: portalGuild.technical_guild,
    source_gvg_key: sourceGvgKey,
    occurrences: aggregated.occurrences,
    unique_entries: aggregated.entries.length,
    skipped_invalid: aggregated.skippedInvalid,
    skipped_ally: aggregated.skippedAlly,
    fingerprints: traceSample(fingerprints, shortTraceHash, 20),
    entries: traceSample(aggregated.entries, summarizeEnemyDefenseForTrace, 12),
  });

  if (!fingerprints.length) {
    traceEnemySimilarity("archive_skipped", {
      guild: guild || null,
      reason: "no_valid_enemy_defenses",
      skipped_invalid: aggregated.skippedInvalid,
      skipped_ally: aggregated.skippedAlly,
    });

    return {
      skipped: true,
      reason: "no_valid_enemy_defenses",
      occurrences: 0,
      unique_defenses: 0,
      skipped_invalid: aggregated.skippedInvalid,
      images_archived: 0,
    };
  }

  traceEnemySimilarity("archive_existing_enemy_rows_select_start", {
    guild: guild || null,
    fingerprints: traceSample(fingerprints, shortTraceHash, 20),
  });

  const { data: existingRows, error: existingError } = await supabase
    .from("gvg_enemy_defenses")
    .select("id, defense_fingerprint, image_url, image_storage_path")
    .in("defense_fingerprint", fingerprints);

  if (existingError) {
    traceEnemySimilarityError("archive_existing_enemy_rows_select_error", existingError, {
      guild: guild || null,
      fingerprints: traceSample(fingerprints, shortTraceHash, 20),
    });
    if (isEnemyDefenseBankSchemaMissing(existingError)) throw createBankNotInitializedError();
    throw existingError;
  }

  traceEnemySimilarity("archive_existing_enemy_rows_select_done", {
    guild: guild || null,
    existing_rows: traceSample(existingRows || [], (row) => ({
      id: row.id,
      fingerprint: shortTraceHash(row.defense_fingerprint),
      has_image_url: Boolean(row.image_url),
      has_image_storage_path: Boolean(row.image_storage_path),
    }), 20),
  });

  const existingByFingerprint = new Map(
    (existingRows || []).map((row) => [String(row.defense_fingerprint), row]),
  );

  let imagesArchived = 0;
  const archivePayload = [];

  for (const entry of aggregated.entries) {
    const existing = existingByFingerprint.get(entry.defense_fingerprint);
    const existingImageReady =
      existing &&
      isPermanentEnemyDefenseImagePath(existing.image_storage_path, entry.defense_fingerprint) &&
      isPermanentEnemyDefenseImageUrl(existing.image_url, entry.defense_fingerprint);
    let imageStoragePath = existingImageReady
      ? existing.image_storage_path
      : getPermanentEnemyDefenseImagePath(entry.defense_fingerprint, entry.source_image_url || "webp");
    let imageUrl = existingImageReady
      ? existing.image_url
      : getPermanentEnemyDefenseImageUrl(imageStoragePath);
    let imageArchived = false;

    if (!existingImageReady) {
      const sourcePath = extractGvgVpsPreviewSourcePath(entry.source_image_url);
      if (!sourcePath) {
        const error = new Error(`Image temporaire introuvable pour la defense ${entry.defense_fingerprint}.`);
        error.statusCode = 500;
        throw error;
      }

      const copyResult = await archiveImageOnVps({
        sourcePath,
        fingerprint: entry.defense_fingerprint,
        extension: getStorageExtension(sourcePath),
      });
      imageStoragePath = copyResult.image_storage_path || imageStoragePath;
      imageUrl = copyResult.image_url || imageUrl;
      imageArchived = Boolean(copyResult.copied);
      if (imageArchived) imagesArchived += 1;

      if (!imageUrl) {
        const error = new Error(`URL permanente introuvable pour la defense ${entry.defense_fingerprint}.`);
        error.statusCode = 500;
        throw error;
      }
    }

    archivePayload.push({
      defense_fingerprint: entry.defense_fingerprint,
      canonical_definition: entry.canonical_definition,
      map_type: entry.map_type,
      heroes_count: entry.heroes_count,
      image_url: imageUrl,
      image_storage_path: imageStoragePath,
      encounters: entry.encounters,
      opened: entry.opened,
      first_seen_at: entry.first_seen_at,
      last_seen_at: entry.last_seen_at,
      image_archived: imageArchived,
    });
  }

  traceEnemySimilarity("archive_payload_ready", {
    guild: guild || null,
    payload_rows: archivePayload.length,
    payload_sample: traceSample(archivePayload, summarizeEnemyDefenseForTrace, 12),
    images_archived: imagesArchived,
  });

  traceEnemySimilarity("archive_rpc_start", {
    guild: guild || null,
    portal_guild_id: portalGuild.id,
    organization_id: portalGuild.organization_id,
    source_gvg_key: sourceGvgKey,
    payload_rows: archivePayload.length,
  });

  const { data, error } = await supabase.rpc("archive_gvg_enemy_defense_bank", {
    p_portal_guild_id: portalGuild.id,
    p_source_gvg_key: sourceGvgKey,
    p_technical_guild: portalGuild.technical_guild,
    p_defenses: archivePayload,
  });

  if (error) {
    traceEnemySimilarityError("archive_rpc_error", error, {
      guild: guild || null,
      portal_guild_id: portalGuild.id,
      organization_id: portalGuild.organization_id,
      source_gvg_key: sourceGvgKey,
      payload_rows: archivePayload.length,
    });
    if (isEnemyDefenseBankSchemaMissing(error)) throw createBankNotInitializedError();
    throw createSupabaseArchiveError(error);
  }

  traceEnemySimilarity("archive_rpc_done", {
    guild: guild || null,
    portal_guild_id: portalGuild.id,
    organization_id: portalGuild.organization_id,
    source_gvg_key: sourceGvgKey,
    result: data || null,
  });

  let similarityDetection = {
    ok: true,
    skipped: true,
    reason: "not_run",
  };

  try {
    traceEnemySimilarity("archive_post_reset_enemy_rows_select_start", {
      guild: guild || null,
      organization_id: portalGuild.organization_id,
      fingerprints: traceSample(fingerprints, shortTraceHash, 20),
    });

    const { data: archivedDefenseRows, error: archivedDefenseError } = await supabase
      .from("gvg_enemy_defenses")
      .select("id, defense_fingerprint, canonical_definition, map_type")
      .in("defense_fingerprint", fingerprints);

    if (archivedDefenseError) {
      traceEnemySimilarityError("archive_post_reset_enemy_rows_select_error", archivedDefenseError, {
        guild: guild || null,
        organization_id: portalGuild.organization_id,
        fingerprints: traceSample(fingerprints, shortTraceHash, 20),
      });
      throw archivedDefenseError;
    }

    traceEnemySimilarity("archive_post_reset_enemy_rows_select_done", {
      guild: guild || null,
      organization_id: portalGuild.organization_id,
      archived_rows: traceSample(archivedDefenseRows || [], summarizeEnemyDefenseForTrace, 20),
    });

    similarityDetection = await detectEnemyDefenseSimilaritiesForArchive(supabase, {
      organizationId: portalGuild.organization_id,
      enemyDefenses: archivedDefenseRows || [],
      sourcePortalGuild: portalGuild,
    });

    traceEnemySimilarity("archive_similarity_detection_done", {
      guild: guild || null,
      organization_id: portalGuild.organization_id,
      result: similarityDetection,
    });
  } catch (postProcessError) {
    traceEnemySimilarityError("archive_similarity_detection_error", postProcessError, {
      guild: guild || null,
      organization_id: portalGuild.organization_id,
    });
    similarityDetection = isEnemyDefenseLinksSchemaMissing(postProcessError)
      ? {
          ok: false,
          skipped: true,
          migrationRequired: true,
          reason: "enemy_links_schema_missing",
        }
      : {
          ok: false,
          skipped: true,
          reason: "post_process_failed",
          error: postProcessError?.message || "Post-traitement defenses adverses impossible.",
        };
  }

  return {
    ...(data || {}),
    portal_guild_id: portalGuild.id,
    portal_guild_code: portalGuild.guild_code,
    technical_guild: portalGuild.technical_guild,
    source_gvg_key: sourceGvgKey,
    occurrences: aggregated.occurrences,
    unique_defenses: archivePayload.length,
    images_archived: imagesArchived,
    skipped_invalid: aggregated.skippedInvalid,
    skipped_ally: aggregated.skippedAlly,
    similarity_detection: similarityDetection,
  };
}
