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
  resolveChatDisplayBody,
  shouldTranslateMessage,
  validateChatBody,
  validateClientMessageId,
} from "../api/_portal-chat-core.js";
import {
  getPortalChatTranslationConfig,
  translatePortalChatMessage,
} from "../api/_portal-chat-translation.js";
import { createPortalTranslatorSignature, verifyPortalTranslatorSignature } from "../api/_portal-translator-auth.js";
import { getPortalSupportedLanguageCodes } from "../src/lib/portalSupportedLanguages.js";

const previousEnabled = process.env.PORTAL_CHAT_TRANSLATION_ENABLED;
const previousProvider = process.env.PORTAL_CHAT_TRANSLATION_PROVIDER;
const previousModel = process.env.PORTAL_CHAT_TRANSLATION_MODEL;
const previousMaxLength = process.env.PORTAL_CHAT_MAX_MESSAGE_LENGTH;
const previousTranslatorUrl = process.env.PORTAL_CHAT_TRANSLATOR_URL;
const previousTranslatorSecret = process.env.PORTAL_CHAT_TRANSLATOR_SECRET;
const previousTimeout = process.env.PORTAL_CHAT_TRANSLATION_TIMEOUT_MS;
const previousMaxChars = process.env.PORTAL_CHAT_TRANSLATION_MAX_CHARS;
const previousFetch = globalThis.fetch;

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
  assert.deepEqual(
    resolveChatDisplayBody({
      bodyOriginal: "Hello everyone",
      translation: { status: "ready", translated_body: "Bonjour tout le monde" },
    }),
    {
      bodyOriginal: "Hello everyone",
      body: "Bonjour tout le monde",
      isTranslated: true,
    },
  );
  assert.deepEqual(
    resolveChatDisplayBody({
      bodyOriginal: "Hello everyone",
      translation: { status: "pending", translated_body: "" },
    }),
    {
      bodyOriginal: "Hello everyone",
      body: "Hello everyone",
      isTranslated: false,
    },
  );

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

  const rawBody = JSON.stringify({ text: "Bonjour", source: "fr", target: "en" });
  const signature = createPortalTranslatorSignature({
    secret: "test-secret",
    timestamp: "1700000000000",
    body: rawBody,
  });
  assert.match(signature, /^[a-f0-9]{64}$/);
  assert.equal(
    verifyPortalTranslatorSignature({
      secret: "test-secret",
      timestamp: "1700000000000",
      body: rawBody,
      signature,
      now: 1700000000000,
    }),
    true,
  );
  assert.equal(
    verifyPortalTranslatorSignature({
      secret: "test-secret",
      timestamp: "1700000000000",
      body: `${rawBody} `,
      signature,
      now: 1700000000000,
    }),
    false,
  );

  process.env.PORTAL_CHAT_TRANSLATION_ENABLED = "true";
  process.env.PORTAL_CHAT_TRANSLATION_PROVIDER = "libretranslate";
  process.env.PORTAL_CHAT_TRANSLATION_MODEL = "argos-fr-en";
  process.env.PORTAL_CHAT_TRANSLATOR_URL = "https://translator.example.test/translate";
  process.env.PORTAL_CHAT_TRANSLATOR_SECRET = "secret";
  process.env.PORTAL_CHAT_TRANSLATION_TIMEOUT_MS = "2000";
  process.env.PORTAL_CHAT_TRANSLATION_MAX_CHARS = "1000";

  let fetchCalls = 0;
  globalThis.fetch = async (url, options) => {
    fetchCalls += 1;
    assert.equal(url, "https://translator.example.test/translate");
    assert.equal(options.method, "POST");
    assert.ok(options.headers["X-Portal-Translator-Timestamp"]);
    assert.ok(options.headers["X-Portal-Translator-Signature"]);
    const parsed = JSON.parse(options.body);
    assert.deepEqual(parsed, { text: "Bonjour", source: "fr", target: "en" });
    return {
      ok: true,
      status: 200,
      json: async () => ({ translatedText: "Hello", detectedSourceLanguage: "fr", model: "argos-fr-en" }),
    };
  };

  const libreTranslation = await translatePortalChatMessage({
    text: "Bonjour",
    targetLanguage: "en",
    sourceLanguageHint: "fr",
  });
  assert.equal(fetchCalls, 1);
  assert.equal(libreTranslation.status, "ready");
  assert.equal(libreTranslation.translatedText, "Hello");
  assert.equal(libreTranslation.provider, "libretranslate");

  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({ error: "boom" }),
  });
  const serverErrorTranslation = await translatePortalChatMessage({
    text: "Bonjour",
    targetLanguage: "en",
    sourceLanguageHint: "fr",
  });
  assert.equal(serverErrorTranslation.status, "failed");

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ translatedText: "" }),
  });
  const emptyTranslation = await translatePortalChatMessage({
    text: "Bonjour",
    targetLanguage: "en",
    sourceLanguageHint: "fr",
  });
  assert.equal(emptyTranslation.status, "failed");

  process.env.PORTAL_CHAT_TRANSLATOR_SECRET = "";
  const missingSecretTranslation = await translatePortalChatMessage({
    text: "Bonjour",
    targetLanguage: "en",
    sourceLanguageHint: "fr",
  });
  assert.equal(missingSecretTranslation.status, "failed");

  console.log("portal-chat tests ok");
} finally {
  globalThis.fetch = previousFetch;

  if (previousEnabled === undefined) delete process.env.PORTAL_CHAT_TRANSLATION_ENABLED;
  else process.env.PORTAL_CHAT_TRANSLATION_ENABLED = previousEnabled;

  if (previousProvider === undefined) delete process.env.PORTAL_CHAT_TRANSLATION_PROVIDER;
  else process.env.PORTAL_CHAT_TRANSLATION_PROVIDER = previousProvider;

  if (previousModel === undefined) delete process.env.PORTAL_CHAT_TRANSLATION_MODEL;
  else process.env.PORTAL_CHAT_TRANSLATION_MODEL = previousModel;

  if (previousMaxLength === undefined) delete process.env.PORTAL_CHAT_MAX_MESSAGE_LENGTH;
  else process.env.PORTAL_CHAT_MAX_MESSAGE_LENGTH = previousMaxLength;

  if (previousTranslatorUrl === undefined) delete process.env.PORTAL_CHAT_TRANSLATOR_URL;
  else process.env.PORTAL_CHAT_TRANSLATOR_URL = previousTranslatorUrl;

  if (previousTranslatorSecret === undefined) delete process.env.PORTAL_CHAT_TRANSLATOR_SECRET;
  else process.env.PORTAL_CHAT_TRANSLATOR_SECRET = previousTranslatorSecret;

  if (previousTimeout === undefined) delete process.env.PORTAL_CHAT_TRANSLATION_TIMEOUT_MS;
  else process.env.PORTAL_CHAT_TRANSLATION_TIMEOUT_MS = previousTimeout;

  if (previousMaxChars === undefined) delete process.env.PORTAL_CHAT_TRANSLATION_MAX_CHARS;
  else process.env.PORTAL_CHAT_TRANSLATION_MAX_CHARS = previousMaxChars;
}
