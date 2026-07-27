import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { normalizeCreatorLinkHostname } from "../src/lib/creatorLinkPlatforms.js";

const DEFAULT_TIMEOUT_MS = 2500;
const MAX_REDIRECTS = 3;
const MAX_INPUT_URL_LENGTH = 2048;
const MAX_HTML_BYTES = 128 * 1024;
const MAX_ICON_BYTES = 256 * 1024;
const CACHE_HEADER = "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800";
const SAFE_ADDRESSES_SYMBOL = Symbol("safeAddresses");
const SAFE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);

function makeIconError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeNetworkHostname(value) {
  return String(value || "")
    .trim()
    .replace(/^\[(.*)\]$/u, "$1")
    .replace(/\.+$/g, "")
    .toLowerCase();
}

function attachSafeAddresses(url, addresses) {
  url[SAFE_ADDRESSES_SYMBOL] = addresses
    .map((address) => ({
      address: String(address?.address || address || "").trim(),
      family: Number(address?.family || net.isIP(address?.address || address)),
    }))
    .filter((address) => address.address && (address.family === 4 || address.family === 6));
  return url;
}

function getSafeAddresses(url) {
  return Array.isArray(url?.[SAFE_ADDRESSES_SYMBOL]) ? url[SAFE_ADDRESSES_SYMBOL] : [];
}

export function isPrivateIpAddress(value) {
  const ip = normalizeNetworkHostname(value);
  const version = net.isIP(ip);
  if (!version) return false;

  if (version === 4) {
    const parts = ip.split(".").map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }

  if (ip === "::" || ip === "::1") return true;
  if (ip.startsWith("::ffff:")) {
    return isPrivateIpAddress(ip.slice("::ffff:".length));
  }
  return (
    ip.startsWith("fc") ||
    ip.startsWith("fd") ||
    ip.startsWith("fe80") ||
    ip.startsWith("fe90") ||
    ip.startsWith("fea0") ||
    ip.startsWith("feb0") ||
    ip.startsWith("ff") ||
    ip.startsWith("2001:db8")
  );
}

function isBlockedHostname(hostname) {
  const host = normalizeNetworkHostname(hostname);
  return (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "metadata" ||
    host === "metadata.google.internal" ||
    host.endsWith(".metadata.google.internal") ||
    host === "instance.metadata.azure.com"
  );
}

export async function assertSafeRemoteUrl(value, options = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw makeIconError("URL invalide.");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw makeIconError("Protocole non autorise.");
  }
  if (url.username || url.password) {
    throw makeIconError("URL avec identifiants refusee.");
  }

  const hostname = normalizeNetworkHostname(url.hostname);
  if (isBlockedHostname(hostname)) {
    throw makeIconError("Hostname refuse.");
  }
  if (net.isIP(hostname)) {
    if (isPrivateIpAddress(hostname)) throw makeIconError("Adresse IP privee refusee.");
    return attachSafeAddresses(url, [{ address: hostname, family: net.isIP(hostname) }]);
  }

  const resolveDns = options.resolveDns || dns.lookup;
  let addresses;
  try {
    addresses = await resolveDns(hostname, { all: true, verbatim: true });
  } catch {
    throw makeIconError("Resolution DNS impossible.", 204);
  }

  const resolvedAddresses = Array.isArray(addresses) ? addresses : [addresses];
  if (!resolvedAddresses.length) {
    throw makeIconError("Aucune adresse DNS.", 204);
  }

  const privateAddress = resolvedAddresses.find((address) => isPrivateIpAddress(address?.address || address));
  if (privateAddress) {
    throw makeIconError("Hostname resolu vers une adresse privee.");
  }

  return attachSafeAddresses(url, resolvedAddresses);
}

function makePinnedLookup(addresses) {
  return (hostname, lookupOptions, callback) => {
    const family = Number(lookupOptions?.family || 0);
    const selected = (family ? addresses.find((address) => address.family === family) : addresses[0]) || addresses[0];
    if (!selected) {
      callback(makeIconError("Aucune adresse DNS.", 204));
      return;
    }
    callback(null, selected.address, selected.family);
  };
}

function makeResponseHeaders(headers) {
  return {
    get(name) {
      const value = headers[String(name || "").toLowerCase()];
      return Array.isArray(value) ? value.join(", ") : value || null;
    },
  };
}

async function fetchNodeResponseWithPinnedDns(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const parsedUrl = new URL(url.toString());
  const safeAddresses = getSafeAddresses(url);
  const client = parsedUrl.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const request = client.request(
      parsedUrl,
      {
        method: "GET",
        headers: options.fetchOptions?.headers || {},
        lookup: makePinnedLookup(safeAddresses),
        timeout: timeoutMs,
      },
      (response) => {
        const status = Number(response.statusCode || 0);
        resolve({
          status,
          ok: status >= 200 && status < 300,
          headers: makeResponseHeaders(response.headers || {}),
          body: response,
        });
      },
    );

    request.on("timeout", () => {
      request.destroy(makeIconError("Timeout favicon.", 204));
    });
    request.on("error", reject);
    request.end();
  });
}

