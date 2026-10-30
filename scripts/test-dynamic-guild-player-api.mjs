import assert from "node:assert/strict";
import handler from "../api/portal-player-data.js";
import { createPortalSessionToken } from "../api/_portal-auth.js";

process.env.SUPABASE_URL = "https://member-data-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "isolated-test-key";
process.env.PORTAL_SESSION_SECRET = "isolated-member-identity-secret-not-production";
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const member = (n,guild) => ({id:id(n),watcher_name:n===1?"2G4X":"Player "+n,guild_code:guild,role:"member",primary_member_id:null});
const members=[member(1,"G1"),member(8,"G8"),member(18,"G8"),member(9,"G9"),member(10,"G10"),
  ...Array.from({length:6},(_,i)=>member(30+i,`G${i+2}`)),member(20,"MAD G1")];
members[1].discord_id=members[2].discord_id="111111111111111111";
const champion={id:101,name:"Elowyn",portal_name:"Elowyn",english_name:"Elowyn",lord:"non-lord"};
const monster={id:id(500),name:"Glacius",slug:"glacius",rarity:"legendaire",is_active:true};
const tables={guild_members:members,champions:[champion],demonic_monsters:[monster],
  member_awakenings:members.map((m,i)=>({member_id:m.id,champion_id:101,awakening_level:i%6,champions:champion})),
  member_pb_entries:members.map((m,i)=>({id:id(100+i),member_id:m.id,member_name:m.watcher_name,slot_index:1,champion_id:101,pb_raw:String(1000+i),awakening_level:null,champions:champion})),
  member_demonic_monsters:members.map((m,i)=>({id:id(200+i),member_id:m.id,monster_id:monster.id,level:i+1,demonic_monsters:monster})),
  soul_stones:members.map((m,i)=>({id:id(300+i),member_id:m.id,watcher_name:m.watcher_name,type:"lord",created_at:"2026-10-30"})),
  portal_member_activity_state:[]};
const calls=[];
let hiddenRosterId="";
globalThis.fetch=async(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input.url);
  assert.equal(url.origin,process.env.SUPABASE_URL,"real network is forbidden");
  const method=options.method||'GET';
  const table=url.pathname.split('/').at(-1);
  const headers=new Headers(options.headers);
  calls.push({table,method});
  if(url.pathname.includes('/rpc/')) {
    assert.equal(table,'get_soulstone_ranking');
    return new Response(JSON.stringify(members.map(m=>({member_id:m.id,watcher_name:m.watcher_name,lord_count:1,total:1}))),{headers:{'content-type':'application/json'}});
  }
  assert.ok(Object.hasOwn(tables,table),`Unexpected table ${table}`);
  const matches=row=>[...url.searchParams].every(([key,value])=>{
    if(['select','order','limit','offset','on_conflict'].includes(key))return true;
    if(value.startsWith('eq.'))return String(row[key])===value.slice(3);
    if(value.startsWith('in.('))return value.slice(4,-1).split(',').map(x=>x.replaceAll('"','')).includes(String(row[key]));
    throw new Error('Unsupported test filter '+key+':'+value);
  });
  if(method==='POST') {
    const payload=JSON.parse(options.body);
    const incoming=Array.isArray(payload)?payload:[payload];
    const keys=(url.searchParams.get('on_conflict')||'id').split(',');
    for(const item of incoming){const existing=tables[table].find(r=>keys.every(key=>r[key]===item[key]));if(existing)Object.assign(existing,item);else tables[table].push({...item,id:item.id||id(900+tables[table].length)});}
  } else if(method==='PATCH') {
    const patch=JSON.parse(options.body);
    tables[table].filter(matches).forEach(row=>Object.assign(row,patch));
  } else assert.equal(method,'GET',"no delete or unexpected method in isolated API tests");
  let rows=tables[table].filter(matches);
  if(table==='guild_members'&&!url.searchParams.has('id'))rows=rows.filter(m=>m.id!==hiddenRosterId);
  if(url.searchParams.get('order')?.includes('watcher_name'))rows=[...rows].sort((a,b)=>a.watcher_name.localeCompare(b.watcher_name));
  const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||1000);
  rows=rows.slice(offset,offset+limit);
  const wantsSingle=headers.get('accept')?.includes('application/vnd.pgrst.object+json');
  return new Response(JSON.stringify(wantsSingle?rows[0]||null:rows),{headers:{'content-type':'application/json'}});
};
async function request(actor,body,token=true){
  const req={method:'POST',url:'/api/portal-player-data',headers:{host:'localhost:3010',origin:'http://localhost:3010',
    ...(token?{cookie:'portal_session='+encodeURIComponent(createPortalSessionToken(actor))}:{})},body};
  const res={headers:{},setHeader(key,value){this.headers[key]=value;},end(value){this.payload=JSON.parse(value);}};
  const originalError=console.error;
  console.error=(...args)=>{
    const error=args[1];
    if(args[0]==='[portal-player-data]' && error?.statusCode>=400 && error?.statusCode<500)return;
    originalError(...args);
  };
  try {await handler(req,res);} finally {console.error=originalError;}
  return {status:res.statusCode,...res.payload};
}
const baseline=structuredClone(tables);
for(const actor of members.filter(m=>m.guild_code!=='MAD G1')){
  const base=await request(actor,{action:'heroBoxBase'});
  assert.equal(base.status,200);assert.equal(base.actorMemberId,actor.id);
  assert.ok(base.members.some(m=>m.id===actor.id));
  assert.ok(!base.members.some(m=>m.guild_code==='MAD G1'));
  const box=await request(actor,{action:'heroAwakenings',memberId:actor.id,championIds:[101]});
  assert.equal(box.status,200);assert.equal(box.memberId,actor.id);
  assert.deepEqual(box.awakenings.map(a=>a.awakening_level),tables.member_awakenings.filter(a=>a.member_id===actor.id).map(a=>a.awakening_level));
  const pb=await request(actor,{action:'personalBest',guildCode:actor.guild_code});
  assert.equal(pb.status,200);assert.equal(pb.actorMemberId,actor.id);
  assert.ok(pb.members.some(m=>m.id===actor.id));
  assert.ok(pb.entries.every(row=>pb.members.some(m=>m.id===row.member_id)));
  for(const action of ['demonicMonsters','soulStones']){
    const data=await request(actor,{action});
    assert.equal(data.status,200);assert.equal(data.selectedMemberId,actor.id);
    assert.equal(data.actorMemberId,actor.id);
    assert.ok((data.entries||data.stones).every(row=>row.member_id===actor.id));
  }
}
assert.notDeepEqual((await request(members[1],{action:'heroAwakenings',memberId:members[1].id})).awakenings,
  (await request(members[2],{action:'heroAwakenings',memberId:members[2].id})).awakenings,"two G8 users never receive one shared owner by default");
