const DISCORD_ACTIVITY_READY_TIMEOUT_MS = 2500;
const DISCORD_ACTIVITY_REQUIRED_PARAMS = ["frame_id", "instance_id", "platform"];

let activeDiscordActivitySdk = null;

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

export function shouldRenderPortalForDiscordActivityRoot(locationLike) {
  if (!locationLike) return false;

  let currentUrl;
  try {
    currentUrl = new URL(
      typeof locationLike === "string" ? locationLike : locationLike.href,
      "https://run-form.local",
    );
  } catch {
    return false;
  }

  return currentUrl.pathname === "/" && hasDiscordActivityLaunchParams(currentUrl.searchParams);
}

export function getBootstrapRenderPath(locationLike) {
  if (!locationLike) return "/";

  let currentUrl;
  try {
    currentUrl = new URL(
      typeof locationLike === "string" ? locationLike : locationLike.href,
      "https://run-form.local",
    );
  } catch {
    return "/";
  }

  if (shouldRenderPortalForDiscordActivityRoot(currentUrl)) return "/portal";
  return currentUrl.pathname || "/";
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

  if (activeDiscordActivitySdk) {
    return { status: "ready", sdk: activeDiscordActivitySdk };
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
    activeDiscordActivitySdk = discordSdk;
    logDiscordActivity("info", "ready");
    return { status: "ready", sdk: discordSdk };
  } catch (error) {
    logDiscordActivity("info", "init failed", {
      message: error?.message || String(error),
    });
    return { status: "browser-fallback", error };
  }
}

export async function openExternalUrlForRuntime(url, options = {}) {
  const targetUrl = String(url || "").trim();
  if (!targetUrl) return { opened: false, mode: "empty" };

  const windowRef = options.windowRef || (typeof window !== "undefined" ? window : null);
  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl, windowRef?.location?.href || "https://run-form.local/");
  } catch {
    return { opened: false, mode: "invalid-url" };
  }

  const normalizedUrl = parsedUrl.href;
  const isHttpUrl = parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
  const locationLike = options.location || windowRef?.location || "";
  const discordActivity =
    typeof options.discordActivity === "boolean"
      ? options.discordActivity
      : isDiscordActivityRuntime(locationLike, { clientId: options.discordClientId });

  if (discordActivity && isHttpUrl) {
    let discordSdk = options.discordSdk || activeDiscordActivitySdk;

    if (!discordSdk && options.initializeSdk !== false) {
      const initResult = await initDiscordActivity({
        readyTimeoutMs: options.readyTimeoutMs || DISCORD_ACTIVITY_READY_TIMEOUT_MS,
      });
      discordSdk = initResult?.sdk || null;
    }

    if (discordSdk?.commands?.openExternalLink) {
      const result = await discordSdk.commands.openExternalLink({ url: normalizedUrl });
      return { opened: result?.opened !== false, mode: "discord", result };
    }

    return { opened: false, mode: "discord-sdk-unavailable" };
  }

  if (!windowRef) return { opened: false, mode: "no-window" };

  if (options.newTab) {
    windowRef.open?.(normalizedUrl, "_blank", "noopener,noreferrer");
    return { opened: true, mode: "browser-new-tab" };
  }

  windowRef.location.href = normalizedUrl;
  return { opened: true, mode: "browser-location" };
}
