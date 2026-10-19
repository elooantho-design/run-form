import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { buildSurveyChoiceForecast } from "../src/lib/intersaisonSurveyChoices.js";
import { buildSurveyTwoDiscordPayload } from "../src/lib/intersaisonSurveyObjectives.js";
import { describeIntersaisonDeliveryError } from "../src/lib/intersaisonDelivery.js";
import { retrySurveyChoiceRecipient } from "../api/_intersaison-survey-choices.js";

globalThis.fetch=()=>{throw Error("Production access and real Discord sends forbidden in tests");};
if (!process.env.PGLITE_MODULE_PATH) throw Error("Set PGLITE_MODULE_PATH to an isolated PostgreSQL runtime.");
const { PGlite }=await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href);
const db=new PGlite();
const id=n=>`20000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const org=id(100),other=id(101),season=id(200),admin=id(1);
const query=async(sql,args=[]) => (await db.query(sql,args)).rows;
const one=async(sql,args=[]) => (await query(sql,args))[0];
const rpc=async(name,args)=> (await one(`select public.${name}(${Object.keys(args).map((key,i)=>`${key}=>$${i+1}`).join(",")}) as result`,Object.values(args))).result;
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create table portal_organizations(id uuid primary key,organization_key text,is_active boolean default true);
create table portal_guilds(id uuid primary key default gen_random_uuid(),organization_id uuid references portal_organizations(id),guild_code text,is_active boolean default true,unique(organization_id,guild_code));
create table guild_members(id uuid primary key,watcher_name text,role text,guild_code text,discord_id text,roster_status text default 'active',community_access_type text default 'guild',primary_member_id uuid references guild_members(id));
insert into portal_organizations values('${org}','paladin',true),('${other}','mad',true);
insert into portal_guilds(organization_id,guild_code) select '${org}','G'||i from generate_series(1,7)i;
insert into portal_guilds(organization_id,guild_code) values('${other}','MAD G1');
grant select on portal_guilds,guild_members to service_role;`);
for(const [n,name,discord,guild,primary] of [
  [1,"Admin","111111111111111111","G1",null],[2,"Solo","222222222222222222","G2",null],
  [10,"Principal","333333333333333333","G1",null],[11,"Secondaire","333333333333333333","G2",10],
  [20,"Principal Trois","444444444444444444","G3",null],[21,"Alt A","444444444444444444","G4",20],
  [22,"Alt B","444444444444444444","G5",20],[23,"Alt C","444444444444444444","G6",20],
  [30,"Ambigu A","555555555555555555","G1",null],[31,"Ambigu B","555555555555555555","G2",null],
  [40,"Foreign","666666666666666666","MAD G1",null]]) {
  await db.query("insert into guild_members(id,watcher_name,role,guild_code,discord_id,primary_member_id) values($1,$2,$3,$4,$5,$6)",
    [id(n),name,n===1?"admin":"member",guild,discord,primary?id(primary):null]);
}
for(const name of ["guild_dm_campaigns","guild_dm_campaigns_test_mode","guild_dm_campaigns_lifecycle","intersaison_surveys","intersaison_surveys_test_mode","intersaison_survey_objectives","intersaison_survey_choices"])
  await db.exec((await readFile(new URL(`${name}.sql`,import.meta.url),"utf8")).replace(/create extension if not exists pgcrypto;/gi,""));
