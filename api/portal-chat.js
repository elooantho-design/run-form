/* global process */
import { createClient } from "@supabase/supabase-js";
import {
  applyPortalCorsHeaders,
  readJsonBody,
  requirePortalLeaderSession,
  sendPortalJson,
  verifyPortalRequestOrigin,
} from "./_portal-auth.js";
import {
  PORTAL_CHAT_CHANNEL_KEY,
  cleanChatText,
  createChatBodyHash,
  createMessageCursor,
  getChatMaxLength,
  inferChatLanguage,
  normalizeChatAction,
  normalizeChatLanguage,
  normalizeChatLimit,
  parseMessageCursor,
  resolveChatDisplayBody,
  shouldTranslateChatBody,
  validateChatMessagePayload,
  validateClientMessageId,
} from "./_portal-chat-core.js";
import {
  getPortalChatTranslationConfig,
} from "./_portal-chat-translation.js";
import {
  enqueuePortalChatTranslationJob,
  isReadyTranslationForConfig,
} from "./_portal-chat-queue.js";
import {
  checkReactionRateLimit,
  checkReactionSchema,
  loadReactionsForMessageIds,
  countMemberReactionsOnMessage,
  canAddAnotherReactionForMember,
  isMissingReactionSchema,
  validateReactionEmoji,
} from "./_portal-chat-reactions.js";
import {
  CHAT_ATTACHMENT_SELECT,
  checkAttachmentSchema,
  isMissingAttachmentSchema,
  loadAttachmentsForMessageIds,
} from "./_portal-chat-attachments.js";
import {
  loadCosmeticsForMemberIds,
} from "./_portal-cosmetics.js";
import {
  checkGifSearchRateLimit,
  getPortalChatGifConfig,
  getTrendingGifs,
  resolveGif,
  searchGifs,
} from "./_portal-chat-gif-provider.js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const MESSAGE_SELECT = [
  "id",
  "channel_key",
  "client_message_id",
  "author_member_id",
  "body_original",
  "body_hash",
  "source_language",
  "language_hint",
  "reply_to_message_id",
  "translation_status",
  "created_at",
  "deleted_at",
].join(", ");

const TRANSLATION_SELECT = [
  "id",
  "message_id",
  "target_language",
  "source_hash",
  "translated_body",
  "provider",
  "model",
  "status",
  "created_at",
].join(", ");

const MEMBER_SELECT = "id, watcher_name, discord_id, role, guild_code";
const SPAM_WINDOW_SECONDS = 10;
const SPAM_WINDOW_MAX_MESSAGES = 4;
const DUPLICATE_WINDOW_SECONDS = 15;
const PROCESS_IP_BUCKETS = new Map();

function parseChatBoolean(value) {
  return ["1", "true", "yes", "on"].includes(cleanChatText(value).toLowerCase());
}

function isPortalChatReactionsEnabled() {
  return parseChatBoolean(process.env.PORTAL_CHAT_REACTIONS_ENABLED);
}

function isMissingChatSchema(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    error?.code === "PGRST204" ||
    message.includes("portal_chat_messages") ||
    message.includes("portal_chat_message_translations") ||
    message.includes("portal_chat_message_reactions") ||
    message.includes("portal_chat_message_attachments")
  );
}

function getRequestIp(req) {
  return cleanChatText(req?.headers?.["x-forwarded-for"]).split(",")[0]?.trim() || cleanChatText(req?.socket?.remoteAddress);
}

function checkProcessIpRateLimit(req) {
  const ip = getRequestIp(req);
  if (!ip) return null;

  const now = Date.now();
  const cutoff = now - 5000;
  const entries = (PROCESS_IP_BUCKETS.get(ip) || []).filter((timestamp) => timestamp > cutoff);
  entries.push(now);
  PROCESS_IP_BUCKETS.set(ip, entries);

  if (entries.length > 8) {
    return {
      error: "Trop de requetes. Patiente quelques secondes.",
      status: 429,
    };
  }

  return null;
}

async function loadAuthorMap(memberIds) {
  const ids = [...new Set((memberIds || []).map((value) => cleanChatText(value)).filter(Boolean))];
  if (!ids.length) return new Map();

  const { data, error } = await supabase
    .from("guild_members")
    .select(MEMBER_SELECT)
    .in("id", ids);

  if (error) throw error;
  const cosmeticsByMemberId = await loadCosmeticsForMemberIds(supabase, (data || []).map((member) => member.id));
  return new Map(
    (data || []).map((member) => [
      String(member.id),
      {
        ...member,
        cosmetics: cosmeticsByMemberId.get(String(member.id)) || null,
      },
    ]),
  );
}

