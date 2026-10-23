import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

globalThis.fetch = () => { throw Error("Network and real Discord sends forbidden in SQL tests"); };
if (!process.env.PGLITE_MODULE_PATH) throw Error("Set PGLITE_MODULE_PATH to an isolated PostgreSQL runtime.");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href);
let db = new PGlite();
const id = n => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const org = id(100), other = id(101), season = id(200), admin = id(1);
const query = async (sql, args = []) => (await db.query(sql, args)).rows;
const one = async (sql, args = []) => (await query(sql, args))[0];
const rpc = async (name, args) => (await one(`select public.${name}(${Object.keys(args).map((k, i) => `${k}=>$${i + 1}`).join(",")}) as result`, Object.values(args))).result;
const sqlFile = name => readFile(new URL(`${name}.sql`, import.meta.url), "utf8");
let inTransaction = false;
const sandbox = async fn => {
  await db.exec("begin"); inTransaction = true;
  try { await fn(); } finally { await db.exec("rollback"); inTransaction = false; }
};
const rejects = async (fn, pattern) => {
  if (inTransaction) await db.exec("savepoint expected_failure");
  try { await assert.rejects(fn, pattern); } finally {
    if (inTransaction) await db.exec("rollback to savepoint expected_failure; release savepoint expected_failure");
  }
};
const cleanChecks = rows => assert.deepEqual(rows.filter(r => r.status === "ERROR"), []);

