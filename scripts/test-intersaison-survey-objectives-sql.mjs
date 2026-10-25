import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  loadSurveyObjectivesPreparation, saveSurveyObjectivesDraft, validateSurveyObjectivesDraft,
} from "../api/_intersaison-survey-objectives.js";
import { normalizeSurveyObjectives } from "../src/lib/intersaisonSurveyObjectives.js";

// Run against a disposable in-memory PostgreSQL, never a Supabase connection.
// PGLITE_MODULE_PATH points at a separately installed @electric-sql/pglite entry point.
if (!process.env.PGLITE_MODULE_PATH) throw new Error("Set PGLITE_MODULE_PATH to run the isolated SQL integration tests.");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href);
const db = new PGlite();
const orgId = "10000000-0000-4000-8000-000000000001";
const foreignOrgId = "10000000-0000-4000-8000-000000000002";
const seasonId = "20000000-0000-4000-8000-000000000001";
const foreignSeasonId = "20000000-0000-4000-8000-000000000002";
const actor = { id: "30000000-0000-4000-8000-000000000001", role: "admin", guild_code: "G1" };
const ordinary = { id: "30000000-0000-4000-8000-000000000002", role: "member", guild_code: "G2" };
const organization = { id: orgId, organization_key: "paladin" };
const season = { id: seasonId, organization_id: orgId, status: "survey1_open" };
const migration = await readFile(new URL("./intersaison_survey_objectives.sql", import.meta.url), "utf8");
const preflight = await readFile(new URL("./intersaison_survey_objectives_preflight.sql", import.meta.url), "utf8");
const verify = await readFile(new URL("./intersaison_survey_objectives_verify.sql", import.meta.url), "utf8");

await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create table portal_organizations(id uuid primary key, organization_key text, is_active boolean default true);
  create table portal_guilds(id uuid primary key default gen_random_uuid(), organization_id uuid references portal_organizations(id), guild_code text, is_active boolean default true, unique(organization_id,guild_code));
  create table guild_members(id uuid primary key, role text, guild_code text);
  create table intersaison_survey_seasons(id uuid primary key, organization_id uuid references portal_organizations(id), status text);
  create table intersaison_survey_guild_objectives(id integer primary key, objective_text text);
  create table intersaison_survey_campaigns(id integer primary key, status text, poll_number integer);
  create table intersaison_survey_recipients(id integer primary key, response_status text);
  create table intersaison_survey_responses(id integer primary key, objective_text text);
  create table guild_dm_campaigns(id integer primary key, status text);
  create table guild_dm_recipients(id integer primary key, status text);
  insert into portal_organizations values ('${orgId}','paladin',true),('${foreignOrgId}','mad',true);
  insert into portal_guilds(organization_id,guild_code) select '${orgId}', 'G' || n from generate_series(1,7) n;
  insert into portal_guilds(organization_id,guild_code) values ('${foreignOrgId}','MAD G1');
  insert into guild_members values ('${actor.id}','admin','G1'),('${ordinary.id}','member','G2');
  insert into intersaison_survey_seasons values ('${seasonId}','${orgId}','survey1_open'),('${foreignSeasonId}','${foreignOrgId}','survey1_open');
  insert into intersaison_survey_guild_objectives values (1,'Reference historique intacte');
  insert into intersaison_survey_campaigns values (1,'open',1);
  insert into intersaison_survey_recipients values (1,'responded');
  insert into intersaison_survey_responses values (1,'Reponse originale intacte');
  insert into guild_dm_campaigns values (1,'partial');
  insert into guild_dm_recipients values (1,'sent');
  grant select on portal_guilds to service_role;
