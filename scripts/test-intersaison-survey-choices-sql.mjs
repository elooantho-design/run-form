import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { buildSurveyChoiceForecast } from "../src/lib/intersaisonSurveyChoices.js";
import { exportSurveyChoices, loadSurveyChoiceWorkspace, runSurveyChoiceAction } from "../api/_intersaison-survey-choices.js";

if (!process.env.PGLITE_MODULE_PATH) throw new Error("Set PGLITE_MODULE_PATH (isolated PostgreSQL tests only).");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href);
const db = new PGlite();
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const org = id(100), foreign = id(101), season = id(200), oldSeason = id(201);
const actor = { id: id(1), role: "admin", guild_code: "G1" };
const organization = { id: org, organization_key: "paladin" };
const seasonRow = { id: season, status: "survey1_open" };
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create table portal_organizations(id uuid primary key,organization_key text,is_active boolean default true);
  create table portal_guilds(id uuid primary key default gen_random_uuid(),organization_id uuid references portal_organizations(id),guild_code text,is_active boolean default true,unique(organization_id,guild_code));
  create table guild_members(id uuid primary key,watcher_name text,role text,guild_code text,discord_id text,roster_status text default 'active',community_access_type text default 'guild');
  insert into portal_organizations values('${org}','paladin',true),('${foreign}','mad',true);
  insert into portal_guilds(organization_id,guild_code) select '${org}','G' || n from generate_series(1,7) n;
  insert into portal_guilds(organization_id,guild_code) values('${foreign}','MAD G1');
  insert into guild_members(id,watcher_name,role,guild_code,discord_id) values
    ('${actor.id}','Admin','admin','G1','111111111111111111'),
    ('${id(2)}','Joueur 2','member','G2','222222222222222222'),
    ('${id(3)}','Sans ID','member','G3',''),
    ('${id(4)}','Doublon A','member','G4','444444444444444444'),
    ('${id(5)}','Doublon B','member','G5','444444444444444444'),
    ('${id(6)}','Autre organisation','admin','MAD G1','666666666666666666');
  insert into guild_members(id,watcher_name,role,guild_code,discord_id,roster_status,community_access_type) values
    ('${id(10)}','Inactif','member','G1','101010101010101010','inactive','guild'),
    ('${id(11)}','Communauté','member','G7','121212121212121212','active','community');
  grant select on portal_guilds,guild_members to service_role;
`);
for (const file of ["guild_dm_campaigns.sql", "guild_dm_campaigns_test_mode.sql", "guild_dm_campaigns_lifecycle.sql", "intersaison_surveys.sql", "intersaison_surveys_test_mode.sql", "intersaison_survey_objectives.sql"]) {
  const sql = (await readFile(new URL(file, import.meta.url), "utf8")).replace(/create extension if not exists pgcrypto;/gi, "");
  await db.exec(sql);
}
await db.exec(`
  insert into intersaison_survey_seasons(id,organization_id,status) values('${season}','${org}','survey1_open'),('${oldSeason}','${org}','finished');
  insert into guild_dm_campaigns(id,organization_id,message,target_guild_codes,status) values('${id(300)}','${org}','Sondage 1',array['G1'],'completed');
  insert into intersaison_survey_campaigns(id,season_id,organization_id,poll_number,guild_dm_campaign_id,status,title,message)
    values('${id(301)}','${season}','${org}',1,'${id(300)}','open','Sondage 1','Ne pas altérer');
  insert into intersaison_survey_recipients(id,survey_campaign_id,organization_id,member_id,guild_code_snapshot,member_name_snapshot,response_status,responded_at)
    values('${id(302)}','${id(301)}','${org}','${actor.id}','G1','Admin','responded',now());
  insert into intersaison_survey_responses(survey_campaign_id,survey_recipient_id,organization_id,member_id,poll_number,guild_code_snapshot,member_name_snapshot,objective_text)
    values('${id(301)}','${id(302)}','${org}','${actor.id}',1,'G1','Admin','Réponse du premier sondage, intacte.');
  insert into intersaison_survey_guild_objectives(season_id,organization_id,guild_code,objective_text) values('${oldSeason}','${org}','G1','Référence historique');