try {
  const fixtureSchema = `create role anon; create role authenticated; create role service_role bypassrls;
    create table portal_organizations(id uuid primary key,organization_key text,is_active boolean default true);
    create table portal_guilds(id uuid primary key default gen_random_uuid(),organization_id uuid references portal_organizations(id),
      guild_code text,is_active boolean default true,unique(organization_id,guild_code));
    create table guild_members(id uuid primary key,watcher_name text,role text,guild_code text,discord_id text,
      roster_status text default 'active',community_access_type text default 'guild',primary_member_id uuid references guild_members(id));
    insert into portal_organizations values('${org}','paladin',true),('${other}','mad',true);
    insert into portal_guilds(organization_id,guild_code) select '${org}','G'||i from generate_series(1,7)i;
    insert into portal_guilds(organization_id,guild_code) values('${other}','MAD G1');
    grant select on portal_guilds,guild_members to service_role;`;
  const installPrerequisites = async () => {
    await db.exec(fixtureSchema);
    for (const name of ["guild_dm_campaigns", "guild_dm_campaigns_test_mode", "guild_dm_campaigns_lifecycle",
      "intersaison_surveys", "intersaison_surveys_test_mode", "intersaison_survey_objectives", "intersaison_survey_choices", "intersaison_survey_accounts",
      "intersaison_survey_forecast_roles"])
      await db.exec((await sqlFile(name)).replace(/create extension if not exists pgcrypto;/gi, ""));
  };
  await installPrerequisites();
  const preflight = await sqlFile("intersaison_survey_reminders_preflight");
  const migration = await sqlFile("intersaison_survey_reminders");
  const verify = await sqlFile("intersaison_survey_reminders_verify");
  // Both diagnostics must work without any live campaign, admin or member.
  await db.exec("begin read only"); cleanChecks(await query(preflight)); await db.exec("rollback");
  console.log("OK: empty-database preflight");

  for (const n of [1, 2, 10, 11, ...Array.from({ length: 31 }, (_, i) => i + 20)]) {
    await db.query("insert into guild_members(id,watcher_name,role,guild_code,discord_id,primary_member_id) values($1,$2,$3,$4,$5,$6)",
      [id(n), `Account ${n}`, n <= 2 ? "admin" : "member", `G${n % 7 + 1}`,
        String(200000000000000000n + BigInt(n === 11 ? 10 : n)), n === 11 ? id(10) : null]);
  }
  await db.exec(`insert into intersaison_survey_seasons(id,organization_id,status) values('${season}','${org}','survey1_closed');
    insert into guild_dm_campaigns(id,organization_id,message,target_guild_codes,status)
      values('${id(300)}','${org}','Poll1',array['G1'],'completed');
    insert into intersaison_survey_campaigns(id,season_id,organization_id,poll_number,guild_dm_campaign_id,status,title,message)
      values('${id(301)}','${season}','${org}',1,'${id(300)}','closed','Poll1','Existing poll1');
    insert into guild_dm_recipients(id,campaign_id,organization_id,member_id,guild_code,member_name_snapshot,discord_user_id,status,last_error)
      values('${id(303)}','${id(300)}','${org}','${id(2)}','G3','Poll1 pending','200000000000000002','failed','old failure');
    insert into intersaison_survey_recipients(id,survey_campaign_id,organization_id,member_id,guild_code_snapshot,member_name_snapshot)
      values('${id(302)}','${id(301)}','${org}','${admin}','G2','Admin');
    insert into intersaison_survey_recipients(id,survey_campaign_id,organization_id,member_id,guild_code_snapshot,member_name_snapshot,guild_dm_recipient_id)
      values('${id(304)}','${id(301)}','${org}','${id(2)}','G3','Poll1 pending','${id(303)}');
    insert into intersaison_survey_responses(survey_campaign_id,survey_recipient_id,organization_id,member_id,poll_number,guild_code_snapshot,member_name_snapshot,objective_text)
      values('${id(301)}','${id(302)}','${org}','${admin}',1,'G2','Admin','Keep poll1 answer');`);
  const context = { p_org: org, p_actor: admin };
  const goals = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`G${i + 1}`, `Objective ${i + 1}`]));
  const version = await rpc("save_intersaison_survey_objectives_draft", { p_organization_id: org, p_season_id: season,
    p_actor_member_id: admin, p_objectives: JSON.stringify(goals), p_expected_version: 0 });
  await rpc("validate_intersaison_survey_objectives_draft", { p_organization_id: org, p_season_id: season, p_actor_member_id: admin, p_version_id: version });
  const launchPreview = await rpc("preview_intersaison_survey_two", { ...context, p_season: season });
  const launch = await rpc("launch_intersaison_survey_two", { ...context, p_season: season, p_version: version,
    p_fingerprint: launchPreview.rosterFingerprint, p_is_test: false });
  const campaign = launch.campaignId;
  const dc = (await one("select guild_dm_campaign_id as id from intersaison_survey_campaigns where id=$1", [campaign])).id;
  const recipient = n => one("select * from intersaison_survey_recipients where survey_campaign_id=$1 and member_id=$2", [campaign, id(n)]);
  const dm = async n => one("select * from guild_dm_recipients where id=$1", [(await recipient(n)).guild_dm_recipient_id]);
  const setS = async (n, fragment) => db.query(`update intersaison_survey_recipients set ${fragment} where id=$1`, [(await recipient(n)).id]);
  const setD = async (n, fragment) => db.query(`update guild_dm_recipients set ${fragment} where id=$1`, [(await dm(n)).id]);
  const preview = () => rpc("preview_intersaison_survey_two_reminders", { ...context, p_campaign: campaign });
  const queue = (fp, request, extra = {}) => rpc("queue_intersaison_survey_two_reminders", { ...context, p_campaign: campaign,
    p_fingerprint: fp, p_request: request, p_confirmed: true, ...extra });
  const attemptsFor = (dmRecipient, reminder) => rpc("intersaison_choice_delivery_attempts", { p_dm_recipient: dmRecipient, p_reminder: reminder });
  const answer = async (n, interaction = 900, first = "G1") => rpc("submit_intersaison_survey_choice", {
    p_dm_recipient_id: (await dm(n)).id, p_discord_user_id: (await dm(n)).discord_user_id,
    p_interaction_id: String(800000000000000000n + BigInt(interaction)), p_first_choice: first, p_second_choice: "G7", p_comment: "Keep full choice comment" });
  await db.query(`update guild_dm_recipients set status='sent',sent_at='2026-01-01T00:00:00Z',last_sent_at='2026-01-01T00:00:00Z',
    discord_message_id='700000000000000001',send_attempts=4 where campaign_id=$1`, [dc]);
  await db.query("update guild_dm_campaigns set status='completed',sent_at='2026-01-01T00:00:00Z' where id=$1", [dc]);
  await setS(20, "responded_at=now()"); await setS(21, "response_status='responded'");
  await answer(22);
  // Current response alone suffices, even if both marker columns are stale.
  await setS(22, "responded_at=null,response_status='none',delivery_status='queued'");
  for (const [n, status] of [[23, "excluded_duplicate"], [24, "missing_invalid"], [25, "not_included"], [26, "cancelled"]])
    await setS(n, `delivery_status='${status}'`);
  await setD(27, "status='cancelled'"); await setD(28, "status='queued'"); await setD(29, "status='sending'");
  await setD(30, "status='failed'"); await setS(31, "delivery_status='failed'");
  await setD(32, "last_error='DELIVERY_UNCERTAIN'"); await setS(33, "last_error='permanent Discord failure'");
  await db.query("update guild_members set roster_status='inactive' where id=$1", [id(34)]);
  await db.query("update guild_members set guild_code='MAD G1' where id=$1", [id(35)]);
  await setS(36, "discord_user_id='999999999999999999'"); await setS(37, `member_key='${id(10)}'`);
  await setD(38, "discord_message_id=null"); await setD(39, "sent_at=null");
  await setD(40, "status='confirmed',confirmed_at=now()");
  await setS(42, "last_error='HTTP 403'"); await setS(43, "delivery_status='failed'"); await setD(43, "status='queued'");
  await setS(44, "delivery_status='excluded_duplicate'"); await setD(44, "status='queued'");
  await setS(45, "guild_dm_recipient_id=null");
  await setS(46, "member_id=null");
  await setS(47, "discord_user_id=' 200000000000000047 '");
  await db.query("update guild_members set discord_id='invalid' where id=$1", [id(48)]);
  await setD(49, "member_id=null"); await setS(50, "delivery_status='confirmed'");
  await rpc("save_intersaison_survey_forecast_entry", { ...context, p_season: season, p_member: id(10), p_guild: "G2", p_role: "officer",
    p_expected_placement_revision: 0, p_expected_role_revision: 0 });

  const dataTables = ["guild_members", "portal_guilds", "guild_dm_campaigns", "guild_dm_recipients", "intersaison_survey_seasons",
    "intersaison_survey_campaigns", "intersaison_survey_recipients", "intersaison_survey_responses", "intersaison_survey_placements", "intersaison_survey_forecast_roles",
    "intersaison_survey_objective_versions", "intersaison_survey_objective_items", "intersaison_survey_guild_objectives"];
  const snapshot = async (tables = dataTables) => {
    const result = {};
    for (const table of tables) result[table] = await query(`select to_jsonb(t) as row from public.${table} t order by to_jsonb(t)::text`);
    return result;
  };
  const allTables = [...dataTables, "intersaison_survey_reminder_batches", "intersaison_survey_delivery_events"];
  const beforeMigration = await snapshot();
  assert.equal(beforeMigration.intersaison_survey_placements.length, 1, "nonempty placement preservation witness");
  assert.equal(beforeMigration.intersaison_survey_forecast_roles.length, 1, "nonempty forecast role preservation witness");
  await db.exec(migration);
  assert.deepEqual(await snapshot(), beforeMigration, "installation never backfills or updates a live row");
  const beforeReinstall = await snapshot(allTables); await db.exec(migration);
  assert.deepEqual(await snapshot(allTables), beforeReinstall, "reinstallation never backfills or updates a live row");
  cleanChecks(await query(verify));
  const queueBody = (await one("select prosrc from pg_proc where oid='public.queue_intersaison_survey_two_reminders(uuid,uuid,uuid,text,uuid,boolean)'::regprocedure")).prosrc;
  assert.equal((queueBody.match(/for\s+share\s+nowait/gi) || []).length, 3, "all member/guild/org share locks are NOWAIT");
  assert.doesNotMatch(queueBody, /for\s+share\s*;/i, "no blocking reference-row SHARE lock remains");
  for (const table of ["guild_members", "portal_guilds", "portal_organizations"])
    assert.match(queueBody, new RegExp(`perform 1 from public\\.${table}\\b[\\s\\S]*?for share nowait;`, "i"));
  assert.match(queueBody, /exception when lock_not_available then\s+raise exception '[^']*actualiser la previsualisation[^']*' using errcode='55P03';/i);
  assert.ok(queueBody.indexOf("errcode='55P03'") < queueBody.search(/\bupdate\s+public\./i), "lock conflict is raised before the first write");
  console.log("OK: NOWAIT structure and explicit 55P03 refresh error before writes (not a multi-session stress test)");
  const states = await query("select recipient_id,category from intersaison_survey_two_reminder_state($1,$2)", [org, campaign]);
  const expected = { responded: [20, 21, 22], excluded: [23, 24, 25, 26, 27, 44], pending: [28, 29, 43],
    failed: [30, 31, 32, 33, 42], inactive: [34, 35], invalid: [36, 37, 38, 39, 40, 45, 46, 47, 48, 49, 50], eligible: [1, 2, 10, 11, 41] };
  for (const [category, members] of Object.entries(expected)) for (const n of members)
    assert.equal(states.find(s => s.recipient_id === beforeMigration.intersaison_survey_recipients.find(r => r.row.member_id === id(n) && r.row.survey_campaign_id === campaign)?.row.id)?.category
      ?? (n === 46 ? states.find(s => s.recipient_id === beforeMigration.intersaison_survey_recipients.find(r => r.row.member_key === id(46))?.row.id)?.category : undefined), category, `classification of ${n}`);
  const initial = await preview();
  assert.equal(initial.canQueue, false, "one button cannot start an overlapping wave");
  for (const [category, members] of Object.entries(expected)) assert.equal(initial.counts[category], members.length);
  assert.equal(initial.counts.nonRespondents, initial.counts.total - initial.counts.responded);
  assert.deepEqual(initial.scopeGuilds, ["G1", "G2", "G3", "G4", "G5", "G6", "G7"]);
  assert.match(initial.fingerprint, /^[a-f0-9]{32}$/);
  await rejects(() => queue(initial.fingerprint, id(600)), /Relance impossible/);
  for (const n of [28, 29, 43, 44]) await setD(n, "status='sent'");
  const ready = await preview(); assert.equal(ready.canQueue, true);
  console.log("OK: real SQL classification, account scope, exclusions and no overlapping waves");

  await sandbox(async () => {
    const before = await preview();
    await db.exec("set local timezone='Pacific/Honolulu'");
    assert.equal((await preview()).fingerprint, before.fingerprint, "deterministic across session timezones");
    await db.query(`update guild_dm_recipients set updated_at=now(),last_attempt_at=now(),last_sent_at=now() where id in
      (select dm_recipient_id from intersaison_survey_two_reminder_state($1,$2) where category='eligible')`, [org, campaign]);
    await db.query("update intersaison_survey_recipients set updated_at=now(),last_reminder_at=now() where survey_campaign_id=$1", [campaign]);
    assert.equal((await preview()).fingerprint, before.fingerprint, "volatile timestamps do not change consent");
    await db.query("update intersaison_survey_campaigns set target_guild_codes=array['G1'] where id=$1", [campaign]);
    assert.deepEqual((await preview()).counts, before.counts, "global scope ignores guild filters");
  });
  for (const mutate of [
    () => answer(10, 901),
    () => db.query("update guild_members set primary_member_id=$1 where id=$2", [id(2), id(11)]),
    () => setD(10, "reminder_count=reminder_count+1"),
    () => db.query("update intersaison_survey_responses set comment_text='Same response count, changed content' where survey_campaign_id=$1 and poll_number=2", [campaign]),
  ]) await sandbox(async () => {
    const before = await preview(); await mutate();
    assert.notEqual((await preview()).fingerprint, before.fingerprint);
    const afterChange = await snapshot(allTables);
    await rejects(() => queue(before.fingerprint, id(601)), /actualiser la previsualisation/);
    assert.deepEqual(await snapshot(allTables), afterChange, "stale confirmation performs no write");
  });
  for (const mutate of [
    () => db.query("update intersaison_survey_campaigns set status='closed' where id=$1", [campaign]),
    () => db.query("update intersaison_survey_seasons set status='finished' where id=$1", [season]),
    () => db.query("update guild_dm_campaigns set is_test=true where id=$1", [dc]),
    () => db.query("update guild_dm_campaigns set interaction_type='ack' where id=$1", [dc]),
  ]) await sandbox(async () => { await mutate(); assert.equal((await preview()).canQueue, false); });
  await rejects(() => queue(ready.fingerprint, id(602), { p_confirmed: false }), /Confirmation/);
  await rejects(() => rpc("preview_intersaison_survey_two_reminders", { ...context, p_org: other, p_campaign: campaign }), /organisation|autorise/);
  await rejects(() => rpc("preview_intersaison_survey_two_reminders", { ...context, p_actor: id(10), p_campaign: campaign }), /autorise/);
  console.log("OK: stale answers/content/identity/sequence rejected without writes; authorization and lifecycle");

  const protectedTables = ["guild_members", "intersaison_survey_responses", "intersaison_survey_placements", "intersaison_survey_forecast_roles", "intersaison_survey_objective_items",
    "intersaison_survey_objective_versions", "intersaison_survey_guild_objectives"];
  const protectedBefore = await snapshot(protectedTables);
  const beforeQueue = await snapshot();
  const eligible = await query("select recipient_id,dm_recipient_id from intersaison_survey_two_reminder_state($1,$2) where category='eligible'", [org, campaign]);
  const countsBefore = await one("select (select count(*) from guild_dm_campaigns)::int as campaigns,(select count(*) from guild_dm_recipients)::int as dm,(select count(*) from intersaison_survey_recipients)::int as survey");
  const request = id(610);
  await db.exec("set role service_role");
  const queued = await queue((await preview()).fingerprint, request);
  assert.deepEqual(queued, { queuedCount: eligible.length, batchId: request, alreadyQueued: false });
  await db.exec("reset role");
  for (const row of beforeQueue.guild_dm_recipients) {
    const after = await one("select to_jsonb(d) as row from guild_dm_recipients d where id=$1", [row.row.id]);
    if (!eligible.some(e => e.dm_recipient_id === row.row.id)) assert.deepEqual(after.row, row.row, "excluded/failed/other recipients unchanged");
    else assert.deepEqual(after.row, { ...row.row, status: "queued", reminder_count: row.row.reminder_count + 1 }, "only status/sequence change on D");
  }
  for (const e of eligible) {
    const s = await one("select * from intersaison_survey_recipients where id=$1", [e.recipient_id]);
    const old = beforeQueue.intersaison_survey_recipients.find(r => r.row.id === e.recipient_id).row;
    assert.equal(s.reminder_count, old.reminder_count + 1); assert.equal(s.delivery_status, "queued"); assert.ok(s.last_reminder_at);
    for (const key of ["id", "guild_dm_recipient_id", "member_id", "member_key", "member_name_snapshot", "guild_code_snapshot", "discord_user_id", "last_error"])
      assert.equal(s[key], old[key]);
  }
  assert.equal((await dm(10)).reminder_count, 1); assert.equal((await dm(11)).reminder_count, 1);
  const events = await query("select * from intersaison_survey_delivery_events where new_snapshot->>'status'='queued'");
  assert.equal(events.length, eligible.length);
  assert.ok(events.every(e => e.old_snapshot.status === "sent" && e.old_snapshot.discord_message_id && e.old_snapshot.sent_at && e.reminder_count === 1));
  assert.ok(events.every(e => !JSON.stringify(e).includes("Keep full choice comment")));
  await rpc("refresh_intersaison_choice_delivery_counters", { p_campaign: dc });
  assert.equal((await one("select status from guild_dm_campaigns where id=$1", [dc])).status, "queued", "counter refresh does not overwrite a new queue with completed");
  const beforeReplay = await snapshot(allTables);
  assert.deepEqual(await queue("changed-preview-fingerprint", request, { p_confirmed: false }), { ...queued, alreadyQueued: true });
  assert.deepEqual(await snapshot(allTables), beforeReplay);
  await rejects(() => queue("anything", request, { p_actor: id(2) }), /autre organisation, campagne ou acteur/);
  await rejects(() => queue("anything", request, { p_campaign: id(301) }), /autre organisation, campagne ou acteur/);
  console.log("OK: selective queue, durable request idempotence and initial-delivery history");

  await sandbox(async () => {
    await setD(10, "status='sending',send_attempts=send_attempts+1");
    await answer(10, 902);
    const confirmed = await dm(10), savedAnswers = await query("select * from intersaison_survey_responses order by id");
    await setD(10, "status='sent',confirmed_at=null,discord_message_id='700000000000000099',last_sent_at=now()");
    const after = await dm(10);
    assert.equal(after.status, "confirmed"); assert.deepEqual(after.confirmed_at, confirmed.confirmed_at);
    assert.equal(after.discord_message_id, confirmed.discord_message_id);
    assert.deepEqual(await query("select * from intersaison_survey_responses order by id"), savedAnswers);
    const afterAnswer = await snapshot(allTables);
    assert.deepEqual(await queue((await preview()).fingerprint, request), { ...queued, alreadyQueued: true });
    assert.deepEqual(await snapshot(allTables), afterAnswer, "replay after an answer is harmless");
  });
  for (const marker of ["responded_at=now()", "response_status='responded'"]) await sandbox(async () => {
    await setS(10, marker); await setD(10, "status='failed',last_error='worker late failure'");
    assert.equal((await dm(10)).status, "confirmed"); assert.ok((await dm(10)).confirmed_at);
  });
  await sandbox(async () => {
    await answer(10, 903); await setS(10, "responded_at=null,response_status='none'");
    await setD(10, "status='sent',confirmed_at=null"); assert.equal((await dm(10)).status, "confirmed");
  });
  await sandbox(async () => {
    await setD(27, "status='cancelled',last_error='Cancellation retained'");
    assert.equal((await dm(27)).status, "cancelled", "non-response cancellation is not rewritten as confirmed");
    const cancelled = await dm(27);
    // Mirror the worker's terminal metadata-only payload, without writing status.
    const metadata = { sent_at: cancelled.sent_at, last_sent_at: "2026-10-23T12:00:00Z",
      discord_message_id: "700000000000000088", last_error: null, updated_at: "2026-10-23T12:00:00Z" };
    await db.query(`update guild_dm_recipients set sent_at=$2,last_sent_at=$3,discord_message_id=$4,last_error=$5,updated_at=$6 where id=$1`,
      [cancelled.id, ...Object.values(metadata)]);
    const afterMetadata = await dm(27);
    assert.equal(afterMetadata.status, "cancelled"); assert.equal(afterMetadata.confirmed_at, null);
    assert.equal(afterMetadata.discord_message_id, cancelled.discord_message_id);
    const metadataEvent = await one("select * from intersaison_survey_delivery_events where dm_recipient_id=$1 and new_snapshot->>'discord_message_id'=$2", [cancelled.id, metadata.discord_message_id]);
    assert.ok(metadataEvent); assert.equal(metadataEvent.new_snapshot.status, "cancelled");
    assert.equal(metadataEvent.old_snapshot.discord_message_id, cancelled.discord_message_id);
    await setD(10, "status='sending'"); await answer(10, 904);
    const answers = await query("select * from intersaison_survey_responses order by id");
    await setD(10, "status='cancelled',confirmed_at=null");
    assert.equal((await dm(10)).status, "confirmed", "a cancellation cannot undo an actual response");
    assert.deepEqual(await query("select * from intersaison_survey_responses order by id"), answers);
  });
  await sandbox(async () => {
    await db.query("update guild_members set guild_code='MAD G1' where id=$1", [id(10)]);
    await rejects(() => setD(10, "status='sending'"), /outside campaign organization/);
    await setD(10, "status='failed',last_error='Account left organization'");
    assert.equal((await dm(10)).status, "failed");
    await setD(10, "status='cancelled'"); await setD(10, "status='confirmed'");
    await rejects(() => setD(10, `account_member_key='${id(2)}'`), /immutable/);
    await rejects(() => setD(10, `organization_id='${other}'`), /organization mismatch/);
    await rejects(() => setD(10, "discord_user_id='999999999999999999'"), /outside campaign organization/);
  });
  // Deliver wave 1. The latest real IDs live in events, initial IDs stay on D.
  for (const e of eligible) {
    await db.query("update guild_dm_recipients set status='sending',send_attempts=send_attempts+1,last_attempt_at=now() where id=$1", [e.dm_recipient_id]);
    await db.query("update guild_dm_recipients set status='sent',last_sent_at=now(),discord_message_id='700000000000000002' where id=$1", [e.dm_recipient_id]);
    assert.equal((await one("select discord_message_id from guild_dm_recipients where id=$1", [e.dm_recipient_id])).discord_message_id, "700000000000000001");
    assert.equal(await attemptsFor(e.dm_recipient_id, 1), 1, "wave 1 contains one durable sending claim");
    assert.equal((await one("select send_attempts from guild_dm_recipients where id=$1", [e.dm_recipient_id])).send_attempts, 5, "cumulative history reaches five without consuming the next wave's budget");
  }
  assert.equal((await one("select count(*)::int as n from intersaison_survey_delivery_events where new_snapshot->>'discord_message_id'='700000000000000002'")).n, eligible.length);
  const sequenceEvents = await query("select old_snapshot,new_snapshot from intersaison_survey_delivery_events where dm_recipient_id=$1", [(await dm(10)).id]);
  assert.ok(sequenceEvents.some(e => e.old_snapshot.status === "sent" && e.new_snapshot.status === "queued"));
  assert.ok(sequenceEvents.some(e => e.old_snapshot.status === "queued" && e.new_snapshot.status === "sending"));
  assert.ok(sequenceEvents.some(e => e.old_snapshot.status === "sending" && e.new_snapshot.status === "sent"));
  await rpc("refresh_intersaison_choice_delivery_counters", { p_campaign: dc });
  const counter = await one("select * from guild_dm_campaigns where id=$1", [dc]);
  assert.equal(counter.status, "partial"); assert.equal(counter.failed_count, 1); assert.equal(counter.confirmed_count, 2);
  assert.equal(new Date(counter.sent_at).toISOString(), "2026-01-01T00:00:00.000Z");
  const second = await preview(); assert.equal(second.canQueue, true);
  const secondWave = await queue(second.fingerprint, id(611)); assert.equal(secondWave.queuedCount, eligible.length);
  assert.equal((await dm(10)).reminder_count, 2); assert.equal((await dm(11)).reminder_count, 2);
  const mainDm = (await dm(10)).id, secondaryDm = (await dm(11)).id;
  assert.equal(await attemptsFor(mainDm, 2), 0, "a new wave starts with zero ledger claims, not five historical attempts");
  await sandbox(async () => {
    await setD(10, "status='sending'");
    assert.equal(await attemptsFor(mainDm, 2), 0, "a transition without an attempt increment does not consume budget");
    await setD(10, "status='queued'");
    for (let claim = 1; claim <= 5; claim++) {
      await setD(10, "status='sending',send_attempts=send_attempts+1");
      const count = await attemptsFor(mainDm, 2);
      assert.equal(count, claim); assert.equal(count < 5, claim < 5, "429 retries stop at five claims for this wave");
      assert.equal((await dm(10)).send_attempts, 5 + claim, "send_attempts remains cumulative");
      assert.equal(await attemptsFor(secondaryDm, 2), 0, "a secondary sharing the Discord ID has its own budget");
      if (claim < 5) await setD(10, "status='queued',last_error='HTTP 429'");
    }
    const afterClaims = await snapshot(allTables);
    await db.exec("set local role service_role"); assert.equal(await attemptsFor(mainDm, 2), 5); await db.exec("reset role");
    assert.deepEqual(await snapshot(allTables), afterClaims, "budget reads never change ledger or recipient history");
  });
  const budgetDenied = error => error.code === "42501" && /non autorise/.test(error.message);
  for (const reminder of [null, -1, 0, 1, 3]) await rejects(() => attemptsFor(mainDm, reminder), budgetDenied);
  await rejects(() => attemptsFor(id(99999), 2), budgetDenied);
  for (const mutate of [
    () => setS(10, `member_key='${id(11)}'`),
    () => setS(10, `organization_id='${other}'`),
    () => setD(10, "discord_user_id='999999999999999999'"),
    () => db.query("update guild_dm_campaigns set is_test=true where id=$1", [dc]),
    () => db.query("update guild_dm_campaigns set interaction_type='ack' where id=$1", [dc]),
  ]) await sandbox(async () => { await mutate(); await rejects(() => attemptsFor(mainDm, 2), budgetDenied); });
  await sandbox(async () => {
    await setS(11, "guild_dm_recipient_id=null"); await setS(10, `guild_dm_recipient_id='${secondaryDm}'`);
    await rejects(() => attemptsFor(secondaryDm, 2), budgetDenied);
    await rejects(() => attemptsFor(mainDm, 2), budgetDenied);
  });
  await sandbox(async () => {
    await db.query("update guild_dm_recipients set reminder_count=1 where id=$1", [id(303)]);
    await rejects(() => attemptsFor(id(303), 1), budgetDenied);
  });
  console.log("OK: two-wave ledger budgets with cumulative attempts >=5, 429 limit, secondary isolation and forged-scope denial");
  const replayAfterSent = await snapshot(allTables);
  assert.deepEqual(await queue(second.fingerprint, request), { ...queued, alreadyQueued: true });
  assert.deepEqual(await snapshot(allTables), replayAfterSent);
  assert.deepEqual(await snapshot(protectedTables), protectedBefore);
  assert.deepEqual(await one("select (select count(*) from guild_dm_campaigns)::int as campaigns,(select count(*) from guild_dm_recipients)::int as dm,(select count(*) from intersaison_survey_recipients)::int as survey"), countsBefore);
  console.log("OK: successive waves, initial message IDs, delivery sequence, confirmed downgrade guard and terminal failure after departure");

  await sandbox(async () => {
    await db.query("update guild_dm_campaigns set status='cancelled',sent_at=null where id=$1", [dc]);
    await rpc("refresh_intersaison_choice_delivery_counters", { p_campaign: dc });
    const c = await one("select * from guild_dm_campaigns where id=$1", [dc]);
    assert.equal(c.status, "cancelled"); assert.equal(new Date(c.sent_at).toISOString(), "2026-01-01T00:00:00.000Z");
  });
  await sandbox(async () => {
    await db.query("update guild_dm_campaigns set is_test=true where id=$1", [dc]);
    await rejects(() => rpc("refresh_intersaison_choice_delivery_counters", { p_campaign: dc }), /incoherente/);
  });
  await rejects(() => rpc("refresh_intersaison_choice_delivery_counters", { p_campaign: id(300) }), /incoherente/);
  await rejects(() => rpc("queue_intersaison_survey_reminders", { ...context, p_campaign: campaign }), /previsualisation/);
  await sandbox(async () => {
    const count = (await one("select count(*)::int as n from intersaison_survey_delivery_events")).n;
    await db.query("update intersaison_survey_campaigns set status='open' where id=$1", [id(301)]);
    assert.equal(await rpc("queue_intersaison_survey_reminders", { ...context, p_campaign: id(301) }), 1);
    assert.equal((await one("select last_error from guild_dm_recipients where id=$1", [id(303)])).last_error, null);
    assert.equal((await one("select count(*)::int as n from intersaison_survey_delivery_events")).n, count, "poll 1 / ack never audited");
  });
  await sandbox(async () => {
    const testLaunchPreview = await rpc("preview_intersaison_survey_two", { ...context, p_season: season });
    const test = await rpc("launch_intersaison_survey_two", { ...context, p_season: season, p_version: version,
      p_fingerprint: testLaunchPreview.rosterFingerprint, p_is_test: true });
    const testCampaign = await one("select * from intersaison_survey_campaigns where id=$1", [test.campaignId]);
    const beforeEvents = (await one("select count(*)::int as n from intersaison_survey_delivery_events")).n;
    await db.query("update guild_dm_recipients set status='sent',sent_at=now(),discord_message_id='test-message' where campaign_id=$1", [testCampaign.guild_dm_campaign_id]);
    await rpc("refresh_intersaison_choice_delivery_counters", { p_campaign: testCampaign.guild_dm_campaign_id });
    assert.equal((await one("select status from guild_dm_campaigns where id=$1", [testCampaign.guild_dm_campaign_id])).status, "completed");
    assert.equal((await one("select count(*)::int as n from intersaison_survey_delivery_events")).n, beforeEvents, "test choice not audited");
    const testDm = await one("update guild_dm_recipients set reminder_count=1 where campaign_id=$1 returning id", [testCampaign.guild_dm_campaign_id]);
    await rejects(() => attemptsFor(testDm.id, 1), budgetDenied);
  });
  await sandbox(async () => {
    const before = (await dm(38)).discord_message_id; assert.equal(before, null);
    await setD(38, "discord_message_id='700000000000000003'");
    assert.equal((await dm(38)).discord_message_id, "700000000000000003", "first delivery may store its first ID");
  });
  const eventFks = await query("select confrelid::regclass::text as parent from pg_constraint where conrelid='intersaison_survey_delivery_events'::regclass and contype='f'");
  assert.deepEqual(eventFks.map(r => r.parent), ["portal_organizations"], "no event FK KEY SHARE can invert the C/S -> D lock order");
  await sandbox(async () => {
    const e = await one("select * from intersaison_survey_delivery_events limit 1");
    await rejects(() => db.query("insert into intersaison_survey_delivery_events(organization_id,survey_campaign_id,survey_recipient_id,dm_recipient_id,reminder_count,old_snapshot,new_snapshot) values($1,$2,$3,$4,1,'{}','{}')",
      [other, campaign, e.survey_recipient_id, e.dm_recipient_id]), /mismatch/);
    await rejects(() => db.exec("update intersaison_survey_delivery_events set reminder_count=999"), /append-only/);
    await rejects(() => db.exec("delete from intersaison_survey_reminder_batches"), /append-only/);
    await rejects(() => db.exec("truncate intersaison_survey_delivery_events"), /append-only/);
    await db.query("update intersaison_survey_recipients set guild_dm_recipient_id=null where id=$1", [e.survey_recipient_id]);
    await db.query("delete from guild_dm_recipients where id=$1", [e.dm_recipient_id]);
    assert.ok(await one("select id from intersaison_survey_delivery_events where id=$1", [e.id]), "events survive DM archival");
  });
  for (const role of ["anon", "authenticated", "service_role"]) {
    await db.exec(`set role ${role}`);
    if (role !== "service_role") {
      await rejects(() => preview(), /permission denied/);
      await rejects(() => queue("forged", id(700)), /permission denied/);
      await rejects(() => rpc("refresh_intersaison_choice_delivery_counters", { p_campaign: dc }), /permission denied/);
      await rejects(() => attemptsFor(mainDm, 2), /permission denied/);
      for (const table of ["intersaison_survey_reminder_batches", "intersaison_survey_delivery_events"])
        await rejects(() => query(`select * from ${table}`), /permission denied/);
    } else {
      assert.equal(await attemptsFor(mainDm, 2), 0);
      assert.ok((await query("select * from intersaison_survey_reminder_batches")).length);
      await rejects(() => query("delete from intersaison_survey_delivery_events"), /permission denied/);
      await rejects(() => rpc("queue_intersaison_survey_reminders_legacy_private", { ...context, p_campaign: campaign }), /permission denied/);
    }
    await db.exec("reset role");
  }
  const end = await snapshot(allTables); await db.exec(migration);
  assert.deepEqual(await snapshot(allTables), end);
  await db.exec("begin read only"); cleanChecks(await query(preflight)); cleanChecks(await query(verify)); await db.exec("rollback");
  console.log("OK: counters, legacy poll 1, test isolation, append-only scope, no inverted event FKs, RLS and migration idempotence");
  await db.close(); db = new PGlite(); await installPrerequisites(); await db.exec(migration);
  await db.exec("begin read only"); cleanChecks(await query(preflight)); cleanChecks(await query(verify)); await db.exec("rollback");
  console.log("OK: post-install read-only diagnostics without live samples");
  console.log("All intersaison reminder SQL tests passed (isolated PGlite, no network).");
} catch (error) {
  console.error(error.stack);
  if (error.where) console.error(error.where);
  if (error.query) console.error(error.query);
  process.exitCode = 1;
} finally {
  await db.close();
}
