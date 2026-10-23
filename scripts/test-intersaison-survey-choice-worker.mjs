import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { prepareIntersaisonBot } from "./prepare-intersaison-bot.mjs";

if (!process.env.DISCORD_TEST_NODE_MODULES) throw new Error("Set DISCORD_TEST_NODE_MODULES to an isolated discord.js 14.27.0 node_modules path.");
process.env.NODE_PATH=[process.env.DISCORD_TEST_NODE_MODULES,process.env.NODE_PATH].filter(Boolean).join(delimiter);
Module._initPaths();
globalThis.fetch=()=>{throw new Error("Real network is forbidden in worker tests");};
const output=await prepareIntersaisonBot(await mkdtemp(join(tmpdir(),"intersaison-bot-mocked-")));
const dockerfile=await readFile(join(output,"Dockerfile"),"utf8");
assert.match(dockerfile,/^COPY shared \.\/shared$/m,"the runtime image must contain the shared survey helpers");
const require=createRequire(join(output,"package.json"));
const discord=require("discord.js");
const worker=require("./services/guildDmCampaigns.js");
const choice=require("./services/intersaisonChoice.cjs");
const id="10000000-0000-4000-8000-000000000001",user="111111111111111111";
const objectives=Object.fromEntries(Array.from({length:7},(_,i)=>[`G${i+1}`,`Objectif ${i+1}`]));
const campaign={id:"campaign",message:"Message classique",status:"queued",interaction_type:"ack"};
const normal=worker.buildGuildDmPayload(campaign,{id});
assert.equal(normal.components[0].toJSON().components[0].custom_id,`gdmack:${id}`);
assert.equal(normal.components[0].toJSON().components[0].label,"J'ai lu");
assert.equal(worker.buildGuildDmPayload({...campaign,interaction_type:"intersaison_objectives"},{id}).components[0].toJSON().components[0].label,"Donner mon avis");
const choiceCampaign={...campaign,interaction_type:"intersaison_choice",interaction_payload:{objectives,isTest:false}};
const payload=await choice.buildChoicePayload(choiceCampaign,{id,discord_user_id:user,member_name_snapshot:"Compte Alpha",guild_code:"G2"});
assert.match(payload.content,/Compte Alpha.*Imperatores \(G2\)/);
assert.equal(payload.components[0].components[0].label,"Choisir ma guilde");
assert.equal(payload.embeds[0].fields.length,7);
await assert.rejects(choice.buildChoicePayload({...choiceCampaign,interaction_payload:{}},{id,discord_user_id:user}),/Snapshot/);
const calls=[];
const interaction={id:"123456789012345678",customId:`interchoice:${id}:${user}`,user:{id:user},
  isButton:()=>true,isModalSubmit:()=>false,
  showModal:async(data)=>{const serialized=new discord.ModalBuilder(data).toJSON();assert.equal(serialized.components[0].component.type,3);calls.push("modal");},
  reply:async(data)=>calls.push(data.content),
};
await worker.handleGuildDmInteraction(interaction,{supabase:new Proxy({}, {get(){throw new Error("Database before modal forbidden");}})});
assert.deepEqual(calls,["modal"],"real discord.js validates the modal without any pre-modal query");
const denied=[];
await worker.handleGuildDmInteraction({...interaction,user:{id:"222222222222222222"},reply:async(d)=>denied.push(d.content)});
assert.match(denied[0],/destinataire/);
const components=[{type:18,component:{customId:"first_choice",type:3,values:["G2"]}},{type:18,component:{customId:"second_choice",type:3,values:["none"]}},{type:18,component:{customId:"comment_text",type:4,value:""}}];
const submitted=[];
const submit={...interaction,customId:`interchoice_submit:${id}:${user}`,components,isButton:()=>false,isModalSubmit:()=>true,
  deferReply:async()=>submitted.push("defer"),editReply:async(d)=>submitted.push(d.content)};
await worker.handleGuildDmInteraction(submit,{supabase:{rpc:async(name,args)=>{assert.equal(name,"submit_intersaison_survey_choice");assert.equal(args.p_second_choice,"");return {data:{version:1}};}}});
assert.equal(submitted[0],"defer");assert.match(submitted[1],/enregistrés/);
submitted.length=0;
await worker.handleGuildDmInteraction(submit,{supabase:{rpc:async()=>({error:{message:"Ce sondage n’est plus ouvert."}})}});
assert.match(submitted[1],/plus ouvert/);assert.doesNotMatch(submitted[1],/enregistrés/);
submitted.length=0;
await worker.handleGuildDmInteraction(submit,{supabase:{rpc:async()=>({error:{message:"Échec Supabase simulé"}})}});
assert.match(submitted[1],/Échec/);assert.doesNotMatch(submitted[1],/enregistrés/);

