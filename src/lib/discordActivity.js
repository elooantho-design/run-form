const DISCORD_ACTIVITY_READY_TIMEOUT_MS = 2500;

function readViteEnv(name) {
  return String(import.meta.env?.[name] || "").trim();
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