function serializeAuthor(member, fallbackId = "") {
  const displayName = member?.watcher_name || member?.discord_id || "Joueur";
  return {
    id: member?.id || fallbackId || null,
    displayName,
    discordId: member?.discord_id || "",
    guildCode: member?.guild_code || "",
    avatarUrl: member?.cosmetics?.avatar?.url || null,
    cosmetics: member?.cosmetics || null,
    initial: displayName.slice(0, 1).toUpperCase() || "?",
  };
}

async function loadReplyPreviewMap(rows, targetLanguage, { loadAttachments = false } = {}) {
  const replyIds = [
    ...new Set((rows || []).map((row) => cleanChatText(row.reply_to_message_id)).filter(Boolean)),
  ];
  if (!replyIds.length) return new Map();

  const { data, error } = await supabase
    .from("portal_chat_messages")
    .select(MESSAGE_SELECT)
    .in("id", replyIds);

  if (error) throw error;

  const authors = await loadAuthorMap((data || []).map((row) => row.author_member_id));
  const activeReplyRows = (data || []).filter((row) => !row.deleted_at);
  const translationCache = await loadTranslations(activeReplyRows, targetLanguage);
  const attachmentMap = loadAttachments
    ? await loadAttachmentsForMessageIds(supabase, activeReplyRows.map((row) => row.id))
    : new Map();
  const replyMap = new Map();

  for (const row of data || []) {
    const deleted = Boolean(row.deleted_at);
    const author = authors.get(String(row.author_member_id || ""));
    const serializedAuthor = serializeAuthor(author, row.author_member_id);
    const translationKey = `${row.id}:${row.body_hash}`;
    const translation = deleted
      ? { status: "deleted", translated_body: "" }
      : await ensureTranslation(row, targetLanguage, translationCache.get(translationKey));
    const displayBody = resolveChatDisplayBody({ bodyOriginal: row.body_original, translation });

    const preview = {
      id: row.id,
      author: serializedAuthor,
      authorName: serializedAuthor.displayName,
      deleted,
    };

    if (deleted) {
      replyMap.set(String(row.id), {
        ...preview,
        body: null,
        translation: null,
        attachments: [],
      });
      continue;
    }

    replyMap.set(String(row.id), {
      ...preview,
      bodyOriginal: cleanChatText(row.body_original).slice(0, 180),
      body: cleanChatText(displayBody.body).slice(0, 180),
      isTranslated: displayBody.isTranslated,
      attachments: attachmentMap.get(String(row.id)) || [],
    });
  }

  return replyMap;
}

async function loadTranslations(rows, targetLanguage) {
  const candidates = (rows || []).filter((row) =>
    shouldTranslateChatBody({
      bodyOriginal: row.body_original,
      sourceLanguage: row.source_language,
      targetLanguage,
      deleted: Boolean(row.deleted_at),
    }),
  );
  if (!candidates.length) return new Map();

  const messageIds = [...new Set(candidates.map((row) => row.id))];
  const sourceHashes = [...new Set(candidates.map((row) => row.body_hash).filter(Boolean))];
  if (!messageIds.length || !sourceHashes.length) return new Map();

  const { data, error } = await supabase
    .from("portal_chat_message_translations")
    .select(TRANSLATION_SELECT)
    .in("message_id", messageIds)
    .in("source_hash", sourceHashes)
    .eq("target_language", targetLanguage);

  if (error) throw error;
  return new Map((data || []).map((translation) => [`${translation.message_id}:${translation.source_hash}`, translation]));
}

