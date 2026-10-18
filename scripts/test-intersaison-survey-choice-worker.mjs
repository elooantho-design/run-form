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
  in(k,v){this.filters.push(r=>v.includes(r[k]));return this;} order(){return this;} limit(){return this;}
  run(single=false){const source=this.table==="guild_dm_campaigns" ? [state.campaign] : state.recipients || [state.recipient];
    const rows=source.filter(row=>this.filters.every(f=>f(row)));
    if(this.patch?.status==="sent" && state.failPersist){state.failPersist=false;return Promise.resolve({data:null,error:{message:"mock persistence failure"}});}
    if(this.patch) rows.forEach(r=>Object.assign(r,this.patch));
    const data=rows.map(r=>({...r,...(this.table==="guild_dm_recipients" ? {guild_dm_campaigns:{...state.campaign}} : {})}));
    return Promise.resolve({data:single ? data[0] || null : data,error:null});}
  maybeSingle(){return this.run(true);}single(){return this.run(true);}then(resolve,reject){return this.run().then(resolve,reject);}
}
let sends=0;
const db={from:table=>new Query(table),rpc:async(name,args)=>{assert.equal(name,"check_intersaison_choice_delivery");assert.ok(args.p_dm_recipient);return {data:true,error:null};}};
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
for(const [type,label] of [["ack","J'ai lu"],["intersaison_objectives","Donner mon avis"]]) {
  state.campaign.interaction_type=type;state.campaign.status="queued";state.recipient.status="queued";
  let legacySends=0;
  await worker.processGuildDmBatch({supabase:{...db,rpc:()=>{throw Error("Account RPC must not affect legacy campaigns");}},
    client:{users:{fetch:async()=>({send:async(data)=>{legacySends++;assert.equal(data.components[0].toJSON().components[0].label,label);return {id:"legacy-mock"};}})}}});
  assert.equal(legacySends,1);
}
console.log(`Bot worker tests passed with discord.js ${discord.version}: ack, survey 1, survey 2, modal, security, save errors, CAS, rate limits. All sends mocked.`);
