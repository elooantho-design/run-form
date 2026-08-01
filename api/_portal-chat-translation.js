/* global process */
import { cleanChatText, inferChatLanguage, normalizeChatLanguage } from "./_portal-chat-core.js";
import { createPortalTranslatorSignature } from "./_portal-translator-auth.js";

const DEFAULT_TRANSLATION_TIMEOUT_MS = 3500;
const MIN_TRANSLATION_TIMEOUT_MS = 500;
const MAX_TRANSLATION_TIMEOUT_MS = 15000;
const DEFAULT_TRANSLATION_MAX_CHARS = 1000;
const MAX_TRANSLATION_MAX_CHARS = 1000;
const PROCESS_DAILY_USAGE = new Map();

function readFlag(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function getTranslationProvider() {
  return cleanChatText(process.env.PORTAL_CHAT_TRANSLATION_PROVIDER).toLowerCase();
}

function readBoundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function getTranslatorSecret() {
  return cleanChatText(process.env.PORTAL_CHAT_TRANSLATOR_SECRET);
}

function getTranslatorUrl() {
  const raw = cleanChatText(process.env.PORTAL_CHAT_TRANSLATOR_URL);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function canConsumeDailyBudget(charCount, dailyLimit) {
  if (!dailyLimit) return true;
  const todayKey = getTodayKey();
  const used = Number(PROCESS_DAILY_USAGE.get(todayKey) || 0);
  return used + charCount <= dailyLimit;
}

function consumeDailyBudget(charCount, dailyLimit) {
  if (!dailyLimit || !charCount) return;
  const todayKey = getTodayKey();
  const used = Number(PROCESS_DAILY_USAGE.get(todayKey) || 0);
  PROCESS_DAILY_USAGE.clear();
  PROCESS_DAILY_USAGE.set(todayKey, used + charCount);
}

export function getPortalChatTranslationConfig() {
  const provider = getTranslationProvider();
  const enabled = readFlag(process.env.PORTAL_CHAT_TRANSLATION_ENABLED) && Boolean(provider);
  const maxChars = readBoundedInteger(
    process.env.PORTAL_CHAT_TRANSLATION_MAX_CHARS,
    DEFAULT_TRANSLATION_MAX_CHARS,
    1,
    MAX_TRANSLATION_MAX_CHARS,
  );
  const timeoutMs = readBoundedInteger(
    process.env.PORTAL_CHAT_TRANSLATION_TIMEOUT_MS,
    DEFAULT_TRANSLATION_TIMEOUT_MS,
    MIN_TRANSLATION_TIMEOUT_MS,
    MAX_TRANSLATION_TIMEOUT_MS,
  );
  const dailyCharLimit = readBoundedInteger(process.env.PORTAL_CHAT_TRANSLATION_DAILY_CHAR_LIMIT, 0, 0, 5_000_000);

  return {
    enabled,
    provider: provider || "disabled",
    model: cleanChatText(process.env.PORTAL_CHAT_TRANSLATION_MODEL) || "none",
    maxChars,
    timeoutMs,
    dailyCharLimit,
  };
}

async function translateWithLibreTranslateGateway({ body, target, detectedSourceLanguage, config }) {
  const url = getTranslatorUrl();
  const secret = getTranslatorSecret();

  if (!url || !secret) {
    return {
      status: "failed",
      translatedText: "",
      detectedSourceLanguage,
      provider: config.provider,
      model: config.model,
      error: "Passerelle de traduction non configuree.",
    };
  }

  const payload = {
    text: body,
    source: detectedSourceLanguage && detectedSourceLanguage !== "und" ? detectedSourceLanguage : "auto",
    target,
  };
  const rawBody = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const signature = createPortalTranslatorSignature({ secret, timestamp, body: rawBody });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Portal-Translator-Timestamp": timestamp,
        "X-Portal-Translator-Signature": signature,
      },
      body: rawBody,
      signal: controller.signal,
    });

    const responsePayload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        status: "failed",
        translatedText: "",
        detectedSourceLanguage: responsePayload?.detectedSourceLanguage || detectedSourceLanguage,
        provider: config.provider,
        model: config.model,
        error: responsePayload?.error || `Traducteur indisponible (${response.status}).`,
      };
    }

    const translatedText = cleanChatText(
      responsePayload?.translatedText || responsePayload?.translated_text || responsePayload?.translatedBody,
    );

    if (!translatedText) {
      return {
        status: "failed",
        translatedText: "",
        detectedSourceLanguage: responsePayload?.detectedSourceLanguage || detectedSourceLanguage,
        provider: config.provider,
        model: config.model,
        error: "Traduction vide.",
      };
    }

    return {
      status: "ready",
      translatedText,
      detectedSourceLanguage: responsePayload?.detectedSourceLanguage || detectedSourceLanguage,
      provider: "libretranslate",
      model: responsePayload?.model || config.model,
    };
  } catch (error) {
    return {
      status: "failed",
      translatedText: "",
      detectedSourceLanguage,
      provider: config.provider,
      model: config.model,
      error: error?.name === "AbortError" ? "Timeout traduction." : "Traducteur indisponible.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function translatePortalChatMessage({ text, targetLanguage, sourceLanguageHint } = {}) {
  const body = cleanChatText(text);
  const target = normalizeChatLanguage(targetLanguage);
  const detectedSourceLanguage = sourceLanguageHint || inferChatLanguage(body);
  const config = getPortalChatTranslationConfig();

  if (!body) {
    return {
      status: "failed",
      translatedText: "",
      detectedSourceLanguage,
      provider: config.provider,
      model: config.model,
      error: "Message vide.",
    };
  }

  if (!config.enabled) {
    return {
      status: "disabled",
      translatedText: "",
      detectedSourceLanguage,
      provider: "disabled",
      model: "none",
      error: "Traduction automatique non configuree.",
    };
  }

  if (body.length > config.maxChars) {
    return {
      status: "failed",
      translatedText: "",
      detectedSourceLanguage,
      provider: config.provider,
      model: config.model,
      error: `Message trop long pour la traduction. Maximum ${config.maxChars} caracteres.`,
    };
  }

  if (!canConsumeDailyBudget(body.length, config.dailyCharLimit)) {
    return {
      status: "failed",
      translatedText: "",
      detectedSourceLanguage,
      provider: config.provider,
      model: config.model,
      error: "Limite journaliere de traduction atteinte.",
    };
  }

  if (config.provider === "mock") {
    consumeDailyBudget(body.length, config.dailyCharLimit);
    return {
      status: "ready",
      translatedText: `[${target.toUpperCase()}] ${body}`,
      detectedSourceLanguage,
      provider: "mock",
      model: config.model,
    };
  }

  if (config.provider === "libretranslate") {
    const result = await translateWithLibreTranslateGateway({
      body,
      target,
      detectedSourceLanguage,
      config,
    });
    if (result.status === "ready") consumeDailyBudget(body.length, config.dailyCharLimit);
    return result;
  }

  return {
    status: "failed",
    translatedText: "",
    detectedSourceLanguage,
    provider: config.provider,
    model: config.model,
    error: `Provider de traduction non implemente: ${config.provider}.`,
  };
}