async function ensureTranslation(row, targetLanguage, existingTranslation) {
  const translationConfig = getPortalChatTranslationConfig();

  if (isReadyTranslationForConfig(existingTranslation, translationConfig)) {
    return existingTranslation;
  }

  if (
    !shouldTranslateChatBody({
      bodyOriginal: row.body_original,
      sourceLanguage: row.source_language,
      targetLanguage,
      deleted: Boolean(row.deleted_at),
    })
  ) {
    return {
      status: "original",
      translated_body: "",
      provider: "none",
      model: "none",
    };
  }

  if (!translationConfig.enabled) {
    return {
      status: "disabled",
      translated_body: "",
      provider: "disabled",
      model: "none",
    };
  }

  try {
    await enqueuePortalChatTranslationJob(supabase, row, targetLanguage, translationConfig);
  } catch (error) {
    return {
      status: "failed",
      translated_body: "",
      provider: translationConfig.provider,
      model: translationConfig.model,
      error: error?.message || "Mise en file de traduction impossible.",
    };
  }

  return {
    status: "pending",
    translated_body: "",
    provider: translationConfig.provider,
    model: translationConfig.model,
  };
}

async function serializeMessages(rows, { targetLanguage, actorMember }) {
  const visibleRows = (rows || []).filter((row) => !row.deleted_at);
  const authors = await loadAuthorMap(visibleRows.map((row) => row.author_member_id));
  const reactionsEnabled = isPortalChatReactionsEnabled();
  const gifConfig = getPortalChatGifConfig();
  const [attachmentsReady, contentTypeReady] = gifConfig.enabled
    ? await Promise.all([
        checkAttachmentSchema(supabase),
        checkMessageContentTypeSchema(),
      ])
    : [false, false];
  const shouldLoadAttachments = Boolean(gifConfig.enabled && attachmentsReady && contentTypeReady);
  const replyPreviews = await loadReplyPreviewMap(visibleRows, targetLanguage, { loadAttachments: shouldLoadAttachments });
  const translationCache = await loadTranslations(visibleRows, targetLanguage);
  const messageIds = visibleRows.map((row) => row.id);
  const [attachmentMap, reactionMap] = await Promise.all([
    shouldLoadAttachments ? loadAttachmentsForMessageIds(supabase, messageIds) : Promise.resolve(new Map()),
    reactionsEnabled ? loadReactionsForMessageIds(supabase, messageIds, actorMember?.id) : Promise.resolve(new Map()),
  ]);
  const translationConfig = getPortalChatTranslationConfig();

  const serialized = [];
  for (const row of visibleRows) {
    const author = serializeAuthor(authors.get(String(row.author_member_id || "")), row.author_member_id);
    const translationKey = `${row.id}:${row.body_hash}`;
    const translation = await ensureTranslation(row, targetLanguage, translationCache.get(translationKey));
    const displayBody = resolveChatDisplayBody({ bodyOriginal: row.body_original, translation });
    const isOwnMessage = String(row.author_member_id || "") === String(actorMember?.id || "");
    const isLeader = cleanChatText(actorMember?.role)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase() === "leader";

    serialized.push({
      id: row.id,
      channelKey: row.channel_key || PORTAL_CHAT_CHANNEL_KEY,
      author,
      createdAt: row.created_at,
      deletedAt: null,
      deleted: false,
      bodyOriginal: displayBody.bodyOriginal,
      body: displayBody.body,
      sourceLanguage: row.source_language || "und",
      targetLanguage,
      isTranslated: displayBody.isTranslated,
      translationStatus: translation?.status || (translationConfig.enabled ? "pending" : "disabled"),
      translationProvider: translation?.provider || translationConfig.provider,
      canShowOriginal: displayBody.isTranslated,
      replyTo: replyPreviews.get(String(row.reply_to_message_id || "")) || null,
      attachments: attachmentMap.get(String(row.id)) || [],
      reactions: reactionMap.get(String(row.id)) || [],
      permissions: {
        canDelete: isOwnMessage || isLeader,
        canReact: reactionsEnabled && reactionMap.has(String(row.id)),
      },
      cursor: createMessageCursor(row),
    });
  }

  return serialized;
}

