/* global Buffer, process */
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  applyPortalCorsHeaders,
  isPortalAdminRole,
  isPortalCommunityRole,
  isPortalLeaderRole,
  normalizePortalText,
  readJsonBody,
  requirePortalSession,
  sendPortalJson,
  validatePortalInput,
  verifyPortalRequestOrigin,
} from "./_portal-auth.js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const PALADIN_CLUSTER_GUILD_CODES = new Set(["G1", "G2", "G3", "G4", "G5", "G6", "G7"]);
const EMPTY_DEFENSE_LABEL = "Aucune defense";
const MAX_COMMENT_LENGTH = 4000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const THREAD_SELECT = "id, member_id, slot, defense_name, wins, losses, created_at, updated_at";
const MESSAGE_SELECT = "id, thread_id, author_member_id, author_name, kind, content, youtube_url, image_path, created_at";
const MEMBER_SELECT =
  "id, watcher_name, discord_id, guild_code, role, community_access_type, community_status, defense_1, defense_2";

function sendJson(res, status, payload, req = null) {
  sendPortalJson(res, status, payload, req);
}

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeGuildCode(value) {
  return cleanText(value).toUpperCase().replace(/\s+/g, "_");
}

function isPaladinGuildCode(value) {
  return PALADIN_CLUSTER_GUILD_CODES.has(normalizeGuildCode(value));
}

function getGuildSpaceKey(value) {
  const code = normalizeGuildCode(value);
  if (!code) return "";
  if (isPaladinGuildCode(code)) return "PALADIN";

  const match = code.match(/^(.+?)(?:_?G\d+)$/i);
  return (match?.[1] || code).replace(/_+$/g, "") || code;
}

function sameGuildSpace(left, right) {
  const leftSpace = getGuildSpaceKey(left);
  const rightSpace = getGuildSpaceKey(right);
  return Boolean(leftSpace && rightSpace && leftSpace === rightSpace);
}

function isCommunityAccount(member) {
  return (
    normalizePortalText(member?.community_access_type) === "community" ||
    isPortalCommunityRole(member?.role)
  );
}

function canAccessMemberFollowup(actor, target) {
  if (!actor?.id || !target?.id) return false;
  if (isCommunityAccount(actor) || isCommunityAccount(target)) return false;
  if (isPortalLeaderRole(actor.role)) return true;
  if (String(actor.id) === String(target.id)) return true;
  if (!isPortalAdminRole(actor.role)) return false;

  const actorGuild = normalizeGuildCode(actor.guild_code);
  const targetGuild = normalizeGuildCode(target.guild_code);
  if (!actorGuild || !targetGuild) return false;
  if (isPaladinGuildCode(actorGuild)) return isPaladinGuildCode(targetGuild);
  return sameGuildSpace(actorGuild, targetGuild);
}

function normalizeDefenseName(value) {
  const cleanValue = cleanText(value);
  if (!cleanValue || cleanValue === "--" || cleanValue === "—") return EMPTY_DEFENSE_LABEL;
  return cleanValue;
}

function normalizeSlot(value) {
  const slot = cleanText(value);
  return slot === "defense2" ? "defense2" : "defense1";
}

function formatThread(thread, unread = 0) {
  return {
    id: thread.id,
    memberId: thread.member_id,
    slot: thread.slot,
    defenseName: thread.defense_name || EMPTY_DEFENSE_LABEL,
    wins: thread.wins ?? 0,
    losses: thread.losses ?? 0,
    unread,
    createdAt: thread.created_at || null,
    updatedAt: thread.updated_at || null,
  };
}

function formatMessage(message, mentionsMap, actorId) {
  return {
    id: message.id,
    author: message.author_name || "Joueur",
    kind: message.kind || "text",
    content: message.content || message.youtube_url || message.image_path || "",
    createdAt: message.created_at || null,
    isOwn: String(message.author_member_id) === String(actorId),
    mentions: mentionsMap.get(String(message.id)) || [],
  };
}

function extractMentionNames(text) {
  const matches = String(text || "").match(/@([a-zA-Z0-9_\u00c0-\u024f-]+)/g) || [];
  return [...new Set(matches.map((item) => cleanText(item.slice(1))).filter(Boolean))];
}

