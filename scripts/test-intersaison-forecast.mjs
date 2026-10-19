import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { buildSurveyChoiceForecast } from "../src/lib/intersaisonSurveyChoices.js";
import { resolveForecastAvatarUrl } from "../src/lib/intersaisonForecast.js";
import { createForecastAvatarReader } from "../api/_intersaison-forecast-avatars.js";
import { runSurveyChoiceAction } from "../api/_intersaison-survey-choices.js";

globalThis.fetch = () => { throw Error("Real network forbidden in forecast tests"); };
const owner = "111111111111111111";
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
const assetKey = createHash("sha256").update(owner).digest("hex");
const version = "0123456789abcdef";
const expectedUrl = `https://vps-aad12be0.vps.ovh.net/assets/discord-avatars/${assetKey}.webp?v=${version}`;
assert.equal(resolveForecastAvatarUrl(expectedUrl), expectedUrl);
assert.equal(resolveForecastAvatarUrl(expectedUrl, { discordActivity: true }), `/vps-assets/assets/discord-avatars/${assetKey}.webp?v=${version}`);
assert.equal(resolveForecastAvatarUrl(`https://cdn.discordapp.com/avatars/${owner}/avatar.png`), "");
assert.equal(resolveForecastAvatarUrl("https://evil.example/avatars/test.webp"), "");
let calls = 0, clock = 1000, unavailable = false;
const reader = createForecastAvatarReader({ now: () => clock, fetchImpl: async (url, options) => {
  calls++;
  assert.equal(url, "https://vps-aad12be0.vps.ovh.net/assets/discord-avatars/manifest.json");
  assert.equal(options.method, "GET"); assert.equal(options.body, undefined); assert.equal(options.headers.Authorization, undefined);
  if (unavailable) throw Error("VPS temporarily unavailable");
  return new Response(JSON.stringify({ version: 1, avatars: { [assetKey]: version, "../invalid": "bad" } }), {
    headers: { "Content-Type": "application/json", ETag: '"manifest-1"' },
  });
} });
const [avatars, duplicateRead] = await Promise.all([reader(members, ["root", "alt", "solo"]), reader(members, ["root"])]);
assert.equal(avatars.root, expectedUrl); assert.equal(avatars.alt, expectedUrl); assert.equal(avatars.solo, "");
assert.equal(duplicateRead.root, expectedUrl); assert.equal(calls, 1, "one manifest request shared by every visible avatar");
await reader(members, ["root", "alt"]); assert.equal(calls, 1, "refresh inside cache lifetime does not fetch again");
clock += 60001; unavailable = true;
assert.equal((await reader(members, ["root"])).root, expectedUrl, "keep known URLs during a VPS outage");
assert.equal(calls, 2);
const absent = createForecastAvatarReader({ fetchImpl: async () => new Response("", { status: 404 }) });
assert.equal((await absent(members, ["root"])).root, "", "missing initial sync uses a neutral icon, never Discord");
const oversized = createForecastAvatarReader({ fetchImpl: async () => new Response("{}", { headers: { "Content-Length": "1048577" } }) });
assert.equal((await oversized(members, ["root"])).root, "");
const streamedOversize = createForecastAvatarReader({ fetchImpl: async () => new Response("x".repeat(1048577)) });
assert.equal((await streamedOversize(members, ["root"])).root, "", "stream is bounded even without Content-Length");
let conditionalCalls = 0;
const conditional = createForecastAvatarReader({ now: () => clock, fetchImpl: async (url, options) => {
  conditionalCalls++;
  if (conditionalCalls === 1) return new Response(JSON.stringify({ version: 1, avatars: { [assetKey]: version } }), { headers: { ETag: '"index-1"' } });
  assert.equal(options.headers["If-None-Match"], '"index-1"');
  return new Response(null, { status: 304 });
} });
assert.equal((await conditional(members, ["root"])).root, expectedUrl);
clock += 60001;
assert.equal((await conditional(members, ["root"])).root, expectedUrl, "304 preserves the cached index without transferring its body");
assert.equal(conditionalCalls, 2);
const code = await readFile(new URL("../src/components/IntersaisonSurveyTwoWorkspace.jsx", import.meta.url), "utf8");
assert.doesNotMatch(code, /createForecastAvatarQueue|load-survey-forecast-avatars/);
const rowCode = await readFile(new URL("../src/components/IntersaisonForecastPlayer.jsx", import.meta.url), "utf8");
assert.match(rowCode, /loading="lazy"/);
assert.doesNotMatch(rowCode, /fetch\(|cdn\.discordapp/);
await assert.rejects(runSurveyChoiceAction({ from() { throw Error("No query before authorization"); } }, { role: "member" }, { organization_key: "paladin" }, {}, "load-survey-forecast-avatars", { memberIds: ["root"] }), /admins/);
for (const suffix of ["preflight", "verify"]) {
  const sql = await readFile(new URL(`intersaison_survey_forecast_roles_${suffix}.sql`, import.meta.url), "utf8");
  assert.doesNotMatch(sql, /^\s*(?:insert into|update|delete from|create table|alter table|drop table)\b/im);
}
const migration = await readFile(new URL("intersaison_survey_forecast_roles.sql", import.meta.url), "utf8");
assert.doesNotMatch(migration, /\b(?:update|insert into|delete from)\s+(?:public\.)?(?:guild_members|guild_dm_\w+|intersaison_survey_(?:responses|recipients|campaigns|objective_\w+))\b/i);
console.log("Forecast tests passed: current guild, latest comment, 2nd choice, roles, alts, counts, VPS manifest/cache/fallback, zero per-avatar requests. No real network or sends.");