async function checkAntiSpam({ req, member, bodyHash, skipDuplicate = false }) {
  const ipCheck = checkProcessIpRateLimit(req);
  if (ipCheck) return ipCheck;

  const now = Date.now();
  const spamSince = new Date(now - SPAM_WINDOW_SECONDS * 1000).toISOString();
  const duplicateSince = new Date(now - DUPLICATE_WINDOW_SECONDS * 1000).toISOString();

  const { count, error: countError } = await supabase
    .from("portal_chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("channel_key", PORTAL_CHAT_CHANNEL_KEY)
    .eq("author_member_id", member.id)
    .is("deleted_at", null)
    .gte("created_at", spamSince);

  if (countError) return { error: countError.message || "Verification anti-spam impossible.", status: 500 };
  if (Number(count || 0) >= SPAM_WINDOW_MAX_MESSAGES) {
    return { error: "Trop de messages en peu de temps. Patiente quelques secondes.", status: 429 };
  }

  if (!skipDuplicate) {
    const { data: duplicate, error: duplicateError } = await supabase
      .from("portal_chat_messages")
      .select("id")
      .eq("channel_key", PORTAL_CHAT_CHANNEL_KEY)
      .eq("author_member_id", member.id)
      .eq("body_hash", bodyHash)
      .is("deleted_at", null)
      .gte("created_at", duplicateSince)
      .limit(1)
      .maybeSingle();

    if (duplicateError) return { error: duplicateError.message || "Verification doublon impossible.", status: 500 };
    if (duplicate?.id) return { error: "Message identique deja envoye.", status: 429 };
  }

  return null;
}

async function getChatFeatureConfig() {
  const gifConfig = getPortalChatGifConfig();
  const reactionsEnabled = isPortalChatReactionsEnabled();
  const reactionsReady = reactionsEnabled ? await checkReactionSchema(supabase) : false;
  const [attachmentsReady, contentTypeReady] = gifConfig.enabled
    ? await Promise.all([
        checkAttachmentSchema(supabase),
        checkMessageContentTypeSchema(),
      ])
    : [false, false];

  return {
    reactions: {
      enabled: Boolean(reactionsEnabled && reactionsReady),
    },
    gif: {
      enabled: Boolean(gifConfig.enabled && attachmentsReady && contentTypeReady),
      provider: gifConfig.provider,
      maxResults: gifConfig.maxResults,
      attribution: gifConfig.provider === "giphy" ? "GIPHY" : "",
      schemaReady: attachmentsReady && contentTypeReady,
    },
  };
}

async function checkMessageContentTypeSchema() {
  const { error } = await supabase
    .from("portal_chat_messages")
    .select("content_type", { count: "exact", head: true })
    .limit(1);

  if (!error) return true;
  if (error?.code === "PGRST204" || `${error?.message || ""}`.toLowerCase().includes("content_type")) return false;
  if (isMissingChatSchema(error)) return false;
  throw error;
}

async function listMessages(req, res, member, params) {
  const targetLanguage = normalizeChatLanguage(params.targetLanguage || params.language);
  const limit = normalizeChatLimit(params.limit);
  const before = parseMessageCursor(params.before);

  let query = supabase
    .from("portal_chat_messages")
    .select(MESSAGE_SELECT)
    .eq("channel_key", PORTAL_CHAT_CHANNEL_KEY)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (before) query = query.lt("created_at", before);

  const { data, error } = await query;
  if (error) {
    const status = isMissingChatSchema(error) ? 503 : 500;
    return sendPortalJson(res, status, { error: error.message || "Chargement chat impossible.", schemaReady: false }, req);
  }

  const rows = data || [];
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const messages = await serializeMessages(pageRows, { targetLanguage, actorMember: member });

  return sendPortalJson(res, 200, {
    success: true,
    schemaReady: true,
    messages,
    page: {
      hasMore,
      before: messages.length ? messages[messages.length - 1].cursor : "",
    },
    config: {
      channelKey: PORTAL_CHAT_CHANNEL_KEY,
      targetLanguage,
      maxLength: getChatMaxLength(),
      translation: getPortalChatTranslationConfig(),
      features: await getChatFeatureConfig(),
      pollingMs: 4000,
    },
  }, req);
}

async function loadUpdates(req, res, member, params) {
  const targetLanguage = normalizeChatLanguage(params.targetLanguage || params.language);
  const after = parseMessageCursor(params.after);
  const limit = normalizeChatLimit(params.limit || 100);

  if (!after) {
    return sendPortalJson(res, 400, { error: "Curseur de mise a jour manquant." }, req);
  }

  const { data, error } = await supabase
    .from("portal_chat_messages")
    .select(MESSAGE_SELECT)
    .eq("channel_key", PORTAL_CHAT_CHANNEL_KEY)
    .is("deleted_at", null)
    .gt("created_at", after)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit);

  if (error) {
    const status = isMissingChatSchema(error) ? 503 : 500;
    return sendPortalJson(res, status, { error: error.message || "Mise a jour chat impossible.", schemaReady: false }, req);
  }

  const messages = await serializeMessages(data || [], { targetLanguage, actorMember: member });
  return sendPortalJson(res, 200, { success: true, messages }, req);
}

