#!/usr/bin/env node
import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { verifyPortalTranslatorSignature } from "../../api/_portal-translator-auth.js";

const PORT = readInteger(process.env.PORTAL_TRANSLATOR_GATEWAY_PORT, 8088, 1024, 65535);
const MAX_BODY_BYTES = readInteger(process.env.PORTAL_TRANSLATOR_MAX_BODY_BYTES, 4096, 512, 65536);
const MAX_TEXT_CHARS = readInteger(process.env.PORTAL_TRANSLATOR_MAX_CHARS, 1000, 1, 1000);
const TIMEOUT_MS = readInteger(process.env.PORTAL_TRANSLATOR_TIMEOUT_MS, 5000, 500, 15000);
const RATE_LIMIT_PER_MINUTE = readInteger(process.env.PORTAL_TRANSLATOR_RATE_LIMIT_PER_MINUTE, 60, 1, 600);
const SECRET = clean(process.env.PORTAL_TRANSLATOR_SECRET);
const LIBRETRANSLATE_URL = clean(process.env.LIBRETRANSLATE_URL || "http://libretranslate:5000");
const LIBRETRANSLATE_API_KEY = clean(process.env.LIBRETRANSLATE_API_KEY);
const ALLOWED_LANGUAGES = new Set(
  clean(process.env.PORTAL_TRANSLATOR_ALLOWED_LANGUAGES || "fr,en")
    .split(",")
    .map((value) => clean(value).toLowerCase())
    .filter(Boolean),
);
const RATE_BUCKETS = new Map();

function clean(value) {
  return String(value || "").trim();
}

function readInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

function getClientIp(req) {
  return clean(req.headers["x-forwarded-for"]).split(",")[0]?.trim() || clean(req.socket?.remoteAddress) || "unknown";
}

function checkRateLimit(req) {
  const key = getClientIp(req);
  const now = Date.now();
  const cutoff = now - 60_000;
  const entries = (RATE_BUCKETS.get(key) || []).filter((timestamp) => timestamp > cutoff);
  entries.push(now);
  RATE_BUCKETS.set(key, entries);
  return entries.length <= RATE_LIMIT_PER_MINUTE;
}

async function readRawBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Corps trop volumineux.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function validatePayload(payload) {
  const text = clean(payload?.text);
  const source = clean(payload?.source || "auto").toLowerCase();
  const target = clean(payload?.target).toLowerCase();

  if (!text) return { error: "Texte vide.", status: 400 };
  if (text.length > MAX_TEXT_CHARS) return { error: `Texte trop long. Maximum ${MAX_TEXT_CHARS} caracteres.`, status: 413 };
  if (!ALLOWED_LANGUAGES.has(target)) return { error: "Langue cible non autorisee.", status: 400 };
  if (source !== "auto" && !ALLOWED_LANGUAGES.has(source)) return { error: "Langue source non autorisee.", status: 400 };
  if (source !== "auto" && source === target) {
    return { text, source, target, passthrough: true };
  }

  return { text, source, target };
}

async function callLibreTranslate({ text, source, target }) {
  const url = new URL("/translate", LIBRETRANSLATE_URL.endsWith("/") ? LIBRETRANSLATE_URL : `${LIBRETRANSLATE_URL}/`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const body = {
    q: text,
    source,
    target,
    format: "text",
  };
  if (LIBRETRANSLATE_API_KEY) body.api_key = LIBRETRANSLATE_API_KEY;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { error: payload?.error || `LibreTranslate HTTP ${response.status}`, status: response.status };
    }

    const translatedText = clean(payload?.translatedText);
    if (!translatedText) return { error: "Reponse LibreTranslate invalide.", status: 502 };
    return { translatedText };
  } catch (error) {
    return {
      error: error?.name === "AbortError" ? "Timeout LibreTranslate." : "LibreTranslate indisponible.",
      status: error?.name === "AbortError" ? 504 : 502,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function handleTranslate(req, res) {
  if (!SECRET) return sendJson(res, 503, { error: "Gateway non configuree." });
  if (!checkRateLimit(req)) return sendJson(res, 429, { error: "Trop de requetes." }, { "Retry-After": "60" });

  const rawBody = await readRawBody(req);
  const signature = clean(req.headers["x-portal-translator-signature"]);
  const timestamp = clean(req.headers["x-portal-translator-timestamp"]);

  if (!verifyPortalTranslatorSignature({ secret: SECRET, timestamp, body: rawBody, signature })) {
    return sendJson(res, 401, { error: "Signature invalide." });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return sendJson(res, 400, { error: "JSON invalide." });
  }

  const validation = validatePayload(payload);
  if (validation.error) return sendJson(res, validation.status, { error: validation.error });
  if (validation.passthrough) {
    return sendJson(res, 200, {
      translatedText: validation.text,
      detectedSourceLanguage: validation.source,
      provider: "libretranslate",
      model: clean(process.env.PORTAL_TRANSLATOR_MODEL || "argos-fr-en"),
    });
  }

  const translated = await callLibreTranslate(validation);
  if (translated.error) return sendJson(res, translated.status, { error: translated.error });

  return sendJson(res, 200, {
    translatedText: translated.translatedText,
    detectedSourceLanguage: validation.source,
    provider: "libretranslate",
    model: clean(process.env.PORTAL_TRANSLATOR_MODEL || "argos-fr-en"),
  });
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, {
        ok: true,
        service: "portal-translator-gateway",
        allowedLanguages: [...ALLOWED_LANGUAGES],
      });
    }

    if (req.method !== "POST" || url.pathname !== "/translate") {
      return sendJson(res, 405, { error: "Method not allowed" }, { Allow: "GET, POST" });
    }

    return await handleTranslate(req, res);
  } catch (error) {
    if (error?.status) return sendJson(res, error.status, { error: error.message || "Erreur requete." });
    return sendJson(res, 500, { error: "Erreur gateway." });
  }
}

http.createServer(handleRequest).listen(PORT, "0.0.0.0", async () => {
  console.log(`[portal-translator-gateway] listening port=${PORT} maxChars=${MAX_TEXT_CHARS} languages=${[...ALLOWED_LANGUAGES].join(",")}`);
  await sleep(0);
});