for(const action of ['demonicMonsters','soulStones']){
  assert.equal((await request(members[1],{action,memberId:id(999)})).status,403);
  assert.equal((await request(members[1],{action,memberId:'invalid'})).status,400);
  assert.equal((await request(members[1],{action,memberId:members.at(-1).id})).status,403);
}
assert.equal((await request({id:id(998)},{action:'heroBoxBase'})).status,401,"a signed but unknown subject gets no other account");
assert.equal((await request(members[1],{action:'heroBoxBase'},false)).status,401);
assert.equal((await request(members[1],{action:'heroBoxBase',session:{memberId:members[0].id}})).actorMemberId,members[1].id,"browser-supplied identity never overrides the signed session");
hiddenRosterId=members[1].id;
for(const action of ['heroBoxBase','personalBest','demonicMonsters','soulStones']){
  const data=await request(members[1],{action});
  assert.equal(data.status,409);assert.match(data.error,/introuvable/);
  assert.equal(data.members,undefined,"an unresolved default account never falls back to another account");
}
hiddenRosterId='';
assert.deepEqual(tables,baseline,"every read and failed lookup preserved personal data");
const actor=members[1],other=members[2];
const foreignSnapshot=structuredClone(tables.member_awakenings.filter(row=>row.member_id!==actor.id));
assert.equal((await request(actor,{action:'setHeroAwakening',memberId:other.id,championId:101,awakeningLevel:5})).status,403);
assert.equal((await request(actor,{action:'setHeroAwakening',memberId:actor.id,championId:101,awakeningLevel:5})).status,200);
const ownPb=tables.member_pb_entries.find(row=>row.member_id===actor.id),otherPb=tables.member_pb_entries.find(row=>row.member_id===other.id);
assert.equal((await request(actor,{action:'updatePersonalBestValue',entryId:otherPb.id,pbRaw:'9000'})).status,403);
assert.equal((await request(actor,{action:'updatePersonalBestValue',entryId:ownPb.id,pbRaw:'2345'})).status,200);
assert.equal((await request(actor,{action:'setDemonicMonsterLevel',memberId:other.id,monsterId:monster.id,level:17})).status,403);
assert.equal((await request(actor,{action:'setDemonicMonsterLevel',memberId:actor.id,monsterId:monster.id,level:17})).status,200);
assert.deepEqual(tables.member_awakenings.filter(row=>row.member_id!==actor.id),foreignSnapshot,"other accounts retain their own awakenings");
for(const guild of ['G7','G8','G9','G10']){
  actor.guild_code=guild; // Isolated fixture only: the same account ID keeps every data row.
  const pb=await request(actor,{action:'personalBest',guildCode:guild});
  assert.equal(pb.status,200);assert.equal(pb.entries.find(row=>row.id===ownPb.id).pb_raw,'2345');
  assert.equal((await request(actor,{action:'heroAwakenings',memberId:actor.id})).awakenings[0].awakening_level,5);
  assert.equal((await request(actor,{action:'demonicMonsters'})).entries[0].level,17);
}
console.log(`Member API passed: real signed-session handler with ${calls.length} mocked requests, independent G8/G9/G10 data, G7 transfers without loss, self writes, cross-account/organization write denials, unknown sessions and no first-player fallback. No production access.`);
