import { isDiscordActivityRuntime } from "./discordActivity.js";

const DEFAULT_PUBLIC_ASSETS_BASE_URL = "https://vps-aad12be0.vps.ovh.net";
const DISCORD_VPS_ASSETS_PREFIX = "/vps-assets";

const PUBLIC_ASSETS_BASE_URL = String(
  import.meta.env?.VITE_GVG_PUBLIC_ASSETS_BASE_URL ||
    import.meta.env?.VITE_ASSETS_BASE_URL ||
    DEFAULT_PUBLIC_ASSETS_BASE_URL
).replace(/\/+$/, "");

const CALQUE_FOLDERS = {
  hero: "hero-calques",
  faction: "faction-calques",
  role: "role-calques",
};
const HERO_ASSETS_VERSION = "20260718-heroes-1";

function encodeSegment(value) {
  return encodeURIComponent(String(value || "").trim());
}

function buildAssetUrl(parts) {
  if (!PUBLIC_ASSETS_BASE_URL) return "";
  return resolveVpsAssetUrlForRuntime(`${PUBLIC_ASSETS_BASE_URL}/${parts.map(encodeSegment).join("/")}`);
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

export function buildPublicCalquesBaseUrl() {
  return PUBLIC_ASSETS_BASE_URL ? resolveVpsAssetUrlForRuntime(`${PUBLIC_ASSETS_BASE_URL}/assets/calques`) : "";
}

export function buildPublicCalqueUrl(kind, fileName) {
  const folder = CALQUE_FOLDERS[kind];
  if (!folder || !fileName) return "";
  return buildAssetUrl(["assets", "calques", folder, fileName]);
}

export function buildPublicHeroUrl(fileName) {
  if (!fileName) return "";
  const url = buildAssetUrl(["assets", "heroes", fileName]);
  return url ? `${url}?v=${HERO_ASSETS_VERSION}` : "";
}

export function buildPublicPreviewUrl(guild, jobId, fileName) {
  if (!guild || !jobId || !fileName) return "";

  return buildAssetUrl([
    "public",
    "jobs",
    String(guild).trim().toLowerCase(),
    jobId,
    "previews",
    fileName,
  ]);
}

export function buildPublicDownloadUrl(fileName) {
  if (!fileName) return "";
  return buildAssetUrl(["downloads", fileName]);
}

export function resolvePublicAssetProxyUrl(url) {
  if (!url) return "";

  try {
    const parsed = new URL(url, "https://portal.local");
    if (parsed.pathname !== "/api/gvg-server") return resolveVpsAssetUrlForRuntime(url);

    const action = parsed.searchParams.get("action");

    if (action === "preview") {
      return (
        buildPublicPreviewUrl(
          parsed.searchParams.get("guild") || parsed.searchParams.get("sourceGuild"),
          parsed.searchParams.get("jobId") || parsed.searchParams.get("job_id"),
          parsed.searchParams.get("file")
        ) || url
      );
    }

    if (action === "calque") {
      return (
        buildPublicCalqueUrl(
          parsed.searchParams.get("kind"),
          parsed.searchParams.get("file")
        ) || url
      );
    }

    if (action === "launcher-download") {
      return buildPublicDownloadUrl("PaladinGVGLauncher.zip") || url;
    }

    if (action === "record-launcher-download") {
      return buildPublicDownloadUrl("PaladinGVGRecordLauncher.zip") || url;
    }
  } catch {
    return url;
  }

  return resolveVpsAssetUrlForRuntime(url);
}
