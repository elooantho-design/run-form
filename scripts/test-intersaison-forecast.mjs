import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";
import { buildSurveyChoiceForecast } from "../src/lib/intersaisonSurveyChoices.js";
import { buildForecastAvatarUrl, createForecastAvatarQueue } from "../src/lib/intersaisonForecast.js";
import { createForecastAvatarReader } from "../api/_intersaison-forecast-avatars.js";
import { runSurveyChoiceAction } from "../api/_intersaison-survey-choices.js";

globalThis.fetch = () => { throw Error("Real network forbidden in forecast tests"); };
const owner = "111111111111111111", secondOwner = "222222222222222222";
const members = [
  { id: "root", watcher_name: "Principal", guild_code: "G3", discord_id: owner, role: "member" },
  { id: "alt", watcher_name: "Secondaire", guild_code: "G2", discord_id: "", primary_member_id: "root", role: "member" },
  { id: "solo", watcher_name: "Sans avatar", guild_code: "G4", discord_id: "invalid", role: "member" },
];
const recipients = members.map((m) => ({ id: `r-${m.id}`, member_key: m.id, member_id: m.id, guild_code_snapshot: "G1" }));
const responses = [
  { id: "old", survey_recipient_id: "r-root", poll_number: 2, is_current: false, first_choice_guild_code: "G7", second_choice_guild_code: "G6", comment_text: "Ancien commentaire" },
  { id: "current", survey_recipient_id: "r-root", poll_number: 2, is_current: true, first_choice_guild_code: "G1", second_choice_guild_code: "G2", comment_text: "  Commentaire intégral\nSans troncature.  " },
  { id: "alt-answer", survey_recipient_id: "r-alt", poll_number: 2, is_current: true, first_choice_guild_code: "G4", second_choice_guild_code: "", comment_text: "" },
];
const placements = [{ id: "manual", member_key: "root", revision: 1, action: "set", guild_code: "G5" }];
const roles = [
  { member_key: "root", revision: 1, forecast_role: "leader" },
  { member_key: "alt", revision: 1, forecast_role: "officer" },
  { member_key: "alt", revision: 2, forecast_role: "member" },
];
const baseline = structuredClone({ members, recipients, responses, placements });
const forecast = buildSurveyChoiceForecast({ members, recipients, responses, placements, roles });
const root = forecast.players.find((p) => p.memberKey === "root"), alt = forecast.players.find((p) => p.memberKey === "alt");
assert.equal(root.currentGuild, "G3", "active roster is distinct from the launch snapshot and manual destination");
assert.equal(root.originGuild, "G1", "historical origin remains available without changing exports");
assert.equal(root.targetGuild, "G5"); assert.equal(root.hasDifference, true);
assert.equal(root.answer.id, "current"); assert.equal(root.answer.comment_text, responses[1].comment_text);
assert.equal(root.forecastRole, "leader"); assert.equal(alt.forecastRole, "member"); assert.equal(alt.roleRevision, 2);
assert.equal(root.discordUserId, alt.discordUserId, "linked accounts share an avatar, not a forecast row");
assert.equal(forecast.players.find((p) => p.memberKey === "solo").discordUserId, "");
assert.equal(forecast.guilds.find((g) => g.code === "G2").count, 0, "second choices never increment a counter");
assert.equal(forecast.players.length, new Set(forecast.players.map((p) => p.memberKey)).size);
assert.equal(forecast.guilds.reduce((n, g) => n + g.count, 0) + forecast.unassigned.length, 3);
assert.deepEqual({ members, recipients, responses, placements }, baseline, "projection never mutates its sources");
const next = buildSurveyChoiceForecast({ members, recipients, placements, roles, responses: responses.map((r) => r.id === "current" ? { ...r, comment_text: "Dernière version", second_choice_guild_code: "G6" } : r) });
assert.equal(next.players.find((p) => p.memberKey === "root").answer.comment_text, "Dernière version");
assert.equal(next.players.find((p) => p.memberKey === "root").targetGuild, "G5");
assert.equal(buildSurveyChoiceForecast({ members: [members[1]], roles }).players[0].discordUserId, "", "unresolved principal uses the generic fallback");
assert.equal(buildForecastAvatarUrl({ id: owner, avatar: "a_" + "a".repeat(32) }), `https://cdn.discordapp.com/avatars/${owner}/a_${"a".repeat(32)}.png?size=64`);
assert.match(buildForecastAvatarUrl({ id: owner }), /^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/[0-5]\.png$/);
assert.equal(buildForecastAvatarUrl({ id: "not-an-id" }), "");