// The actual queue implementation is exercised with a fake Discord client and an in-memory query stub.
const state={campaign:{...choiceCampaign},recipient:{id,campaign_id:campaign.id,discord_user_id:user,member_name_snapshot:"Compte Alpha",guild_code:"G2",status:"queued",send_attempts:0,reminder_count:0}};
class Query {
  constructor(table){this.table=table;this.filters=[];this.patch=null;}
  select(){return this;} update(patch){this.patch=patch;return this;} eq(k,v){this.filters.push(r=>r[k]===v);return this;}
  in(k,v){this.filters.push(r=>v.includes(k==="guild_dm_campaigns.status" ? state.campaign.status : r[k]));return this;} order(){return this;} limit(){return this;}
  run(single=false){const source=this.table==="guild_dm_campaigns" ? [state.campaign] : state.recipients || [state.recipient];
    if(this.patch?.status==="sending" && this.table==="guild_dm_recipients" && state.bumpGeneration){state.recipient.reminder_count++;state.bumpGeneration=false;}
    const rows=source.filter(row=>this.filters.every(f=>f(row)));
    if(this.patch?.status==="sending" && this.table==="guild_dm_recipients" && state.confirmClaimError){state.recipient.status="confirmed";state.confirmClaimError=false;return Promise.resolve({data:null,error:{message:"Claim failed after concurrent confirmation"}});}
    if(this.patch?.status==="sending" && rows.some(r=>r.id===state.claimErrorId)) return Promise.resolve({data:null,error:{message:"Account outside campaign organization"}});
    if(this.patch?.status==="sent" && state.failPersist){state.failPersist=false;return Promise.resolve({data:null,error:{message:"mock persistence failure"}});}
    if(this.patch) rows.forEach(r=>Object.assign(r,this.patch));
    const data=rows.map(r=>({...r,...(this.table==="guild_dm_recipients" ? {guild_dm_campaigns:{...state.campaign}} : {})}));
    return Promise.resolve({data:single ? data[0] || null : data,error:null});}
  maybeSingle(){return this.run(true);}single(){return this.run(true);}then(resolve,reject){return this.run().then(resolve,reject);}
}
let sends=0;
const db={from:table=>new Query(table),rpc:async(name,args)=>{
  if(name==="intersaison_choice_delivery_attempts") {
    assert.equal(args.p_dm_recipient,state.recipient.id);assert.equal(args.p_reminder,state.recipient.reminder_count);
    state.budgetCalls=(state.budgetCalls||0)+1;
    return {data:state.waveAttempts||1,error:null};
  }
  if(name==="refresh_intersaison_choice_delivery_counters") {
    assert.equal(args.p_campaign,state.campaign.id);
    const recipients=state.recipients||[state.recipient];
    state.campaign.status=recipients.some(r=>["queued","sending"].includes(r.status))?"sending":recipients.some(r=>r.status==="failed")?"partial":"completed";
    return {data:null,error:null};
  }
  assert.equal(name,"check_intersaison_choice_delivery");assert.ok(args.p_dm_recipient);return {data:true,error:null};
}};
const client={users:{fetch:async(uid)=>{assert.equal(uid,user);return {send:async(data)=>{sends++;assert.equal(data.components[0].components[0].label,"Choisir ma guilde");return {id:"fake-message"};}};}}};
await worker.processGuildDmBatch({client,supabase:db});
await worker.processGuildDmBatch({client,supabase:db});
assert.equal(sends,1,"CAS and persisted sent state avoid duplicate delivery on repeated worker ticks");
assert.equal(state.recipient.status,"sent");assert.equal(state.recipient.send_attempts,1);
state.recipient.status="queued";state.campaign.status="queued";
await worker.processGuildDmBatch({client:{users:{fetch:async()=>({send:async()=>{throw {status:429,retry_after:0.001,message:"mock rate limit"};}})}},supabase:db});
assert.equal(state.recipient.status,"queued","the existing rate-limit retry path is preserved");
assert.equal(state.recipient.send_attempts,2);
state.recipient.status="queued";state.recipient.send_attempts=4;
await worker.processGuildDmBatch({client:{users:{fetch:async()=>({send:async()=>{throw {status:429,retry_after:0.001};}})}},supabase:db});
assert.equal(state.recipient.status,"failed","survey 2 rate-limit retries stop after five attempts");
state.recipient.status="queued";state.recipient.send_attempts=0;
let unauthorizedSends=0;
await worker.processGuildDmBatch({client:{users:{fetch:async()=>{unauthorizedSends++;throw Error("must not fetch user");}}},
  supabase:{...db,rpc:async()=>({error:{message:"Association changed"}})}});