await db.exec(`insert into intersaison_survey_seasons(id,organization_id,status) values('${season}','${org}','survey1_closed');
insert into guild_dm_campaigns(id,organization_id,message,target_guild_codes,status) values('${id(300)}','${org}','Survey1',array['G1'],'completed');
insert into intersaison_survey_campaigns(id,season_id,organization_id,poll_number,guild_dm_campaign_id,status,title,message)
values('${id(301)}','${season}','${org}',1,'${id(300)}','closed','Survey1','Existing survey1');
insert into intersaison_survey_recipients(id,survey_campaign_id,organization_id,member_id,guild_code_snapshot,member_name_snapshot)
values('${id(302)}','${id(301)}','${org}','${admin}','G1','Admin');
insert into intersaison_survey_responses(survey_campaign_id,survey_recipient_id,organization_id,member_id,poll_number,guild_code_snapshot,member_name_snapshot,objective_text)
values('${id(301)}','${id(302)}','${org}','${admin}',1,'G1','Admin','Existing survey1 answer');`);
const context={p_org:org,p_actor:admin};
const goals=Object.fromEntries(Array.from({length:7},(_,i)=>[`G${i+1}`,`Official ${i+1}`]));
const version=await rpc("save_intersaison_survey_objectives_draft",{p_organization_id:org,p_season_id:season,p_actor_member_id:admin,p_objectives:JSON.stringify(goals),p_expected_version:0});
await rpc("validate_intersaison_survey_objectives_draft",{p_organization_id:org,p_season_id:season,p_actor_member_id:admin,p_version_id:version});
const preview=await rpc("preview_intersaison_survey_two",{...context,p_season:season});
const launch=await rpc("launch_intersaison_survey_two",{...context,p_season:season,p_version:version,p_fingerprint:preview.rosterFingerprint,p_is_test:false});
const campaign=launch.campaignId;
const recipient=member=>one("select * from intersaison_survey_recipients where survey_campaign_id=$1 and member_id=$2",[campaign,id(member)]);
const solo=await recipient(2),oldAdmin=await recipient(1);
await db.query("update guild_dm_recipients set status='failed',last_error='HTTP 503 - temporary failure',send_attempts=1 where id=$1",[solo.guild_dm_recipient_id]);
const answer=(r,discord,interaction,first="G1")=>({p_dm_recipient_id:r.guild_dm_recipient_id,p_discord_user_id:discord,
  p_interaction_id:interaction,p_first_choice:first,p_second_choice:"G7",p_comment:"Full comment"});
await rpc("submit_intersaison_survey_choice",answer(oldAdmin,"111111111111111111","123456789012345670"));
const before={responses:await query("select * from intersaison_survey_responses order by id"),
 recipients:await query("select * from intersaison_survey_recipients order by id"),objectives:await query("select * from intersaison_survey_objective_items order by guild_code"),
 campaign:await one("select * from intersaison_survey_campaigns where id=$1",[campaign]),members:await query("select * from guild_members order by id")};
const preflight=await readFile(new URL("intersaison_survey_accounts_preflight.sql",import.meta.url),"utf8");
const migration=await readFile(new URL("intersaison_survey_accounts.sql",import.meta.url),"utf8");
const verify=await readFile(new URL("intersaison_survey_accounts_verify.sql",import.meta.url),"utf8");
assert.ok((await query(preflight)).every(r=>r.status!=="ERROR"));
await db.exec(migration);
assert.ok((await query(verify)).every(r=>r.status!=="ERROR"));
assert.deepEqual(await query("select * from intersaison_survey_responses order by id"),before.responses);
assert.deepEqual(await query("select * from intersaison_survey_recipients order by id"),before.recipients);
assert.deepEqual(await one("select * from intersaison_survey_campaigns where id=$1",[campaign]),before.campaign);
const inspect=r=>rpc("inspect_intersaison_choice_recipient",{...context,p_recipient:r.id});
const retry=async(r,inspection=undefined)=>rpc("requeue_intersaison_choice_recipient",{...context,p_recipient:r.id,
 p_fingerprint:(inspection||await inspect(r)).fingerprint,p_confirmed:true});
