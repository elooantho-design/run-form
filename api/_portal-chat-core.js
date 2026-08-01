/* global process */
import crypto from "node:crypto";
import {
  getPortalSupportedLanguageCodes,
  normalizePortalLanguageCode,
} from "../src/lib/portalSupportedLanguages.js";

export const PORTAL_CHAT_CHANNEL_KEY = "global";
export const PORTAL_CHAT_DEFAULT_PAGE_SIZE = 50;
export const PORTAL_CHAT_MAX_PAGE_SIZE = 100;
export const PORTAL_CHAT_DEFAULT_MAX_LENGTH = 1000;
export const PORTAL_CHAT_TECHNICAL_MAX_LENGTH = 10000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function cleanChatText(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

export function getChatMaxLength() {
  const configured = Number(process.env.PORTAL_CHAT_MAX_MESSAGE_LENGTH || PORTAL_CHAT_DEFAULT_MAX_LENGTH);
  if (!Number.isFinite(configured)) return PORTAL_CHAT_DEFAULT_MAX_LENGTH;
  return Math.max(1, Math.min(PORTAL_CHAT_TECHNICAL_MAX_LENGTH, Math.floor(configured)));
}

export function normalizeChatLimit(value) {
  const number = Number(value || PORTAL_CHAT_DEFAULT_PAGE_SIZE);
  if (!Number.isFinite(number)) return PORTAL_CHAT_DEFAULT_PAGE_SIZE;
  return Math.max(1, Math.min(PORTAL_CHAT_MAX_PAGE_SIZE, Math.floor(number)));
}

export function normalizeChatLanguage(value) {
  return normalizePortalLanguageCode(value, "fr");
}

export function isSupportedChatLanguage(value) {
  return getPortalSupportedLanguageCodes().includes(String(value || "").trim().toLowerCase());
}

export function validateChatBody(value) {
  const body = cleanChatText(value);
  const maxLength = getChatMaxLength();

  if (!body) return { error: "Message vide.", status: 400 };
  if (body.length > maxLength) {
    return {
      error: `Message trop long. Maximum ${maxLength} caracteres.`,
      status: 400,
      maxLength,
    };
  }

  return { body, maxLength };
}

export function isValidUuid(value) {
  return UUID_PATTERN.test(String(value || ""));
}

export function validateClientMessageId(value) {
  const clientMessageId = cleanChatText(value);
  return isValidUuid(clientMessageId) ? clientMessageId : "";
}

export function createChatBodyHash(value) {
  return crypto.createHash("sha256").update(cleanChatText(value), "utf8").digest("hex");
}

export function inferChatLanguage(value) {
  const text = cleanChatText(value);
  if (!text) return "und";

  const frenchScore = (text.match(/[àâçéèêëîïôùûüÿœ]|(?:\b(?:bonjour|salut|merci|avec|pour|dans|une|des|les|pas|est|suis|faire)\b)/gi) || []).length;
  const englishScore = (text.match(/\b(?:hello|thanks|with|for|from|this|that|the|and|you|can|please)\b/gi) || []).length;

  if (frenchScore > englishScore) return "fr";
  if (englishScore > frenchScore) return "en";
  return "und";
}

export function createMessageCursor(row) {
  return row?.created_at ? String(row.created_at) : "";
}

export function parseMessageCursor(value) {
  const raw = cleanChatText(value);
  if (!raw) return "";

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

export function normalizeChatAction(value, fallback = "list") {
  return cleanChatText(value || fallback).toLowerCase();
}

export function shouldTranslateMessage({ sourceLanguage, targetLanguage, deleted }) {
  if (deleted) return false;
  if (!targetLanguage || !isSupportedChatLanguage(targetLanguage)) return false;
  if (!sourceLanguage || sourceLanguage === "und") return true;
  return sourceLanguage !== targetLanguage;
}
