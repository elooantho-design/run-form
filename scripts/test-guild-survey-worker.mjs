import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { prepareIntersaisonBot } from "./prepare-intersaison-bot.mjs";

if (!process.env.DISCORD_TEST_NODE_MODULES) throw Error("DISCORD_TEST_NODE_MODULES must select an isolated discord.js runtime.");
process.env.NODE_PATH = [process.env.DISCORD_TEST_NODE_MODULES, process.env.NODE_PATH].filter(Boolean).join(delimiter);
Module._initPaths();
globalThis.fetch = () => { throw Error("Real network forbidden in guild-survey worker tests"); };
const output = await prepareIntersaisonBot(await mkdtemp(join(tmpdir(), "guild-survey-worker-")));
const require = createRequire(join(output, "package.json"));
const worker = require("./services/guildDmCampaigns.js");
const adapter = require("./services/guildSurvey.cjs");
const survey = "51000000-0000-4000-8000-000000000300";
const uuid = "51000000-0000-4000-8000-000000000400";
const discordId = "200000000000000010";
let state;
function reset() {
  state = { campaign: { id: "dm-campaign", status: "queued", interaction_type: "none", interaction_payload: { kind: "guild_survey_v1", surveyId: survey, waveId: uuid },
    message: `Sondage\nhttps://run-form-tau.vercel.app/portal?guildSurvey=${survey}` },
    recipient: { id: "dm-recipient", campaign_id: "dm-campaign", discord_user_id: discordId, status: "queued", member_name_snapshot: "Account", guild_code: "G10", send_attempts: 0, reminder_count: 0 },
    sent: [], auth: 0, answered: false, closed: false, identityChanged: false, rateLimit: false, permanentError: false, failPersist: false, answerDuringLookup: false, answerDuringSend: false };
}
class Query {
  constructor(table) { this.table = table; this.filters = []; this.patch = null; }
  select() { return this; } update(value) { this.patch = value; return this; }
  eq(key, value) { this.filters.push(r => (key === "guild_dm_campaigns.status" ? state.campaign.status : r[key]) === value); return this; }
  in(key, values) { this.filters.push(r => values.includes(key === "guild_dm_campaigns.status" ? state.campaign.status : r[key])); return this; }
  order() { return this; } limit() { return this; }
  async run(single = false) {
    const source = this.table === "guild_dm_campaigns" ? state.campaign : state.recipient;
    if (!this.filters.every(f => f(source))) return { data: single ? null : [] };
    if (this.patch?.status === "sent" && state.failPersist) { state.failPersist = false; return { error: { message: "Persistence failed" } }; }
    if (this.patch) Object.assign(source, this.patch);
    const data = { ...source, ...(this.table === "guild_dm_recipients" ? { guild_dm_campaigns: { ...state.campaign } } : {}) };
    return { data: single ? data : [data] };
  }
  maybeSingle() { return this.run(true); } single() { return this.run(true); } then(resolve, reject) { return this.run().then(resolve, reject); }
}
const db = { from(table) { assert.ok(["guild_dm_campaigns", "guild_dm_recipients"].includes(table), "No Inter-saison table access"); return new Query(table); },
  async rpc(name, args) {
    assert.equal(name, "authorize_guild_survey_delivery"); assert.equal(args.p_dm_recipient, "dm-recipient"); assert.equal(args.p_discord_user_id, discordId);
    state.auth++;
    return state.answered || state.closed || state.identityChanged ? { error: { message: "Already answered, closed or changed" } } : { data: { authorized: true } };
  } };
const client = { users: { async fetch(id) {
  assert.equal(id, discordId);
  if (state.answerDuringLookup) { state.answered = true; state.recipient.status = "cancelled"; }
  return { async send(payload) {
    if (state.rateLimit) throw { status: 429, retry_after: 0.001, message: "Rate limit" };
    if (state.permanentError) throw { status: 403, code: 50007, message: "Cannot send messages" };
    state.sent.push(payload);
    if (state.answerDuringSend) { state.answered = true; state.recipient.status = "cancelled"; }
    return { id: "actual-message" };
  } };
} } };
const tick = () => worker.processGuildDmBatch({ client, supabase: db });
reset();
const payload = worker.buildGuildDmPayload(state.campaign, state.recipient);
assert.match(payload.content, /Account \(G10\)/); assert.deepEqual(payload.components, []); assert.deepEqual(payload.allowedMentions, { parse: [] });
assert.equal(adapter.isGuildSurveyCampaign({ interaction_payload: {} }), false);
assert.throws(() => adapter.buildGuildSurveyPayload({ ...state.campaign, interaction_type: "ack" }, state.recipient), /invalide/);
await tick(); assert.equal(state.sent.length, 1); assert.equal(state.auth, 2); assert.equal(state.recipient.status, "sent");
await tick(); assert.equal(state.sent.length, 1);
reset(); await Promise.all([tick(), tick()]); assert.equal(state.sent.length, 1, "Only one worker claims a queued recipient");
reset(); state.answered = true; await tick(); assert.equal(state.sent.length, 0);
reset(); state.closed = true; await tick(); assert.equal(state.sent.length, 0);
reset(); state.identityChanged = true; await tick(); assert.equal(state.sent.length, 0);
reset(); state.answerDuringLookup = true; await tick(); assert.equal(state.sent.length, 0, "Late answer before Discord send is rechecked"); assert.equal(state.recipient.status, "cancelled");
reset(); state.answerDuringSend = true; await tick(); assert.equal(state.sent.length, 1); assert.equal(state.recipient.status, "cancelled", "Record an already accepted DM without undoing a concurrent response");
reset(); state.permanentError = true; await tick(); await tick(); assert.equal(state.sent.length, 0); assert.equal(state.recipient.send_attempts, 1); assert.equal(state.recipient.status, "failed");
reset(); state.rateLimit = true;
for (let i = 0; i < 5; i++) await tick();
assert.equal(state.recipient.send_attempts, 5); assert.equal(state.recipient.status, "failed");
reset(); state.failPersist = true; await tick(); assert.equal(state.sent.length, 1); assert.match(state.recipient.last_error, /DELIVERY_UNCERTAIN/);
await tick(); assert.equal(state.sent.length, 1, "Uncertain delivery is never resent automatically");
console.log("Guild survey worker tests passed: no real Discord client, no network, existing queue exercised.");