async function loadMessageContext(req, res, member, params) {
  const targetLanguage = normalizeChatLanguage(params.targetLanguage || params.language);
  const messageId = cleanChatText(params.messageId || params.message_id || params.id);
  if (!messageId) return sendPortalJson(res, 400, { error: "Message cible manquant." }, req);

  const { data: target, error: targetError } = await supabase
    .from("portal_chat_messages")
    .select(MESSAGE_SELECT)
    .eq("id", messageId)
    .eq("channel_key", PORTAL_CHAT_CHANNEL_KEY)
    .maybeSingle();

  if (targetError) {
    const status = isMissingChatSchema(targetError) ? 503 : 500;
    return sendPortalJson(res, status, { error: targetError.message || "Lecture du message cible impossible." }, req);
  }

  if (!target) return sendPortalJson(res, 404, { error: "Message d'origine introuvable.", unavailable: true }, req);
  if (target.deleted_at) {
    return sendPortalJson(res, 410, { error: "Message d'origine supprime.", unavailable: true, deletedMessageId: target.id }, req);
  }

  const [beforeResult, afterResult] = await Promise.all([
    supabase
      .from("portal_chat_messages")
      .select(MESSAGE_SELECT)
      .eq("channel_key", PORTAL_CHAT_CHANNEL_KEY)
      .is("deleted_at", null)
      .lt("created_at", target.created_at)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(25),
    supabase
      .from("portal_chat_messages")
      .select(MESSAGE_SELECT)
      .eq("channel_key", PORTAL_CHAT_CHANNEL_KEY)
      .is("deleted_at", null)
      .gt("created_at", target.created_at)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(25),
  ]);

  const contextError = beforeResult.error || afterResult.error;
  if (contextError) {
    const status = isMissingChatSchema(contextError) ? 503 : 500;
    return sendPortalJson(res, status, { error: contextError.message || "Chargement du contexte impossible." }, req);
  }

  const rowMap = new Map();
  for (const row of [...(beforeResult.data || []).reverse(), target, ...(afterResult.data || [])]) {
    if (row?.id && !row.deleted_at) rowMap.set(String(row.id), row);
  }

  const messages = await serializeMessages([...rowMap.values()], { targetLanguage, actorMember: member });
  return sendPortalJson(res, 200, { success: true, messages, targetMessageId: target.id }, req);
}

async function loadReactionState(req, res, member, body) {
  if (!isPortalChatReactionsEnabled()) {
    return sendPortalJson(res, 200, {
      success: true,
      enabled: false,
      reactionsByMessageId: {},
      deletedMessageIds: [],
    }, req);
  }

  const ids = Array.isArray(body.messageIds || body.message_ids)
    ? body.messageIds || body.message_ids
    : [];
  const safeIds = [...new Set(ids.map((value) => cleanChatText(value)).filter(Boolean))].slice(0, 100);
  const reactionMap = await loadReactionsForMessageIds(supabase, safeIds, member.id);
  const { data: deletedRows, error: deletedError } = await supabase
    .from("portal_chat_messages")
    .select("id")
    .in("id", safeIds)
    .not("deleted_at", "is", null);

  if (deletedError) {
    const status = isMissingChatSchema(deletedError) ? 503 : 500;
    return sendPortalJson(res, status, { error: deletedError.message || "Verification suppressions impossible." }, req);
  }

  const reactionsByMessageId = {};
  for (const id of safeIds) reactionsByMessageId[id] = reactionMap.get(id) || [];
  return sendPortalJson(res, 200, {
    success: true,
    reactionsByMessageId,
    deletedMessageIds: (deletedRows || []).map((row) => row.id).filter(Boolean),
  }, req);
}

