import { cleanChatText, normalizeChatLanguage } from "./_portal-chat-core.js";

const GIF_PROVIDER_TIMEOUT_MS = 4500;
const GIF_PROVIDER_MAX_RESULTS = 24;
const GIF_PROVIDER_ALLOWED_HOSTS = new Map([
  ["giphy", ["giphy.com", "media.giphy.com", "i.giphy.com", "media0.giphy.com", "media1.giphy.com", "media2.giphy.com", "media3.giphy.com", "media4.giphy.com"]],
  ["mock", ["media.giphy.com"]],
]);

const SEARCH_BUCKETS = new Map();

function parseBoolean(value) {
  return ["1", "true", "yes", "on"].includes(cleanChatText(value).toLowerCase());
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function getConfiguredProvider() {
  const provider = cleanChatText(process.env.PORTAL_CHAT_GIF_PROVIDER || "giphy").toLowerCase();
  return ["giphy", "mock"].includes(provider) ? provider : "";
}

export function getPortalChatGifConfig() {
  const provider = getConfiguredProvider();
  const apiKey = cleanChatText(process.env.PORTAL_CHAT_GIF_API_KEY);
  const enabled = parseBoolean(process.env.PORTAL_CHAT_GIF_ENABLED) && Boolean(provider) && (provider === "mock" || Boolean(apiKey));

  return {
    enabled,
    provider: provider || "none",
    hasApiKey: Boolean(apiKey),
    rating: cleanChatText(process.env.PORTAL_CHAT_GIF_RATING || "pg-13").toLowerCase() || "pg-13",
    maxResults: clampNumber(process.env.PORTAL_CHAT_GIF_MAX_RESULTS, GIF_PROVIDER_MAX_RESULTS, 1, GIF_PROVIDER_MAX_RESULTS),
  };
}

export function checkGifSearchRateLimit(memberId) {
  const key = cleanChatText(memberId);
  if (!key) return null;

  const now = Date.now();
  const cutoff = now - 10000;
  const entries = (SEARCH_BUCKETS.get(key) || []).filter((timestamp) => timestamp > cutoff);
  entries.push(now);
  SEARCH_BUCKETS.set(key, entries);

  if (entries.length > 20) {
    return { error: "Trop de recherches GIF. Patiente quelques secondes.", status: 429 };
  }

  return null;
}

function normalizeGifLimit(limit) {
  return clampNumber(limit, 12, 1, getPortalChatGifConfig().maxResults || GIF_PROVIDER_MAX_RESULTS);
}

function normalizeOffset(cursor) {
  return Math.max(0, clampNumber(cursor, 0, 0, 5000));
}

function isAllowedProviderHost(provider, url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const hostname = parsed.hostname.toLowerCase();
    return (GIF_PROVIDER_ALLOWED_HOSTS.get(provider) || []).some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function pickImage(images = {}) {
  return (
    images.fixed_height ||
    images.downsized_medium ||
    images.downsized ||
    images.original ||
    images.preview_gif ||
    null
  );
}

function pickPreview(images = {}) {
  return images.fixed_height_small || images.preview_gif || images.fixed_height || images.downsized || images.original || null;
}

function serializeGiphyItem(item) {
  const main = pickImage(item?.images || {});
  const preview = pickPreview(item?.images || {});
  const mediaUrl = cleanChatText(main?.url);
  const previewUrl = cleanChatText(preview?.url || mediaUrl);

  if (!item?.id || !isAllowedProviderHost("giphy", mediaUrl) || !isAllowedProviderHost("giphy", previewUrl)) {
    return null;
  }

  return {
    provider: "giphy",
    providerItemId: String(item.id),
    mediaUrl,
    previewUrl,
    width: Number(main?.width || preview?.width || 0) || null,
    height: Number(main?.height || preview?.height || 0) || null,
    title: cleanChatText(item.title || item.slug || "GIF").slice(0, 180),
  };
}

function createAbortSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

async function requestGiphy(path, params) {
  const apiKey = cleanChatText(process.env.PORTAL_CHAT_GIF_API_KEY);
  if (!apiKey) throw new Error("Fournisseur GIF non configure.");

  const url = new URL(`https://api.giphy.com/v1/gifs/${path}`);
  url.searchParams.set("api_key", apiKey);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }

  const timeout = createAbortSignal(GIF_PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: timeout.signal,
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.message || `Erreur GIF ${response.status}`);
    return payload;
  } finally {
    timeout.cancel();
  }
}