await db.exec("set role service_role");
for(const n of [10,11,20,21,22,23]) {
 const r=await recipient(n),check=await inspect(r);assert.equal(check.eligible,true);assert.equal(check.canRetry,true);
 assert.equal(Object.hasOwn(check,"discordId"),false);assert.equal(check.linkedAccounts.length,n<20?2:4);
 const recovery=await retry(r,check);assert.equal(recovery.queuedCount,1);
 await assert.rejects(retry(r,check),/déjà en file/);
}
assert.equal((await one("select count(*)::int as n from guild_dm_recipients where campaign_id=$1 and discord_user_id='444444444444444444'",[before.campaign.guild_dm_campaign_id])).n,4);
await assert.rejects(retry(await recipient(30)),/rattachement commun/);
await assert.rejects(retry(oldAdmin),/déjà répondu/);
await assert.rejects(rpc("inspect_intersaison_choice_recipient",{...context,p_org:other,p_recipient:solo.id}),/organisation|autorise/);
const fingerprint=await inspect(solo);await retry(solo,fingerprint);
await db.exec("reset role");
await db.query("update guild_dm_recipients set status='failed',send_attempts=5 where id=$1",[solo.guild_dm_recipient_id]);
assert.equal((await inspect(solo)).canRetry,false);
await db.query("update guild_dm_recipients set send_attempts=2,last_error='DELIVERY_UNCERTAIN' where id=$1",[solo.guild_dm_recipient_id]);
assert.equal((await inspect(solo)).canRetry,false);
await db.query("update guild_dm_recipients set last_error='HTTP 403 - code 50278' where id=$1",[solo.guild_dm_recipient_id]);
assert.equal((await inspect(solo)).canRetry,true);
assert.equal(await rpc("queue_intersaison_survey_reminders",{...context,p_campaign:campaign,p_recipient:solo.id}),0,"bulk reminder cannot bypass individual failed-delivery recovery");
await retry(solo);
await db.query("update guild_dm_recipients set status='sent',sent_at=now(),discord_message_id='fake-message' where id=$1",[solo.guild_dm_recipient_id]);
await assert.rejects(retry(solo),/déjà reçu/);
const principal=await recipient(10),secondary=await recipient(11);
await db.query("update guild_dm_recipients set status='sending' where id=$1",[secondary.guild_dm_recipient_id]);
assert.equal(await rpc("check_intersaison_choice_delivery",{p_dm_recipient:secondary.guild_dm_recipient_id}),true);
await assert.rejects(rpc("submit_intersaison_survey_choice",answer(secondary,"999999999999999999","123456789012345671")),/destinataire/);
await rpc("submit_intersaison_survey_choice",answer(principal,"333333333333333333","123456789012345672","G2"));
await rpc("submit_intersaison_survey_choice",answer(secondary,"333333333333333333","123456789012345673","G3"));
const principalAnswer=await one("select * from intersaison_survey_responses where survey_recipient_id=$1 and is_current",[principal.id]);
await rpc("submit_intersaison_survey_choice",answer(secondary,"333333333333333333","123456789012345674","G4"));
assert.deepEqual(await one("select * from intersaison_survey_responses where survey_recipient_id=$1 and is_current",[principal.id]),principalAnswer);
assert.equal((await one("select count(*)::int as n from intersaison_survey_responses where survey_recipient_id=$1",[secondary.id])).n,2);
assert.equal((await one("select first_choice_guild_code from intersaison_survey_responses where survey_recipient_id=$1 and is_current",[secondary.id])).first_choice_guild_code,"G4");
await assert.rejects(retry(secondary),/déjà répondu/);
for(const n of [20,21,22,23]) await rpc("submit_intersaison_survey_choice",answer(await recipient(n),"444444444444444444",String(123456789012345680n+BigInt(n)),`G${n-19}`));
const siblingsBefore=await query("select * from intersaison_survey_responses where member_id=any($1::uuid[]) and is_current order by member_id",[`{${[20,21,22,23].map(id).join(',')}}`]);
assert.equal(siblingsBefore.length,4);assert.equal(new Set(siblingsBefore.map(r=>r.member_id)).size,4);
await rpc("submit_intersaison_survey_choice",answer(await recipient(22),"444444444444444444","123456789012345799","G6"));
assert.deepEqual(await query("select * from intersaison_survey_responses where member_id=any($1::uuid[]) and is_current order by member_id",[`{${[20,21,23].map(id).join(',')}}`]),siblingsBefore.filter(r=>r.member_id!==id(22)));
await db.query("insert into guild_members(id,watcher_name,role,guild_code,discord_id,primary_member_id) values($1,'Late alt','member','G6','333333333333333333',$2)",[id(12),id(10)]);
const append={...context,p_campaign:campaign,p_members:`{${id(12)}}`};
assert.equal((await rpc("add_intersaison_survey_members",append)).queuedCount,1);
assert.equal((await rpc("add_intersaison_survey_members",append)).addedCount,0);
const late=await recipient(12),stale=await inspect(await recipient(31));
await db.query("update guild_members set primary_member_id=$1 where id=$2",[id(30),id(31)]);
await assert.rejects(retry(await recipient(31),stale),/modifié/);
assert.equal((await inspect(await recipient(31))).eligible,true);
await retry(await recipient(31));
await db.query("update guild_members set discord_id='777777777777777777' where id=$1",[id(12)]);
await db.query("update guild_dm_recipients set status='sending' where id=$1",[late.guild_dm_recipient_id]);
await assert.rejects(rpc("check_intersaison_choice_delivery",{p_dm_recipient:late.guild_dm_recipient_id}),/non autorisé/);
await db.query("update guild_members set discord_id='333333333333333333' where id=$1",[id(12)]);
await db.query("update guild_members set primary_member_id=$1 where id=$2",[id(40),id(12)]);
const foreignParent=(await one("select public.intersaison_choice_account_identity($1,$2) as identity",[org,id(12)])).identity;
assert.equal(foreignParent.eligible,false);assert.ok(!JSON.stringify(foreignParent).includes('Foreign'));
await db.query("update guild_members set primary_member_id=$1 where id=$2",[id(10),id(12)]);
await db.query("update guild_members set primary_member_id=$1 where id=$2",[id(11),id(10)]);
assert.equal((await one("select public.intersaison_choice_account_identity($1,$2) as identity",[org,id(11)])).identity.eligible,false,"cycles/chains fail closed");
await db.query("update guild_members set primary_member_id=null where id=$1",[id(10)]);
await assert.rejects(rpc("requeue_intersaison_choice_recipient",{...context,p_recipient:(await recipient(30)).id,p_fingerprint:"forged",p_confirmed:false}),/Confirmation/);
await assert.rejects(db.query("update guild_dm_recipients set account_member_key=$1 where id=$2",[id(20),principal.guild_dm_recipient_id]),/immutable/);
await assert.rejects(db.query(`insert into intersaison_survey_responses(survey_campaign_id,survey_recipient_id,organization_id,member_id,discord_user_id,poll_number,guild_code_snapshot,member_name_snapshot,first_choice_guild_code)
values($1,$2,$3,$4,'333333333333333333',2,'G1','Spoof','G2')`,[campaign,principal.id,org,id(20)]),/non autorisée/);
const classic=await one("insert into guild_dm_campaigns(organization_id,message,target_guild_codes) values($1,'Classic',array['G1']) returning id",[org]);
const insertClassic="insert into guild_dm_recipients(campaign_id,organization_id,member_id,guild_code,member_name_snapshot,discord_user_id) values($1,$2,$3,'G1','Classic','111111111111111111')";
await db.query(insertClassic,[classic.id,org,admin]);await assert.rejects(db.query(insertClassic,[classic.id,org,id(10)]),/unique/);
await assert.rejects(db.query("insert into guild_dm_recipients(campaign_id,organization_id,member_id,guild_code,member_name_snapshot,discord_user_id) values($1,$2,$3,'G1','Duplicate','333333333333333333')",[before.campaign.guild_dm_campaign_id,org,id(10)]),/unique/);
const plan=buildSurveyChoiceForecast({members:await query("select * from guild_members where guild_code<>'MAD G1'"),
 recipients:await query("select * from intersaison_survey_recipients where survey_campaign_id=$1",[campaign]),
 responses:await query("select * from intersaison_survey_responses where survey_campaign_id=$1",[campaign])});