async function toggleReaction(req, res, member, body) {
  if (!isPortalChatReactionsEnabled()) {
    return sendPortalJson(res, 503, { error: "Les reactions ne sont pas activees.", schemaReady: false }, req);
  }

  const messageId = cleanChatText(body.messageId || body.message_id || body.id);
  const validation = validateReactionEmoji(body.emoji);
  if (!messageId) return sendPortalJson(res, 400, { error: "Message manquant." }, req);
  if (validation.error) return sendPortalJson(res, validation.status, { error: validation.error }, req);

  const rateLimit = checkReactionRateLimit(member.id);
  if (rateLimit) return sendPortalJson(res, rateLimit.status, { error: rateLimit.error }, req);

  const { data: message, error: messageError } = await supabase
    .from("portal_chat_messages")
    .select("id, channel_key, deleted_at")
    .eq("id", messageId)
    .maybeSingle();

  if (messageError) return sendPortalJson(res, 500, { error: messageError.message || "Lecture message impossible." }, req);
  if (!message || message.channel_key !== PORTAL_CHAT_CHANNEL_KEY || message.deleted_at) {
    return sendPortalJson(res, 404, { error: "Message introuvable ou supprime." }, req);
  }

  const existing = await supabase
    .from("portal_chat_message_reactions")
    .select("id")
    .eq("message_id", messageId)
    .eq("member_id", member.id)
    .eq("emoji", validation.emoji)
    .maybeSingle();

  if (existing.error) {
    const status = isMissingReactionSchema(existing.error) ? 503 : 500;
    return sendPortalJson(res, status, { error: existing.error.message || "Reaction indisponible.", schemaReady: false }, req);
  }

  let reactedByMe = false;
  if (existing.data?.id) {
    const { error } = await supabase
      .from("portal_chat_message_reactions")
      .delete()
      .eq("id", existing.data.id)
      .eq("member_id", member.id);
    if (error) return sendPortalJson(res, 500, { error: error.message || "Retrait reaction impossible." }, req);
  } else {
    const memberReactionCount = await countMemberReactionsOnMessage(supabase, messageId, member.id);
    if (!memberReactionCount.schemaReady) {
      return sendPortalJson(res, 503, { error: "Les reactions ne sont pas encore configurees.", schemaReady: false }, req);
    }
    if (!canAddAnotherReactionForMember(memberReactionCount.count)) {
      return sendPortalJson(res, 429, { error: "Trop de reactions differentes sur ce message." }, req);
    }

    const { error } = await supabase
      .from("portal_chat_message_reactions")
      .insert({
        message_id: messageId,
        member_id: member.id,
        emoji: validation.emoji,
      });
    if (error && error.code !== "23505") {
      const status = isMissingReactionSchema(error) ? 503 : 500;
      return sendPortalJson(res, status, { error: error.message || "Ajout reaction impossible.", schemaReady: false }, req);
    }
    reactedByMe = true;
  }

  const reactionMap = await loadReactionsForMessageIds(supabase, [messageId], member.id);
  return sendPortalJson(res, 200, {
    success: true,
    messageId,
    emoji: validation.emoji,
    reactedByMe,
    reactions: reactionMap.get(messageId) || [],
  }, req);
}

async function loadGifResults(req, res, member, params) {
  const rateLimit = checkGifSearchRateLimit(member.id);
  if (rateLimit) return sendPortalJson(res, rateLimit.status, { error: rateLimit.error }, req);

  const config = getPortalChatGifConfig();
  if (!config.enabled) {
    return sendPortalJson(res, 200, {
      success: true,
      enabled: false,
      provider: config.provider,
      items: [],
      nextCursor: "",
    }, req);
  }

  const [attachmentsReady, contentTypeReady] = await Promise.all([
    checkAttachmentSchema(supabase),
    checkMessageContentTypeSchema(),
  ]);
  if (!attachmentsReady || !contentTypeReady) {
    return sendPortalJson(res, 200, {
      success: true,
      enabled: false,
      provider: config.provider,
      items: [],
      nextCursor: "",
      schemaReady: false,
    }, req);
  }

  try {
    const query = cleanChatText(params.query || params.q);
    const payload = query
      ? await searchGifs({ query, locale: params.language || params.targetLanguage, cursor: params.cursor, limit: params.limit })
      : await getTrendingGifs({ locale: params.language || params.targetLanguage, cursor: params.cursor, limit: params.limit });
    return sendPortalJson(res, 200, { success: true, ...payload }, req);
  } catch (error) {
    return sendPortalJson(res, 502, { error: error?.message || "Recherche GIF indisponible." }, req);
  }
}

