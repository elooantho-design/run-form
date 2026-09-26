import { isDiscordActivityRuntime } from "./discordActivity.js";

const DEFAULT_PUBLIC_ASSETS_BASE_URL = "https://vps-aad12be0.vps.ovh.net";
const DISCORD_VPS_ASSETS_PREFIX = "/vps-assets";
const DISCORD_SUPABASE_STORAGE_PREFIX = "/supabase-storage";
const SUPABASE_DEFENSE_IMAGES_PUBLIC_PATH_PREFIX = "/storage/v1/object/public/defense-images/";

const PUBLIC_ASSETS_BASE_URL = String(
  import.meta.env?.VITE_GVG_PUBLIC_ASSETS_BASE_URL ||
    import.meta.env?.VITE_ASSETS_BASE_URL ||
    DEFAULT_PUBLIC_ASSETS_BASE_URL
).replace(/\/+$/, "");
const SUPABASE_PUBLIC_URL = String(import.meta.env?.VITE_SUPABASE_URL || "").replace(/\/+$/, "");

const CALQUE_FOLDERS = {
  hero: "hero-calques",
  faction: "faction-calques",
  role: "role-calques",
};
const HERO_ASSETS_VERSION = "20260718-heroes-1";

function encodeSegment(value) {
  return encodeURIComponent(String(value || "").trim());
}

function buildAssetUrl(parts, options = {}) {
  if (!PUBLIC_ASSETS_BASE_URL) return "";
  return resolveVpsAssetUrlForRuntime(`${PUBLIC_ASSETS_BASE_URL}/${parts.map(encodeSegment).join("/")}`, options);
}

export function getPublicAssetsBaseUrl() {
  return PUBLIC_ASSETS_BASE_URL;
}

export function resolveVpsAssetUrlForRuntime(url, options = {}) {
  const value = String(url || "").trim();
  if (!value || !PUBLIC_ASSETS_BASE_URL) return value;

  let parsedUrl;
  let publicBaseUrl;
  try {
    parsedUrl = new URL(value);
    publicBaseUrl = new URL(PUBLIC_ASSETS_BASE_URL);
  } catch {
    return value;
  }

  if (parsedUrl.origin !== publicBaseUrl.origin) return value;

  const useDiscordMapping =
    typeof options.discordActivity === "boolean"
      ? options.discordActivity
      : isDiscordActivityRuntime(options.location, { clientId: options.discordClientId });

  if (!useDiscordMapping) return value;

  const prefix = String(options.discordPrefix || DISCORD_VPS_ASSETS_PREFIX).replace(/\/+$/, "");
  return `${prefix}${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
}

function resolveSupabaseDefenseImageUrlForRuntime(url, options = {}) {
  const value = String(url || "").trim();
  const supabasePublicUrl = String(options.supabasePublicUrl || SUPABASE_PUBLIC_URL || "").replace(/\/+$/, "");
  if (!value || !supabasePublicUrl) return value;

  let parsedUrl;
  let supabaseBaseUrl;
  try {
    parsedUrl = new URL(value);
    supabaseBaseUrl = new URL(supabasePublicUrl);
  } catch {
    return value;
  }

  if (parsedUrl.origin !== supabaseBaseUrl.origin) return value;
  if (!parsedUrl.pathname.startsWith(SUPABASE_DEFENSE_IMAGES_PUBLIC_PATH_PREFIX)) return value;

  const useDiscordMapping =
    typeof options.discordActivity === "boolean"
      ? options.discordActivity
      : isDiscordActivityRuntime(options.location, { clientId: options.discordClientId });

  if (!useDiscordMapping) return value;

  const prefix = String(options.supabaseDiscordPrefix || DISCORD_SUPABASE_STORAGE_PREFIX).replace(/\/+$/, "");
  return `${prefix}${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
}

export function buildPublicCalquesBaseUrl(options = {}) {
  return PUBLIC_ASSETS_BASE_URL ? resolveVpsAssetUrlForRuntime(`${PUBLIC_ASSETS_BASE_URL}/assets/calques`, options) : "";
}

export function buildPublicCalqueUrl(kind, fileName, options = {}) {
  const folder = CALQUE_FOLDERS[kind];
  if (!folder || !fileName) return "";
  return buildAssetUrl(["assets", "calques", folder, fileName], options);
}

export function buildPublicHeroUrl(fileName, options = {}) {
  if (!fileName) return "";
  const url = buildAssetUrl(["assets", "heroes", fileName], options);
  return url ? `${url}?v=${HERO_ASSETS_VERSION}` : "";
}

export function buildPublicPreviewUrl(guild, jobId, fileName, options = {}) {
  if (!guild || !jobId || !fileName) return "";

  return buildAssetUrl([
    "public",
    "jobs",
    String(guild).trim().toLowerCase(),
    jobId,
    "previews",
    fileName,
  ], options);
}

export function buildPublicDownloadUrl(fileName, options = {}) {
  if (!fileName) return "";
  return buildAssetUrl(["downloads", fileName], options);
}

export function resolvePublicAssetProxyUrl(url, options = {}) {
  if (!url) return "";

  try {
    const parsed = new URL(url, "https://portal.local");
    if (parsed.pathname !== "/api/gvg-server") {
      return resolveSupabaseDefenseImageUrlForRuntime(resolveVpsAssetUrlForRuntime(url, options), options);
    }

    const action = parsed.searchParams.get("action");

    if (action === "preview") {
      return (
        buildPublicPreviewUrl(
          parsed.searchParams.get("guild") || parsed.searchParams.get("sourceGuild"),
          parsed.searchParams.get("jobId") || parsed.searchParams.get("job_id"),
          parsed.searchParams.get("file"),
          options,
        ) || url
      );
    }

    if (action === "calque") {
      return (
        buildPublicCalqueUrl(
          parsed.searchParams.get("kind"),
          parsed.searchParams.get("file"),
          options,
        ) || url
      );
    }

    if (action === "launcher-download") {
      return buildPublicDownloadUrl("PaladinGVGLauncher.zip", options) || url;
    }

    if (action === "record-launcher-download") {
      return buildPublicDownloadUrl("PaladinGVGRecordLauncher.zip", options) || url;
    }
  } catch {
    return url;
  }

  return resolveSupabaseDefenseImageUrlForRuntime(resolveVpsAssetUrlForRuntime(url, options), options);
}