assert.equal(plan.players.filter(p=>[id(10),id(11)].includes(p.memberKey)).length,2);
assert.equal(plan.players.find(p=>p.memberKey===id(10)).targetGuild,"G2");assert.equal(plan.players.find(p=>p.memberKey===id(11)).targetGuild,"G4");
assert.equal(new Set(plan.players.map(p=>p.memberKey)).size,plan.players.length);
assert.deepEqual(await query("select * from intersaison_survey_objective_items order by guild_code"),before.objectives);
assert.deepEqual(await query("select * from intersaison_survey_responses where poll_number=1 order by id"),before.responses.filter(r=>r.poll_number===1));
assert.deepEqual((await query("select id,guild_code from guild_members where id<>$1 order by id",[id(12)])),before.members.map(m=>({id:m.id,guild_code:m.guild_code})));
await db.exec("begin");
await db.query("update intersaison_survey_seasons set status='finished' where id=$1",[season]);
await db.query("insert into intersaison_survey_seasons(id,organization_id,status) values($1,$2,'survey1_closed')",[id(201),org]);
await db.query("insert into intersaison_survey_campaigns(season_id,organization_id,poll_number,status,title,message) values($1,$2,1,'closed','Future 1','Future 1')",[id(201),org]);
const next=await rpc("save_intersaison_survey_objectives_draft",{p_organization_id:org,p_season_id:id(201),p_actor_member_id:admin,p_objectives:JSON.stringify(goals),p_expected_version:0});
await rpc("validate_intersaison_survey_objectives_draft",{p_organization_id:org,p_season_id:id(201),p_actor_member_id:admin,p_version_id:next});
const nextPreview=await rpc("preview_intersaison_survey_two",{...context,p_season:id(201)});
assert.equal(nextPreview.counts.total,11);assert.equal(nextPreview.counts.eligible,11);assert.equal(nextPreview.counts.duplicates,0);
const future=await rpc("launch_intersaison_survey_two",{...context,p_season:id(201),p_version:next,p_fingerprint:nextPreview.rosterFingerprint,p_is_test:false});
assert.equal(future.queuedCount,11,"future initial campaigns enqueue every legitimate game account");
assert.equal((await one("select count(*)::int as n from guild_dm_recipients d join intersaison_survey_campaigns c on c.guild_dm_campaign_id=d.campaign_id where c.id=$1 and d.discord_user_id='333333333333333333'",[future.campaignId])).n,3);
await db.exec("rollback");
await db.exec(migration);assert.ok((await query(verify)).every(r=>r.status!=="ERROR"));
const genericVerify=await query(await readFile(new URL("guild_dm_campaigns_verify.sql",import.meta.url),"utf8"));
assert.equal(genericVerify.find(r=>Object.values(r).includes("recipient_unique_campaign_discord"))?.status,"OK","the legacy read-only verify recognizes the scoped indexes");
const personalized=buildSurveyTwoDiscordPayload(goals,{recipientId:id(10),discordUserId:"333333333333333333",account:{name:"Principal",guildCode:"G2"}});
assert.match(personalized.content,/Principal.*Imperatores \(G2\)/);assert.equal(personalized.embeds[0].fields.length,7);
assert.equal(describeIntersaisonDeliveryError("HTTP 403 - code 50278").kind,"intervention");
assert.equal(describeIntersaisonDeliveryError("HTTP 503").kind,"temporary");assert.equal(describeIntersaisonDeliveryError("DELIVERY_UNCERTAIN").retry,false);
await assert.rejects(retrySurveyChoiceRecipient({from:()=>{throw Error("must reject non-admin before any query");}},{id:admin,role:"member",guild_code:"G1"},{id:org,organization_key:"paladin"},{confirmed:true}),/admins/);
const forecastBefore={responses:await query("select * from intersaison_survey_responses order by id"),
  recipients:await query("select * from intersaison_survey_recipients order by id"),members:await query("select * from guild_members order by id"),
  placements:await query("select * from intersaison_survey_placements order by id")};