async function sendMessage(req, res, member, body) {
  const validation = validateChatMessagePayload({
    body: body.body || body.message || body.text,
    attachment: body.attachment || body.gif || null,
  });
  if (validation.error) return sendPortalJson(res, validation.status, { error: validation.error }, req);

  const clientMessageId = validateClientMessageId(body.clientMessageId || body.client_message_id);
  if (!clientMessageId) return sendPortalJson(res, 400, { error: "Identifiant client invalide." }, req);

  const targetLanguage = normalizeChatLanguage(body.targetLanguage || body.language);
  const replyToMessageId = cleanChatText(body.replyToMessageId || body.reply_to_message_id) || null;
  const bodyHash = createChatBodyHash(validation.body);
  const sourceLanguage = inferChatLanguage(validation.body);
  let resolvedAttachment = null;

  if (validation.attachment) {
    const gifConfig = getPortalChatGifConfig();
    if (!gifConfig.enabled) {
      return sendPortalJson(res, 503, { error: "Les GIF du chat ne sont pas actives.", schemaReady: false }, req);
    }

    const [attachmentsReady, contentTypeReady] = await Promise.all([
      checkAttachmentSchema(supabase),
      checkMessageContentTypeSchema(),
    ]);
    if (!attachmentsReady || !contentTypeReady) {
      return sendPortalJson(res, 503, { error: "Les pieces jointes du chat ne sont pas encore configurees.", schemaReady: false }, req);
    }

    try {
      resolvedAttachment = await resolveGif({
        provider: validation.attachment.provider,
        providerItemId: validation.attachment.providerItemId,
      });
    } catch (error) {
      return sendPortalJson(res, 400, { error: error?.message || "GIF invalide." }, req);
    }
  }

  if (replyToMessageId) {
    const { data: reply, error: replyError } = await supabase
      .from("portal_chat_messages")
      .select("id, channel_key")
      .eq("id", replyToMessageId)
      .is("deleted_at", null)
      .maybeSingle();

    if (replyError) return sendPortalJson(res, 500, { error: replyError.message || "Verification reponse impossible." }, req);
    if (!reply || reply.channel_key !== PORTAL_CHAT_CHANNEL_KEY) {
      return sendPortalJson(res, 404, { error: "Message de reponse introuvable." }, req);
    }
  }

  const spamCheck = await checkAntiSpam({ req, member, bodyHash, skipDuplicate: Boolean(resolvedAttachment && !validation.body) });
  if (spamCheck) return sendPortalJson(res, spamCheck.status, { error: spamCheck.error }, req);

  const translationNeeded = shouldTranslateChatBody({
    bodyOriginal: validation.body,
    sourceLanguage,
    targetLanguage,
    deleted: false,
  });
  const translationConfig = getPortalChatTranslationConfig();
  const insertPayload = {
    channel_key: PORTAL_CHAT_CHANNEL_KEY,
    client_message_id: clientMessageId,
    author_member_id: member.id,
    body_original: validation.body,
    body_hash: bodyHash,
    source_language: sourceLanguage,
    language_hint: targetLanguage,
    reply_to_message_id: replyToMessageId,
    translation_status: translationNeeded ? (translationConfig.enabled ? "pending" : "disabled") : "ready",
  };

  if (resolvedAttachment) {
    insertPayload.content_type = validation.body ? "mixed" : "gif";
  }

  let row;
  const inserted = await supabase
    .from("portal_chat_messages")
    .insert(insertPayload)
    .select(MESSAGE_SELECT)
    .maybeSingle();

  if (inserted.error?.code === "23505") {
    const existing = await supabase
      .from("portal_chat_messages")
      .select(MESSAGE_SELECT)
      .eq("author_member_id", member.id)
      .eq("client_message_id", clientMessageId)
      .maybeSingle();
    if (existing.error) return sendPortalJson(res, 500, { error: existing.error.message || "Lecture message impossible." }, req);
    row = existing.data;
  } else if (inserted.error) {
    const status = isMissingChatSchema(inserted.error) ? 503 : 500;
    return sendPortalJson(res, status, { error: inserted.error.message || "Envoi message impossible.", schemaReady: false }, req);
  } else {
    row = inserted.data;
  }

  if (row?.id && resolvedAttachment) {
    const attachmentInsert = await supabase
      .from("portal_chat_message_attachments")
      .insert({
        message_id: row.id,
        attachment_type: "gif",
        provider: resolvedAttachment.provider,
        provider_item_id: resolvedAttachment.providerItemId,
        media_url: resolvedAttachment.mediaUrl,
        preview_url: resolvedAttachment.previewUrl || resolvedAttachment.mediaUrl,
        width: resolvedAttachment.width,
        height: resolvedAttachment.height,
        title: resolvedAttachment.title,
      })
      .select(CHAT_ATTACHMENT_SELECT)
      .maybeSingle();

    if (attachmentInsert.error && attachmentInsert.error.code !== "23505") {
      await supabase
        .from("portal_chat_messages")
        .update({ deleted_at: new Date().toISOString(), translation_status: "disabled" })
        .eq("id", row.id);
      const status = isMissingAttachmentSchema(attachmentInsert.error) ? 503 : 500;
      return sendPortalJson(res, status, {
        error: attachmentInsert.error.message || "Enregistrement du GIF impossible.",
        schemaReady: status !== 503,
      }, req);
    }
  }

  const messages = await serializeMessages(row ? [row] : [], { targetLanguage, actorMember: member });
  return sendPortalJson(res, 200, { success: true, message: messages[0] || null }, req);
}

