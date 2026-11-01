import assert from "node:assert/strict";
import { createGuildSurveyHandler, guildSurveyHttpStatus } from "../api/portal-guild-surveys.js";
import { createPortalSessionToken } from "../api/_portal-auth.js";
import { guildSurveyCsv, reorganizationSurvey, surveyStats, validateSurveyDraft } from "../src/lib/guildSurveys.js";

globalThis.fetch = () => { throw Error("Real network forbidden in guild-survey API tests"); };
process.env.PORTAL_SESSION_SECRET = "guild-survey-isolated-tests-not-a-production-secret";
const member = { id: "51000000-0000-4000-8000-000000000010", role: "member", watcher_name: "Own member", guild_code: "G10" };
const token = createPortalSessionToken(member);
const calls = [];
let failure = null;
const db = {
  from(table) {
    assert.equal(table, "guild_members");
    return { select() { return this; }, eq(column, value) { assert.equal(column, "id"); assert.equal(value, member.id); return this; },
      async maybeSingle() { return { data: member }; } };
  },
  async rpc(name, args) { calls.push({ name, args }); return failure ? { error: failure } : { data: { surveys: [], actorId: args.p_actor } }; },
};
const handler = createGuildSurveyHandler(db);
async function request(method, action, body = {}, headers = {}) {
  const req = { method, url: `/api/portal-guild-surveys?action=${action}`, headers: { host: "run-form-tau.vercel.app", origin: "https://run-form-tau.vercel.app", cookie: `portal_session=${token}`, ...headers }, body: { action, ...body } };
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(value) { this.body = value ? JSON.parse(value) : null; } };
  await handler(req, res); return res;
}
assert.equal((await request("GET", "mine")).statusCode, 200);
assert.equal(calls.at(-1).args.p_actor, member.id);
assert.equal((await request("POST", "answer", { actor: "forged", memberId: "victim", expectedRevision: 0, payload: { answers: {} } })).statusCode, 200);
assert.equal(calls.at(-1).args.p_actor, member.id, "The caller cannot supply the actor identity");
assert.equal(calls.at(-1).args.p_expected, 0);
const count = calls.length;
assert.equal((await request("GET", "publish")).statusCode, 400);
assert.equal((await request("POST", "mine")).statusCode, 400);
assert.equal((await request("POST", "publish", {}, { origin: "https://evil.example" })).statusCode, 403);
assert.equal((await request("GET", "mine", {}, { cookie: "" })).statusCode, 401);
assert.equal((await request("DELETE", "close")).statusCode, 405);
assert.equal(calls.length, count, "Rejected HTTP requests never call the SQL action");
for (const [code, status] of [["42501", 403], ["P0002", 404], ["40001", 409], ["55P03", 409], ["23505", 409], ["22023", 400], ["22007", 400], ["22008", 400], ["23502", 400], ["PGRST202", 428]]) {
  failure = { code, message: "Controlled denial" };
  assert.equal((await request("GET", "detail")).statusCode, status);
  assert.equal(guildSurveyHttpStatus(failure), status);
}
failure = { message: "PRIVATE SQL DATA", code: "XX000" };
const denied = await request("GET", "detail");
assert.equal(denied.statusCode, 500); assert.doesNotMatch(JSON.stringify(denied.body), /PRIVATE/);

const guilds = [2, 8, 9, 10].map(n => ({ id: `id-${n}`, guild_code: `G${n}` }));
const preset = reorganizationSurvey(guilds);
assert.deepEqual(preset.target_guild_ids, ["id-2", "id-8"], "Only the optional preset targets G2/G8");
assert.equal(validateSurveyDraft(preset), ""); assert.equal(preset.questions.length, 3);
assert.match(preset.introduction, /PB/); assert.match(preset.introduction, /Boss hebdomadaires/); assert.match(preset.introduction, /pas une garantie/);
assert.equal(preset.questions[2].required, false);
assert.notEqual(validateSurveyDraft({ ...preset, target_guild_ids: [] }), "");
const campaign = { questions: [{ id: "q", type: "multiple", label: "=Sensitive header", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] }] };
const recipients = [
  { member_name_snapshot: "=HYPERLINK(\"bad\")", guild_code_snapshot: "G10", delivery_status: "sent", response: { answers: { q: ["a", "b"] }, updated_at: "now" } },
  { member_name_snapshot: "Another", guild_code_snapshot: "G8", delivery_status: "failed" },
];
assert.equal(surveyStats(campaign, recipients).responded, 1);
assert.equal(surveyStats(campaign, recipients, "G10").rate, 100);
assert.equal(surveyStats(campaign, recipients, "G8").responded, 0);
assert.deepEqual(surveyStats(campaign, recipients).questions[0].options.map(o => o.count), [1, 1]);
const csv = guildSurveyCsv(campaign, recipients);
assert.equal(csv.charCodeAt(0), 0xfeff);
assert.match(csv, /"'=HYPERLINK\(""bad""\)"/); assert.match(csv, /"'=Sensitive header"/); assert.match(csv, /A \| B/);
console.log("Guild survey API, identity, safe-method, preset, statistics and CSV tests passed (no network).");