async function fetchWithTimeout(url, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);

  if (!options.fetchImpl) {
    return fetchNodeResponseWithPinnedDns(url, options);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(url.toString(), {
      ...options.fetchOptions,
      redirect: "manual",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithSafeRedirects(inputUrl, options = {}) {
  let currentUrl = String(inputUrl);
  let response = null;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const url = await assertSafeRemoteUrl(currentUrl, options);
    response = await fetchWithTimeout(url, options);

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return { response, url };
    }

    if (redirectCount >= MAX_REDIRECTS) {
      throw makeIconError("Trop de redirections.", 204);
    }

    const location = response.headers.get("location");
    if (!location) {
      throw makeIconError("Redirection invalide.", 204);
    }
    currentUrl = new URL(location, url).toString();
  }

  throw makeIconError("Trop de redirections.", 204);
}

export async function readResponseBuffer(response, maxBytes) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw makeIconError("Reponse trop volumineuse.", 204);
  }

  if (!response.body?.getReader) {
    if (response.body?.[Symbol.asyncIterator]) {
      const chunks = [];
      let total = 0;

      for await (const value of response.body) {
        const chunk = Buffer.from(value);
        total += chunk.byteLength;
        if (total > maxBytes) {
          response.body.destroy?.();
          throw makeIconError("Reponse trop volumineuse.", 204);
        }
        chunks.push(chunk);
      }

      return Buffer.concat(chunks);
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) {
      throw makeIconError("Reponse trop volumineuse.", 204);
    }
    return Buffer.from(arrayBuffer);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw makeIconError("Reponse trop volumineuse.", 204);
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks);
}

function readLinkAttribute(tag, attributeName) {
  const pattern = new RegExp(`${attributeName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>` + "`" + `]+))`, "i");
  const match = tag.match(pattern);
  return String(match?.[1] || match?.[2] || match?.[3] || "").trim();
}

export function extractFaviconCandidates(html, pageUrl) {
  const candidates = [];
  const seen = new Set();
  const linkTags = String(html || "").match(/<link\b[^>]*>/gi) || [];

  for (const tag of linkTags) {
    const rel = readLinkAttribute(tag, "rel").toLowerCase();
    const href = readLinkAttribute(tag, "href");
    if (!href) continue;

    const relParts = rel.split(/\s+/).filter(Boolean);
    const isIcon =
      relParts.includes("icon") ||
      relParts.includes("shortcut") ||
      relParts.includes("apple-touch-icon") ||
      relParts.includes("apple-touch-icon-precomposed");
    if (!isIcon) continue;

    try {
      const resolved = new URL(href, pageUrl).toString();
      if (!seen.has(resolved)) {
        seen.add(resolved);
        candidates.push(resolved);
      }
    } catch {
      // Ignore malformed icon URLs from third-party pages.
    }
  }

  return candidates.slice(0, 8);
}

function isSafeImageContentType(contentType) {
  const type = String(contentType || "").split(";")[0].trim().toLowerCase();
  return SAFE_IMAGE_TYPES.has(type);
}

export async function fetchCreatorLinkFavicon(value, options = {}) {
  const hostname = normalizeCreatorLinkHostname(value);
  if (!hostname) {
    throw makeIconError("URL invalide.");
  }

  const inputUrl = /^[a-z][a-z\d+.-]*:/i.test(String(value || "").trim())
    ? String(value).trim()
    : `https://${String(value).trim()}`;

  const pageUrl = await assertSafeRemoteUrl(inputUrl, options);
  const candidates = [];
  const seen = new Set();

  try {
    const { response, url: finalPageUrl } = await fetchWithSafeRedirects(pageUrl.toString(), {
      ...options,
      fetchOptions: {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "PortalCreatorLinkIcon/1.0",
        },
      },
    });
    const contentType = response.headers.get("content-type") || "";
    if (response.ok && contentType.toLowerCase().includes("text/html")) {
      const html = (await readResponseBuffer(response, MAX_HTML_BYTES)).toString("utf8");
      for (const candidate of extractFaviconCandidates(html, finalPageUrl)) {
        if (!seen.has(candidate)) {
          seen.add(candidate);
          candidates.push(candidate);
        }
      }
    }
    const fallback = new URL("/favicon.ico", finalPageUrl).toString();
    if (!seen.has(fallback)) {
      seen.add(fallback);
      candidates.push(fallback);
    }
  } catch {
    const fallback = new URL("/favicon.ico", pageUrl).toString();
    candidates.push(fallback);
  }

  for (const candidate of candidates) {
    try {
      const { response } = await fetchWithSafeRedirects(candidate, {
        ...options,
        fetchOptions: {
          headers: {
            accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/x-icon,*/*;q=0.5",
            "user-agent": "PortalCreatorLinkIcon/1.0",
          },
        },
      });
      if (!response.ok || !isSafeImageContentType(response.headers.get("content-type"))) continue;

      const body = await readResponseBuffer(response, MAX_ICON_BYTES);
      return {
        body,
        contentType: response.headers.get("content-type").split(";")[0].trim().toLowerCase(),
      };
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const rawUrl = String(req.query?.url || req.query?.hostname || "").trim();
  if (!rawUrl) {
    return res.status(400).json({ error: "url_required" });
  }
  if (rawUrl.length > MAX_INPUT_URL_LENGTH) {
    return res.status(400).json({ error: "url_too_long" });
  }

  try {
    const favicon = await fetchCreatorLinkFavicon(rawUrl);
    if (!favicon) {
      res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
      return res.status(204).end();
    }

    res.setHeader("Content-Type", favicon.contentType);
    res.setHeader("Content-Length", String(favicon.body.length));
    res.setHeader("Cache-Control", CACHE_HEADER);
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).send(favicon.body);
  } catch (error) {
    const status = Number(error?.status || 400);
    if (status === 204) {
      res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
      return res.status(204).end();
    }
    return res.status(400).json({ error: "favicon_unavailable" });
  }
}
