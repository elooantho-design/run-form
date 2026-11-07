# Allied GvG feedback delivery

## Scope

Adds explicit, per-defense delivery to the existing personal Discord thread, the remaining-feedback choice before reset, and the red OUVERTE stamp. No worker, launcher, recognition, template, historical campaign, PB or Rorkesh change. No reset API or installed reset/similarity SQL function is replaced.

## Installation

1. In Supabase SQL Editor run `scripts/gvg_ally_delivery_preflight.sql` (read only, seven checks).
2. Only if all checks pass, run `scripts/gvg_ally_delivery.sql`. It creates two isolated tables and three restricted entrypoints. The feature setting is enabled, but installation does not send anything. Existing business rows remain unchanged.
3. Run `scripts/gvg_ally_delivery_verify.sql` (read only, sixteen checks). Compare its business and protected-function fingerprints with preflight; concurrent legitimate admin edits can change business fingerprints.
4. The application is backward compatible with the already-installed preparation SQL: if the new entrypoints are absent, preview, assignments and opened flags still work, but delivery stays unavailable. Never replay `gvg_ally_followup.sql`.
5. After application publication, refresh Portal, open G2 / Pilotage / Retours allies. Check all intended recipients, thread links and videos before explicitly confirming the first delivery. No assistant-triggered delivery or real reset is part of deployment verification.

## Delivery rules

- Opening a preview or checking Ouverte never sends a message.
- Envoyer les retours prets has a separate explicit confirmation and sends sequential, one-defense requests. Only ready, unsent defenses from the reviewed snapshot are included.
- Both defense teams of a player have distinct receipts. A later opening of team 1 never resends team 2.
- A database claim is unique per stable portal guild and defense UUID, and shares the existing reset advisory lock. A full preview fingerprint and server-rendered message fingerprint prevent sending stale or browser-supplied content.
- Recipient, content and destination are frozen at claim time. Only the current confirmed owner in the same guild is eligible. Discord channel metadata must identify a personal thread on the server in the saved URL. No DM fallback, space creation or automatic mention is used.
- Definite Discord rejection is retryable after the operator resolves it. A timeout, ambiguous response, missing confirmation or lost database acknowledgement is not automatically retried, even after a process restart. The retained sending/uncertain state requires checking the personal thread; this release deliberately provides no blind uncertain-send override.
- Discord nonce checking adds short-term protection, not a perpetual exactly-once guarantee. Receipts provide the persistent no-retry rule. Official reference: https://docs.discord.com/developers/resources/message#create-message
- A message is kept below Discord's content limit, retaining its primary replay and as many older examples as fit. The preview shows the exact text that will be sent.
- Receipts have no cascading foreign key to defense/member rows. SQL cleanup cannot erase proof of an in-flight or successful delivery. Finishing an existing claim after reset/permission loss requires its server-only claim capability and cannot initiate another message.

## Reset

The original two confirmations and enemy archive choice are preserved. A new final feedback step offers Envoyer et poursuivre, Ignorer les envois et poursuivre, or Annuler. The send branch awaits attempted deliveries before invoking the existing reset. Individual delivery failures are summarized and do not prevent the normal reset. Skip creates no false sent receipts. Retry/resume of an already-engaged reset bypasses feedback and uses the existing reset idempotency path.

## Validation

- Isolated PGlite: fifteen SQL scenarios, 136 assertions; old preparation verify 16/16 and new delivery verify 16/16. Installation fingerprints and protected function definitions unchanged.
- Preparation API: forty assertions; delivery API/transport: fifty-nine assertions, including parallel claims, per-defense receipts, lost acknowledgements, refusal/timeout handling and no POST retries.
- Actual React Pilotage and Admin interfaces in Playwright: 132 assertions over 1440, 768, 390 and 320 pixel viewports. Manual confirmation, second opening, stamp, cancellation, both archive choices, skip, partial delivery failure and reset ordering covered with mocked localhost endpoints only.
- Changed new modules and Admin/Reset components pass ESLint; build passes with the existing bundle-size warning. Pilotage's preexisting diagnostics are compared separately.
- PGlite tests do not claim a physical multi-connection PostgreSQL scheduling test. Real Discord permissions and visual delivery remain an operator-controlled production test.

## Rollback / pause

To stop new claims, a SQL administrator can run `update public.gvg_ally_delivery_settings set delivery_enabled=false where singleton;`. This affects only this feature, not surveys or other Discord queues. Do not delete receipts, requeue uncertain sends or remove the installed safety migrations. The previous application commit can be redeployed; it ignores the additive tables and keeps the existing reset. Already-sent Discord messages are not automatically removed. There is no background delivery worker to stop.
