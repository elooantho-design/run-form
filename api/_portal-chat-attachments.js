import { cleanChatText } from "./_portal-chat-core.js";

export const CHAT_ATTACHMENT_SELECT = [
  "id",
  "message_id",
  "attachment_type",
  "provider",
  "provider_item_id",
  "media_url",
  "preview_url",
  "width",
  "height",
  "title",
  "created_at",
].join(", ");

export function isMissingAttachmentSchema(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    error?.code === "PGRST204" ||
    message.includes("portal_chat_message_attachments")
  );
}

export async function checkAttachmentSchema(supabase) {
  const { error } = await supabase
    .from("portal_chat_message_attachments")
    .select("id", { count: "exact", head: true })
    .limit(1);

  if (!error) return true;
  if (isMissingAttachmentSchema(error)) return false;
  throw error;
}

export function serializeAttachment(row) {
  if (!row || cleanChatText(row.attachment_type).toLowerCase() !== "gif") return null;

  return {
    id: row.id || null,
    messageId: row.message_id || null,
    attachmentType: "gif",
    provider: cleanChatText(row.provider).toLowerCase(),
    providerItemId: cleanChatText(row.provider_item_id),
    mediaUrl: cleanChatText(row.media_url),
    previewUrl: cleanChatText(row.preview_url),
    width: Number(row.width || 0) || null,
    height: Number(row.height || 0) || null,
    title: cleanChatText(row.title),
    createdAt: row.created_at || null,
  };
}

export async function loadAttachmentsForMessageIds(supabase, messageIds) {
  const ids = [...new Set((messageIds || []).map((value) => cleanChatText(value)).filter(Boolean))];
  if (!ids.length) return new Map();

  const { data, error } = await supabase
    .from("portal_chat_message_attachments")
    .select(CHAT_ATTACHMENT_SELECT)
    .in("message_id", ids)
    .order("created_at", { ascending: true });

  if (error) {
    if (isMissingAttachmentSchema(error)) return new Map();
    throw error;
  }

  const output = new Map();
  for (const row of data || []) {
    const attachment = serializeAttachment(row);
    if (!attachment?.messageId) continue;
    const key = String(attachment.messageId);
    if (!output.has(key)) output.set(key, []);
    output.get(key).push(attachment);
  }

  return output;
}
