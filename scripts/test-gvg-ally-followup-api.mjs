import assert from "node:assert/strict";

process.env.SUPABASE_URL="https://ally-fixture.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY="isolated-fixture-not-a-secret";
globalThis.fetch=()=>{throw Error("Real network forbidden in allied API tests");};
const { createGvgAllyFollowupHandler, loadGvgAllyHistory }=await import("../api/gvg-ally-followup.js");
const id=n=>`b8120000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const org=id(1),actor=id(2),guild=id(3),defense=id(4),member=id(5),copy=id(6);
const heroes=["Elowyn","Valara","Nezha","Erlang Shen","Nastya"].map((champion,n)=>({champion,position:`B${n+1}`,direction:"E"}));
const base={defenses:[{id:defense,guild:"G2",is_ally:true,bastion:1,type:"tower",tower:1,team:1,heroes,created_at:"2026-11-07",youtube_url:"https://youtu.be/aaaaaaaaaaa"},
  {id:copy,guild:"G2",is_ally:true,bastion:2,type:"tower",tower:1,team:1,heroes,youtube_url:null}],
  states:[],members:[{id:member,guild_code:"G2",assignment:"B1 Tour 1",watcher_name:"Thanatos"}],provisional_member_ids:[],roster_version:"a".repeat(32)};
let assertions=0,calls=[],auth="admin",license=true,catalogOrg=org,dbError=null,historyReads=0;
const equal=(a,b,message)=>{assert.deepEqual(a,b,message);assertions++;};
const db={rpc:async(name,args)=>{calls.push({name,args});if(dbError)return {error:dbError};return {data:structuredClone(base)};}};
const handler=createGvgAllyFollowupHandler({db,
  requireSession:async()=>auth==="none"?{error:"Session requise",status:401}:auth==="member"?{error:"Admin requis",status:403}:{member:{id:actor,guild_code:"G2",role:"admin"}},
  resolveScope:async()=>({canUseGvg:license,isPaladin:true,guildCode:"G2",role:"admin"}),
  loadCatalog:async()=>({organizationId:catalogOrg,guilds:[{id:guild,guild_code:"G2",organization_id:org}]}),
  loadHistory:async()=>{historyReads++;return {historicalRuns:[],history_warnings:[]};},
});
async function call(body=null,{method=body?"POST":"GET",origin="https://run-form-tau.vercel.app",target="G2"}={}){
  const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},getHeader(k){return this.headers[k];},status(code){this.statusCode=code;return this;},
    json(data){this.data=data;return this;},end(value){if(value)this.data=JSON.parse(value);return this;}};
  await handler({method,body,query:{guild:target},url:"/api/gvg-ally-followup",headers:{host:"run-form-tau.vercel.app",origin}},res);
  return res;
}
for(const [mode,status]of [["none",401],["member",403]]){auth=mode;calls=[];equal((await call()).statusCode,status);equal(calls.length,0);}auth="admin";
calls=[];equal((await call({guild:"G2",action:"preview"},{origin:"https://evil.invalid"})).statusCode,403);equal(calls.length,0);
license=false;equal((await call()).statusCode,403);license=true;
catalogOrg=id(99);equal((await call()).statusCode,403);catalogOrg=org;
equal((await call(null,{target:"G8"})).statusCode,403);
equal((await call(null,{method:"DELETE"})).statusCode,405);
const read=await call();equal(read.statusCode,200);equal(read.headers["Cache-Control"],"no-store");equal(read.data.delivery_enabled,false);equal(read.data.sent,0);equal(read.data.ally_groups.length,1);
equal(historyReads,0);
const preview=await call({guild:"G2",action:"preview",actor_member_id:id(999)});equal(preview.statusCode,200);equal(historyReads,1);
equal(calls.at(-1).args.p_actor_member_id,actor,"Browser cannot impersonate a different actor");
const edit={guild:"G2",action:"opened",defense_id:defense,opened:true,revision:0,roster_version:base.roster_version};
equal((await call(edit)).statusCode,200);equal(calls.findLast(c=>c.name==="save_gvg_ally_followup").args.p_value,{opened:true});
equal((await call({...edit,opened:"true"})).statusCode,400);equal((await call({...edit,revision:-1})).statusCode,400);
equal((await call({...edit,defense_id:id(999)})).statusCode,403);
equal((await call({...edit,action:"send"})).statusCode,428,"Delivery remains unavailable until its additive SQL and bot configuration exist");
equal((await call({...edit,action:"video",video_defense_id:copy})).statusCode,400,"Missing video cannot be selected");
base.defenses[1].youtube_url="https://youtu.be/bbbbbbbbbbb";
equal((await call({...edit,action:"video",video_defense_id:copy})).statusCode,200);
base.defenses[1].heroes=heroes.map((h,n)=>({...h,direction:n===0?"N":h.direction}));
equal((await call({...edit,action:"video",video_defense_id:copy})).statusCode,400);
dbError={code:"40001",message:"Stale edit"};equal((await call(edit)).statusCode,409);
dbError={code:"PGRST202",message:"Missing function"};equal((await call()).statusCode,428);
const historyDb={from(table){equal(table,"defence_strat");return {select(){return this;},async in(){return {data:[{id:1,def_key:"b1_t1_team1"},{id:2,def_key:"b1_fort_team1"},{id:3,def_key:null},{id:4,def_key:"b1_t1_team1"}]};}};}};
let searches=0;
const historyData={defenses:[{...base.defenses[0]},{...base.defenses[0],id:copy}],states:[{defense_id:defense,opened:true},{defense_id:copy,opened:true}]};
const history=await loadGvgAllyHistory(historyDb,historyData,{search:async(_db,_heroes,options)=>{
  searches++;equal(options.scope.isAdmin,false);equal(options.targetGuildCode,"G2");
  return [1,2,3,4].map(strat_id=>({strat_id,slots:heroes,youtube_url:"https://youtu.be/aaaaaaaaaaa",created_at:"2026-10-01",guild_code:strat_id===4?"MAD G1":null}));
}});
equal(searches,2,"One group is searched once per raw/compact champion naming variant, not once per defense");
equal(history.historicalRuns.length,2,"Only matching map and organization; duplicate source results are deduplicated when building the preview");
equal(history.history_warnings,[]);
const failedHistory=await loadGvgAllyHistory(historyDb,historyData,{search:async()=>{throw Error("fixture bank unavailable");}});
equal(failedHistory.historicalRuns,[]);equal(failedHistory.history_warnings.length,1);
console.log(`Allied API: ${assertions} assertions passed; auth, scope, stale edits, video matching, disabled delivery, no real network.`);