async function deleteMessage(req, res, member, body) {
  const messageId = cleanChatText(body.messageId || body.message_id || body.id);
  const targetLanguage = normalizeChatLanguage(body.targetLanguage || body.language);
  if (!messageId) return sendPortalJson(res, 400, { error: "Message manquant." }, req);

  const { data: existing, error: readError } = await supabase
    .from("portal_chat_messages")
    .select(MESSAGE_SELECT)
    .eq("id", messageId)
    .maybeSingle();

  if (readError) return sendPortalJson(res, 500, { error: readError.message || "Lecture message impossible." }, req);
  if (!existing) return sendPortalJson(res, 404, { error: "Message introuvable." }, req);

  const { data, error } = await supabase
    .from("portal_chat_messages")
    .update({ deleted_at: new Date().toISOString(), translation_status: "disabled" })
    .eq("id", messageId)
    .select(MESSAGE_SELECT)
    .maybeSingle();

  if (error) return sendPortalJson(res, 500, { error: error.message || "Suppression message impossible." }, req);

  return sendPortalJson(res, 200, {
    success: true,
    ok: true,
    deletedMessageId: data?.id || messageId,
  }, req);
}

function getQueryParams(req) {
  try {
    const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
    return Object.fromEntries(url.searchParams.entries());
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  applyPortalCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (!["GET", "POST"].includes(req.method)) {
    return sendPortalJson(res, 405, { error: "Method not allowed" }, req);
  }

  if (req.method === "POST" && !verifyPortalRequestOrigin(req)) {
    return sendPortalJson(res, 403, { error: "Origine de requete refusee." }, req);
  }

  const sessionCheck = await requirePortalLeaderSession(req, supabase);
  if (sessionCheck.error) {
    return sendPortalJson(res, sessionCheck.status || 403, { error: sessionCheck.error }, req);
  }

  try {
    const queryParams = getQueryParams(req);
    const body = req.method === "POST" ? await readJsonBody(req) : {};
    const action = normalizeChatAction(body.action || queryParams.action || (req.method === "GET" ? "list" : "send"));
    const params = { ...queryParams, ...body };

    if (action === "list") return await listMessages(req, res, sessionCheck.member, params);
    if (action === "updates") return await loadUpdates(req, res, sessionCheck.member, params);
    if (action === "context" || action === "message-context" || action === "around-message") {
      return await loadMessageContext(req, res, sessionCheck.member, params);
    }
    if (action === "reaction-state") return await loadReactionState(req, res, sessionCheck.member, body);
    if (action === "toggle-reaction") return await toggleReaction(req, res, sessionCheck.member, body);
    if (action === "gif-search" || action === "gif-trending") return await loadGifResults(req, res, sessionCheck.member, params);
    if (action === "send") return await sendMessage(req, res, sessionCheck.member, body);
    if (action === "delete") return await deleteMessage(req, res, sessionCheck.member, body);

    return sendPortalJson(res, 400, { error: "Action chat inconnue." }, req);
  } catch (error) {
    const status = isMissingChatSchema(error) ? 503 : 500;
    return sendPortalJson(res, status, {
      error: error?.message || "Erreur chat general.",
      schemaReady: status !== 503,
    }, req);
  }
}
