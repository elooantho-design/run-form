import { cleanChatText, normalizeChatEmoji } from "./_portal-chat-core.js";

export const CHAT_REACTION_SELECT = "id, message_id, member_id, emoji, created_at";

const MAX_REACTION_EMOJIS_PER_MEMBER_PER_MESSAGE = 12;
const MAX_DISTINCT_REACTIONS_PER_MESSAGE = 30;
const REACTION_BUCKETS = new Map();

export function isMissingReactionSchema(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    error?.code === "PGRST204" ||
    message.includes("portal_chat_message_reactions")
  );
}

export function validateReactionEmoji(value) {
  const emoji = normalizeChatEmoji(value);
  if (!emoji) return { error: "Reaction invalide.", status: 400 };
  return { emoji };
}

export function checkReactionRateLimit(memberId) {
  const key = cleanChatText(memberId);
  if (!key) return null;

  const now = Date.now();
  const cutoff = now - 4000;
  const entries = (REACTION_BUCKETS.get(key) || []).filter((timestamp) => timestamp > cutoff);
  entries.push(now);
  REACTION_BUCKETS.set(key, entries);

  if (entries.length > 12) {
    return { error: "Trop de reactions. Patiente quelques secondes.", status: 429 };
  }

  return null;
}

export async function checkReactionSchema(supabase) {
  const { error } = await supabase
    .from("portal_chat_message_reactions")
    .select("id", { count: "exact", head: true })
    .limit(1);

  if (!error) return true;
  if (isMissingReactionSchema(error)) return false;
  throw error;
}

export function aggregateReactionRows(rows, currentMemberId) {
  const current = cleanChatText(currentMemberId);
  const grouped = new Map();

  for (const row of rows || []) {
    const emoji = normalizeChatEmoji(row?.emoji);
    if (!emoji) continue;

    const entry = grouped.get(emoji) || { emoji, count: 0, reactedByMe: false };
    entry.count += 1;
    if (current && String(row.member_id || "") === current) entry.reactedByMe = true;
    grouped.set(emoji, entry);
  }

  return [...grouped.values()]
    .sort((left, right) => right.count - left.count || left.emoji.localeCompare(right.emoji))
    .slice(0, MAX_DISTINCT_REACTIONS_PER_MESSAGE);
}

export async function loadReactionsForMessageIds(supabase, messageIds, currentMemberId) {
  const ids = [...new Set((messageIds || []).map((value) => cleanChatText(value)).filter(Boolean))];
  if (!ids.length) return new Map();

  const { data, error } = await supabase
    .from("portal_chat_message_reactions")
    .select(CHAT_REACTION_SELECT)
    .in("message_id", ids);

  if (error) {
    if (isMissingReactionSchema(error)) return new Map();
    throw error;
  }

  const byMessage = new Map();
  for (const row of data || []) {
    const key = String(row.message_id || "");
    if (!key) continue;
    if (!byMessage.has(key)) byMessage.set(key, []);
    byMessage.get(key).push(row);
  }

  const output = new Map();
  for (const id of ids) {
    output.set(id, aggregateReactionRows(byMessage.get(id) || [], currentMemberId));
  }
  return output;
}

export async function countMemberReactionsOnMessage(supabase, messageId, memberId) {
  const { count, error } = await supabase
    .from("portal_chat_message_reactions")
    .select("id", { count: "exact", head: true })
    .eq("message_id", messageId)
    .eq("member_id", memberId);

  if (error) {
    if (isMissingReactionSchema(error)) return { schemaReady: false, count: 0 };
    throw error;
  }

  return { schemaReady: true, count: Number(count || 0) };
}

export function canAddAnotherReactionForMember(count) {
  return Number(count || 0) < MAX_REACTION_EMOJIS_PER_MEMBER_PER_MESSAGE;
}