async function loadMember(memberId) {
  const id = validatePortalInput(memberId, 80);
  if (!id) return null;

  const { data, error } = await supabase.from("guild_members").select(MEMBER_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadThread(threadId) {
  const id = validatePortalInput(threadId, 80);
  if (!id) return null;

  const { data, error } = await supabase
    .from("member_defense_threads")
    .select(THREAD_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function deleteThreadMessages(threadId) {
  const { data: oldMessages, error: oldMessagesError } = await supabase
    .from("member_defense_messages")
    .select("id")
    .eq("thread_id", threadId);
  if (oldMessagesError) throw oldMessagesError;

  const oldMessageIds = (oldMessages || []).map((message) => message.id).filter(Boolean);
  if (oldMessageIds.length > 0) {
    const { error: mentionsError } = await supabase
      .from("member_defense_message_mentions")
      .delete()
      .in("message_id", oldMessageIds);
    if (mentionsError) throw mentionsError;
  }

  const { error: messagesError } = await supabase.from("member_defense_messages").delete().eq("thread_id", threadId);
  if (messagesError) throw messagesError;
}

async function getOrCreateThread(target, slot) {
  const normalizedSlot = normalizeSlot(slot);
  const defenseName = normalizeDefenseName(normalizedSlot === "defense1" ? target.defense_1 : target.defense_2);

  const { data: existing, error: existingError } = await supabase
    .from("member_defense_threads")
    .select(THREAD_SELECT)
    .eq("member_id", target.id)
    .eq("slot", normalizedSlot)
    .maybeSingle();
  if (existingError) throw existingError;

  if (existing) {
    if (defenseName !== EMPTY_DEFENSE_LABEL && existing.defense_name !== defenseName) {
      const { data: updated, error: updateError } = await supabase
        .from("member_defense_threads")
        .update({ defense_name: defenseName, wins: 0, losses: 0 })
        .eq("id", existing.id)
        .select(THREAD_SELECT)
        .single();
      if (updateError) throw updateError;
      await deleteThreadMessages(existing.id);
      return updated || existing;
    }

    return existing;
  }

  const { data: created, error: createError } = await supabase
    .from("member_defense_threads")
    .insert({
      member_id: target.id,
      slot: normalizedSlot,
      defense_name: defenseName,
    })
    .select(THREAD_SELECT)
    .single();
  if (createError) throw createError;
  return created;
}

async function computeUnreadCounts(threadIds, actorId) {
  if (!threadIds.length || !actorId) return new Map();

  const [{ data: reads, error: readsError }, { data: messages, error: messagesError }] = await Promise.all([
    supabase
      .from("member_defense_thread_reads")
      .select("thread_id, last_read_at")
      .eq("member_id", actorId)
      .in("thread_id", threadIds),
    supabase
      .from("member_defense_messages")
      .select("thread_id, created_at")
      .in("thread_id", threadIds),
  ]);
  if (readsError) throw readsError;
  if (messagesError) throw messagesError;

  const readMap = new Map((reads || []).map((row) => [String(row.thread_id), row.last_read_at]));
  const unreadMap = new Map(threadIds.map((id) => [String(id), 0]));

  (messages || []).forEach((message) => {
    const key = String(message.thread_id);
    const lastRead = readMap.get(key);
    if (!lastRead || new Date(message.created_at) > new Date(lastRead)) {
      unreadMap.set(key, (unreadMap.get(key) || 0) + 1);
    }
  });

  return unreadMap;
}

async function loadThreadAndTarget(threadId, actor) {
  const thread = await loadThread(threadId);
  if (!thread) return { error: "Fil de suivi introuvable.", status: 404 };

  const target = await loadMember(thread.member_id);
  if (!target) return { error: "Joueur introuvable.", status: 404 };
  if (!canAccessMemberFollowup(actor, target)) return { error: "Acces suivi refuse.", status: 403 };

  return { thread, target };
}

async function resolveMentionRows(actor, target, mentionNames) {
  if (!mentionNames.length) return [];

  const { data, error } = await supabase
    .from("guild_members")
    .select("id, watcher_name, guild_code, role, community_access_type, community_status")
    .limit(800);
  if (error) throw error;

  const mentionSet = new Set(mentionNames.map((name) => normalizePortalText(name)));
  return (data || [])
    .filter((member) => {
      if (!mentionSet.has(normalizePortalText(member.watcher_name))) return false;
      return canAccessMemberFollowup(actor, member);
    })
    .map((member) => ({
      mentioned_member_id: member.id,
      mentioned_name: member.watcher_name || "Joueur",
    }));
}

function parseImageDataUrl(value) {
  const match = String(value || "").match(/^data:(image\/(?:png|jpe?g|webp));base64,([a-z0-9+/=]+)$/i);
  if (!match) return null;
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) return null;
  return { mimeType: match[1].toLowerCase(), buffer };
}

async function uploadImageFromDataUrl({ imageDataUrl, actorId, fileName }) {
  const parsed = parseImageDataUrl(imageDataUrl);
  if (!parsed) throw new Error("Image invalide ou trop lourde.");

  const extension =
    parsed.mimeType === "image/png" ? "png" : parsed.mimeType === "image/webp" ? "webp" : "jpg";
  const safeBaseName = cleanText(fileName)
    .replace(/\.[^/.]+$/, "")
    .replace(/[^a-z0-9_-]/gi, "_")
    .slice(0, 60);
  const objectPath = `threads/${actorId}_${Date.now()}_${crypto.randomUUID()}_${safeBaseName || "image"}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from("member-defense-media")
    .upload(objectPath, parsed.buffer, {
      contentType: parsed.mimeType,
      upsert: false,
    });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from("member-defense-media").getPublicUrl(objectPath);
  return data?.publicUrl || "";
}

async function handleLoadThreads(body, actor) {
  const target = await loadMember(body.memberId);
  if (!target) return { status: 404, payload: { ok: false, error: "Joueur introuvable." } };
  if (!canAccessMemberFollowup(actor, target)) {
    return { status: 403, payload: { ok: false, error: "Acces suivi refuse." } };
  }

  const threads = await Promise.all([
    getOrCreateThread(target, "defense1"),
    getOrCreateThread(target, "defense2"),
  ]);
  const unreadMap = await computeUnreadCounts(
    threads.map((thread) => thread.id),
    actor.id,
  );

  return {
    status: 200,
    payload: {
      ok: true,
      threads: threads.map((thread) => formatThread(thread, unreadMap.get(String(thread.id)) || 0)),
      actorMemberId: actor.id,
    },
  };
}

async function handleLoadMessages(body, actor) {
  const access = await loadThreadAndTarget(body.threadId, actor);
  if (access.error) return { status: access.status, payload: { ok: false, error: access.error } };

  const { data: messages, error: messagesError } = await supabase
    .from("member_defense_messages")
    .select(MESSAGE_SELECT)
    .eq("thread_id", access.thread.id)
    .order("created_at", { ascending: true });
  if (messagesError) throw messagesError;

  const messageIds = (messages || []).map((message) => message.id).filter(Boolean);
  const mentionsMap = new Map();

  if (messageIds.length > 0) {
    const { data: mentions, error: mentionsError } = await supabase
      .from("member_defense_message_mentions")
      .select("message_id, mentioned_name")
      .in("message_id", messageIds);
    if (mentionsError) throw mentionsError;

    (mentions || []).forEach((mention) => {
      const key = String(mention.message_id);
      const list = mentionsMap.get(key) || [];
      list.push(mention.mentioned_name);
      mentionsMap.set(key, list);
    });
  }

  return {
    status: 200,
    payload: {
      ok: true,
      messages: (messages || []).map((message) => formatMessage(message, mentionsMap, actor.id)),
      actorMemberId: actor.id,
    },
  };
}

async function handleAddMessage(body, actor) {
  const access = await loadThreadAndTarget(body.threadId, actor);
  if (access.error) return { status: access.status, payload: { ok: false, error: access.error } };

  const kind = ["text", "youtube", "image"].includes(cleanText(body.kind)) ? cleanText(body.kind) : "text";
  let content = validatePortalInput(body.content, MAX_COMMENT_LENGTH);
  let imagePath = "";
  let youtubeUrl = "";

  if (kind === "image") {
    imagePath = await uploadImageFromDataUrl({
      imageDataUrl: body.imageDataUrl,
      actorId: actor.id,
      fileName: body.fileName,
    });
    content = imagePath;
  }

  if (kind === "youtube") {
    youtubeUrl = content;
  }

  if (!content) {
    return { status: 400, payload: { ok: false, error: "Message vide." } };
  }

  const { data: message, error: insertError } = await supabase
    .from("member_defense_messages")
    .insert({
      thread_id: access.thread.id,
      author_member_id: actor.id,
      author_name: actor.watcher_name || "Joueur",
      kind,
      content,
      youtube_url: youtubeUrl || null,
      image_path: imagePath || null,
    })
    .select(MESSAGE_SELECT)
    .single();
  if (insertError) throw insertError;

  if (kind === "text") {
    const mentionRows = await resolveMentionRows(actor, access.target, extractMentionNames(content));
    if (mentionRows.length > 0) {
      const { error: mentionsError } = await supabase.from("member_defense_message_mentions").insert(
        mentionRows.map((row) => ({
          message_id: message.id,
          ...row,
        })),
      );
      if (mentionsError) throw mentionsError;
    }
  }

  return {
    status: 200,
    payload: {
      ok: true,
      message: formatMessage(message, new Map(), actor.id),
    },
  };
}

async function handleMarkRead(body, actor) {
  const access = await loadThreadAndTarget(body.threadId, actor);
  if (access.error) return { status: access.status, payload: { ok: false, error: access.error } };

  const { error } = await supabase.from("member_defense_thread_reads").upsert(
    {
      thread_id: access.thread.id,
      member_id: actor.id,
      last_read_at: new Date().toISOString(),
    },
    { onConflict: "thread_id,member_id" },
  );
  if (error) throw error;

  return { status: 200, payload: { ok: true } };
}

async function handleUpdateScore(body, actor) {
  const access = await loadThreadAndTarget(body.threadId, actor);
  if (access.error) return { status: access.status, payload: { ok: false, error: access.error } };

  const field = cleanText(body.field);
  if (!["wins", "losses"].includes(field)) {
    return { status: 400, payload: { ok: false, error: "Champ score invalide." } };
  }

  const numericValue = Math.max(0, Number.parseInt(body.value, 10) || 0);
  const { data, error } = await supabase
    .from("member_defense_threads")
    .update({ [field]: numericValue })
    .eq("id", access.thread.id)
    .select(THREAD_SELECT)
    .single();
  if (error) throw error;

  return { status: 200, payload: { ok: true, thread: formatThread(data, 0) } };
}

export default async function handler(req, res) {
  applyPortalCorsHeaders(req, res);
  if (req.method === "OPTIONS") return sendJson(res, 204, {}, req);
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed." }, req);
  if (!verifyPortalRequestOrigin(req)) {
    return sendJson(res, 403, { ok: false, error: "Origine de requete refusee." }, req);
  }

  try {
    const sessionCheck = await requirePortalSession(req, supabase);
    if (sessionCheck.error) {
      return sendJson(res, sessionCheck.status || 401, { ok: false, error: sessionCheck.error }, req);
    }

    const body = await readJsonBody(req);
    const action = cleanText(body.action);
    const actor = sessionCheck.member;

    let result;
    if (action === "load-threads") result = await handleLoadThreads(body, actor);
    else if (action === "load-messages") result = await handleLoadMessages(body, actor);
    else if (action === "add-message") result = await handleAddMessage(body, actor);
    else if (action === "mark-read") result = await handleMarkRead(body, actor);
    else if (action === "update-score") result = await handleUpdateScore(body, actor);
    else result = { status: 400, payload: { ok: false, error: "Action inconnue." } };

    return sendJson(res, result.status, result.payload, req);
  } catch (error) {
    console.error("[portal-followup]", error);
    return sendJson(res, 500, { ok: false, error: error.message || "Erreur serveur." }, req);
  }
}
