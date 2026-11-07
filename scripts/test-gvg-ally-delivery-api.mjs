import assert from "node:assert/strict";
process.env.SUPABASE_URL = "https://ally-fixture.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "isolated-fixture-not-a-secret";
process.env.DISCORD_BOT_TOKEN = "isolated-fixture-not-a-secret";
globalThis.fetch = () => { throw Error("Real network forbidden"); };
const { createGvgAllyFollowupHandler } = await import("../api/gvg-ally-followup.js");
const { sendAllyThreadMessage, attachAllyDeliveries, deliveryMessage } = await import("../api/_gvg-ally-delivery.js");
const id = n => `b8140000-0000-4000-8000-${String(n).padStart(12,"0")}`;
let assertions = 0;
const equal = (a,b,m) => { assert.deepEqual(a,b,m); assertions++; };
const org=id(1),gid=id(2),actor=id(3),owner=id(4),d1=id(5),d2=id(6);
const heroes = ["A","B","C","D","E"].map((champion,n)=>({champion,position:`B${n+1}`,direction:"E"}));
const thread="https://discord.com/channels/111111111111111111/222222222222222222";
const data={delivery_version:1,delivery_enabled:true,snapshot_version:"a".repeat(32),roster_version:"b".repeat(32),
  defenses:[d1,d2].map((id,n)=>({id,guild:"G2",is_ally:true,type:"tower",bastion:1,tower:1,team:n+1,heroes,youtube_url:"https://youtu.be/aaaaaaaaaaa"})),
  members:[{id:owner,watcher_name:"Ais",assignment:"B1 Tour 1",personal_forum_post_url:thread}],
  states:[d1,d2].map(defense_id=>({defense_id,opened:true,owner_member_id:owner,owner_confirmed:true,revision:1})),provisional_member_ids:[],deliveries:[]};
let sends=0,claims=0,auth=true,token=true,installed=true,outcome="sent",finishFails=false;
const db={async rpc(name,args){
  if(name==="read_gvg_ally_delivery")return installed?{data:structuredClone(data)}:{error:{code:"PGRST202"}};
  if(name==="read_gvg_ally_followup")return {data:structuredClone({...data,delivery_version:undefined,delivery_enabled:false})};
  if(name==="claim_gvg_ally_delivery"){
    claims++;equal(args.p_actor_member_id,actor);equal(args.p_payload.owner_member_id,owner);
    const old=data.deliveries.find(r=>r.defense_id===args.p_defense_id);
    if(old&&old.status!=="failed")return {data:{claimed:false,status:old.status}};
    data.deliveries=data.deliveries.filter(r=>r!==old);
    data.deliveries.push({defense_id:args.p_defense_id,status:"sending",id:args.p_receipt_id,claim_token:args.p_claim_token});
    return {data:{claimed:true,receipt_id:args.p_receipt_id,claim_token:args.p_claim_token,payload:args.p_payload}};
  }
  if(name==="finish_gvg_ally_delivery"){
    if(finishFails)return {error:{code:"XX000",message:"fixture storage unavailable"}};
    const r=data.deliveries.find(r=>r.id===args.p_receipt_id&&r.claim_token===args.p_claim_token);
    r.status=args.p_status;r.error_reason=args.p_error;return {data:{status:r.status}};
  }
  throw Error("Unexpected RPC "+name);
}};
const handler=createGvgAllyFollowupHandler({db,requireSession:async()=>auth?{member:{id:actor}}:{error:"Admin requis",status:403},
  resolveScope:async()=>({canUseGvg:true,isPaladin:true,guildCode:"G2",role:"admin"}),
  loadCatalog:async()=>({organizationId:org,guilds:[{id:gid,guild_code:"G2",organization_id:org}]}),
  loadHistory:async()=>({historicalRuns:[],history_warnings:[]}),deliveryConfigured:()=>token,
  send:async payload=>{sends++;equal(payload.thread_url,thread);if(outcome!=="sent")throw Object.assign(Error("Isolated rejection"),{uncertain:outcome==="uncertain"});return "333333333333333333";},
});
async function call(action="preview",extra={}){
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},getHeader(k){return this.headers[k];},status(code){this.statusCode=code;return this;},json(data){this.data=data;return this;},end(text){if(text)this.data=JSON.parse(text);return this;}};
  await handler({method:"POST",body:{guild:"G2",action,...extra},headers:{origin:"https://run-form-tau.vercel.app",host:"run-form-tau.vercel.app"}},res);return res;
}
const body=async(defense_id=d1)=>{const p=(await call()).data;return {defense_id,confirm:true,snapshot_version:p.snapshot_version,message_version:p.preview.rows.find(r=>r.defense_id===defense_id).message_version};};
equal((await call()).data.preview.ready,2);equal(sends,0,"Preview never sends");
let request=await body();auth=false;equal((await call("send",request)).statusCode,403);equal(claims,0);auth=true;
token=false;equal((await call("send",request)).statusCode,428);token=true;
equal((await call("send",{...request,confirm:false})).statusCode,400);
equal((await call("send",{...request,snapshot_version:"c".repeat(32)})).statusCode,409);
equal((await call("send",{...request,message_version:"spoofed"})).statusCode,409);equal(sends,0);
const parallel=await Promise.all([call("send",request),call("send",request)]);
equal(sends,1,"Parallel API calls can produce only one Discord POST");
equal(parallel.every(r=>r.statusCode===200||r.statusCode===409),true);
equal((await call()).data.sent,1);equal((await call()).data.preview.ready,1);
equal((await call("send",await body(d1))).statusCode,409);equal(sends,1);
outcome="failed";let sent=await call("send",await body(d2));equal(sent.data.delivery_result.status,"failed");equal(sent.data.preview.ready,1);
outcome="uncertain";sent=await call("send",await body(d2));equal(sent.data.delivery_result.status,"uncertain");equal(sent.data.preview.ready,0);
equal((await call("send",await body(d2))).statusCode,409);
data.deliveries=[];finishFails=true;outcome="sent";sent=await call("send",await body());equal(sent.data.delivery_result.status,"uncertain");
equal(sent.data.deliveries[0].status,"sending");equal((await call("send",await body())).statusCode,409);finishFails=false;
installed=false;equal((await call()).data.delivery_enabled,false);equal((await call("send",request)).statusCode,428);installed=true;

