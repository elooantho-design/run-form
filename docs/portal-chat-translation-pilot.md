# Portal Chat Translation Pilot

## Decision

The current VPS can host a pilot translation stack for `fr` and `en` only, with strict Docker limits and a queue.
The chat remains leader-only until a later decision opens it to the community.

## Runtime architecture

```text
Browser
  -> Vercel API /api/portal-chat
  -> Supabase message + translation job
  -> VPS translation-worker
  -> VPS translator-gateway
  -> LibreTranslate container
  -> Supabase translation cache
  -> next polling response
```

The original message is always stored and returned first. Translation is best effort.

## Modules boundaries

- Text chat: messages, replies, deletion, anti-spam and polling.
- Translation: job queue, provider calls, cache and failure handling.
- Profiles/cosmetics: avatars, frames, colors and support badges.
- Media: future images, GIFs and attachments.
- Realtime: future SSE, WebSocket or Supabase Realtime migration.
- Moderation: future reports, sanctions and message review.

Translation must not depend on avatars, frames or media storage.

## Cache key

The intended logical cache key is:

```text
message_id + source_hash + target_language + provider + model
```

The existing translation table still has the historical unique key:

```text
message_id + target_language + source_hash
```

For the pilot, the worker overwrites a stale cache row when provider or model changes.
This avoids a disruptive migration while still preventing stale provider/model output from being displayed.

## Failure behavior

If the translator is disabled, slow, unavailable, missing a model, out of quota or returning invalid data:

- sending still works;
- reading still works;
- the original message remains visible;
- the job is retried with backoff;
- after too many attempts, the job becomes `failed`;
- no fake translation is generated.

## Pilot thresholds

- 2 vCPU maximum for LibreTranslate.
- 4 GiB maximum RAM for LibreTranslate.
- 1 logical translation at a time.
- 1,000 characters per message.
- 3 job attempts.
- Alert if pending queue stays above 50 jobs for several minutes.
- Alert if oldest pending job is older than 5 minutes.
- Alert if translator p95 latency is above 5 seconds.
- Stop or move the pilot if GVG API, recognition worker or Discord bot latency becomes visible.

## Polling impact

Current chat polling is 4 seconds while the browser tab is visible.

Approximate request volume:

| Concurrent users | Requests / minute |
|---:|---:|
| 10 | 150 |
| 50 | 750 |
| 100 | 1,500 |
| 300 | 4,500 |

This is acceptable for a leader-only or small pilot. It is not the final architecture for thousands of concurrent users.

## Future move to a separate VPS

To move the translator later:

1. Deploy the same `ops/portal-translator` stack on the new VPS.
2. Configure HTTPS and the gateway route.
3. Rotate `PORTAL_CHAT_TRANSLATOR_SECRET`.
4. Update `PORTAL_CHAT_TRANSLATOR_URL` and `PORTAL_CHAT_TRANSLATOR_SECRET` in the worker/API environment.
5. Redeploy the server code.

No React change, message migration or translation cache reset is required.
