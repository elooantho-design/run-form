const DISCORD_ACTIVITY_READY_TIMEOUT_MS = 2500;
const DISCORD_ACTIVITY_REQUIRED_PARAMS = ["frame_id", "instance_id", "platform"];

function readViteEnv(name) {
  return String(import.meta.env?.[name] || "").trim();
}

export function hasDiscordActivityLaunchParams(searchParams) {
  const params = searchParams instanceof URLSearchParams
    ? searchParams
    : new URLSearchParams(searchParams || "");

  return DISCORD_ACTIVITY_REQUIRED_PARAMS.every((name) => String(params.get(name) || "").trim());
}

export function isDiscordActivityRuntime(locationLike, options = {}) {
  const clientId = String(options.clientId || readViteEnv("VITE_DISCORD_CLIENT_ID")).trim();
  if (!clientId) return false;

  let currentUrl;
  try {
    const fallbackHref =
      typeof window !== "undefined" && window.location?.href
        ? window.location.href
        : "https://run-form.local/";
    currentUrl = new URL(
      locationLike
        ? typeof locationLike === "string"
          ? locationLike
          : locationLike.href
        : fallbackHref,
      "https://run-form.local",
    );
  } catch {
    return false;
  }

  return currentUrl.hostname === `${clientId}.discordsays.com`;
}

export function getDiscordActivityPortalRedirectUrl(locationLike) {
  if (!locationLike) return "";

  const currentUrl = new URL(
    typeof locationLike === "string" ? locationLike : locationLike.href,
    "https://run-form.local",
  );

  if (currentUrl.pathname !== "/" || !hasDiscordActivityLaunchParams(currentUrl.searchParams)) {
    return "";
  }

  currentUrl.pathname = "/portal";
  return `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
}

function isDiscordActivityEnabled() {
  return readViteEnv("VITE_DISCORD_ACTIVITY_ENABLED").toLowerCase() === "true";
}

function shouldLogDiscordActivity() {
  return Boolean(import.meta.env?.DEV) || readViteEnv("VITE_DISCORD_ACTIVITY_DEBUG").toLowerCase() === "true";
}

function logDiscordActivity(level, message, details) {
  if (level !== "warn" && !shouldLogDiscordActivity()) return;
  const logger = level === "warn" ? console.warn : console.info;
  if (details) {
    logger(`[discord-activity] ${message}`, details);
  } else {
    logger(`[discord-activity] ${message}`);
  }
}

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error("Discord SDK ready timeout")), timeoutMs);
    }),
  ]);
}

export async function initDiscordActivity(options = {}) {
  if (typeof window === "undefined") {
    return { status: "server" };
  }

  if (!isDiscordActivityEnabled()) {
    logDiscordActivity("info", "browser fallback");
    return { status: "disabled" };
  }

  const clientId = readViteEnv("VITE_DISCORD_CLIENT_ID");
  if (!clientId) {
    logDiscordActivity("warn", "enabled but VITE_DISCORD_CLIENT_ID is missing");
    return { status: "missing-client-id" };
  }

  try {
    logDiscordActivity("info", "init");
    const { DiscordSDK } = await import("@discord/embedded-app-sdk");
    const discordSdk = new DiscordSDK(clientId);
    await withTimeout(
      discordSdk.ready(),
      Number(options.readyTimeoutMs || DISCORD_ACTIVITY_READY_TIMEOUT_MS),
    );
    logDiscordActivity("info", "ready");
    return { status: "ready", sdk: discordSdk };
  } catch (error) {
    logDiscordActivity("info", "init failed", {
      message: error?.message || String(error),
    });
    return { status: "browser-fallback", error };
  }
}
