/* global process */
import { cleanChatText, shouldTranslateMessage } from "./_portal-chat-core.js";

export const TRANSLATION_JOB_SELECT = [
  "id",
  "message_id",
  "target_language",
  "source_hash",
  "provider",
  "model",
  "status",
  "attempts",
  "max_attempts",
  "locked_until",
  "last_error",
  "created_at",
  "updated_at",
].join(", ");

export function isMissingTranslationJobSchema(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return error?.code === "42P01" || error?.code === "PGRST205" || message.includes("portal_chat_translation_jobs");
}

export function isReadyTranslationForConfig(translation, config) {
  if (translation?.status !== "ready" || !cleanChatText(translation?.translated_body)) {
    return false;
  }

  if (!config?.enabled) return true;

  const expectedProvider = cleanChatText(config.provider || "disabled");
  const expectedModel = cleanChatText(config.model || "none");
  const provider = cleanChatText(translation.provider || "disabled");
  const model = cleanChatText(translation.model || "none");

  return provider === expectedProvider && model === expectedModel;
}

export function buildTranslationJobPayload(row, targetLanguage, config) {
  if (!config?.enabled) return null;
  if (!row?.id || !row?.body_hash) return null;
  if (
    !shouldTranslateMessage({
      sourceLanguage: row.source_language,
      targetLanguage,
      deleted: Boolean(row.deleted_at),
    })
  ) {
    return null;
  }

  return {
    message_id: row.id,
    target_language: targetLanguage,
    source_hash: row.body_hash,
    provider: cleanChatText(config.provider || "disabled"),
    model: cleanChatText(config.model || "none"),
    status: "pending",
    priority: 0,
    max_attempts: 3,
    last_error: null,
  };
}

export async function enqueuePortalChatTranslationJob(supabase, row, targetLanguage, config) {
  const payload = buildTranslationJobPayload(row, targetLanguage, config);
  if (!payload) return { enqueued: false, skipped: true };

  const { data, error } = await supabase
    .from("portal_chat_translation_jobs")
    .upsert(payload, { onConflict: "message_id,target_language,source_hash,provider,model" })
    .select(TRANSLATION_JOB_SELECT)
    .maybeSingle();

  if (error) {
    if (isMissingTranslationJobSchema(error)) {
      return { enqueued: false, skipped: true, missingSchema: true };
    }
    throw error;
  }

  return { enqueued: true, job: data || payload };
}
