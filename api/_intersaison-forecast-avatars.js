/* global process */
import { buildForecastAvatarUrl, getForecastDiscordId } from "../src/lib/intersaisonForecast.js";

// Cosmetic reads only, separate from the survey load/submit path. No Discord writes.
export function createForecastAvatarReader({ fetchImpl = (...args) => fetch(...args), now = Date.now } = {}) {
  const cache = new Map();
  const pending = new Map();
  let retryAt = 0;
  async function readUser(id, organizationId) {
    const key = `${organizationId}:${id}`;
    const cached = cache.get(key);
    if (cached?.expires > now()) return cached.url;
    if (pending.has(key)) return pending.get(key);
    const token = String(process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_DEFENSE_BOT_TOKEN || process.env.DISCORD_TOKEN || "").trim();
    if (!token || now() < retryAt) return "";
    const task = (async () => {
      let url = "";
      try {
        const response = await fetchImpl(`https://discord.com/api/v10/users/${id}`, {
          method: "GET", headers: { Authorization: `Bot ${token}` }, signal: AbortSignal.timeout(1500),
        });
        if (response.status === 429) {
          const payload = await response.json().catch(() => ({}));
          const delay = Number(payload.retry_after);
          retryAt = now() + (Number.isFinite(delay) ? Math.max(1000, delay * 1000) : 30000);
        } else if (response.ok) {
          const user = await response.json();
          if (String(user?.id) === id) url = buildForecastAvatarUrl(user);
        }
      } catch { /* An unavailable avatar must never prevent the forecast from loading. */ }
      if (cache.size >= 1000) cache.delete(cache.keys().next().value);
      cache.set(key, { url, expires: now() + (url ? 600000 : 60000) });
      return url;
    })();
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  }
  return async (members, memberIds, organizationId) => {
    const byId = new Map(members.map((m) => [m.id, m]));
    const requested = [...new Set(memberIds)];
    const urls = new Map();
    const ids = [...new Set(requested.map((key) => getForecastDiscordId(byId.get(key), byId)).filter(Boolean))];
    // Small, bounded batches; a Discord rate limit pauses subsequent lookups, never retries in a loop.
    for (let i = 0; i < ids.length; i += 3) {
      await Promise.all(ids.slice(i, i + 3).map(async (id) => urls.set(id, await readUser(id, organizationId))));
    }
    return Object.fromEntries(requested.map((key) => [key, urls.get(getForecastDiscordId(byId.get(key), byId)) || ""]));
  };
}

export const readForecastAvatars = createForecastAvatarReader();