assert.equal(unauthorizedSends,0);assert.equal(state.recipient.status,"failed");
state.recipient.status="queued";state.failPersist=true;
await worker.processGuildDmBatch({client,supabase:db});
assert.equal(state.recipient.status,"failed");assert.match(state.recipient.last_error,/DELIVERY_UNCERTAIN/);
const altId="10000000-0000-4000-8000-000000000002";
state.campaign.status="queued";
state.recipients=[{...state.recipient,status:"queued",sent_at:null,member_name_snapshot:"Compte Alpha"},
  {...state.recipient,id:altId,status:"queued",sent_at:null,member_name_snapshot:"Compte Beta",guild_code:"G5"}];
const messages=[];
const sharedOwner={users:{fetch:async(uid)=>{assert.equal(uid,user);return {send:async(data)=>{messages.push(data);return {id:"mock-"+messages.length};}};}}};
await worker.processGuildDmBatch({client:sharedOwner,supabase:db});
await worker.processGuildDmBatch({client:sharedOwner,supabase:db});
assert.equal(messages.length,2,"two game accounts sharing one Discord owner each receive exactly one mock DM");
assert.match(messages[0].content,/Compte Alpha/);assert.match(messages[1].content,/Compte Beta/);
assert.notEqual(messages[0].components[0].components[0].custom_id,messages[1].components[0].components[0].custom_id);
state.recipients=null;
state.campaign.interaction_type="intersaison_choice";
state.campaign.status="queued";state.recipient.status="queued";
let authorizationCalls=0,lateSends=0;
const responseDuringLookup={users:{fetch:async()=>{
  state.recipient.status="confirmed";state.recipient.confirmed_at="2026-10-23T12:00:00Z";
  return {send:async()=>{lateSends++;return {id:"must-not-send"};}};
}}};
await worker.processGuildDmBatch({client:responseDuringLookup,supabase:{...db,rpc:async(name,args)=>{
  if(name==="refresh_intersaison_choice_delivery_counters") return db.rpc(name,args);
  authorizationCalls++;return {data:state.recipient.status==="sending",error:null};
}}});
assert.equal(authorizationCalls,2,"delivery is authorized again after the slow Discord lookup");
assert.equal(lateSends,0,"a response received during preparation suppresses the reminder");
assert.equal(state.recipient.status,"confirmed","failed authorization cannot downgrade a response");
state.campaign.status="queued";state.recipient.status="queued";
const confirmsWhileSending={users:{fetch:async()=>({send:async()=>{
  state.recipient.status="confirmed";return {id:"accepted-before-answer-arrived"};
}})}};
await worker.processGuildDmBatch({client:confirmsWhileSending,supabase:db});
assert.equal(state.recipient.status,"confirmed","a response arriving during the outgoing request stays confirmed");
assert.equal(state.recipient.discord_message_id,"accepted-before-answer-arrived","delivery metadata is still recorded");
state.campaign.status="queued";state.recipient.status="queued";
const closesWhileSending={users:{fetch:async()=>({send:async()=>{
  state.recipient.status="cancelled";return {id:"accepted-during-closure"};
}})}};
await worker.processGuildDmBatch({client:closesWhileSending,supabase:db});
assert.equal(state.recipient.status,"cancelled","campaign closure is not undone by the delivery result");
assert.equal(state.recipient.discord_message_id,"accepted-during-closure","an accepted message is recorded even during closure");
state.campaign.status="queued";state.recipient.status="queued";state.recipient.send_attempts=0;
await worker.processGuildDmBatch({client:{users:{fetch:async()=>({send:async()=>{
  state.recipient.status="confirmed";throw {status:429,retry_after:0.001};
}})}},supabase:db});
assert.equal(state.recipient.status,"confirmed","rate-limit retries never requeue a player who has answered");
state.campaign.status="queued";state.recipient.status="queued";
let permanentSends=0;
const permanentFailure={users:{fetch:async()=>({send:async()=>{permanentSends++;throw {status:403,code:50007,message:"Cannot send messages to this user"};}})}};
await worker.processGuildDmBatch({client:permanentFailure,supabase:db});
await worker.processGuildDmBatch({client:permanentFailure,supabase:db});
assert.equal(permanentSends,1,"permanent failures are not automatically retried");
assert.equal(state.recipient.status,"failed");
state.campaign.status="queued";state.recipient.status="queued";state.recipient.reminder_count=1;state.bumpGeneration=true;
let staleSends=0;
await worker.processGuildDmBatch({client:{users:{fetch:async()=>({send:async()=>{staleSends++;return {id:"stale"};}})}},supabase:db});
assert.equal(staleSends,0,"a stale worker snapshot cannot claim a different reminder generation");
assert.equal(state.recipient.status,"queued");assert.equal(state.recipient.reminder_count,2);
state.campaign.status="queued";state.recipient.status="queued";
state.recipients=[{...state.recipient,id,status:"queued"},{...state.recipient,id:altId,status:"queued"}];
state.claimErrorId=id;
let validAfterFailure=0;
await worker.processGuildDmBatch({client:{users:{fetch:async()=>({send:async()=>{validAfterFailure++;return {id:"valid-account"};}})}},supabase:db});
assert.equal(validAfterFailure,1,"an invalid account does not interrupt delivery of the other accounts");
assert.equal(state.recipients[0].status,"failed");assert.equal(state.recipients[1].status,"sent");
state.claimErrorId=null;state.recipients=null;
state.campaign.status="queued";state.recipient.status="queued";
let concurrentSends=0;
const concurrentClient={users:{fetch:async()=>({send:async()=>{concurrentSends++;return {id:"concurrent"};}})}};
await Promise.all([worker.processGuildDmBatch({client:concurrentClient,supabase:db}),worker.processGuildDmBatch({client:concurrentClient,supabase:db})]);
assert.equal(concurrentSends,1,"overlapping worker batches still claim a queued account only once");
state.campaign.status="queued";state.recipient.status="queued";state.recipient.send_attempts=20;state.recipient.reminder_count=6;state.waveAttempts=1;
const reminderRateLimit={users:{fetch:async()=>({send:async()=>{throw {status:429,retry_after:0.001};}})}};
await worker.processGuildDmBatch({client:reminderRateLimit,supabase:db});
assert.equal(state.recipient.status,"queued","successful previous waves do not exhaust the new wave retry budget");
assert.equal(state.recipient.send_attempts,21,"cumulative delivery history is not reset");
state.waveAttempts=5;
await worker.processGuildDmBatch({client:reminderRateLimit,supabase:db});
assert.equal(state.recipient.status,"failed","each reminder wave still stops after five attempts");
assert.equal(state.budgetCalls,2);
for(const [type,label] of [["ack","J'ai lu"],["intersaison_objectives","Donner mon avis"]]) {
  state.campaign.interaction_type=type;state.campaign.status="queued";state.recipient.status="queued";
  let legacySends=0;
  await worker.processGuildDmBatch({supabase:{...db,rpc:()=>{throw Error("Account RPC must not affect legacy campaigns");}},
    client:{users:{fetch:async()=>({send:async(data)=>{legacySends++;assert.equal(data.components[0].toJSON().components[0].label,label);return {id:"legacy-mock"};}})}}});
  assert.equal(legacySends,1);
  state.campaign.status="queued";state.recipient.status="queued";state.confirmClaimError=true;
  await worker.processGuildDmBatch({supabase:{...db,rpc:()=>{throw Error("No choice RPC for a legacy claim failure");}},
    client:{users:{fetch:async()=>{throw Error("A failed claim must never fetch the Discord user");}}}});
  assert.equal(state.recipient.status,"confirmed",`${type} claim failure preserves a concurrent confirmation`);
}
console.log(`Bot worker tests passed with discord.js ${discord.version}: ack, survey 1, survey 2, modal, security, save errors, CAS, rate limits. All sends mocked.`);
