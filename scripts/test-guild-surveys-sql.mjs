import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

globalThis.fetch = () => { throw Error("Real network forbidden in guild-survey SQL tests"); };
if (!process.env.PGLITE_MODULE_PATH) throw Error("PGLITE_MODULE_PATH must select an isolated PostgreSQL runtime.");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href);
const db = new PGlite();
const id = n => `51000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const org = id(100), other = id(101), leader = id(1), admin = id(2), member = id(10), secondary = id(11);
const file = async name => readFile(new URL(`${name}.sql`, import.meta.url), "utf8");
const one = async (sql, values = []) => (await db.query(sql, values)).rows[0];
let assertions = 0;
const check = (actual, expected, label) => { assert.deepEqual(actual, expected, label); assertions++; };
const fail = async (fn, pattern) => {
  await db.exec("savepoint expected_failure");
  try { await assert.rejects(fn, pattern); assertions++; }
  finally { await db.exec("rollback to savepoint expected_failure; release savepoint expected_failure"); }
};
const call = async (action, survey = null, payload = {}, expected = null, actor = admin) =>
  (await one("select guild_survey_request($1,$2,$3,$4,$5) as value", [actor, action, survey, expected, payload])).value;
const questions = [
  { id: "single", type: "single", required: true, label: "Projet", options: [{ id: "yes", label: "Oui" }, { id: "no", label: "Non" }] },
  { id: "multiple", type: "multiple", required: true, label: "Disponibilites", options: [{ id: "a", label: "Lundi" }, { id: "b", label: "Mardi" }] },
  { id: "text", type: "text", required: false, label: "Commentaire", options: [] },
];
const draft = { title: "Sondage generique", introduction: "Avis nominatifs", target_guild_ids: [id(202), id(208), id(210)], questions, deadline: null };
const answers = { single: "yes", multiple: ["a", "b"], text: "=DANGEROUS()" };
const publish = async survey => {
  const preview = await call("preview", survey);
  const payload = { confirmed: true, requestId: id(400), fingerprint: preview.fingerprint };
  return { preview, payload, result: await call("publish", survey, payload) };
};
const sandbox = async (name, fn) => {
  await db.exec("begin");
  try { await fn(); console.log("OK:", name); } finally { await db.exec("rollback"); }
};

try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table portal_organizations(id uuid primary key,organization_key text,is_active boolean default true);
    create table portal_guilds(id uuid primary key default gen_random_uuid(),organization_id uuid references portal_organizations(id),guild_code text,display_name text,is_active boolean default true,unique(organization_id,guild_code));
    create table guild_members(id uuid primary key,watcher_name text,role text,guild_code text,discord_id text,roster_status text default 'active',
      community_access_type text default 'guild',community_status text default 'active',primary_member_id uuid references guild_members(id));
    insert into portal_organizations values('${org}','paladin',true),('${other}','other',true);
    insert into portal_guilds(id,organization_id,guild_code,display_name) select '${id(200)}'::uuid+i,'${org}','G'||i,'Guild '||i from generate_series(1,10)i;
  `.replace("'" + id(200) + "'::uuid+i", "('51000000-0000-4000-8000-'||lpad((200+i)::text,12,'0'))::uuid"));
  await db.query("insert into portal_guilds(id,organization_id,guild_code,display_name) values($1,$2,'OTHER G1','Other')", [id(299), other]);
  for (const n of [1, 2, 10, 11, 12, 13, 14, 15, 16]) {
    await db.query("insert into guild_members(id,watcher_name,role,guild_code,discord_id,primary_member_id) values($1,$2,$3,$4,$5,$6)",
      [id(n), "Player " + n, n === 1 ? "leader" : [2, 15].includes(n) ? "admin" : "member", n === 15 ? "OTHER G1" : n === 12 ? "G8" : n === 13 ? "G9" : n === 14 ? "G10" : "G2",
        n === 16 ? "invalid" : String(200000000000000000n + BigInt(n === 11 ? 10 : n)), n === 11 ? member : null]);
  }
  for (const name of ["guild_dm_campaigns", "guild_dm_campaigns_test_mode", "guild_dm_campaigns_lifecycle", "intersaison_surveys",
    "intersaison_surveys_test_mode", "intersaison_survey_objectives", "intersaison_survey_choices", "intersaison_survey_accounts",
    "intersaison_survey_forecast_roles", "intersaison_survey_reminders"]) await db.exec((await file(name)).replace(/create extension if not exists pgcrypto;/gi, ""));
  await db.exec(`insert into guild_dm_campaigns(id,organization_id,message,target_guild_codes,status) values('${id(600)}','${org}','Legacy MP',array['G2'],'queued');
    insert into guild_dm_recipients(id,campaign_id,organization_id,member_id,guild_code,member_name_snapshot,discord_user_id)
      values('${id(601)}','${id(600)}','${org}','${member}','G2','Legacy member','200000000000000010');
    insert into intersaison_survey_seasons(id,organization_id,status) values('${id(610)}','${org}','survey1_open');
    insert into intersaison_survey_campaigns(id,season_id,organization_id,poll_number,status,title,message)
      values('${id(611)}','${id(610)}','${org}',1,'open','Legacy poll','Keep unchanged');
    insert into intersaison_survey_recipients(id,survey_campaign_id,organization_id,member_id,guild_code_snapshot,member_name_snapshot)
      values('${id(612)}','${id(611)}','${org}','${member}','G2','Legacy member');
    insert into intersaison_survey_responses(survey_campaign_id,survey_recipient_id,organization_id,member_id,poll_number,guild_code_snapshot,member_name_snapshot,objective_text)
      values('${id(611)}','${id(612)}','${org}','${member}',1,'G2','Legacy member','Permanent historical answer');`);
  const protectedTables = ["guild_members", "portal_guilds", "portal_organizations", "intersaison_survey_seasons", "intersaison_survey_campaigns", "intersaison_survey_recipients", "intersaison_survey_responses"];
  const snapshot = async () => Object.fromEntries(await Promise.all(protectedTables.map(async t => [t, (await db.query(`select to_jsonb(t) as value from ${t} t order by to_jsonb(t)::text`)).rows])));
  const before = await snapshot();
  await db.exec("begin read only");
  const preflight = (await one(await file("guild_surveys_preflight"))).guild_surveys_preflight;
  check(preflight.all_checks_ok, true);
  await db.exec("rollback");
  const migration = await file("guild_surveys");
  await db.exec(migration);
  check(await snapshot(), before, "Migration preserves members and Inter-saison");
  check((await one("select delivery_enabled from guild_survey_settings")).delivery_enabled, false);
  const readOnlyDraft = (await call("save", null, draft)).campaign;
  await db.exec("begin read only");
  const firstRead = await call("preview", readOnlyDraft.id);
  check((await call("preview", readOnlyDraft.id)).fingerprint, firstRead.fingerprint);
  check((await call("detail", readOnlyDraft.id)).campaign.status, "draft");
  check((await one("select count(*)::int n from guild_survey_waves")).n, 0);
  await db.exec("rollback");
  console.log("OK: preview and detail succeed inside a read-only PostgreSQL transaction");
  await sandbox("role hierarchy, dynamic G8/G9/G10, organization and private helpers", async () => {
    check((await call("list")).guilds.length, 10);
    await fail(() => call("list", null, {}, null, member), /Leader ou Admin/);
    await fail(() => call("save", null, { ...draft, target_guild_ids: [id(299)] }), /Guildes non autorisees/);
    const created = await call("save", null, draft, null, leader);
    await fail(() => call("close", created.campaign.id, { confirmed: true }), /Leader/);
    check((await call("list", null, {}, null, id(15))).guilds.length, 1);
    await fail(() => call("detail", created.campaign.id, {}, null, id(15)), /introuvable/);
    await fail(() => call("save", created.campaign.id, draft, 1, id(15)), /introuvable/);
    await db.exec("set role anon");
    await fail(() => db.query("select guild_survey_request($1,'list')", [admin]), /permission denied/);
    await db.exec("reset role; set role authenticated");
    await fail(() => db.query("select * from guild_survey_responses"), /permission denied/);
    await db.exec("reset role; set role service_role");
    await fail(() => db.query("select _guild_survey_actor($1)", [admin]), /permission denied/);
    await fail(() => db.query("update guild_surveys set status='open'"), /permission denied/);
    check((await call("list")).guilds.length, 10);
    await db.exec("reset role");
  });
  await sandbox("draft validation, no queue writes, read-only previews and worker gate", async () => {
    const c = (await call("save", null, draft)).campaign;
    check((await one("select count(*)::int n from guild_dm_campaigns")).n, 1);
    await fail(() => call("save", c.id, draft, 0), /brouillon a change/);
    await fail(() => call("save", null, { ...draft, questions: [{ ...questions[0], required: null }] }), /Question invalide/);
    await fail(() => call("save", null, { ...draft, questions: [questions[0], questions[0]] }), /duplique/);
    await fail(() => call("save", null, { ...draft, questions: [{ ...questions[0], id: 123 }] }), /Question invalide/);
    await fail(() => call("save", null, { ...draft, questions: [{ ...questions[0], label: 123 }] }), /Question invalide/);
    await fail(() => call("save", null, { ...draft, questions: [{ ...questions[0], options: [{ id: "a", label: false }, { id: "b", label: "B" }] }] }), /Proposition invalide/);
    const preview = await call("preview", c.id);
    check(preview.participants, 6); check(preview.accounts, 7); check(preview.eligible, 5); check(preview.excluded, 1);
    await fail(() => call("publish", c.id, { confirmed: true, requestId: id(400), fingerprint: preview.fingerprint }), /worker non activee/);
  });
  await sandbox("ambiguous guild namespaces and inactive memberships fail closed", async () => {
    await db.exec("update guild_survey_settings set delivery_enabled=true");
    const c = (await call("save", null, draft)).campaign; await publish(c.id);
    const dm = await one("select d.* from guild_survey_deliveries sd join guild_dm_recipients d on d.id=sd.dm_recipient_id where d.member_id=$1", [id(12)]);
    const authorize = () => one("select authorize_guild_survey_delivery($1,$2)", [dm.id, dm.discord_user_id]);
    const pendingDraft = (await call("save", null, draft)).campaign;
    await db.query("insert into portal_guilds(id,organization_id,guild_code,display_name) values($1,$2,'G8','Ambiguous')", [id(298), other]);
    check((await call("list")).guilds.some(g => g.guild_code === "G8"), false);
    await fail(() => call("preview", pendingDraft.id), /inactif ou ambigu/);
    await fail(() => call("reminder-preview", c.id), /inactif ou ambigu/);
    await fail(authorize, /non autorisee/);
    await db.query("delete from portal_guilds where id=$1", [id(298)]);
    await db.query("update guild_members set community_status='inactive' where id=$1", [id(12)]);
    check((await call("preview", pendingDraft.id)).participants, 6, "A guild member is not a disabled community account");
    check((await authorize()).authorize_guild_survey_delivery.authorized, true);
    await db.query("update guild_members set roster_status='inactive' where id=$1", [id(12)]);
    check((await call("preview", pendingDraft.id)).participants, 5);
    await fail(authorize, /non autorisee/);
    await db.query("update guild_members set roster_status='active' where id=$1", [id(12)]);
    await db.query("update portal_organizations set is_active=false where id=$1", [org]);
    await fail(authorize, /non autorisee/);
  });
  await sandbox("atomic launch, explicit confirmation, stale roster and double-click idempotence", async () => {
    await db.exec("update guild_survey_settings set delivery_enabled=true");
    const c = (await call("save", null, draft)).campaign;
    const preview = await call("preview", c.id);
    await fail(() => call("publish", c.id, { requestId: id(400), fingerprint: preview.fingerprint }), /Confirmation/);
    await fail(() => call("publish", c.id, { confirmed: true, requestId: id(400), fingerprint: "stale" }), /destinataires ont change/);
    await db.query("update guild_members set watcher_name='Renamed' where id=$1", [member]);
    await fail(() => call("publish", c.id, { confirmed: true, requestId: id(400), fingerprint: preview.fingerprint }), /destinataires ont change/);
    const published = await publish(c.id);
    check(published.result.queued, 5);
    check((await call("publish", c.id, published.payload)).idempotent, true);
    check((await one("select count(*)::int n from guild_survey_waves")).n, 1);
    check((await one("select count(*)::int n from guild_survey_deliveries")).n, 5);
    await fail(() => call("publish", c.id, { ...published.payload, requestId: id(401) }), /Etat/);
    await fail(() => call("save", c.id, draft, 2), /figees/);
  });
  await sandbox("stable identity, linked accounts, no leaked answers and answer revisions", async () => {
    await db.exec("update guild_survey_settings set delivery_enabled=true");
    const c = (await call("save", null, draft)).campaign; await publish(c.id);
    const form = await call("answer-form", c.id, {}, null, member);
    check(form.campaign.questions.length, 3);
    await fail(() => call("answer-form", c.id, {}, null, id(15)), /destinataires/);
    await fail(() => call("answer", c.id, { answers: { single: "unknown", multiple: ["a"] } }, 0, member), /Choix unique/);
    await fail(() => call("answer", c.id, { answers: { single: "yes", multiple: ["a", "a"] } }, 0, member), /dupliques/);
    await fail(() => call("answer", c.id, { answers: { ...answers, injected: "yes" } }, 0, member), /Reponses invalides/);
    await fail(() => call("answer", c.id, { answers: { single: "yes" } }, 0, member), /obligatoire/);
    check((await call("answer", c.id, { answers }, 0, member)).version, 1);
    check((await call("answer-form", c.id, {}, null, secondary)).response.version, 1);
    await fail(() => call("answer", c.id, { answers }, 0, secondary), /reponse a change/);
    check((await call("answer", c.id, { answers: { ...answers, text: "Changed" } }, 1, secondary)).version, 2);
    await db.query("update guild_members set guild_code='G9' where id=$1", [member]);
    check((await call("answer-form", c.id, {}, null, member)).recipient.guild, "G2");
    check((await call("mine", null, {}, null, member)).surveys.length, 1);
    check((await call("mine", null, {}, null, id(15))).surveys.length, 0);
    const detail = await call("detail", c.id);
    check(detail.recipients.filter(r => r.response).length, 1);
    check(detail.recipients.find(r => r.member_key === member).delivery_status, "cancelled");
  });
  await sandbox("worker pre-send guards, delivery history, cooldown and successive reminder waves", async () => {
    await db.exec("update guild_survey_settings set delivery_enabled=true");
    const c = (await call("save", null, draft)).campaign; await publish(c.id);
    const deliveries = (await db.query("select sd.dm_recipient_id,d.discord_user_id,d.member_id from guild_survey_deliveries sd join guild_dm_recipients d on d.id=sd.dm_recipient_id")).rows;
    const authorize = d => one("select authorize_guild_survey_delivery($1,$2) as result", [d.dm_recipient_id, d.discord_user_id]);
    check((await authorize(deliveries[0])).result.authorized, true);
    await db.exec("update guild_survey_waves set created_at=now()-interval '2 hours'");
    const pending = await call("reminder-preview", c.id); check(pending.eligible, 0);
    await db.exec("update guild_dm_recipients set status='sent',sent_at=now(),last_sent_at=now(),discord_message_id='saved-first-message' where id in(select dm_recipient_id from guild_survey_deliveries)");
    const dm = deliveries.find(d => d.member_id === member);
    await call("answer", c.id, { answers }, 0, member);
    await fail(() => authorize(dm), /non autorisee/);
    const preview = await call("reminder-preview", c.id);
    check(preview.eligible, 4); check(preview.exclusions.responded, 1);
    await call("answer", c.id, { answers }, 0, id(12));
    await fail(() => call("remind", c.id, { confirmed: true, requestId: id(401), fingerprint: preview.fingerprint }), /destinataires ont change/);
    const fresh = await call("reminder-preview", c.id);
    const payload = { confirmed: true, requestId: id(401), fingerprint: fresh.fingerprint };
    check((await call("remind", c.id, payload)).queued, 3);
    check((await call("remind", c.id, payload)).idempotent, true);
    check((await call("reminder-preview", c.id)).eligible, 0);
    check((await one("select count(*)::int n from guild_dm_recipients where discord_message_id='saved-first-message'")).n, 5);
    check((await one("select count(*)::int n from guild_survey_waves")).n, 2);
    check((await one("select count(*)::int n from guild_survey_delivery_events")).n > 0, true);
    await fail(() => db.query("update guild_dm_recipients set status='queued' where id=$1", [dm.dm_recipient_id]), /previsualisation/);
    await fail(() => db.query("delete from guild_dm_recipients where id=$1", [dm.dm_recipient_id]), /Historique/);
  });
  await sandbox("ambiguous Discord IDs, permanent errors, closed/deadline campaigns and classic non-regression", async () => {
    await db.exec("update guild_survey_settings set delivery_enabled=true");
    await db.query("update guild_members set discord_id='200000000000000010' where id=$1", [id(12)]);
    const c = (await call("save", null, draft)).campaign;
    const preview = await call("preview", c.id); check(preview.exclusions.ambiguous_identity, 2);
    await publish(c.id);
    await db.exec("update guild_survey_waves set created_at=now()-interval '2 hours'");
    await db.exec("update guild_dm_recipients set status='failed',last_error='HTTP 403 code 50007' where id in(select dm_recipient_id from guild_survey_deliveries)");
    check((await call("reminder-preview", c.id)).eligible, 0);
    await call("close", c.id, { confirmed: true });
    await fail(() => call("answer", c.id, { answers }, 0, member), /cloture/);
    await fail(() => call("reminder-preview", c.id), /Etat/);
    check((await db.query("delete from guild_dm_recipients where id=$1 returning id", [id(601)])).rows.length, 1, "Classic recipient deletion unchanged");
    check((await db.query("delete from guild_dm_campaigns where id=$1 returning id", [id(600)])).rows.length, 1, "Classic campaign deletion unchanged");
  });
  await sandbox("late identity changes, deadline enforcement and bounded HTTP 429 recovery", async () => {
    await db.exec("update guild_survey_settings set delivery_enabled=true");
    const c = (await call("save", null, draft)).campaign; await publish(c.id);
    const dm = await one("select d.* from guild_survey_deliveries sd join guild_dm_recipients d on d.id=sd.dm_recipient_id where d.member_id=$1", [member]);
    await db.query("update guild_members set discord_id='999999999999999999' where id=$1", [member]);
    await fail(() => one("select authorize_guild_survey_delivery($1,$2)", [dm.id, dm.discord_user_id]), /non autorisee/);
    await db.query("update guild_members set discord_id=$2 where id=$1", [member, dm.discord_user_id]);
    await fail(() => db.query("update guild_dm_recipients set status='sending' where id=$1", [dm.id]), /Worker de sondage non autorise/);
    await one("select authorize_guild_survey_delivery($1,$2)", [dm.id, dm.discord_user_id]);
    await db.query("update guild_dm_recipients set status='sending',send_attempts=5 where id=$1", [dm.id]);
    await db.query("update guild_dm_recipients set status='queued',last_error='HTTP 429' where id=$1", [dm.id]);
    check((await one("select status from guild_dm_recipients where id=$1", [dm.id])).status, "failed");
    await db.exec("update guild_survey_waves set created_at=now()-interval '2 hours'");
    check((await call("reminder-preview", c.id)).eligible, 1, "Only controlled HTTP 429 failure can be retried");
    const preview = await call("reminder-preview", c.id);
    check((await call("remind", c.id, { confirmed: true, requestId: id(401), fingerprint: preview.fingerprint })).queued, 1);
    await db.query("update guild_surveys set deadline=now()-interval '1 second' where id=$1", [c.id]);
    check((await call("answer-form", c.id, {}, null, member)).campaign.status, "closed");
    await fail(() => call("answer", c.id, { answers }, 0, member), /cloture/);
    await fail(() => one("select authorize_guild_survey_delivery($1,$2)", [dm.id, dm.discord_user_id]), /non autorisee/);
  });
  check(await snapshot(), before, "All business data restored; Inter-saison unchanged");
  await db.exec(migration); check(await snapshot(), before, "Idempotent installation preserves data");
  await db.exec("begin read only");
  const verify = (await one(await file("guild_surveys_verify"))).guild_surveys_verify;
  check(verify.all_checks_ok, true); check(verify.delivery_enabled, false);
  await db.exec("rollback");
  const queueBeforeEnable = (await one("select count(*)::int n from guild_dm_campaigns")).n;
  await db.exec(await file("guild_surveys_enable_delivery"));
  check((await one("select delivery_enabled from guild_survey_settings")).delivery_enabled, true);
  check((await one("select count(*)::int n from guild_dm_campaigns")).n, queueBeforeEnable, "Activation never enqueues or publishes");
  await db.exec(migration);
  check((await one("select delivery_enabled from guild_survey_settings")).delivery_enabled, true, "Repeated installation preserves the operator setting");
  check(await snapshot(), before);
  console.log(`All guild-survey SQL tests passed: ${assertions} assertions (isolated PostgreSQL, no network).`);
} catch (error) {
  console.error(JSON.stringify({ error: error.message, code: error.code, detail: error.detail, where: error.where }, null, 2));
  process.exitCode = 1;
} finally { await db.close(); }
