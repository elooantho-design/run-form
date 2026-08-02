import assert from "node:assert/strict";
import {
  buildTranslationJobPayload,
  enqueuePortalChatTranslationJob,
  isMissingTranslationJobSchema,
  isReadyTranslationForConfig,
} from "../api/_portal-chat-queue.js";

const message = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  body_original: "Bonjour",
  body_hash: "a".repeat(64),
  source_language: "fr",
  deleted_at: null,
};
const config = {
  enabled: true,
  provider: "libretranslate",
  model: "argos-fr-en",
};

assert.equal(isReadyTranslationForConfig(null, config), false);
assert.equal(
  isReadyTranslationForConfig(
    {
      status: "ready",
      translated_body: "Hello",
      provider: "libretranslate",
      model: "argos-fr-en",
    },
    config,
  ),
  true,
);
assert.equal(
  isReadyTranslationForConfig(
    {
      status: "ready",
      translated_body: "Hello",
      provider: "mock",
      model: "none",
    },
    config,
  ),
  false,
);

assert.deepEqual(buildTranslationJobPayload(message, "fr", config), null);
assert.deepEqual(buildTranslationJobPayload({ ...message, deleted_at: "2026-01-01" }, "en", config), null);
assert.deepEqual(buildTranslationJobPayload(message, "en", { ...config, enabled: false }), null);

const payload = buildTranslationJobPayload(message, "en", config);
assert.equal(payload.message_id, message.id);
assert.equal(payload.target_language, "en");
assert.equal(payload.source_hash, message.body_hash);
assert.equal(payload.provider, "libretranslate");
assert.equal(payload.model, "argos-fr-en");
assert.equal(payload.status, "pending");
assert.equal(payload.max_attempts, 3);

let upsertCalled = false;
const supabaseOk = {
  from(table) {
    assert.equal(table, "portal_chat_translation_jobs");
    return {
      upsert(incoming, options) {
        upsertCalled = true;
        assert.deepEqual(incoming, payload);
        assert.equal(options.onConflict, "message_id,target_language,source_hash,provider,model");
        return {
          select() {
            return {
              async maybeSingle() {
                return { data: { ...payload, id: "job-1" }, error: null };
              },
            };
          },
        };
      },
    };
  },
};

const enqueued = await enqueuePortalChatTranslationJob(supabaseOk, message, "en", config);
assert.equal(upsertCalled, true);
assert.equal(enqueued.enqueued, true);
assert.equal(enqueued.job.id, "job-1");

const missingSchemaError = { code: "42P01", message: "relation portal_chat_translation_jobs does not exist" };
assert.equal(isMissingTranslationJobSchema(missingSchemaError), true);

const supabaseMissing = {
  from() {
    return {
      upsert() {
        return {
          select() {
            return {
              async maybeSingle() {
                return { data: null, error: missingSchemaError };
              },
            };
          },
        };
      },
    };
  },
};

const missing = await enqueuePortalChatTranslationJob(supabaseMissing, message, "en", config);
assert.equal(missing.enqueued, false);
assert.equal(missing.missingSchema, true);

console.log("portal-chat translation queue tests ok");
