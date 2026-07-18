const DEFAULT_PUBLIC_ASSETS_BASE_URL = "https://vps-aad12be0.vps.ovh.net";

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
  return `${PUBLIC_ASSETS_BASE_URL}/${parts.map(encodeSegment).join("/")}`;
}

export function getPublicAssetsBaseUrl() {
  return PUBLIC_ASSETS_BASE_URL;
}

export function buildPublicCalquesBaseUrl() {
  return PUBLIC_ASSETS_BASE_URL ? `${PUBLIC_ASSETS_BASE_URL}/assets/calques` : "";
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
    if (parsed.pathname !== "/api/gvg-server") return url;

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

  return url;
}
