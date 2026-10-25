import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { projectForecastPlan, runForecastPlanAction } from "../api/_intersaison-plan.js";
import { buildRosterPublication } from "../src/lib/intersaisonPlanPublication.js";
import { buildSurveyTwoDiscordPayload } from "../src/lib/intersaisonSurveyObjectives.js";
import { buildSurveyChoiceModal, getSurveyChoiceGuildsFromMessage } from "../src/lib/intersaisonSurveyChoices.js";

if (!process.env.PGLITE_MODULE_PATH) throw new Error("PGLITE_MODULE_PATH required (isolated PostgreSQL only).");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href);
const db = new PGlite();
const id = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const org=id(100), other=id(101), season=id(200), actor=id(1);
const context={p_org:org,p_actor:actor,p_season:season};
const rows = async (sql,params=[]) => (await db.query(sql,params)).rows;
const scalar = async (sql,params=[]) => (await rows(sql,params))[0];
const rpc = async (name,args) => (await scalar(`select public.${name}(${Object.keys(args).map((key,i)=>`${key} => $${i+1}`).join(",")}) as result`,
  Object.values(args).map(value=>typeof value==="object" && value!==null ? JSON.stringify(value) : value))).result;
const script = async (name) => (await readFile(new URL(name,import.meta.url),"utf8")).replace(/create extension if not exists pgcrypto;/gi,"");
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create table portal_organizations(id uuid primary key,organization_key text,is_active boolean default true);
    create table portal_guilds(id uuid primary key default gen_random_uuid(),organization_id uuid references portal_organizations(id),guild_code text unique,display_name text not null,is_active boolean default true,unique(organization_id,guild_code));
    create table guild_members(id uuid primary key,watcher_name text,role text,guild_code text,discord_id text,primary_member_id uuid,
      roster_status text default 'active',community_access_type text,community_status text,assignment text,status text,password_hash text,
      pb jsonb default '{"score":123}',heroes jsonb default '{"Elowyn":5}');
    create table intersaison_assignments(id uuid primary key,organization_id uuid,member_id uuid);
    insert into portal_organizations values('${org}','paladin',true),('${other}','mad',true);
    insert into portal_guilds(organization_id,guild_code,display_name) select '${org}','G'||n,'Nom '||n from generate_series(1,7)n;
    insert into portal_guilds(organization_id,guild_code,display_name) values('${other}','MAD G1','MAD');
    insert into guild_members(id,watcher_name,role,guild_code,discord_id,password_hash) values
      ('${actor}','Admin','admin','G1','111111111111111111','PRIVATE_HASH'),
      ('${id(2)}','Premier compte','member','G2','222222222222222222','PRIVATE_HASH'),
      ('${id(3)}','Sans réponse','member','G3','333333333333333333','PRIVATE_HASH'),
      ('${id(4)}','Répondant','member','G4','444444444444444444','PRIVATE_HASH'),
      ('${id(5)}','Compte secondaire','member','G5','222222222222222222','PRIVATE_HASH'),
      ('${id(6)}','MAD admin','admin','MAD G1','666666666666666666','PRIVATE_HASH');
    insert into guild_members(id,watcher_name,role,guild_code,community_access_type,roster_status) values
      ('${id(7)}','Ancien Paladin','community_member',null,'community','inactive'),
      ('${id(8)}','Communauté MAD','community_member',null,'community','inactive'),
      ('${id(9)}','Communauté inconnue','community_member',null,'community','inactive');
    insert into intersaison_assignments values('${id(901)}','${org}','${id(7)}'),('${id(902)}','${other}','${id(8)}');
  `);
  await db.query("update guild_members set primary_member_id=$1 where id=$2",[id(2),id(5)]);
  for (const file of ["guild_dm_campaigns.sql","guild_dm_campaigns_test_mode.sql","guild_dm_campaigns_lifecycle.sql",
    "intersaison_surveys.sql","intersaison_surveys_test_mode.sql","intersaison_survey_objectives.sql",
    "intersaison_survey_choices.sql","intersaison_survey_forecast_roles.sql"]) await db.exec(await script(file));
  const objectives=Object.fromEntries(Array.from({length:7},(_,i)=>[`G${i+1}`,`Objectif ${i+1}`]));
  await db.query("insert into intersaison_survey_seasons(id,organization_id,status) values($1,$2,'survey2_open')",[season,org]);
  await db.query("insert into intersaison_survey_campaigns(id,season_id,organization_id,poll_number,status,title,message,objective_snapshot) values($1,$2,$3,2,'open','Sondage 2','Original immuable',$4)",[id(300),season,org,JSON.stringify(objectives)]);
  await db.query("insert into intersaison_survey_recipients(id,survey_campaign_id,organization_id,member_id,member_key,guild_code_snapshot,member_name_snapshot,response_status) values($1,$2,$3,$4,$4,'G4','Répondant','responded')",[id(301),id(300),org,id(4)]);
  await db.query("insert into intersaison_survey_responses(id,survey_campaign_id,survey_recipient_id,organization_id,member_id,poll_number,guild_code_snapshot,member_name_snapshot,first_choice_guild_code,second_choice_guild_code,comment_text) values($1,$2,$3,$4,$5,2,'G4','Répondant','G2','G3','Texte intégral conservé')",[id(302),id(300),id(301),org,id(4)]);
  for (const file of ["intersaison_survey_accounts.sql","intersaison_survey_reminders.sql"]) await db.exec(await script(file));
  const beforeMembers=await rows("select * from guild_members order by id");
  const beforeResponses=await rows("select * from intersaison_survey_responses order by id");
  const beforeRecipients=await rows("select * from intersaison_survey_recipients order by id");
  const beforeCampaigns=await rows("select * from intersaison_survey_campaigns order by id");
  const preflight=(await db.exec(await script("intersaison_plan_cycle_preflight.sql")))[0].rows[0].intersaison_plan_preflight;
  assert.equal(preflight.all_checks_ok,true);
  assert.equal(preflight.checks.length,30);
  assert.ok(preflight.checks.every(row=>row.status==='OK'));
  assert.equal(preflight.fingerprints.length,4);
  assert.equal(preflight.survey_two[0].survey_2_status,'open');
  const migration=await script("intersaison_plan_cycle_install.sql");
  await db.exec(migration.replace(/^commit;$/m,"rollback;"));
  assert.equal((await scalar("select to_regclass('public.intersaison_plan_cycles') as name")).name,null,"SQL rehearsal rolls back schema and data");
  assert.deepEqual(await rows("select * from guild_members order by id"),beforeMembers);
  await db.exec(migration);
  const installation=(await db.exec(await script("intersaison_plan_cycle_verify.sql")))[0].rows[0].intersaison_plan_verify;
  assert.equal(installation.all_checks_ok,true);
  assert.equal(installation.checks.length,24);
  assert.deepEqual(installation.activity,{applications:0,new_bank_versions:0,plan_events:0});
  assert.deepEqual(installation.fingerprints,preflight.fingerprints,"install changes no original member, placement, recipient or response row");
  await db.exec(await script("intersaison_plan_dynamic_guilds.sql"));
  await assert.rejects(db.query("insert into portal_guilds(organization_id,guild_code,display_name) values($1,'G8','Foreign')",[other]),/réservé/);
  assert.deepEqual(await rows("select * from guild_members order by id"),beforeMembers,"installation changes no member");
  assert.deepEqual(await rows("select * from intersaison_survey_responses order by id"),beforeResponses);
  assert.equal((await scalar("select count(*)::int n from intersaison_plan_applications")).n,0);
  assert.equal((await scalar("select count(*)::int n from intersaison_plan_objective_bank")).n,0);
  let bundle=await rpc("read_intersaison_plan",context);
  assert.ok(!JSON.stringify(bundle).includes("PRIVATE_HASH"),"no credential leaves the SQL helper");
  assert.equal(bundle.members.length,6,"five active Paladin accounts plus one proven community account");
  assert.equal(projectForecastPlan(bundle).forecast.players.length,5,"community dropdown is not automatically part of the plan");
  await assert.rejects(rpc("read_intersaison_plan",{...context,p_actor:id(6)}),/hors organisation/);
  await assert.rejects(rpc("read_intersaison_plan",{...context,p_actor:id(2)}),/hors organisation/);
  await db.exec("set role anon");
  await assert.rejects(rpc("read_intersaison_plan",context),/permission denied/);
  await db.exec("reset role");
  const save=async(kind,data,revision=null)=>{
    const plan=(await rpc("read_intersaison_plan",context)).plan;
    return rpc("save_intersaison_plan",{...context,p_revision:revision ?? plan.revision,p_kind:kind,p_data:data});
  };
  await save("guild",{name:"Huitième",objective:"Nouveaux objectifs"});
  await save("guild",{name:"Neuvième",objective:"Autres objectifs"});
  assert.equal((await scalar("select count(*)::int n from portal_guilds where organization_id=$1",[org])).n,7,"draft guilds are not active guilds");
  await assert.rejects(save("guild",{name:"Périmé",objective:"Non"},1),/Actualise/);
  await save("member",{memberId:actor,guildCode:"G1"});
  await save("member",{memberId:id(2),guildCode:"G8"});
  await save("member",{memberId:id(5),guildCode:"G9"});
  await save("member",{memberId:id(2),guildCode:"G9"});
  await save("member",{memberId:id(2),guildCode:"G8"});
  const history=projectForecastPlan(await rpc("read_intersaison_plan",context)).forecast.players.find(p=>p.memberKey===id(2));
  assert.equal(history.manualHistory.length,3,"every administrative placement is retained");
  await assert.rejects(save("member",{memberId:id(8),guildCode:"G8"}),/hors du périmètre/);
  await assert.rejects(save("member",{memberId:id(9),guildCode:"G8"}),/hors du périmètre/);
  await assert.rejects(save("member",{memberId:id(6),guildCode:"G8"}),/hors du périmètre/);
  let preview=await rpc("preview_intersaison_plan",context);
  assert.equal(preview.canApply,false,"open surveys cannot be transferred");
  await db.query("update intersaison_survey_campaigns set status='closed' where id=$1",[id(300)]);
  preview=await rpc("preview_intersaison_plan",context);
  assert.equal(preview.canApply,true,JSON.stringify(preview.blockers));
  assert.equal(preview.creations.length,2);
  assert.equal(preview.changes.length,4);
  await db.exec("begin");
  await db.exec(`insert into guild_members(id,watcher_name,role,guild_code) select gen_random_uuid(),'Overflow','member','G1' from generate_series(1,31);
    update intersaison_plan_cycles set entries=entries||(select jsonb_object_agg(id::text,jsonb_build_object('guildCode','G1')) from guild_members where watcher_name='Overflow') where season_id='${season}';`);
  assert.equal((await rpc("preview_intersaison_plan",context)).canApply,false,"capacity overflow blocks the whole operation");
  await db.exec("rollback");
  await db.exec("begin");
  await db.query("update intersaison_plan_cycles set guilds=jsonb_set(guilds,'{G1,existingId}',to_jsonb($1::text)) where season_id=$2",[id(9999),season]);
  assert.equal((await rpc("preview_intersaison_plan",context)).canApply,false,"an unavailable real guild cannot receive orphaned member assignments");
  await db.exec("rollback");
  const apply=async(p=preview,request=id(500))=>rpc("apply_intersaison_plan",{...context,p_fingerprint:p.fingerprint,p_request:request,p_confirmed:true});
  await db.query("update guild_members set watcher_name='Pseudo renommé' where id=$1",[id(2)]);
  await assert.rejects(apply(),/Prévisualisation périmée/);
  preview=await rpc("preview_intersaison_plan",context);
  // A simulated failure must roll back guild creation and all earlier member updates.
  await db.exec(`create function fail_plan_update() returns trigger language plpgsql as $$ begin if new.id='${id(5)}' then raise exception 'simulated failure'; end if; return new; end $$;
    create trigger fail_plan_update before update on guild_members for each row execute function fail_plan_update();`);
  const prior=await rows("select * from guild_members order by id");
  await assert.rejects(apply(),/simulated failure/);
  assert.deepEqual(await rows("select * from guild_members order by id"),prior);
  assert.equal((await scalar("select count(*)::int n from portal_guilds where organization_id=$1",[org])).n,7);
  await db.exec("drop trigger fail_plan_update on guild_members;drop function fail_plan_update();");
  const result=await apply();
  assert.equal(result.createdGuilds,2);assert.equal(result.transferred,3);assert.equal(result.community,1);
  assert.equal((await apply()).alreadyApplied,true,"same request is idempotent");
  assert.equal((await scalar("select guild_code from guild_members where id=$1",[id(2)])).guild_code,"G8");
  assert.equal((await scalar("select guild_code from guild_members where id=$1",[id(5)])).guild_code,"G9","secondary account has its own target");
  assert.equal((await scalar("select role from guild_members where id=$1",[id(3)])).role,"community_member");
  preview=await rpc("preview_intersaison_plan",context);
  assert.equal(preview.changes.length,0);assert.equal(preview.creations.length,0);
  assert.equal((await apply(preview,id(501))).transferred,0,"a new confirmation does not replay transfers");
  await save("member",{memberId:id(3),guildCode:"G8"});
  await save("member",{memberId:id(7),guildCode:"G9"});
  preview=await rpc("preview_intersaison_plan",context);
  assert.equal(preview.changes.length,2,"only two community reintegrations");
  await apply(preview,id(502));
  assert.equal((await scalar("select role from guild_members where id=$1",[id(3)])).role,"member","no admin privilege granted during reactivation");
  bundle=await rpc("read_intersaison_plan",context);
  const projected=projectForecastPlan(bundle);
  const effective=(await rows("select member_id,target_guild from intersaison_plan_targets($1,$2)",[org,season]));
  assert.deepEqual(Object.fromEntries(projected.forecast.players.map(p=>[p.memberKey,p.targetGuild || null])),Object.fromEntries(effective.map(p=>[p.member_id,p.target_guild])),"UI and transactional targets agree");
  const publications=buildRosterPublication(projected.forecast,bundle.plan.revision);
  assert.equal(publications.length,9);
  assert.ok(!JSON.stringify(publications).includes("discord"));assert.ok(!JSON.stringify(publications).includes("Texte intégral"));
  assert.deepEqual(await rows("select * from intersaison_survey_responses order by id"),beforeResponses,"answers untouched through every application");
  assert.deepEqual(await rows("select * from intersaison_survey_recipients order by id"),beforeRecipients);
  assert.deepEqual(await rows("select id,pb,heroes,password_hash from guild_members order by id"),beforeMembers.map(({id,pb,heroes,password_hash})=>({id,pb,heroes,password_hash})),"permanent data and credentials intact");
  assert.deepEqual((await rows("select * from guild_members where id=$1",[id(6)]))[0],beforeMembers.find(m=>m.id===id(6)),"foreign organization intact");
  preview=await rpc("preview_intersaison_plan",context);
  await rpc("close_intersaison_plan",{...context,p_fingerprint:preview.fingerprint,p_confirmed:true});
  await assert.rejects(save("guild",{name:"Trop tard",objective:"Non"}),/clôturée/);
  const next=await rpc("prepare_next_intersaison_plan",{...context,p_confirmed:true});
  await assert.rejects(rpc("prepare_next_intersaison_plan",{...context,p_confirmed:true}),/existe déjà/);
  const newBundle=await rpc("read_intersaison_plan",{...context,p_season:next});
  assert.deepEqual(newBundle.responses,[]);assert.deepEqual(newBundle.recipients,[]);assert.deepEqual(newBundle.plan.entries,{});
  assert.equal(Object.keys(newBundle.plan.reference_objectives).length,9,"all final objectives become next cycle reference");
  assert.equal((await scalar("select count(*)::int n from guild_dm_campaigns")).n,0,"no campaign, DM or recipient created by lifecycle");
  assert.equal((await scalar("select count(*)::int n from intersaison_survey_campaigns")).n,beforeCampaigns.length);
  await db.exec(migration); // installation is idempotent, with populated plans and bank
  await db.exec(await script("intersaison_plan_dynamic_guilds.sql"));
  const verify=(await db.exec(await script("intersaison_plan_cycle_verify.sql")))[0].rows[0].intersaison_plan_verify.checks;
  assert.ok(verify.every(r=>r.status==='OK'),JSON.stringify(verify));
  // Backend does not forward client-supplied actor/tenant/active-guild IDs.
  let forwarded;
  const mock={rpc:async(name,args)=>{forwarded={name,args};return {data:null,error:null};}};
  await runForecastPlanAction(mock,{id:actor},{id:org},"save-forecast-guild",{seasonId:season,expectedPlanRevision:1,name:"Nom",objective:"Objectif",organizationId:other,actorId:id(6),existingId:id(8)});
  // Last call is a read; independently assert whitelisting through an action recorder.
  const calls=[];mock.rpc=async(name,args)=>{calls.push({name,args});return {data:null,error:null};};
  await runForecastPlanAction(mock,{id:actor},{id:org},"save-forecast-guild",{seasonId:season,expectedPlanRevision:1,name:"Nom",objective:"Objectif",organizationId:other,actorId:id(6),existingId:id(8)});
  assert.equal(calls[0].args.p_org,org);assert.equal(calls[0].args.p_actor,actor);assert.equal(calls[0].args.p_data.existingId,undefined);
  assert.equal(forwarded.name,"read_intersaison_plan");
  // Exercise the following season with nine real guilds, using only the isolated database.
  const nine=Object.fromEntries(Array.from({length:9},(_,i)=>[`G${i+1}`,`Objectif officiel ${i+1}`]));
  const version=await rpc("save_intersaison_survey_objectives_draft",{p_organization_id:org,p_season_id:next,p_actor_member_id:actor,p_objectives:nine,p_expected_version:0});
  await rpc("validate_intersaison_survey_objectives_draft",{p_organization_id:org,p_season_id:next,p_actor_member_id:actor,p_version_id:version});
  await db.query("insert into intersaison_survey_campaigns(season_id,organization_id,poll_number,status,title,message,target_guild_codes) values($1,$2,1,'closed','Sondage 1','Simulation',public.intersaison_active_guild_codes($2))",[next,org]);
  const nextContext={...context,p_season:next};
  const launchPreview=await rpc("preview_intersaison_survey_two",nextContext);
  assert.equal(launchPreview.canLaunch,true,JSON.stringify(launchPreview));
  const launched=await rpc("launch_intersaison_survey_two",{...nextContext,p_version:version,p_fingerprint:launchPreview.rosterFingerprint,p_is_test:false});
  const launchedCampaign=await scalar("select * from intersaison_survey_campaigns where id=$1",[launched.campaignId]);
  assert.equal(launchedCampaign.target_guild_codes.length,9);
  assert.equal(Object.keys(launchedCampaign.guild_names).length,9);
  const newPlan=await rpc("read_intersaison_plan",nextContext);
  assert.equal(newPlan.plan.guilds.G9.objective,nine.G9,"official objectives are reflected in the new plan");
  const personal=await scalar("select * from guild_dm_recipients where campaign_id=$1 and member_id=$2",[launchedCampaign.guild_dm_campaign_id,actor]);
  const content=buildSurveyTwoDiscordPayload(nine,{guildCodes:Object.keys(nine),guildNames:launchedCampaign.guild_names,recipientId:personal.id,discordUserId:personal.discord_user_id});
  const modal=buildSurveyChoiceModal(`interchoice:${personal.id}:${personal.discord_user_id}`,personal.discord_user_id,getSurveyChoiceGuildsFromMessage(content));
  assert.equal(modal.data.components[0].component.options.length,9);
  assert.equal(modal.data.components[1].component.options.length,10);
  const submit={p_dm_recipient_id:personal.id,p_discord_user_id:personal.discord_user_id,p_interaction_id:'777777777777777777',p_first_choice:'G8',p_second_choice:'G9',p_comment:'Réponse intégrale, indépendante et préservée.'};
  await rpc("submit_intersaison_survey_choice",submit);
  await assert.rejects(rpc("submit_intersaison_survey_choice",{...submit,p_interaction_id:'888888888888888888',p_first_choice:'G10'}),/absent des objectifs/);
  assert.equal((await rpc("preview_intersaison_plan",nextContext)).canApply,false,"new responses continue while roster application stays blocked");
  const shared=await rows("select * from guild_dm_recipients where campaign_id=$1 and member_id=any($2::uuid[])",[launchedCampaign.guild_dm_campaign_id,[id(2),id(5)]]);
  assert.equal(shared.length,2,"verified secondary accounts retain independent messages with the same Discord ID");
  await assert.rejects(db.query("insert into intersaison_survey_placements(organization_id,season_id,member_key,member_id,member_name_snapshot,action,guild_code,revision,actor_member_id,actor_name) values($1,$2,$3,$3,'Admin','set','G1',1,$3,'Admin')",[org,season,actor]),/versionné/);
  assert.deepEqual(await rows("select * from intersaison_survey_responses where survey_campaign_id=$1 order by id",[id(300)]),beforeResponses,"previous survey answers remain byte-for-byte unchanged");
  console.log("Plan lifecycle SQL/API: install safety, 9 guilds, repeated applications, idempotency, rollback, late/community accounts, alts, stale previews, permissions, frozen answers, objective memory and publication privacy passed. Zero production access.");
} finally { await db.close(); }