`);
const legacyTables = ["intersaison_survey_guild_objectives", "intersaison_survey_seasons", "intersaison_survey_campaigns", "intersaison_survey_recipients", "intersaison_survey_responses", "guild_dm_campaigns", "guild_dm_recipients"];
async function snapshot() {
  return Promise.all(legacyTables.map(async (table) => (await db.query(`select * from public.${table} order by id`)).rows));
}
const before = await snapshot();
assert.ok((await db.query(preflight)).rows.every((row) => row.status === "OK"));
await db.exec(migration);
assert.ok((await db.query(verify)).rows.every((row) => row.status === "OK"));
await db.exec("set role service_role");

class Query {
  constructor(table) { this.table = table; this.filters = []; this.desc = false; this.maximum = null; }
  select() { return this; }
  eq(column, value) { this.filters.push([column, value]); return this; }
  order(column, options) { assert.equal(column, "version_number"); this.desc = !options.ascending; return this; }
  limit(value) { this.maximum = value; return this; }
  async run(single = false) {
    assert.ok(["portal_guilds", "intersaison_survey_objective_versions", "intersaison_plan_cycles"].includes(this.table));
    const filter = this.filters.map(([col], index) => `${col} = $${index + 1}`).join(" and ");
    try {
      const { rows } = await db.query(`select * from public.${this.table}${filter ? ` where ${filter}` : ""}${this.desc ? " order by version_number desc" : ""}${this.maximum ? ` limit ${this.maximum}` : ""}`, this.filters.map(([, value]) => value));
      if (this.table === "intersaison_survey_objective_versions") {
        for (const row of rows) row.intersaison_survey_objective_items = (await db.query("select guild_code,objective_text from public.intersaison_survey_objective_items where version_id=$1", [row.id])).rows;
      }
      return { data: single ? rows[0] || null : rows, error: null };
    } catch (error) { return { data: null, error }; }
  }
  maybeSingle() { return this.run(true); }
  then(resolve, reject) { return this.run().then(resolve, reject); }
}
const client = {
  from: (table) => new Query(table),
  async rpc(name, args) {
    const validate = name === "validate_intersaison_survey_objectives_draft";
    assert.ok(validate || name === "save_intersaison_survey_objectives_draft");
    try {
      const params = [args.p_organization_id, args.p_season_id, args.p_actor_member_id];
      if (validate) params.push(args.p_version_id);
      else params.push(JSON.stringify(args.p_objectives), args.p_expected_version);
      const { rows } = await db.query(`select public.${name}(${params.map((_, index) => `$${index + 1}`).join(",")}) as id`, params);
      return { data: rows[0].id, error: null };
    } catch (error) { return { data: null, error }; }
  },
};
let prep = await loadSurveyObjectivesPreparation(client, actor, organization, season);
assert.equal(prep.version, null);
assert.equal(prep.schemaReady, true);
prep = await saveSurveyObjectivesDraft(client, actor, organization, season, { expectedVersion: 0, objectives: { G1: "Objectif partiel\nDeux lignes" } });
assert.equal(prep.version.versionNumber, 1);
assert.equal(prep.version.objectives.G2, "");
const version1 = prep.version;
assert.deepEqual((await loadSurveyObjectivesPreparation(client, actor, organization, season)).version, version1, "refresh restores persisted fields");
await assert.rejects(validateSurveyObjectivesDraft(client, actor, organization, season, { versionId: version1.id }), /sept objectifs/);
const full = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`G${i + 1}`, `Objectif ${i + 1}`]));
prep = await saveSurveyObjectivesDraft(client, actor, organization, season, { expectedVersion: 1, objectives: full });
const version2 = prep.version;
assert.equal(version2.versionNumber, 2);
assert.equal(prep.history[1].objectives.G1, version1.objectives.G1, "previous draft remains unchanged");
prep = await validateSurveyObjectivesDraft(client, actor, organization, season, { versionId: version2.id });
assert.equal(prep.version.status, "validated");
assert.equal(prep.version.officialAt, null, "validation does not publish");
prep = await saveSurveyObjectivesDraft(client, actor, organization, season, { expectedVersion: 2, objectives: full });
assert.equal(prep.version.versionNumber, 2, "saving unchanged text is idempotent and preserves validation");
prep = await saveSurveyObjectivesDraft(client, actor, organization, season, { expectedVersion: 2, objectives: { G2: "Nouveau texte" } });
assert.equal(prep.version.versionNumber, 3);
assert.equal(prep.version.status, "draft", "any changed draft loses current validation");
assert.equal(prep.version.validatedAt, null);
assert.equal(prep.version.objectives.G1, full.G1, "partial payload does not erase other guilds");
assert.equal(prep.history.find((v) => v.id === version2.id).objectives.G2, full.G2);
await assert.rejects(saveSurveyObjectivesDraft(client, actor, organization, season, { expectedVersion: 2, objectives: full }), /autre sauvegarde/);
await assert.rejects(validateSurveyObjectivesDraft(client, actor, organization, season, { versionId: version2.id }), /obsolete/);
await assert.rejects(saveSurveyObjectivesDraft(client, ordinary, organization, season, { expectedVersion: 3, objectives: full }), /admins/);
await assert.rejects(saveSurveyObjectivesDraft(client, { ...ordinary, role: "admin" }, organization, season, { expectedVersion: 3, objectives: full }), /Admin Paladin/, "database rejects forged actor role");
await assert.rejects(saveSurveyObjectivesDraft(client, actor, { ...organization, id: foreignOrgId }, season, { expectedVersion: 3, objectives: full }), /organisation/);
await assert.rejects(saveSurveyObjectivesDraft(client, actor, organization, { ...season, id: foreignSeasonId }, { expectedVersion: 0, objectives: full }), /introuvable/);
await assert.rejects(saveSurveyObjectivesDraft(client, actor, organization, season, { expectedVersion: 3, objectives: { "MAD G1": "Autre" } }), /périmètre/);
await assert.rejects(saveSurveyObjectivesDraft(client, actor, organization, season, { expectedVersion: 3, objectives: { G1: "x".repeat(601) } }), /600/);
const invalidDirect = await client.rpc("save_intersaison_survey_objectives_draft", { p_organization_id: orgId, p_season_id: seasonId, p_actor_member_id: actor.id, p_objectives: { ...full, G1: "x".repeat(601) }, p_expected_version: 3 });
assert.match(invalidDirect.error.message, /600/);
prep = await saveSurveyObjectivesDraft(client, actor, organization, season, {
  expectedVersion: 3, objectives: Object.fromEntries(Object.keys(full).map((code) => [code, "x".repeat(600)])),
});
assert.equal(prep.version.objectives.G7.length, 600, "all seven maximum-length fields can be saved");
await assert.rejects(db.query("update public.intersaison_survey_objective_items set objective_text='tampered'"), /permission denied/);
await db.exec("reset role");
await assert.rejects(db.query("update public.intersaison_survey_objective_items set organization_id=$1 where version_id=$2", [foreignOrgId, version2.id]), /foreign key constraint/, "composite FK prevents cross-organization items even outside the API");
await assert.rejects(db.query("insert into public.intersaison_survey_objective_versions(organization_id,season_id,version_number) values($1,$2,99)", [foreignOrgId, seasonId]), /foreign key constraint/, "season and organization cannot be mixed");
assert.deepEqual(await snapshot(), before, "survey 1, legacy reference objectives and DM queue remain byte-for-byte unchanged");
assert.equal((await db.query("select count(*)::integer as n from intersaison_survey_objective_versions where organization_id=$1", [foreignOrgId])).rows[0].n, 0);
assert.ok((await db.query(verify)).rows.every((row) => row.status === "OK"));
await db.exec(migration);
assert.equal((await db.query("select count(*)::integer as n from intersaison_survey_objective_versions")).rows[0].n, 4, "migration rerun keeps history");
assert.deepEqual(await snapshot(), before);
assert.deepEqual(normalizeSurveyObjectives(prep.version.objectives), prep.version.objectives);
await db.close();
console.log("Intersaison objectives SQL/API integration tests passed (isolated in-memory PostgreSQL).");
