import assert from "node:assert/strict";
import {
  cleanChatText,
  createChatBodyHash,
  getChatMaxLength,
  inferChatLanguage,
  isSupportedChatLanguage,
  normalizeChatLanguage,
  normalizeChatLimit,
  parseMessageCursor,
  shouldTranslateMessage,
  validateChatBody,
  validateClientMessageId,
} from "../api/_portal-chat-core.js";
import {
  getPortalChatTranslationConfig,
  translatePortalChatMessage,
} from "../api/_portal-chat-translation.js";
import { getPortalSupportedLanguageCodes } from "../src/lib/portalSupportedLanguages.js";

const previousEnabled = process.env.PORTAL_CHAT_TRANSLATION_ENABLED;
const previousProvider = process.env.PORTAL_CHAT_TRANSLATION_PROVIDER;
const previousMaxLength = process.env.PORTAL_CHAT_MAX_MESSAGE_LENGTH;

try {
  assert.deepEqual(getPortalSupportedLanguageCodes(), ["fr", "en"]);
  assert.equal(normalizeChatLanguage("en"), "en");
  assert.equal(normalizeChatLanguage("EN"), "en");
  assert.equal(normalizeChatLanguage("de"), "fr");
  assert.equal(isSupportedChatLanguage("fr"), true);
  assert.equal(isSupportedChatLanguage("es"), false);

  assert.equal(cleanChatText(" hello\r\nworld "), "hello\nworld");
  assert.equal(normalizeChatLimit(500), 100);
  assert.equal(normalizeChatLimit(0), 50);

  process.env.PORTAL_CHAT_MAX_MESSAGE_LENGTH = "12";
  assert.equal(getChatMaxLength(), 12);
  assert.deepEqual(validateChatBody("bon message").body, "bon message");
  assert.equal(validateChatBody(" ").status, 400);
  assert.equal(validateChatBody("message beaucoup trop long").status, 400);

  assert.ok(createChatBodyHash("abc").match(/^[a-f0-9]{64}$/));
  assert.equal(createChatBodyHash("abc"), createChatBodyHash("abc"));
  assert.notEqual(createChatBodyHash("abc"), createChatBodyHash("abcd"));

  assert.equal(validateClientMessageId("550e8400-e29b-41d4-a716-446655440000"), "550e8400-e29b-41d4-a716-446655440000");
  assert.equal(validateClientMessageId("not-a-uuid"), "");

  assert.equal(inferChatLanguage("Bonjour merci pour ton aide"), "fr");
  assert.equal(inferChatLanguage("Hello and thanks for your help"), "en");
  assert.equal(shouldTranslateMessage({ sourceLanguage: "fr", targetLanguage: "en", deleted: false }), true);
  assert.equal(shouldTranslateMessage({ sourceLanguage: "en", targetLanguage: "en", deleted: false }), false);
  assert.equal(shouldTranslateMessage({ sourceLanguage: "fr", targetLanguage: "en", deleted: true }), false);

  assert.equal(parseMessageCursor("2026-08-01T12:00:00.000Z"), "2026-08-01T12:00:00.000Z");
  assert.equal(parseMessageCursor("nope"), "");

  delete process.env.PORTAL_CHAT_TRANSLATION_ENABLED;
  delete process.env.PORTAL_CHAT_TRANSLATION_PROVIDER;
  assert.equal(getPortalChatTranslationConfig().enabled, false);
  const disabledTranslation = await translatePortalChatMessage({
    text: "Bonjour",
    targetLanguage: "en",
    sourceLanguageHint: "fr",
  });
  assert.equal(disabledTranslation.status, "disabled");

  process.env.PORTAL_CHAT_TRANSLATION_ENABLED = "true";
  process.env.PORTAL_CHAT_TRANSLATION_PROVIDER = "mock";
  const mockTranslation = await translatePortalChatMessage({
    text: "Bonjour",
    targetLanguage: "en",
    sourceLanguageHint: "fr",
  });
  assert.equal(mockTranslation.status, "ready");
  assert.equal(mockTranslation.translatedText, "[EN] Bonjour");

  console.log("portal-chat tests ok");
} finally {
  if (previousEnabled === undefined) delete process.env.PORTAL_CHAT_TRANSLATION_ENABLED;
  else process.env.PORTAL_CHAT_TRANSLATION_ENABLED = previousEnabled;

  if (previousProvider === undefined) delete process.env.PORTAL_CHAT_TRANSLATION_PROVIDER;
  else process.env.PORTAL_CHAT_TRANSLATION_PROVIDER = previousProvider;

  if (previousMaxLength === undefined) delete process.env.PORTAL_CHAT_MAX_MESSAGE_LENGTH;
  else process.env.PORTAL_CHAT_MAX_MESSAGE_LENGTH = previousMaxLength;
}