`);
const migration = await readFile(new URL("intersaison_survey_choices.sql", import.meta.url), "utf8");
const preflight = await readFile(new URL("intersaison_survey_choices_preflight.sql", import.meta.url), "utf8");
const verify = await readFile(new URL("intersaison_survey_choices_verify.sql", import.meta.url), "utf8");
assert.ok((await db.query(preflight)).rows.every((r) => r.status !== "ERROR"));
await db.exec(migration);
const query = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => (await query(sql, params))[0];
const baseline = await query("select * from intersaison_survey_responses where poll_number=1");
const legacy = await query("select * from intersaison_survey_guild_objectives");
await db.exec(`begin;
  insert into intersaison_survey_objective_versions(id,organization_id,season_id,purpose,version_number,status,validated_at,official_at)
    values('${id(400)}','${org}','${oldSeason}','next',1,'official',now(),now());
  insert into intersaison_survey_objective_items(version_id,organization_id,season_id,guild_code,objective_text)
    select '${id(400)}','${org}','${oldSeason}','G' || n,'Ancien objectif ' || n from generate_series(1,7) n;
  commit;`);
const oldOfficial=await query("select * from intersaison_survey_objective_items where version_id=$1 order by guild_code",[id(400)]);

class Query {
  constructor(table) { assert.match(table,/^[a-z_]+$/); this.table=table; this.filters=[]; this.args=[]; this.sort=""; this.bounds=""; }
  select(columns) { this.columns=columns; return this; }
  filter(col,op,value) { assert.match(col,/^[a-z_]+$/); this.args.push(value); this.filters.push(`${col} ${op} $${this.args.length}`); return this; }
  eq(c,v) { return this.filter(c,"=",v); }
  neq(c,v) { return this.filter(c,"<>",v); }
  in(c,values) { assert.match(c,/^[a-z_]+$/); const ps=values.map(v=>{this.args.push(v);return `$${this.args.length}`;}); this.filters.push(`${c} in (${ps.join(",")})`);return this; }
  or(value) { assert.equal(value,"roster_status.eq.active,roster_status.is.null");this.filters.push("(roster_status='active' or roster_status is null)");return this; }
  order(col) { assert.match(col,/^[a-z_]+$/);this.sort=` order by ${col}`;return this; }
  range(start,end) { this.bounds=` limit ${end-start+1} offset ${start}`;return this; }
  async run(single=false) { try { const rows=await query(`select ${this.columns || "*"} from ${this.table}${this.filters.length ? ` where ${this.filters.join(" and ")}` : ""}${this.sort}${this.bounds}`,this.args); return {data:single ? rows[0] || null : rows,error:null}; } catch(error) {return {data:null,error};} }
  maybeSingle() { return this.run(true); }
  then(resolve,reject) { return this.run().then(resolve,reject); }
}
const client = {
  from: table=>new Query(table),
  async rpc(name,args) {
    assert.match(name,/^[a-z_]+$/);
    const entries=Object.entries(args);
    try {
      const row=await one(`select public.${name}(${entries.map(([k],i)=>`${k} => $${i+1}`).join(",")}) as result`,entries.map(([,v])=>Array.isArray(v) ? `{${v.join(",")}}` : v));
      return {data:row.result,error:null};
    } catch(error) {return {data:null,error};}
  },
};
async function rpc(name,args) {const r=await client.rpc(name,args);if(r.error) throw r.error;return r.data;}
const context={p_org:org,p_actor:actor.id};
const full=Object.fromEntries(Array.from({length:7},(_,i)=>[`G${i+1}`,`Objectif officiel ${i+1}\nTexte intégral.`]));
const version=await rpc("save_intersaison_survey_objectives_draft",{p_organization_id:org,p_season_id:season,p_actor_member_id:actor.id,p_objectives:JSON.stringify(full),p_expected_version:0});
await rpc("validate_intersaison_survey_objectives_draft",{p_organization_id:org,p_season_id:season,p_actor_member_id:actor.id,p_version_id:version});
await db.exec("set role service_role");
let preview=await rpc("preview_intersaison_survey_two",{...context,p_season:season});
assert.equal(preview.canLaunch,false,"survey 1 must be closed explicitly, not implicitly");
assert.deepEqual(preview.counts,{total:5,missing:1,duplicates:2,distinctDiscordIds:3,duplicateDiscordIds:1,eligible:2});
const launchArgs={...context,p_season:season,p_version:version,p_fingerprint:preview.rosterFingerprint,p_is_test:false};
await assert.rejects(rpc("launch_intersaison_survey_two",launchArgs),/Clôture/);
await assert.rejects(runSurveyChoiceAction(client,actor,organization,seasonRow,"launch-survey-two",{versionId:version}),/Confirmation/);
const test=await runSurveyChoiceAction(client,actor,organization,seasonRow,"launch-survey-two-test",{
  confirmed:true,versionId:version,memberIds:[id(2)],discordUserId:"222222222222222222",
});
const testCampaign=test.result.campaignId;
assert.equal(test.result.queuedCount,1);
assert.equal((await one("select member_id from intersaison_survey_recipients where survey_campaign_id=$1",[testCampaign])).member_id,actor.id,"test cannot target another supplied identity");
assert.equal((await one("select status from intersaison_survey_objective_versions where id=$1",[version])).status,"validated","test does not publish");
assert.deepEqual(await query("select * from intersaison_survey_responses where poll_number=1"),baseline);
await assert.rejects(exportSurveyChoices(client,actor,organization,{campaignId:testCampaign,format:"xlsx"}),/introuvable/);
await assert.rejects(runSurveyChoiceAction(client,{...actor,id:id(2),role:"member"},organization,seasonRow,"launch-survey-two-test",{confirmed:true,versionId:version}),/admins/);
await assert.rejects(runSurveyChoiceAction(client,{...actor,id:id(2),role:"admin",guild_code:"G2"},organization,seasonRow,"launch-survey-two-test",{confirmed:true,versionId:version}),/autorise/,
  "SQL checks the real role even if the in-process actor has a forged admin role");
await db.exec("set role anon");
await assert.rejects(rpc("preview_intersaison_survey_two",{...context,p_season:season}),/permission denied/);
await db.exec("set role service_role");
await assert.rejects(rpc("enqueue_intersaison_survey_members",{p_campaign:testCampaign,p_members:[id(2)]}),/permission denied/);
const oldRecipient=await one("select * from intersaison_survey_recipients where id=$1",[id(302)]);
assert.deepEqual(await rpc("add_intersaison_survey_members",{...context,p_campaign:id(301),p_members:[id(2),actor.id]}),
  {addedCount:1,queuedCount:1,alreadyIncludedCount:1},"late arrival support also works for survey 1 without resetting its recipients");
assert.deepEqual(await one("select * from intersaison_survey_recipients where id=$1",[id(302)]),oldRecipient);
await rpc("close_intersaison_survey",{...context,p_campaign:id(301)});
assert.equal((await one("select status from intersaison_survey_seasons where id=$1",[season])).status,"survey1_closed");
assert.deepEqual(await query("select * from intersaison_survey_responses where poll_number=1"),baseline);

// A recipient insertion fault rolls back the campaign, queue and officialization together.
await db.exec("reset role");
await db.exec("create function test_queue_fault() returns trigger language plpgsql as $$ begin raise exception 'simulated queue failure'; end $$; create trigger test_queue_fault before insert on guild_dm_recipients for each row execute function test_queue_fault();");
await db.exec("set role service_role");
preview=await rpc("preview_intersaison_survey_two",{...context,p_season:season});
launchArgs.p_fingerprint=preview.rosterFingerprint;
const countBefore=await one("select count(*)::integer as n from guild_dm_campaigns");
await assert.rejects(rpc("launch_intersaison_survey_two",launchArgs),/simulated queue failure/);
assert.deepEqual(await one("select count(*)::integer as n from guild_dm_campaigns"),countBefore);
assert.equal((await one("select status from intersaison_survey_objective_versions where id=$1",[version])).status,"validated");
await db.exec("reset role; drop trigger test_queue_fault on guild_dm_recipients; drop function test_queue_fault();");
await db.exec("create function test_publication_fault() returns trigger language plpgsql as $$ begin if new.status='survey2_open' then raise exception 'simulated publication failure'; end if; return new; end $$; create trigger test_publication_fault before update on intersaison_survey_seasons for each row execute function test_publication_fault(); set role service_role;");
await assert.rejects(rpc("launch_intersaison_survey_two",launchArgs),/simulated publication failure/);
assert.deepEqual(await one("select count(*)::integer as n from guild_dm_campaigns"),countBefore);
assert.equal((await one("select status from intersaison_survey_objective_versions where id=$1",[id(400)])).status,"official","a failure after publication restores the old official objectives");
assert.equal((await one("select status from intersaison_survey_objective_versions where id=$1",[version])).status,"validated");
await db.exec("reset role; drop trigger test_publication_fault on intersaison_survey_seasons; drop function test_publication_fault();");
await db.exec(`insert into guild_members(id,watcher_name,role,guild_code,discord_id) values('${id(7)}','Arrivée pendant confirmation','member','G6','777777777777777777');`);
await db.exec("set role service_role");
await assert.rejects(rpc("launch_intersaison_survey_two",launchArgs),/effectifs ont changé/);
preview=await rpc("preview_intersaison_survey_two",{...context,p_season:season});
launchArgs.p_fingerprint=preview.rosterFingerprint;
const competing=await Promise.allSettled([rpc("launch_intersaison_survey_two",launchArgs),rpc("launch_intersaison_survey_two",launchArgs)]);
assert.equal(competing.filter(r=>r.status==="fulfilled").length,1,"only one admin can launch the official survey");
const official=competing.find(r=>r.status==="fulfilled").value;
assert.equal(official.addedCount,6);
assert.equal(official.queuedCount,3,"ambiguous shared Discord identities are not sent a DM");
assert.equal((await one("select status from intersaison_survey_objective_versions where id=$1",[version])).status,"official");
assert.equal((await one("select status from intersaison_survey_objective_versions where id=$1",[id(400)])).status,"archived");
assert.deepEqual(await query("select * from intersaison_survey_objective_items where version_id=$1 order by guild_code",[id(400)]),oldOfficial,"publication archives the old status, never its objective texts");
assert.deepEqual((await one("select objective_snapshot from intersaison_survey_campaigns where id=$1",[official.campaignId])).objective_snapshot,full);
await assert.rejects(db.query("update intersaison_survey_campaigns set objective_snapshot='{}' where id=$1",[official.campaignId]),/immuable/);
await db.exec("reset role");
await db.exec(`insert into guild_members(id,watcher_name,role,guild_code,discord_id) values('${id(8)}','Nouveau joueur','member','G3','888888888888888888');`);
await db.exec("set role service_role");
let workspace=await loadSurveyChoiceWorkspace(client,actor,organization,seasonRow);
assert.ok(workspace.candidates[2].some(m=>m.id===id(8)),"new roster accounts are detected without any sending");
const beforeRecipients=await query("select * from intersaison_survey_recipients where survey_campaign_id=$1 order by id",[official.campaignId]);
const appendArgs={...context,p_campaign:official.campaignId,p_members:[id(8),id(2)]};
assert.deepEqual(await rpc("add_intersaison_survey_members",appendArgs),{addedCount:1,queuedCount:1,alreadyIncludedCount:1});
assert.deepEqual(await rpc("add_intersaison_survey_members",appendArgs),{addedCount:0,queuedCount:0,alreadyIncludedCount:2});
assert.deepEqual(await query("select * from intersaison_survey_recipients where survey_campaign_id=$1 and member_id<>$2 order by id",[official.campaignId,id(8)]),beforeRecipients,"no existing recipient is reset");
await assert.rejects(rpc("add_intersaison_survey_members",{...appendArgs,p_members:[id(6)]}),/hors des effectifs/);
await assert.rejects(rpc("add_intersaison_survey_members",{...appendArgs,p_org:foreign}),/organisation|autorise/);
const member=await one("select r.*,d.discord_user_id from intersaison_survey_recipients r join guild_dm_recipients d on d.id=r.guild_dm_recipient_id where r.survey_campaign_id=$1 and r.member_id=$2",[official.campaignId,id(8)]);
const placement={...context,p_season:season,p_member:id(8),p_guild:"G7",p_expected_revision:0};
await rpc("save_intersaison_survey_placement",placement);
const answer={p_dm_recipient_id:member.guild_dm_recipient_id,p_discord_user_id:member.discord_user_id,
  p_interaction_id:"123456789012345678",p_first_choice:"G2",p_second_choice:"",p_comment:""};
await assert.rejects(rpc("submit_intersaison_survey_choice",{...answer,p_discord_user_id:"999999999999999999"}),/destinataire/);
await assert.rejects(rpc("submit_intersaison_survey_choice",{...answer,p_second_choice:"G2"}),/invalides/);
await assert.rejects(rpc("submit_intersaison_survey_choice",{...answer,p_first_choice:"MAD G1"}),/invalides/);
await assert.rejects(rpc("submit_intersaison_survey_choice",{...answer,p_comment:"x".repeat(1901)}),/1900/);
await rpc("submit_intersaison_survey_choice",answer);
await rpc("submit_intersaison_survey_choice",answer);
assert.equal((await one("select confirmed_count from guild_dm_campaigns where id=(select guild_dm_campaign_id from intersaison_survey_campaigns where id=$1)",[official.campaignId])).confirmed_count,1);
assert.equal((await one("select count(*)::integer as n from intersaison_survey_responses where survey_recipient_id=$1",[member.id])).n,1,"retrying the same Discord interaction is idempotent");
workspace=await loadSurveyChoiceWorkspace(client,actor,organization,seasonRow);
let forecast=workspace.forecast.players.find(p=>p.memberKey===id(8));
assert.equal(forecast.targetGuild,"G7"); assert.equal(forecast.firstChoice,"G2"); assert.equal(forecast.hasDifference,true);
assert.equal(workspace.forecast.guilds.reduce((n,g)=>n+g.players.filter(p=>p.memberKey===id(8)).length,0),1);
assert.equal(forecast.manualHistory.length,1);
await db.exec("reset role");
await db.exec("create function test_answer_fault() returns trigger language plpgsql as $$ begin raise exception 'simulated response failure'; end $$; create trigger test_answer_fault before insert on intersaison_survey_responses for each row execute function test_answer_fault();");
await db.exec("set role service_role");
await assert.rejects(rpc("submit_intersaison_survey_choice",{...answer,p_interaction_id:"123456789012345681",p_first_choice:"G7"}),/simulated response failure/);
assert.equal((await one("select first_choice_guild_code from intersaison_survey_responses where survey_recipient_id=$1 and is_current",[member.id])).first_choice_guild_code,"G2","a failed edit must not archive the current response");
await db.exec("reset role; drop trigger test_answer_fault on intersaison_survey_responses; drop function test_answer_fault(); set role service_role;");
await rpc("submit_intersaison_survey_choice",{...answer,p_interaction_id:"123456789012345679",p_first_choice:"G1",p_second_choice:"G3",p_comment:"  Commentaire intégral\nDeuxième ligne.  "});
assert.equal((await one("select count(*)::integer as n from intersaison_survey_responses where survey_recipient_id=$1",[member.id])).n,2);
assert.equal((await one("select count(*)::integer as n from intersaison_survey_responses where survey_recipient_id=$1 and is_current",[member.id])).n,1);
assert.equal((await one("select confirmed_count from guild_dm_campaigns where id=(select guild_dm_campaign_id from intersaison_survey_campaigns where id=$1)",[official.campaignId])).confirmed_count,1,"editing a response does not count a second confirmation");
await assert.rejects(rpc("save_intersaison_survey_placement",placement),/autre administrateur/);
await rpc("save_intersaison_survey_placement",{...placement,p_guild:null,p_expected_revision:1});
workspace=await loadSurveyChoiceWorkspace(client,actor,organization,seasonRow);
forecast=workspace.forecast.players.find(p=>p.memberKey===id(8));
assert.equal(forecast.targetGuild,"G1"); assert.equal(forecast.manual,null); assert.equal(forecast.manualHistory.length,2);
assert.equal((await one("select guild_code from guild_members where id=$1",[id(8)])).guild_code,"G3","no real transfer ever occurs");
assert.equal(await rpc("queue_intersaison_survey_reminders",{...context,p_campaign:official.campaignId,p_recipient:member.id}),0,"responded players are never reminded");
const csv=await exportSurveyChoices(client,actor,organization,{campaignId:official.campaignId,format:"csv"});
const xlsx=await exportSurveyChoices(client,actor,organization,{campaignId:official.campaignId,format:"xlsx"});
assert.match(csv.content,/Commentaire intégral\nDeuxième ligne/);
assert.match(csv.content,/objectif_G7/); assert.match(csv.content,/Objectif officiel 7/);
assert.ok(Buffer.from(xlsx.content,"base64").includes(Buffer.from("Objectif officiel 7")));
for (const name of ["Réponses joueurs","Objectifs guildes","Campagne"]) assert.ok(Buffer.from(xlsx.content,"base64").includes(Buffer.from(name)));
assert.equal(Buffer.from(xlsx.content,"base64").subarray(0,2).toString(),"PK");
await rpc("close_intersaison_survey",{...context,p_campaign:official.campaignId});
await assert.rejects(rpc("submit_intersaison_survey_choice",{...answer,p_interaction_id:"123456789012345680"}),/plus ouvert/);
await assert.rejects(rpc("add_intersaison_survey_members",appendArgs),/officiel ouvert/);
await assert.rejects(rpc("queue_intersaison_survey_reminders",{...context,p_campaign:official.campaignId,p_recipient:null}),/officiel ouvert/);
assert.ok((await exportSurveyChoices(client,actor,organization,{campaignId:official.campaignId,format:"xlsx"})).content,"closed survey remains exportable");
await db.exec("reset role");
assert.deepEqual(await query("select * from intersaison_survey_responses where poll_number=1"),baseline);
assert.deepEqual(await query("select * from intersaison_survey_guild_objectives"),legacy);
assert.ok((await query(verify)).every(r=>r.status==="OK"));
assert.equal((await one("select count(*)::integer as n from intersaison_survey_objective_versions where season_id=$1 and purpose='reference'",[season])).n,0,"existing seasons were not backfilled or rewritten");
await db.query("update intersaison_survey_seasons set status='finished' where id=$1",[season]);
await db.query("insert into intersaison_survey_seasons(id,organization_id,status,created_by_member_id) values($1,$2,'survey1_preparing',$3)",[id(202),org,actor.id]);
const captured=await query("select i.guild_code,i.objective_text from intersaison_survey_objective_versions v join intersaison_survey_objective_items i on i.version_id=v.id where v.season_id=$1 and v.purpose='reference' order by i.guild_code",[id(202)]);
assert.deepEqual(Object.fromEntries(captured.map(r=>[r.guild_code,r.objective_text])),full,"new official objectives become the next season's immutable reference");
await db.exec(migration);
assert.ok((await query(verify)).every(r=>r.status==="OK"));
assert.equal(buildSurveyChoiceForecast({members:[]}).guilds.length,7);
await db.close();
console.log("Survey 2 SQL/API integration passed: atomic launch, rollback, self-test, late members, choices, manual history, exports, tenant isolation. No production access.");
