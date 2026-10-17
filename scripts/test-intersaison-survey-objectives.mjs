import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  normalizeSurveyObjectives,
  buildSurveyTwoDiscordPayload,
  getSurveyObjectivesState,
  SURVEY_OBJECTIVE_GUILDS,
} from "../src/lib/intersaisonSurveyObjectives.js";

const empty = normalizeSurveyObjectives();
assert.equal(Object.keys(empty).length, 7);
assert.ok(Object.values(empty).every((value) => value === ""));
const partial = normalizeSurveyObjectives({ G1: "Premier objectif\nSeconde ligne" });
assert.equal(partial.G2, "");
assert.equal(normalizeSurveyObjectives({ G2: "Autre" }, partial).G1, partial.G1);
assert.equal(getSurveyObjectivesState(null, partial), "incomplete");
const full = Object.fromEntries(SURVEY_OBJECTIVE_GUILDS.map((code) => [code, "x".repeat(600)]));
assert.equal(getSurveyObjectivesState(null, full), "complete");
assert.equal(getSurveyObjectivesState({ status: "validated" }, full), "validated");
assert.equal(getSurveyObjectivesState({ status: "validated" }, full, { dirty: true }), "complete");
assert.equal(getSurveyObjectivesState({ status: "official" }, full), "official");
assert.throws(() => normalizeSurveyObjectives({ G8: "Hors périmètre" }), /périmètre/);
assert.throws(() => normalizeSurveyObjectives({ G1: "x".repeat(601) }), /600/);
assert.throws(() => normalizeSurveyObjectives({ G1: 123 }), /invalide/);
assert.throws(() => normalizeSurveyObjectives([]), /invalides/);
assert.equal(normalizeSurveyObjectives({ G1: "A\r\nB\rC" }).G1, "A\nB\nC");

const payload = buildSurveyTwoDiscordPayload(full);
assert.equal(payload.embeds.length, 1);
assert.equal(payload.embeds[0].fields.length, 7);
assert.deepEqual(payload.embeds[0].fields.map((field) => field.name), [
  "G1 — Legend", "G2 — Imperatores", "G3 — Loyalty", "G4 — Collegium", "G5 — Senatores", "G6 — Legacy", "G7 — Magistratus",
]);
assert.ok(payload.content.length <= 2000);
const embed = payload.embeds[0];
assert.ok(embed.title.length + embed.footer.text.length + embed.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0) <= 6000);
assert.ok(embed.fields.every((field) => field.value.length <= 1024 && !field.inline));
assert.equal(payload.components[0].components[0].disabled, true);
assert.deepEqual(payload.allowedMentions, { parse: [] });
assert.equal(buildSurveyTwoDiscordPayload(partial).embeds[0].fields[0].value, partial.G1);
assert.equal(buildSurveyTwoDiscordPayload(empty).embeds[0].fields[0].value, "Objectif à renseigner");

const api = await readFile(new URL("../api/portal-intersaison.js", import.meta.url), "utf8");
const rpc = await readFile(new URL("./intersaison_survey_objectives.sql", import.meta.url), "utf8");
assert.match(api, /requirePortalAdminSession\(req, supabase\)/);
assert.match(api, /loadActiveSurveySeason\(organization.id\)/);
assert.doesNotMatch(api, /action === "launch-survey-two"/);
assert.doesNotMatch(rpc, /(?:insert into|update|delete from) public\.(?:guild_dm_|intersaison_survey_(?:campaigns|recipients|responses|guild_objectives))/i);
assert.match(rpc, /for update/i);
assert.match(rpc, /p_expected_version/);
console.log("Intersaison objective preparation tests passed.");
