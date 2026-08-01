#!/usr/bin/env node
/* global process */
import { createClient } from "@supabase/supabase-js";
import { cleanChatText } from "../api/_portal-chat-core.js";
import { getPortalChatTranslationConfig, translatePortalChatMessage } from "../api/_portal-chat-translation.js";

const WORKER_ID = cleanChatText(process.env.PORTAL_CHAT_TRANSLATION_WORKER_ID) || `translator-${process.pid}`;
const POLL_INTERVAL_MS = readInteger(process.env.PORTAL_CHAT_TRANSLATION_WORKER_POLL_MS, 5000, 1000, 60000);
const LOCK_SECONDS = readInteger(process.env.PORTAL_CHAT_TRANSLATION_JOB_LOCK_SECONDS, 90, 15, 600);
const MAX_IDLE_LOOPS = readInteger(process.env.PORTAL_CHAT_TRANSLATION_WORKER_MAX_IDLE_LOOPS, 0, 0, 1000000);
const RUN_ONCE = ["1", "true", "yes"].includes(String(process.env.PORTAL_CHAT_TRANSLATION_WORKER_ONCE || "").toLowerCase());
const MESSAGE_SELECT = "id, body_original, body_hash, source_language, deleted_at, translation_status";
const TRANSLATION_SELECT = "id, message_id, target_language, source_hash, translated_body, provider, model, status, char_count, created_at";

function readInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createSupabaseClient() {
  const url = cleanChatText(process.env.SUPABASE_URL);
  const key = cleanChatText(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) {
    throw new Error("SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont obligatoires pour le worker traduction.");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function calculateBackoffSeconds(attempts) {
  return Math.min(300, Math.max(10, 10 * 2 ** Math.max(0, Number(attempts || 1) - 1)));
}

async function claimJob(supabase) {
  const { data, error } = await supabase.rpc("portal_chat_claim_translation_job", {
    p_worker_id: WORKER_ID,
    p_lock_seconds: LOCK_SECONDS,
  });

  if (error) throw error;
  return Array.isArray(data) ? data[0] || null : data || null;
}

async function completeJob(supabase, job) {
  const { error } = await supabase
    .from("portal_chat_translation_jobs")
    .update({
      status: "completed",
      locked_at: null,
      locked_until: null,
      locked_by: null,
      last_error: null,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  if (error) throw error;
}

async function failJob(supabase, job, errorMessage) {
  const attempts = Number(job.attempts || 0);
  const maxAttempts = Number(job.max_attempts || 3);
  const finalFailure = attempts >= maxAttempts;
  const backoffSeconds = calculateBackoffSeconds(attempts);
  const availableAt = new Date(Date.now() + backoffSeconds * 1000).toISOString();

  const { error } = await supabase
    .from("portal_chat_translation_jobs")
    .update({
      status: finalFailure ? "failed" : "pending",
      locked_at: null,
      locked_until: null,
      locked_by: null,
      available_at: finalFailure ? null : availableAt,
      last_error: cleanChatText(errorMessage).slice(0, 500) || "Erreur traduction.",
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  if (error) throw error;
}

async function markMessageStatus(supabase, messageId, status) {
  if (!messageId) return;
  await supabase
    .from("portal_chat_messages")
    .update({ translation_status: status })
    .eq("id", messageId);
}

async function processJob(supabase, job) {
  if (!job?.id || !job.message_id) return false;

  const { data: message, error: messageError } = await supabase
    .from("portal_chat_messages")
    .select(MESSAGE_SELECT)
    .eq("id", job.message_id)
    .maybeSingle();

  if (messageError) throw messageError;
  if (!message || message.deleted_at) {
    await completeJob(supabase, job);
    return true;
  }

  const { data: cached, error: cacheError } = await supabase
    .from("portal_chat_message_translations")
    .select(TRANSLATION_SELECT)
    .eq("message_id", job.message_id)
    .eq("target_language", job.target_language)
    .eq("source_hash", job.source_hash)
    .maybeSingle();

  if (cacheError) throw cacheError;
  if (
    cached?.status === "ready" &&
    cleanChatText(cached.translated_body) &&
    cleanChatText(cached.provider) === cleanChatText(job.provider) &&
    cleanChatText(cached.model || "none") === cleanChatText(job.model || "none")
  ) {
    await completeJob(supabase, job);
    await markMessageStatus(supabase, job.message_id, "ready");
    return true;
  }

  const config = getPortalChatTranslationConfig();
  if (!config.enabled) {
    await failJob(supabase, job, "Traduction desactivee.");
    await markMessageStatus(supabase, job.message_id, "failed");
    return false;
  }

  const result = await translatePortalChatMessage({
    text: message.body_original,
    targetLanguage: job.target_language,
    sourceLanguageHint: message.source_language,
  });

  if (result.status !== "ready" || !cleanChatText(result.translatedText)) {
    await failJob(supabase, job, result.error || "Traduction indisponible.");
    await markMessageStatus(supabase, job.message_id, "failed");
    return false;
  }

  const { error: upsertError } = await supabase
    .from("portal_chat_message_translations")
    .upsert(
      {
        message_id: job.message_id,
        target_language: job.target_language,
        source_hash: job.source_hash,
        translated_body: result.translatedText,
        provider: result.provider || job.provider,
        model: result.model || job.model || "none",
        status: "ready",
        char_count: cleanChatText(message.body_original).length,
      },
      { onConflict: "message_id,target_language,source_hash" },
    );

  if (upsertError) throw upsertError;

  await completeJob(supabase, job);
  await markMessageStatus(supabase, job.message_id, "ready");
  return true;
}

async function main() {
  const supabase = createSupabaseClient();
  let idleLoops = 0;

  console.log(`[portal-chat-translation-worker] start worker=${WORKER_ID} concurrency=1`);

  while (true) {
    const job = await claimJob(supabase);
    if (!job) {
      idleLoops += 1;
      if (RUN_ONCE || (MAX_IDLE_LOOPS && idleLoops >= MAX_IDLE_LOOPS)) break;
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    idleLoops = 0;
    try {
      await processJob(supabase, job);
      console.log(`[portal-chat-translation-worker] processed job=${job.id} status=ok`);
    } catch (error) {
      console.error(`[portal-chat-translation-worker] job=${job.id} status=error message=${cleanChatText(error?.message).slice(0, 240)}`);
      await failJob(supabase, job, error?.message || "Erreur worker.");
    }

    if (RUN_ONCE) break;
  }

  console.log("[portal-chat-translation-worker] stop");
}

await main();
