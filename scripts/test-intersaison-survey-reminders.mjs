import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isSurveyChoiceAction, runSurveyChoiceAction } from "../api/_intersaison-survey-choices.js";

globalThis.fetch = () => { throw Error("Live requests and Discord messages are forbidden in these tests"); };
const id = "10000000-0000-4000-8000-000000000001";
const org = { id: "organization", organization_key: "paladin" };
const actor = { id: "admin", role: "admin", guild_code: "G1" };
const season = { id: "season" };
const fingerprint = "a".repeat(32);
const calls = [];
let rpcError = null;
class Query {
  constructor(table) { this.table = table; }
  select() { return this; } eq() { return this; } in() { return this; } or() { return this; }
  order() { return this; } neq() { return this; } range() { return this; }
  maybeSingle() { return Promise.resolve({ data: { id: "authorized" }, error: null }); }
  then(resolve) {
    return Promise.resolve({ data: this.table === "portal_guilds"
      ? Array.from({ length: 7 }, (_, i) => ({ organization_id: org.id, guild_code: `G${i + 1}` })) : [], error: null }).then(resolve);
  }
}
const db = {
  from: table => new Query(table),
  rpc: async (name, args) => {
    calls.push({ name, args });
    if (rpcError) return { error: rpcError };
    return { data: name.startsWith("preview_") ? { fingerprint, counts: { eligible: 2 }, scopeGuilds: ["G1", "G2", "G3", "G4", "G5", "G6", "G7"] }
      : { queuedCount: 2, batchId: id, alreadyQueued: false }, error: null };
  },
};
for (const action of ["preview-survey-two-reminders", "queue-survey-two-reminders"]) assert.equal(isSurveyChoiceAction(action), true);
const preview = await runSurveyChoiceAction(db, actor, org, season, "preview-survey-two-reminders", {
  campaignId: id, guildCode: "G1", guildCodes: ["G1"], memberIds: ["forged-target"], discordUserId: "forged-owner",
});
assert.equal(preview.preview.counts.eligible, 2);
assert.deepEqual(calls[0], { name: "preview_intersaison_survey_two_reminders", args: { p_org: org.id, p_actor: actor.id, p_campaign: id } });
assert.equal(calls.length, 1, "opening the confirmation performs only a read-only preview");
const request = { campaignId: id, confirmed: true, previewFingerprint: fingerprint, requestId: id, guildCode: "G1", memberIds: ["forged-target"] };
const queued = await runSurveyChoiceAction(db, actor, org, season, "queue-survey-two-reminders", request);
assert.equal(queued.result.queuedCount, 2);
assert.deepEqual(calls[1], { name: "queue_intersaison_survey_two_reminders", args: {
  p_org: org.id, p_actor: actor.id, p_campaign: id, p_fingerprint: fingerprint, p_request: id, p_confirmed: true,
} });
const mutationCount = () => calls.filter(call => call.name.startsWith("queue_")).length;
for (const patch of [{ confirmed: false }, { confirmed: undefined }, { requestId: "not-a-uuid" }, { previewFingerprint: "forged" }, { campaignId: "invalid" }]) {
  await assert.rejects(runSurveyChoiceAction(db, actor, org, season, "queue-survey-two-reminders", { ...request, ...patch }), error => error.statusCode === 400);
}
assert.equal(mutationCount(), 1, "invalid confirmations never reach the queue");
await assert.rejects(runSurveyChoiceAction(db, { ...actor, role: "member" }, org, season, "preview-survey-two-reminders", { campaignId: id }), error => error.statusCode === 403);
await assert.rejects(runSurveyChoiceAction(db, actor, { ...org, organization_key: "mad" }, season, "queue-survey-two-reminders", request), error => error.statusCode === 403);
await assert.rejects(runSurveyChoiceAction(db, actor, org, null, "queue-survey-two-reminders", request), /inter-saison/);
rpcError = { code: "PGRST202" };
await assert.rejects(runSurveyChoiceAction(db, actor, org, season, "preview-survey-two-reminders", { campaignId: id }), error => error.statusCode === 428 && /intersaison_survey_reminders/.test(error.message));
rpcError = { code: "P0001", message: "Les destinataires ont changé. Actualiser la prévisualisation." };
await assert.rejects(runSurveyChoiceAction(db, actor, org, season, "queue-survey-two-reminders", request), error => error.statusCode === 409 && /prévisualisation/.test(error.message));
rpcError = { code: "42501", message: "Périmètre interdit" };
await assert.rejects(runSurveyChoiceAction(db, actor, org, season, "queue-survey-two-reminders", request), error => error.statusCode === 403);
const center = await readFile(new URL("../src/components/PortalIntersaisonSurveyCenter.jsx", import.meta.url), "utf8");
assert.match(center, /error\.statusCode = response\.status/, "HTTP failures retain their status for safe idempotent retry");
assert.match(center, /selectedCampaign\?\.status === "open" && selectedPoll !== 2/);
assert.match(center, /selectedPoll !== 2 && selectedMember\.delivery\.color === "orange"/);
console.log("Survey-2 reminder API tests passed: server permissions, global scope, explicit confirmation, idempotency arguments, stale preview and missing migration. No real requests.");