await db.exec(await readFile(new URL("intersaison_survey_forecast_roles.sql",import.meta.url),"utf8"));
for(const [n,role] of [[10,"leader"],[11,"officer"]])await rpc("save_intersaison_survey_forecast_entry",{
  ...context,p_season:season,p_member:id(n),p_guild:null,p_role:role,p_expected_placement_revision:0,p_expected_role_revision:0});
const accountForecast=buildSurveyChoiceForecast({members:forecastBefore.members.filter(m=>m.guild_code!=="MAD G1"),
  recipients:forecastBefore.recipients.filter(r=>r.survey_campaign_id===campaign),responses:forecastBefore.responses,
  roles:await query("select * from intersaison_survey_forecast_roles order by id")});
const rootForecast=accountForecast.players.find(p=>p.memberKey===id(10)),altForecast=accountForecast.players.find(p=>p.memberKey===id(11));
assert.equal(rootForecast.discordUserId,altForecast.discordUserId);assert.equal(rootForecast.forecastRole,"leader");assert.equal(altForecast.forecastRole,"officer");
assert.equal(rootForecast.targetGuild,"G2");assert.equal(altForecast.targetGuild,"G4");
assert.deepEqual(await query("select * from intersaison_survey_responses order by id"),forecastBefore.responses);
assert.deepEqual(await query("select * from intersaison_survey_recipients order by id"),forecastBefore.recipients);
assert.deepEqual(await query("select * from guild_members order by id"),forecastBefore.members);
assert.deepEqual(await query("select * from intersaison_survey_placements order by id"),forecastBefore.placements);
await db.close();
console.log("Account survey tests passed: legacy recovery, principal + secondary + three alts, ambiguity, independent edits, retry bounds, no resend, late account, classic uniqueness, tenant and preservation. No production access or Discord sends.");
