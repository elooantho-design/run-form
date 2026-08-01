/* global process */
import { cleanChatText, inferChatLanguage, normalizeChatLanguage } from "./_portal-chat-core.js";

function readFlag(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function getTranslationProvider() {
  return cleanChatText(process.env.PORTAL_CHAT_TRANSLATION_PROVIDER).toLowerCase();
}

export function getPortalChatTranslationConfig() {
  const provider = getTranslationProvider();
  const enabled = readFlag(process.env.PORTAL_CHAT_TRANSLATION_ENABLED) && Boolean(provider);

  return {
    enabled,
    provider: provider || "disabled",
    model: cleanChatText(process.env.PORTAL_CHAT_TRANSLATION_MODEL) || "none",
  };
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

  if (config.provider === "mock") {
    return {
      status: "ready",
      translatedText: `[${target.toUpperCase()}] ${body}`,
      detectedSourceLanguage,
      provider: "mock",
      model: config.model,
    };
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
