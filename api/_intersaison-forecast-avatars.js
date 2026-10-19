import { createHash } from "node:crypto";
import { getForecastDiscordId } from "../src/lib/intersaisonForecast.js";
import { buildPublicDiscordAvatarUrl, getPublicAssetsBaseUrl } from "../src/lib/vpsAssets.js";

const MAX_MANIFEST_BYTES = 1024 * 1024;

// One shared static index read, never a Discord request or synchronization command.
export function createForecastAvatarReader({ fetchImpl = (...args) => fetch(...args), now = Date.now } = {}) {
  let versions = new Map(), expires = 0, etag = "", pending = null;
  async function loadManifest() {
    if (now() < expires) return;
    if (pending) return pending;
    pending = (async () => {
      try {
        const response = await fetchImpl(`${getPublicAssetsBaseUrl()}/assets/discord-avatars/manifest.json`, {
          method: "GET", headers: etag ? { "If-None-Match": etag } : {}, signal: AbortSignal.timeout(1500),
        });
        if (response.status === 304) { expires = now() + 60000; return; }
        if (!response.ok || Number(response.headers.get("content-length") || 0) > MAX_MANIFEST_BYTES) throw Error("Manifest unavailable");
        const reader = response.body.getReader(), chunks = [];
        let size = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_MANIFEST_BYTES) throw Error("Manifest too large");
            chunks.push(value);
          }
        } finally { await reader.cancel(); }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        const manifest = JSON.parse(new TextDecoder().decode(bytes));
        if (manifest?.version !== 1 || !manifest.avatars || typeof manifest.avatars !== "object" || Array.isArray(manifest.avatars)) throw Error("Invalid manifest");
        versions = new Map(Object.entries(manifest.avatars).filter(([key, version]) =>
          /^[a-f0-9]{64}$/.test(key) && /^[a-f0-9]{16}$/.test(String(version))));
        etag = response.headers.get("etag") || "";
        expires = now() + 60000;
      } catch {
        // Preserve known URLs during an asset outage; never fall back to Discord.
        expires = now() + 15000;
      }
    })();
    try { await pending; } finally { pending = null; }
  }
  return async (members, memberIds) => {
    const byId = new Map(members.map((m) => [m.id, m]));
    const identities = new Map(memberIds.map((memberId) => [memberId, getForecastDiscordId(byId.get(memberId), byId)]));
    if ([...identities.values()].some(Boolean)) await loadManifest();
    return Object.fromEntries([...identities].map(([memberId, id]) => {
      const key = id ? createHash("sha256").update(id).digest("hex") : "";
      return [memberId, buildPublicDiscordAvatarUrl(key, versions.get(key))];
    }));
  };
}

export const readForecastAvatars = createForecastAvatarReader();
