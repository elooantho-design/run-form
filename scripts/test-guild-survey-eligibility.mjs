import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createGuildSurveyHandler } from "../api/portal-guild-surveys.js";
import { createPortalSessionToken } from "../api/_portal-auth.js";

globalThis.fetch = () => { throw Error("Production/network forbidden in eligibility regression tests"); };
process.env.PORTAL_SESSION_SECRET = "isolated-guild-survey-eligibility-test";
if (!process.env.PGLITE_MODULE_PATH) throw Error("PGLITE_MODULE_PATH must select an isolated PostgreSQL runtime");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href);
const db = new PGlite();
const file = name => readFile(new URL(`${name}.sql`, import.meta.url), "utf8");
const patch = await file("guild_surveys_eligibility_fix");
const verifySql = await file("guild_surveys_eligibility_verify");
const rules = JSON.parse(patch.split("$guild_survey_eligibility_rules$")[1]);
const canonical = await file("guild_surveys");
const id = n => `52000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const org = id(100), otherOrg = id(101), testOrg = id(102);
const gid = n => id(200 + n);
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
let assertions = 0, inTransaction = false;
const check = (actual, expected, label) => { assert.deepEqual(actual, expected, label); assertions++; };
async function reject(fn, pattern) {
  if (inTransaction) await db.exec("savepoint expected_failure");
  try { await assert.rejects(fn, pattern); assertions++; }
  finally { if (inTransaction) await db.exec("rollback to savepoint expected_failure; release savepoint expected_failure"); }
}
async function scenario(label, fn) {
  await db.exec("begin"); inTransaction = true;
  try { await fn(); console.log("OK:", label); }
  finally { await db.exec("rollback"); inTransaction = false; }
}
const call = async (actor, action, survey = null, payload = {}, expected = null) =>
  (await one("select guild_survey_request($1,$2,$3,$4,$5) value", [actor, action, survey, expected, payload])).value;
function functionText(source, signature) {
  const name = signature.split("(")[0];
  const start = source.indexOf(`create or replace function ${name}(`);
  const body = source.indexOf("as $$", start) + 5;
  const end = source.indexOf("$$;", body) + 3;
  assert.ok(start >= 0 && body > start && end > body, signature);
  return { start, end, text: source.slice(start, end), body: source.slice(body, end - 3) };
}
let legacy = canonical;
for (const rule of rules) {
  const current = functionText(legacy, rule.signature);
  assert.equal(current.text.split(rule.after).length - 1, 1, "Patch and canonical installation must stay aligned");
  legacy = legacy.slice(0, current.start) + current.text.replace(rule.after, rule.before) + legacy.slice(current.end);
}
// Anonymous aggregates from the observed roster: no production identity or credential.
// Per guild: total, inactive-community-field members/admins/leaders, active-field admins.
const distribution = [[1, 30, 15, 7, 2, 1], [2, 29, 8, 1, 1, 1], [3, 30, 26, 1, 0, 0],
  [4, 30, 6, 0, 0, 0], [5, 30, 3, 1, 0, 2], [6, 30, 4, 0, 0, 1],
  [7, 18, 5, 0, 0, 0], [8, 21, 20, 1, 0, 0], [9, 13, 13, 0, 0, 0]];
const people = [];
let serial = 1000;
for (const [guild, total, members, admins, leaders, otherAdmins] of distribution) {
  const groups = [["member", "inactive", members], ["admin", "inactive", admins], ["leader", "inactive", leaders],
    ["admin", "active", otherAdmins], ["member", "active", total - members - admins - leaders - otherAdmins]];
  for (const [role, community_status, count] of groups) for (let i = 0; i < count; i++) {
    serial++;
    people.push({ id: id(serial), watcher_name: `Fictional ${serial}`, role, community_status, community_access_type: null,
      roster_status: "active", guild_code: `G${guild}`, discord_id: String(300000000000000000n + BigInt(serial)) });
  }
}
const affected = people.filter(m => m.community_status === "inactive");
const leaders = affected.filter(m => m.role === "leader");
const admins = affected.filter(m => m.role === "admin");
const leader = leaders[0], admin = admins[0], g8 = affected.find(m => m.guild_code === "G8" && m.role === "member"), g9 = affected.find(m => m.guild_code === "G9");
let rpcCalls = 0;
const api = createGuildSurveyHandler({
  from(table) {
    assert.equal(table, "guild_members"); let selected;
    return { select() { return this; }, eq(column, value) { assert.equal(column, "id"); selected = value; return this; },
      async maybeSingle() { return { data: (await one("select * from guild_members where id=$1", [selected])) || null }; } };
  },
  async rpc(name, args) {
    assert.equal(name, "guild_survey_request"); rpcCalls++;
    try { return { data: await call(args.p_actor, args.p_action, args.p_survey, args.p_payload, args.p_expected) }; }
    catch (error) { return { error: { code: error.code, message: error.message } }; }
  },
});
async function http(actor, action = "mine") {
  const token = createPortalSessionToken(actor);
  const req = { method: "GET", url: `/api/portal-guild-surveys?action=${action}`,
    headers: { host: "run-form-tau.vercel.app", cookie: `portal_session=${token}` } };
  const res = { statusCode: 200, setHeader() {}, end(value) { this.body = value ? JSON.parse(value) : null; } };
  await api(req, res); return res;
}
const draft = { title: "Isolated eligibility fixture", introduction: "Not published", deadline: null,
  target_guild_ids: [gid(8), gid(9)], questions: [{ id: "q", label: "Avis", type: "single", required: true, options: [{ id: "yes", label: "Oui" }, { id: "no", label: "Non" }] }] };
const protectedTables = ["guild_members", "portal_guilds", "portal_organizations", "guild_dm_campaigns", "guild_dm_recipients",
  "intersaison_survey_seasons", "intersaison_survey_campaigns", "intersaison_survey_recipients", "intersaison_survey_responses",
  "intersaison_survey_placements", "intersaison_survey_forecast_roles", "intersaison_survey_objective_versions", "intersaison_survey_objective_items",
  "guild_surveys", "guild_survey_recipients", "guild_survey_responses", "guild_survey_waves", "guild_survey_deliveries", "guild_survey_delivery_events", "guild_survey_settings"];
const snapshot = async () => Object.fromEntries(await Promise.all(protectedTables.map(async t =>
  [t, (await db.query(`select to_jsonb(t) v from ${t} t order by to_jsonb(t)::text`)).rows])));
const functions = async () => (await db.query("select p.oid::text,p.proname,p.prosrc,p.proacl::text,p.proowner::text,p.proconfig,p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by p.oid")).rows;
async function verify() {
  await db.exec("begin read only");
  try { return (await one(verifySql)).guild_surveys_eligibility_verify; }
  finally { await db.exec("rollback"); }
}

try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table portal_organizations(id uuid primary key,organization_key text,is_active boolean default true);
    create table portal_guilds(id uuid primary key default gen_random_uuid(),organization_id uuid references portal_organizations(id),guild_code text,display_name text,is_active boolean default true,unique(organization_id,guild_code));
    create table guild_members(id uuid primary key,watcher_name text,role text,guild_code text,discord_id text,roster_status text default 'active',community_access_type text,
      community_status text default 'inactive',primary_member_id uuid references guild_members(id),permanent_profile jsonb default '{"pb":999,"awakening":5,"heroes":[1,2]}');`);
  await db.query("insert into portal_organizations values($1,'paladin',true),($2,'other',true),($3,'test',true)", [org, otherOrg, testOrg]);
  for (let n = 1; n <= 9; n++) await db.query("insert into portal_guilds(id,organization_id,guild_code,display_name) values($1,$2,$3,$3)", [gid(n), org, `G${n}`]);
  await db.query("insert into portal_guilds(id,organization_id,guild_code,display_name) values($1,$2,'OTHER G1','Other'),($3,$4,'TEST G1','Test')", [gid(50), otherOrg, gid(51), testOrg]);
  for (const person of people) await db.query("insert into guild_members(id,watcher_name,role,community_status,community_access_type,roster_status,guild_code,discord_id) values($1,$2,$3,$4,$5,$6,$7,$8)", Object.values(person));
  const extras = [
    { id: id(20), role: "admin", guild: "OTHER G1", roster: "active", access: null, status: "inactive" },
    { id: id(21), role: "member", guild: "G8", roster: "inactive", access: null, status: "active" },
    { id: id(22), role: "leader", guild: "G9", roster: "inactive", access: null, status: "active" },
    ...["community_member", "content_creator", "vip"].map((role, i) => ({ id: id(30 + i), role, guild: "G8", roster: "active", access: null, status: "inactive" })),
    { id: id(33), role: "admin", guild: "G9", roster: "active", access: "community", status: "inactive" },
    { id: id(34), role: "community_member", guild: null, roster: "active", access: null, status: "active" },
    { id: id(35), role: "admin", guild: "G1", roster: "active", access: "community", status: "active" },
  ];
  for (const m of extras) await db.query("insert into guild_members(id,watcher_name,role,guild_code,roster_status,community_access_type,community_status,discord_id) values($1,$2,$3,$4,$5,$6,$7,$8)",
    [m.id, `Fictional extra ${m.id}`, m.role, m.guild, m.roster, m.access, m.status, "4000000000000000" + m.id.slice(-2)]);
  for (const name of ["guild_dm_campaigns", "guild_dm_campaigns_test_mode", "guild_dm_campaigns_lifecycle", "intersaison_surveys", "intersaison_surveys_test_mode",
    "intersaison_survey_objectives", "intersaison_survey_choices", "intersaison_survey_accounts", "intersaison_survey_forecast_roles", "intersaison_survey_reminders"])
    await db.exec((await file(name)).replace(/create extension if not exists pgcrypto;/gi, ""));
  await db.exec(`insert into guild_dm_campaigns(id,organization_id,message,target_guild_codes,status) values('${id(600)}','${org}','Legacy queued message',array['G2'],'queued');
    insert into guild_dm_recipients(id,campaign_id,organization_id,member_id,guild_code,member_name_snapshot,discord_user_id)
      values('${id(601)}','${id(600)}','${org}','${leader.id}','G1','Legacy','${leader.discord_id}');
    insert into intersaison_survey_seasons(id,organization_id,status) values('${id(610)}','${org}','survey1_open');
    insert into intersaison_survey_campaigns(id,season_id,organization_id,poll_number,status,title,message) values('${id(611)}','${id(610)}','${org}',1,'open','Historical','Unchanged');
    insert into intersaison_survey_recipients(id,survey_campaign_id,organization_id,member_id,guild_code_snapshot,member_name_snapshot)
      values('${id(612)}','${id(611)}','${org}','${leader.id}','G1','Historical');
    insert into intersaison_survey_responses(survey_campaign_id,survey_recipient_id,organization_id,member_id,poll_number,guild_code_snapshot,member_name_snapshot,objective_text)
      values('${id(611)}','${id(612)}','${org}','${leader.id}',1,'G1','Historical','Historical response');`);
  await db.exec(legacy);
  check(people.length, 231); check(affected.length, 114); check(leaders.length, 3); check(admins.length, 11);
  const before = await snapshot(), beforeFunctions = await functions();
  const oldVerify = await verify(); check(oldVerify.all_checks_ok, false, "Read-only verification detects the installed bug");
  for (const person of affected) check((await http(person)).statusCode, 403, "All 114 historical false exclusions reproduced through the real API");
  const workingAdmin = people.find(m => m.role === "admin" && m.community_status === "active");
  const oldCatalog = await call(workingAdmin.id, "list");
  check(oldCatalog.guilds.find(g => g.guild_code === "G8").active_members, 0);
  check(oldCatalog.guilds.find(g => g.guild_code === "G9").active_members, 0);
  console.log("OK: reproduced 114 HTTP 403 responses, including 3 Leaders/11 Admins, and empty G8/G9 counts");

  await db.exec(patch);
  check(await snapshot(), before, "The targeted patch changes no member, profile, historical response, queue or delivery flag");
  const afterFunctions = await functions();
  const targets = new Set(rules.map(r => r.signature.split("(")[0].split(".")[1]));
  check(afterFunctions.filter((f, i) => f.prosrc !== beforeFunctions[i].prosrc).map(f => f.proname).sort(), [...targets].sort(), "Exactly five function bodies changed");
  check(afterFunctions.map(({ prosrc: _body, ...rest }) => rest), beforeFunctions.map(({ prosrc: _body, ...rest }) => rest), "ACLs, owners, security, OIDs and search paths unchanged");
  for (const f of afterFunctions.filter(f => targets.has(f.proname))) {
    const target = rules.find(r => r.signature.startsWith(`public.${f.proname}(`));
    check(f.prosrc.trim(), functionText(canonical, target.signature).body.trim(), "Corrected fresh install and targeted patch agree");
  }
  await db.exec(patch); check(await functions(), afterFunctions, "Patch is idempotent"); check(await snapshot(), before);
  const verification = await verify();
  check(verification.all_checks_ok, true); check(verification.checks.length, 10); check(verification.delivery_enabled, false);
  const recovered = verification.organizations.find(o => o.organization_key === "paladin");
  check(recovered.active_guild_accounts, 231); check(recovered.previously_filtered_active_accounts, 114);
  check(recovered.recovered_leaders, 3); check(recovered.recovered_admins, 11);
  for (const [n, total] of distribution) {
    const g = verification.guild_counts.find(g => g.organization_key === "paladin" && g.guild_code === `G${n}`);
    check(g.expected_active_accounts, total); check(g.reported_active_accounts, total, "G1-G9 all match the active roster");
  }
  check(await snapshot(), before, "Runtime verification is read-only");
  for (const person of affected) check((await http(person)).statusCode, 200, "All 114 members regain access through the real API");
  for (const person of [...leaders, ...admins]) {
    const result = await http(person, "list"); check(result.statusCode, 200); check(result.body.guilds.length, 9);
  }
  check((await http(g8, "list")).statusCode, 403, "A restored member never gains administration rights");
  check((await http({ id: id(20) }, "list")).body.guilds.map(g => g.guild_code), ["OTHER G1"]);
  for (const n of [21, 22, 30, 31, 32, 33]) {
    check((await http({ id: id(n) })).statusCode, 403, "Inactive roster/community accounts remain excluded");
    await reject(() => call(id(n), "mine"), /Session membre invalide/);
  }
  check((await http({ id: id(35) }, "list")).statusCode, 403, "An active community account cannot gain guild administration through a stale role");
  const apiCallsBefore = rpcCalls; await http({ id: id(30) }); check(rpcCalls, apiCallsBefore, "Existing API rejects disabled community accounts before SQL");
  console.log("OK: 114 restored accesses, all 3 Leaders/11 Admins, G8=21/G9=13 and G1-G7 counts; inactive accounts still denied");

  await scenario("recipient preview, linked principal and dynamic organization/guild guards", async () => {
    await db.query("update guild_members set guild_code='G8' where id=$1", [id(34)]);
    check((await one("select _guild_survey_actor($1) value", [id(34)])).value.rank, 0, "A legacy community role cannot gain guild administration");
    const c = (await call(leader.id, "save", null, draft)).campaign;
    const preview = await call(leader.id, "preview", c.id);
    check(preview.accounts, 34); check(preview.participants, 34); check(preview.eligible, 34); check(preview.deliveryReady, false);
    check(preview.recipients.filter(r => r.guild_code_snapshot === "G8").length, 21);
    check(preview.recipients.filter(r => r.guild_code_snapshot === "G9").length, 13);
    await reject(() => call(id(20), "preview", c.id), /introuvable/);
    await reject(() => call(admin.id, "preview", c.id), /Leader/);
    const all = (await call(leader.id, "save", null, { ...draft, target_guild_ids: distribution.map(([n]) => gid(n)) })).campaign;
    check((await call(leader.id, "preview", all.id)).accounts, 231);
    await db.query("insert into guild_members(id,watcher_name,role,guild_code,discord_id,community_status,primary_member_id) values($1,'Linked fictional','member','G8',$2,'inactive',$3)", [id(9000), g8.discord_id, g8.id]);
    const linked = await call(leader.id, "preview", c.id);
    check(linked.accounts, 35); check(linked.participants, 34); check(linked.eligible, 34);
    check(linked.recipients.find(r => r.member_key === g8.id).linked_accounts, 2);
    await db.query("insert into portal_guilds(id,organization_id,guild_code) values($1,$2,'G10')", [gid(10), org]);
    check((await call(leader.id, "list")).guilds.some(g => g.guild_code === "G10"), true);
    await db.query("update portal_guilds set is_active=false where id=$1", [gid(8)]);
    await reject(() => call(leader.id, "preview", c.id), /inactif ou ambigu/);
    await db.query("update portal_guilds set is_active=true where id=$1", [gid(8)]);
    await db.query("update portal_organizations set is_active=false where id=$1", [org]);
    await reject(() => call(leader.id, "list"), /Leader ou Admin/);
  });
  await scenario("answers and pre-send authorization simulated with rollback, never sent", async () => {
    const c = (await call(leader.id, "save", null, { ...draft, target_guild_ids: distribution.map(([n]) => gid(n)) })).campaign;
    await db.query("update guild_surveys set status='open' where id=$1", [c.id]);
    await db.query(`insert into guild_survey_recipients(survey_id,organization_id,member_id,member_key,owner_member_ids,member_name_snapshot,guild_code_snapshot,linked_accounts,discord_user_id,eligibility)
      select $1,$2,r.member_key,r.member_key,r.owner_member_ids,r.member_name_snapshot,r.guild_code_snapshot,r.linked_accounts,r.discord_user_id,r.eligibility from _guild_survey_roster($1) r`, [c.id, org]);
    await db.query("insert into guild_dm_campaigns(id,organization_id,message,target_guild_codes,status,interaction_type,interaction_payload) values($1,$2,'Local fixture only',array['G8','G9'],'queued','none',$3)",
      [id(700), org, { kind: "guild_survey_v1", surveyId: c.id, waveId: id(701) }]);
    await db.query("insert into guild_survey_waves(id,survey_id,organization_id,kind,created_by_member_id,fingerprint,dm_campaign_id) values($1,$2,$3,'initial',$4,'isolated',$5)", [id(701), c.id, org, leader.id, id(700)]);
    for (const [n, person] of [leader, admin, g8, g9].entries()) {
      await db.query("insert into guild_dm_recipients(id,campaign_id,organization_id,member_id,guild_code,member_name_snapshot,discord_user_id) values($1,$2,$3,$4,$5,'Fictional',$6)", [id(710 + n), id(700), org, person.id, person.guild_code, person.discord_id]);
      await db.query("insert into guild_survey_deliveries(wave_id,recipient_id,survey_id,organization_id,dm_recipient_id) select $1,r.id,$2,$3,$4 from guild_survey_recipients r where r.survey_id=$2 and r.member_key=$5", [id(701), c.id, org, id(710 + n), person.id]);
    }
    const authorize = (n, person) => one("select authorize_guild_survey_delivery($1,$2) value", [id(710 + n), person.discord_id]);
    await reject(() => authorize(2, g8), /non autorisee/);
    // Test only: a transient flag in a disposable transaction, rolled back below.
    await db.exec("update guild_survey_settings set delivery_enabled=true");
    for (const [n, person] of [leader, admin, g8, g9].entries()) check((await authorize(n, person)).value.authorized, true);
    check((await call(g8.id, "answer", c.id, { answers: { q: "yes" } }, 0)).version, 1);
    check((await call(g8.id, "answer", c.id, { answers: { q: "no" } }, 1)).version, 2);
    await reject(() => authorize(2, g8), /non autorisee/);
    await reject(() => call(id(20), "answer-form", c.id), /destinataires/);
    await db.query("update guild_members set guild_code='OTHER G1' where id=$1", [g9.id]);
    await reject(() => authorize(3, g9), /non autorisee/);
    await db.query("update guild_members set guild_code='G9' where id=$1", [g9.id]);
    await db.query("update guild_members set roster_status='inactive' where id=$1", [g9.id]);
    await reject(() => authorize(3, g9), /non autorisee/);
    await reject(() => call(g9.id, "answer-form", c.id), /Session membre invalide/);
    await db.query("update guild_members set roster_status='active',community_access_type='community' where id=$1", [g9.id]);
    await reject(() => authorize(3, g9), /non autorisee/);
    await reject(() => call(g9.id, "answer-form", c.id), /Session membre invalide/);
  });
  check(await snapshot(), before, "All simulated changes rolled back; historical data and disabled flag intact");
  await db.exec("update guild_survey_settings set delivery_enabled=true");
  await assert.rejects(() => db.exec(patch), /envois doivent deja etre desactives/); assertions++;
  await db.exec("rollback");
  check((await one("select delivery_enabled from guild_survey_settings")).delivery_enabled, true, "Patch never changes the operator flag");
  await db.exec("update guild_survey_settings set delivery_enabled=false");
  const goodDefinitions = (await db.query("select p.proname,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any($1::text[])", [[...targets]])).rows;
  const actorSignature = rules[0].signature;
  const extendedActor = functionText(legacy, actorSignature).text.replace("  select * into m", "  -- Unrelated installed comment must survive the targeted patch.\n  select * into m");
  await db.exec(extendedActor); await db.exec(patch);
  check((await one("select prosrc from pg_proc where oid='public._guild_survey_actor(uuid)'::regprocedure")).prosrc.includes("Unrelated installed comment"), true);
  for (const signature of new Set(rules.map(r => r.signature))) await db.exec(functionText(legacy, signature).text);
  const lastRule = rules.find(r => r.signature.startsWith("public.guild_survey_request("));
  await db.exec(functionText(legacy, lastRule.signature).text.replace(lastRule.before, lastRule.before.replace("<>'inactive'", "<> 'inactive'")));
  const drifted = await functions();
  await assert.rejects(() => db.exec(patch), /definition inattendue/); assertions++;
  await db.exec("rollback"); check(await functions(), drifted, "An error in the last function rolls back the four earlier replacements");
  for (const f of goodDefinitions) await db.exec(f.definition);
  check(await snapshot(), before); check((await verify()).all_checks_ok, true);
  check((await one("select delivery_enabled from guild_survey_settings")).delivery_enabled, false);
  if (process.env.GUILD_SURVEY_ELIGIBILITY_REPORT) await writeFile(process.env.GUILD_SURVEY_ELIGIBILITY_REPORT, JSON.stringify({
    isolated: true, network: "blocked", assertions, reproducedHttp403: 114, correctedHttpAccesses: 114,
    verification, protectedTables: protectedTables.length, dataAndQueueUnchanged: true, deliveryEnabledAfter: false,
    patchedFunctions: [...targets].sort(), atomicRollbackValidated: true, idempotenceValidated: true,
  }, null, 2));
  console.log(`All eligibility regression tests passed: ${assertions} assertions; original bug reproduced, targeted patch and read-only verification validated; no network.`);
} catch (error) {
  console.error(error); process.exitCode = 1;
} finally { await db.close(); }