let requests=[];
const payload={thread_url:thread,content:"Test @everyone without mentions"};
const transport=async(_url,options)=>{requests.push({url:_url,...options});return {ok:true,status:200,json:async()=>options.method==="GET"?
  {id:"222222222222222222",guild_id:"111111111111111111",type:11}:{id:"333333333333333333",channel_id:"222222222222222222"}};};
equal(await sendAllyThreadMessage(payload,id(800),{fetchImpl:transport}),"333333333333333333");
equal(requests.map(r=>r.method),["GET","POST"]);equal(JSON.parse(requests[1].body).allowed_mentions,{parse:[]});
equal(JSON.parse(requests[1].body).enforce_nonce,true);equal(JSON.parse(requests[1].body).nonce.length,25);
for(const status of [403,404,429,500]){
  let posts=0;
  await assert.rejects(()=>sendAllyThreadMessage(payload,id(801),{fetchImpl:async(url,o)=>{
    if(o.method==="GET")return transport(url,o);posts++;return {ok:false,status,json:async()=>({message:"Do not leak this body"})};
  }}),error=>error.uncertain===(status>=500)&&!error.message.includes("leak")); assertions++;equal(posts,1,"Never retry a Discord POST automatically");
}
await assert.rejects(()=>sendAllyThreadMessage(payload,id(802),{fetchImpl:async(url,o)=>{if(o.method==="GET")return transport(url,o);throw Error("connection lost");}}),e=>e.uncertain===true);assertions++;
for(const channel of [{id:"222222222222222222",guild_id:"999999999999999999",type:11},{id:"222222222222222222",guild_id:"111111111111111111",type:0}]){
  let count=0;await assert.rejects(()=>sendAllyThreadMessage(payload,id(803),{fetchImpl:async()=>{count++;return {ok:true,json:async()=>channel};}}),e=>e.uncertain===false);assertions++;equal(count,1,"Invalid space cannot receive a POST");
}
const row={defense_id:d1,ready:true,opened:true,owner:data.members[0],label:"B1 Tour 1",video:{source:"own",url:"https://youtu.be/aaaaaaaaaaa"},history:Array.from({length:100},()=>({url:"https://youtu.be/bbbbbbbbbbb"}))};
equal(deliveryMessage(row).length<=1900,true);equal(attachAllyDeliveries({rows:[row]},[{defense_id:d1,status:"sent"}]).ready,0);
console.log(`Allied delivery API/transport: ${assertions} assertions passed; no real Discord or production request.`);
