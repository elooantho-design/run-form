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
  inferChatLanguage,
  normalizeChatAction,
  normalizeChatLanguage,
  normalizeChatLimit,
  parseMessageCursor,
  shouldTranslateMessage,
  validateChatBody,
  validateClientMessageId,
} from "./_portal-chat-core.js";
import {
  getPortalChatTranslationConfig,
} from "./_portal-chat-translation.js";
import {
  enqueuePortalChatTranslationJob,
  isReadyTranslationForConfig,
} from "./_portal-chat-queue.js";

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

function isMissingChatSchema(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    error?.code === "PGRST204" ||
    message.includes("portal_chat_messages") ||
    message.includes("portal_chat_message_translations")
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
  return new Map((data || []).map((member) => [String(member.id), member]));
}

function serializeAuthor(member, fallbackId = "") {
  const displayName = member?.watcher_name || member?.discord_id || "Joueur";
  return {
    id: member?.id || fallbackId || null,
    displayName,
    discordId: member?.discord_id || "",
    guildCode: member?.guild_code || "",
    avatarUrl: null,
    initial: displayName.slice(0, 1).toUpperCase() || "?",
  };
}

async function loadReplyPreviewMap(rows) {
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
  return new Map(
    (data || []).map((row) => {
      const deleted = Boolean(row.deleted_at);
      const author = authors.get(String(row.author_member_id || ""));
      return [
        String(row.id),
        {
          id: row.id,
          authorName: serializeAuthor(author, row.author_member_id).displayName,
          body: deleted ? "Message supprime." : cleanChatText(row.body_original).slice(0, 180),
          deleted,
        },
      ];
    }),
  );
}

async function loadTranslations(rows, targetLanguage) {
  const candidates = (rows || []).filter((row) =>
    shouldTranslateMessage({
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
    !shouldTranslateMessage({
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
  const authors = await loadAuthorMap((rows || []).map((row) => row.author_member_id));
  const replyPreviews = await loadReplyPreviewMap(rows);
  const translationCache = await loadTranslations(rows, targetLanguage);
  const translationConfig = getPortalChatTranslationConfig();

  const serialized = [];
  for (const row of rows || []) {
    const deleted = Boolean(row.deleted_at);
    const author = serializeAuthor(authors.get(String(row.author_member_id || "")), row.author_member_id);
    const translationKey = `${row.id}:${row.body_hash}`;
    const translation = await ensureTranslation(row, targetLanguage, translationCache.get(translationKey));
    const hasTranslation = translation?.status === "ready" && Boolean(translation?.translated_body);
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
      deletedAt: row.deleted_at || null,
      deleted,
      bodyOriginal: deleted ? "" : row.body_original || "",
      body: deleted
        ? "Message supprime."
        : hasTranslation
          ? translation.translated_body
          : row.body_original || "",
      sourceLanguage: row.source_language || "und",
      targetLanguage,
      isTranslated: Boolean(hasTranslation),
      translationStatus: deleted ? "none" : translation?.status || (translationConfig.enabled ? "pending" : "disabled"),
      translationProvider: translation?.provider || translationConfig.provider,
      canShowOriginal: Boolean(hasTranslation),
      replyTo: replyPreviews.get(String(row.reply_to_message_id || "")) || null,
      permissions: {
        canDelete: !deleted && (isOwnMessage || isLeader),
      },
      cursor: createMessageCursor(row),
    });
  }

  return serialized;
}

async function checkAntiSpam({ req, member, bodyHash }) {
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

  return null;
}

async function listMessages(req, res, member, params) {
  const targetLanguage = normalizeChatLanguage(params.targetLanguage || params.language);
  const limit = normalizeChatLimit(params.limit);
  const before = parseMessageCursor(params.before);

  let query = supabase
    .from("portal_chat_messages")
    .select(MESSAGE_SELECT)
    .eq("channel_key", PORTAL_CHAT_CHANNEL_KEY)
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
      maxLength: validateChatBody("x").maxLength,
      translation: getPortalChatTranslationConfig(),
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

async function sendMessage(req, res, member, body) {
  const validation = validateChatBody(body.body || body.message || body.text);
  if (validation.error) return sendPortalJson(res, validation.status, { error: validation.error }, req);

  const clientMessageId = validateClientMessageId(body.clientMessageId || body.client_message_id);
  if (!clientMessageId) return sendPortalJson(res, 400, { error: "Identifiant client invalide." }, req);

  const targetLanguage = normalizeChatLanguage(body.targetLanguage || body.language);
  const replyToMessageId = cleanChatText(body.replyToMessageId || body.reply_to_message_id) || null;
  const bodyHash = createChatBodyHash(validation.body);
  const sourceLanguage = inferChatLanguage(validation.body);

  if (replyToMessageId) {
    const { data: reply, error: replyError } = await supabase
      .from("portal_chat_messages")
      .select("id, channel_key")
      .eq("id", replyToMessageId)
      .maybeSingle();

    if (replyError) return sendPortalJson(res, 500, { error: replyError.message || "Verification reponse impossible." }, req);
    if (!reply || reply.channel_key !== PORTAL_CHAT_CHANNEL_KEY) {
      return sendPortalJson(res, 404, { error: "Message de reponse introuvable." }, req);
    }
  }

  const spamCheck = await checkAntiSpam({ req, member, bodyHash });
  if (spamCheck) return sendPortalJson(res, spamCheck.status, { error: spamCheck.error }, req);

  const translationNeeded = shouldTranslateMessage({
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

  const messages = await serializeMessages(data ? [data] : [], { targetLanguage, actorMember: member });
  return sendPortalJson(res, 200, { success: true, message: messages[0] || null }, req);
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
