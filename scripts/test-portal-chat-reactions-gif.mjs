import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createChatBodyHash,
  hasTranslatableChatText,
  inferChatLanguage,
  isEmojiOnlyChatBody,
  normalizeChatAttachmentDraft,
  normalizeChatEmoji,
  shouldTranslateChatBody,
  validateChatMessagePayload,
} from "../api/_portal-chat-core.js";
import {
  aggregateReactionRows,
  canAddAnotherReactionForMember,
  validateReactionEmoji,
} from "../api/_portal-chat-reactions.js";
import {
  getPortalChatGifConfig,
  getTrendingGifs,
  resolveGif,
  searchGifs,
} from "../api/_portal-chat-gif-provider.js";

const previousGifEnabled = process.env.PORTAL_CHAT_GIF_ENABLED;
const previousGifProvider = process.env.PORTAL_CHAT_GIF_PROVIDER;
const previousGifKey = process.env.PORTAL_CHAT_GIF_API_KEY;
const previousGifMax = process.env.PORTAL_CHAT_GIF_MAX_RESULTS;

try {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const chatSource = readFileSync(join(scriptDir, "../src/components/GlobalChatTab.jsx"), "utf8");

  assert.match(chatSource, /function EmojiPicker\(\{[^}]*autoFocusSearch = true/s);
  assert.match(chatSource, /searchDisabled = false/s);
  assert.match(chatSource, /autoFocusSearch=\{!searchDisabled && autoFocusSearch\}/);
  assert.match(chatSource, /searchDisabled=\{searchDisabled\}/);
  assert.match(chatSource, /autoFocusSearch=\{!isTouchMenu\}/);
  assert.match(chatSource, /searchDisabled=\{isTouchMenu\}/);
  assert.match(chatSource, /menu\.source === "touch" && pickerOpen/);
  assert.match(chatSource, /if \(menu\.source === "touch"\) return undefined/);
  assert.match(chatSource, /onPointerDown=\{openReactionPicker\}/);

  assert.equal(hasTranslatableChatText("😂🔥"), false);
  assert.equal(hasTranslatableChatText("Salut 👋"), true);
  assert.equal(isEmojiOnlyChatBody("😂🔥"), true);
  assert.equal(isEmojiOnlyChatBody("ok 😂"), false);
  assert.equal(inferChatLanguage("😂🔥"), "und");
  assert.equal(
    shouldTranslateChatBody({
      bodyOriginal: "😂🔥",
      sourceLanguage: "und",
      targetLanguage: "fr",
      deleted: false,
    }),
    false,
  );
  assert.equal(
    shouldTranslateChatBody({
      bodyOriginal: "Hello everyone",
      sourceLanguage: "en",
      targetLanguage: "fr",
      deleted: false,
    }),
    true,
  );
  assert.equal(normalizeChatEmoji("👍"), "👍");
  assert.equal(normalizeChatEmoji("ok"), "");
  assert.equal(validateReactionEmoji("❤️").emoji, "❤️");
  assert.equal(validateReactionEmoji("abc").status, 400);
  assert.equal(canAddAnotherReactionForMember(11), true);
  assert.equal(canAddAnotherReactionForMember(12), false);

  assert.deepEqual(
    aggregateReactionRows(
      [
        { message_id: "m1", member_id: "a", emoji: "👍" },
        { message_id: "m1", member_id: "b", emoji: "👍" },
        { message_id: "m1", member_id: "a", emoji: "🔥" },
      ],
      "a",
    ),
    [
      { emoji: "👍", count: 2, reactedByMe: true },
      { emoji: "🔥", count: 1, reactedByMe: true },
    ],
  );

  assert.deepEqual(
    normalizeChatAttachmentDraft({ type: "gif", provider: "mock", providerItemId: "abc" }),
    { attachmentType: "gif", provider: "mock", providerItemId: "abc" },
  );
  assert.equal(normalizeChatAttachmentDraft({ type: "image", provider: "mock", providerItemId: "abc" }), null);
  assert.equal(validateChatMessagePayload({ body: " ", attachment: null }).status, 400);
  assert.equal(validateChatMessagePayload({ body: "😂", attachment: null }).body, "😂");
  assert.equal(validateChatMessagePayload({ body: "", attachment: { type: "gif", provider: "mock", providerItemId: "abc" } }).body, "");
  assert.ok(createChatBodyHash("").match(/^[a-f0-9]{64}$/));

  process.env.PORTAL_CHAT_GIF_ENABLED = "false";
  process.env.PORTAL_CHAT_GIF_PROVIDER = "mock";
  assert.equal(getPortalChatGifConfig().enabled, false);

  process.env.PORTAL_CHAT_GIF_ENABLED = "true";
  process.env.PORTAL_CHAT_GIF_PROVIDER = "mock";
  process.env.PORTAL_CHAT_GIF_MAX_RESULTS = "8";
  assert.equal(getPortalChatGifConfig().enabled, true);
  const trending = await getTrendingGifs({ locale: "fr", limit: 3 });
  assert.equal(trending.enabled, true);
  assert.equal(trending.items.length, 3);
  assert.equal(trending.items[0].provider, "mock");
  const searched = await searchGifs({ query: "paladin", locale: "en", limit: 2 });
  assert.equal(searched.items.length, 2);
  const resolved = await resolveGif({ provider: "mock", providerItemId: "mock-item-1" });
  assert.equal(resolved.providerItemId, "mock-item-1");
  await assert.rejects(() => resolveGif({ provider: "giphy", providerItemId: "abc" }), /Fournisseur GIF/);

  console.log("portal-chat reactions/gif tests ok");
} finally {
  if (previousGifEnabled === undefined) delete process.env.PORTAL_CHAT_GIF_ENABLED;
  else process.env.PORTAL_CHAT_GIF_ENABLED = previousGifEnabled;

  if (previousGifProvider === undefined) delete process.env.PORTAL_CHAT_GIF_PROVIDER;
  else process.env.PORTAL_CHAT_GIF_PROVIDER = previousGifProvider;

  if (previousGifKey === undefined) delete process.env.PORTAL_CHAT_GIF_API_KEY;
  else process.env.PORTAL_CHAT_GIF_API_KEY = previousGifKey;

  if (previousGifMax === undefined) delete process.env.PORTAL_CHAT_GIF_MAX_RESULTS;
  else process.env.PORTAL_CHAT_GIF_MAX_RESULTS = previousGifMax;
}