function getMockGifItems({ query = "", cursor = 0, limit = 12 }) {
  const label = cleanChatText(query) || "trending";
  return Array.from({ length: limit }, (_, index) => {
    const n = Number(cursor || 0) + index + 1;
    return {
      provider: "mock",
      providerItemId: `mock-${label}-${n}`.slice(0, 120),
      mediaUrl: `https://media.giphy.com/media/${index % 2 ? "ICOgUNjpvO0PC" : "l0MYt5jPR6QX5pnqM"}/giphy.gif`,
      previewUrl: `https://media.giphy.com/media/${index % 2 ? "ICOgUNjpvO0PC" : "l0MYt5jPR6QX5pnqM"}/100.gif`,
      width: 200,
      height: 200,
      title: `Mock GIF ${n} ${label}`.trim(),
    };
  });
}

export async function searchGifs({ query, locale, cursor, limit }) {
  const config = getPortalChatGifConfig();
  if (!config.enabled) return { enabled: false, provider: config.provider, items: [], nextCursor: "" };

  const cleanQuery = cleanChatText(query).slice(0, 80);
  if (!cleanQuery) return getTrendingGifs({ locale, cursor, limit });

  const safeLimit = normalizeGifLimit(limit);
  const offset = normalizeOffset(cursor);
  const language = normalizeChatLanguage(locale);

  if (config.provider === "mock") {
    return {
      enabled: true,
      provider: "mock",
      items: getMockGifItems({ query: cleanQuery, cursor: offset, limit: safeLimit }),
      nextCursor: String(offset + safeLimit),
    };
  }

  const payload = await requestGiphy("search", {
    q: cleanQuery,
    limit: safeLimit,
    offset,
    rating: config.rating,
    lang: language,
  });
  const items = (payload?.data || []).map(serializeGiphyItem).filter(Boolean);
  const total = Number(payload?.pagination?.total_count || 0);
  const nextOffset = offset + safeLimit;

  return {
    enabled: true,
    provider: "giphy",
    items,
    nextCursor: items.length && nextOffset < total ? String(nextOffset) : "",
    attribution: "GIPHY",
  };
}

export async function getTrendingGifs({ locale, cursor, limit }) {
  const config = getPortalChatGifConfig();
  if (!config.enabled) return { enabled: false, provider: config.provider, items: [], nextCursor: "" };

  const safeLimit = normalizeGifLimit(limit);
  const offset = normalizeOffset(cursor);
  const language = normalizeChatLanguage(locale);

  if (config.provider === "mock") {
    return {
      enabled: true,
      provider: "mock",
      items: getMockGifItems({ cursor: offset, limit: safeLimit }),
      nextCursor: String(offset + safeLimit),
    };
  }

  const payload = await requestGiphy("trending", {
    limit: safeLimit,
    offset,
    rating: config.rating,
    lang: language,
  });
  const items = (payload?.data || []).map(serializeGiphyItem).filter(Boolean);
  const total = Number(payload?.pagination?.total_count || 0);
  const nextOffset = offset + safeLimit;

  return {
    enabled: true,
    provider: "giphy",
    items,
    nextCursor: items.length && nextOffset < total ? String(nextOffset) : "",
    attribution: "GIPHY",
  };
}

export async function resolveGif({ provider, providerItemId }) {
  const config = getPortalChatGifConfig();
  const normalizedProvider = cleanChatText(provider).toLowerCase();
  const id = cleanChatText(providerItemId).slice(0, 160);

  if (!config.enabled) throw new Error("Fournisseur GIF desactive.");
  if (!normalizedProvider || normalizedProvider !== config.provider) throw new Error("Fournisseur GIF non autorise.");
  if (!id) throw new Error("GIF introuvable.");

  if (normalizedProvider === "mock") {
    const item = getMockGifItems({ query: id, limit: 1 })[0];
    return { ...item, providerItemId: id };
  }

  const payload = await requestGiphy(encodeURIComponent(id), {});
  const item = serializeGiphyItem(payload?.data);
  if (!item) throw new Error("GIF invalide ou non autorise.");
  return item;
}
