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

export function normalizeGvgMapType(mapType) {
  const value = String(mapType || "").trim().toLowerCase();
  if (value === "fortress" || value === "bastion") return "fortress";
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

  if (!enemyDefenses.length) {
    return {
      skipped: true,
      reason: "no_enemy_defenses",
      occurrences: 0,
      unique_defenses: 0,
      images_archived: 0,
    };
  }

  const portalGuild = await resolvePortalGuildForGvgGuild(supabase, guild);
  const sourceGvgKey = buildSourceGvgKey(guild, enemyDefenses);
  const aggregated = aggregateEnemyDefenseOccurrences(enemyDefenses);
  const fingerprints = aggregated.entries.map((entry) => entry.defense_fingerprint);

  if (!fingerprints.length) {
    return {
      skipped: true,
      reason: "no_valid_enemy_defenses",
      occurrences: 0,
      unique_defenses: 0,
      skipped_invalid: aggregated.skippedInvalid,
      images_archived: 0,
    };
  }

  const { data: existingRows, error: existingError } = await supabase
    .from("gvg_enemy_defenses")
    .select("id, defense_fingerprint, image_url, image_storage_path")
    .in("defense_fingerprint", fingerprints);

  if (existingError) {
    if (isEnemyDefenseBankSchemaMissing(existingError)) throw createBankNotInitializedError();
    throw existingError;
  }

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

  const { data, error } = await supabase.rpc("archive_gvg_enemy_defense_bank", {
    p_portal_guild_id: portalGuild.id,
    p_source_gvg_key: sourceGvgKey,
    p_technical_guild: portalGuild.technical_guild,
    p_defenses: archivePayload,
  });

  if (error) {
    if (isEnemyDefenseBankSchemaMissing(error)) throw createBankNotInitializedError();
    throw createSupabaseArchiveError(error);
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
  };
}
