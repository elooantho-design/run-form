import fs from "node:fs";
import path from "node:path";

const projectDir = process.cwd();
const DISCORD_GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const INTENTS = 1 | 1024; // GUILDS + GUILD_MESSAGE_REACTIONS

function loadEnvFile(fileName) {
  const filePath = path.join(projectDir, fileName);
  if (!fs.existsSync(filePath)) return;

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;

    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index);
    const value = trimmed.slice(index + 1).replace(/^"|"$/g, "");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(".env");
loadEnvFile(".env.local");

const botToken = String(
  process.env.DISCORD_BOT_TOKEN ||
    process.env.DISCORD_DEFENSE_BOT_TOKEN ||
    process.env.DISCORD_TOKEN ||
    ""
).trim();
const internalToken = String(process.env.DISCORD_REPRO_INTERNAL_TOKEN || "").trim();
const portalApiBase = String(
  process.env.PORTAL_API_BASE_URL ||
    process.env.PORTAL_PUBLIC_URL ||
    "https://run-form-tau.vercel.app"
)
  .trim()
  .replace(/\/$/, "");

if (!botToken) {
  throw new Error("DISCORD_BOT_TOKEN, DISCORD_DEFENSE_BOT_TOKEN ou DISCORD_TOKEN manquant.");
}

if (!internalToken) {
  throw new Error("DISCORD_REPRO_INTERNAL_TOKEN manquant.");
}

if (typeof WebSocket !== "function") {
  throw new Error("Ce script demande Node 22+ avec WebSocket global.");
}

function isWhiteCheckEmoji(emoji) {
  const name = String(emoji?.name || "").trim();
  return name === "✅" || name === "white_check_mark";
}

async function forwardReaction(event) {
  const response = await fetch(`${portalApiBase}/api/gvg-server?action=discord-repro`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Discord-Repro-Token": internalToken,
    },
    body: JSON.stringify({
      action: "reaction_add",
      messageId: event.message_id,
      channelId: event.channel_id,
      userId: event.user_id,
      emojiName: event.emoji?.name || "",
    }),
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    throw new Error(payload?.error || `Portal API ${response.status}`);
  }

  return payload;
}

function connect() {
  let heartbeatTimer = null;
  let lastSequence = null;
  let botUserId = null;
  let reconnecting = false;

  const socket = new WebSocket(DISCORD_GATEWAY_URL);

  function clearHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function reconnect(reason) {
    if (reconnecting) return;
    reconnecting = true;
    clearHeartbeat();
    console.error(`[discord-repro-bot] reconnexion dans 5s: ${reason || "close"}`);
    try {
      socket.close();
    } catch {
      // already closed
    }
    setTimeout(connect, 5000);
  }

  socket.addEventListener("open", () => {
    console.log("[discord-repro-bot] gateway connecte");
  });

  socket.addEventListener("message", async (message) => {
    let packet = null;
    try {
      packet = JSON.parse(String(message.data || ""));
    } catch {
      return;
    }

    if (packet.s !== null && packet.s !== undefined) {
      lastSequence = packet.s;
    }

    if (packet.op === 10) {
      const interval = Number(packet.d?.heartbeat_interval || 45000);
      socket.send(JSON.stringify({ op: 1, d: lastSequence }));
      heartbeatTimer = setInterval(() => {
        socket.send(JSON.stringify({ op: 1, d: lastSequence }));
      }, interval);

      socket.send(
        JSON.stringify({
          op: 2,
          d: {
            token: botToken,
            intents: INTENTS,
            properties: {
              os: process.platform,
              browser: "paladin-repro-bot",
              device: "paladin-repro-bot",
            },
          },
        })
      );
      return;
    }

    if (packet.op === 7) {
      reconnect("discord requested reconnect");
      return;
    }

    if (packet.op === 9) {
      reconnect("invalid session");
      return;
    }

    if (packet.t === "READY") {
      botUserId = packet.d?.user?.id || null;
      console.log(`[discord-repro-bot] pret (${packet.d?.user?.username || "bot"})`);
      return;
    }

    if (packet.t === "MESSAGE_REACTION_ADD") {
      const event = packet.d || {};
      if (!isWhiteCheckEmoji(event.emoji)) return;
      if (botUserId && event.user_id === botUserId) return;

      try {
        const result = await forwardReaction(event);
        if (!result?.ignored) {
          if (result?.handler === "guild_defense_followup") {
            console.log(
              `[discord-repro-bot] defenses validees message=${event.message_id} member=${result?.member_id || "?"}`
            );
          } else {
            console.log(
              `[discord-repro-bot] repro ouverte message=${event.message_id} defense=${result?.gvg_defense_id || "?"}`
            );
          }
        } else {
          console.log(
            `[discord-repro-bot] reaction ignoree message=${event.message_id} reason=${result?.reason || "unknown"}`
          );
        }
      } catch (error) {
        console.error("[discord-repro-bot] reaction error:", error?.message || error);
      }
    }
  });

  socket.addEventListener("close", (event) => {
    clearHeartbeat();
    reconnect(`close ${event.code || ""} ${event.reason || ""}`.trim());
  });

  socket.addEventListener("error", (event) => {
    console.error("[discord-repro-bot] websocket error:", event?.message || event);
  });
}

connect();