const savedEnv = Object.fromEntries(["DISCORD_BOT_TOKEN", "DISCORD_DEFENSE_BOT_TOKEN", "DISCORD_TOKEN"].map((key) => [key, process.env[key]]));
for (const key of Object.keys(savedEnv)) delete process.env[key];
let calls = 0, clock = 1000;
const reader = createForecastAvatarReader({ now: () => clock, fetchImpl: async (url, options) => {
  calls++; assert.equal(options.method, "GET"); assert.equal(options.body, undefined);
  assert.equal(url, `https://discord.com/api/v10/users/${owner}`);
  return { ok: true, status: 200, json: async () => ({ id: owner, avatar: "b".repeat(32) }) };
} });
assert.deepEqual(await reader(members, ["root", "alt"], "paladin"), { root: "", alt: "" });
assert.equal(calls, 0, "missing token never breaks the plan or performs a request");
process.env.DISCORD_BOT_TOKEN = "fake-test-token";
const avatars = await reader(members, ["root", "alt", "solo"], "paladin");
assert.equal(calls, 1, "one GET per unique Discord identity, including secondary accounts");
assert.equal(avatars.root, avatars.alt); assert.equal(avatars.solo, "");
await reader(members, ["root", "alt"], "paladin"); assert.equal(calls, 1, "successful avatars are cached");
clock += 600001; await reader(members, ["root"], "paladin"); assert.equal(calls, 2);
const failed = createForecastAvatarReader({ fetchImpl: async () => { throw Error("unavailable"); } });
assert.equal((await failed(members, ["root"], "paladin")).root, "");
let limitedCalls = 0;
const limited = createForecastAvatarReader({ now: () => clock, fetchImpl: async () => { limitedCalls++; return { status: 429, json: async () => ({ retry_after: 30 }) }; } });
await limited(members, ["root"], "paladin");
await limited([...members, { id: "new", discord_id: secondOwner }], ["new"], "paladin");
assert.equal(limitedCalls, 1, "rate limit pauses further calls, with no automatic retry loop");
for (const [key, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }

const requests = [], results = [];
const queue = createForecastAvatarQueue(async (body) => {
  requests.push(body); return { avatars: Object.fromEntries(body.memberIds.map((id) => [id, `https://cdn.discordapp.com/embed/avatars/0.png`])) };
}, (key, url) => results.push([key, url]));
for (let i = 0; i < 25; i++) queue.add(`member-${i}`, `identity-${i}`);
await wait(300);
assert.deepEqual(requests.map((r) => r.memberIds.length), [12, 12, 1]);
assert.ok(requests.every((r) => r.action === "load-survey-forecast-avatars"));
assert.equal(results.length, 25);
queue.add("another-alt", "identity-0"); assert.equal(results.length, 26); assert.equal(requests.length, 3);
queue.dispose(); queue.add("hidden", "new"); await wait(80); assert.equal(requests.length, 3);
await assert.rejects(runSurveyChoiceAction({ from() { throw Error("No query before authorization"); } }, { role: "member" }, { organization_key: "paladin" }, {}, "load-survey-forecast-avatars", { memberIds: ["root"] }), /admins/);
for (const suffix of ["preflight", "verify"]) {
  const sql = await readFile(new URL(`intersaison_survey_forecast_roles_${suffix}.sql`, import.meta.url), "utf8");
  assert.doesNotMatch(sql, /^\s*(?:insert into|update|delete from|create table|alter table|drop table)\b/im);
}
const migration = await readFile(new URL("intersaison_survey_forecast_roles.sql", import.meta.url), "utf8");
assert.doesNotMatch(migration, /\b(?:update|insert into|delete from)\s+(?:public\.)?(?:guild_members|guild_dm_\w+|intersaison_survey_(?:responses|recipients|campaigns|objective_\w+))\b/i);
console.log("Forecast tests passed: current guild, latest comment, 2nd choice, roles, alts, counts, avatar batching/cache/fallback/rate limit. No real network or sends.");
