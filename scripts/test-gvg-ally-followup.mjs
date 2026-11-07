import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { allySignature, buildAllyGroups, buildAllyFollowupPreview, renderAllyFeedbackMessage, personalThreadReference, youtubeReference } from "../src/lib/gvgAllyFollowup.js";

// In-memory PostgreSQL only; all real network access is forbidden.
globalThis.fetch = () => { throw Error("Network forbidden in isolated allied followup tests"); };
if (!process.env.PGLITE_MODULE_PATH) throw Error("PGLITE_MODULE_PATH must select an isolated local runtime");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href);
const db = new PGlite();
const id = n => `b8110000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const org=id(1),other=id(2),g2=id(12),g8=id(18),g9=id(19),gx=id(29),admin=id(100),paul=id(101),thanatos=id(102);
const d1=id(200),d2=id(201),d3=id(202),d4=id(203),foreign=id(204);
const heroes = ["Elowyn","Valara","Nezha","Erlang Shen","Nastya"].map((champion,i)=>({champion,position:`B${i+1}`,direction:"E"}));
let assertions=0,groups=0;
const equal=(a,b,message)=>{assert.deepEqual(a,b,message);assertions++;};
const ok=(value,message)=>{assert.ok(value,message);assertions++;};
const query=async(sql,args=[])=>db.query(sql,args);
const one=async(sql,args=[])=>Object.values((await query(sql,args)).rows[0])[0];
const read=async()=>one("select read_gvg_ally_followup($1,$2)",[g2,admin]);
const save=async(defense,action,value,data=null)=>{data ||= await read();const state=data.states.find(s=>s.defense_id===defense);
  return one("select save_gvg_ally_followup($1,$2,$3,$4,$5,$6,$7)",[g2,admin,defense,action,value,state?.revision||0,data.roster_version]);};
const fails=async(fn,pattern)=>{await db.exec("savepoint expected_failure");try{await assert.rejects(fn,pattern);assertions++;}finally{await db.exec("rollback to expected_failure; release expected_failure");}};
const scenario=async(name,fn)=>{await db.exec("begin");try{await fn();groups++;console.log("OK:",name);}finally{await db.exec("rollback");}};
const fingerprint=()=>one("select md5(jsonb_build_array((select jsonb_agg(to_jsonb(m) order by id) from guild_members m),(select jsonb_agg(to_jsonb(d) order by id) from gvg_defense d))::text)");

try {
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create table portal_organizations(id uuid primary key,is_active boolean);
    create table portal_guilds(id uuid primary key,guild_code text,organization_id uuid,is_active boolean);
    create table guild_members(id uuid primary key,watcher_name text,guild_code text,assignment text,roster_status text default 'active',role text default 'member',
      community_access_type text default 'guild',community_status text default 'inactive',personal_forum_post_url text,pb jsonb default '{"Rorkesh":17}');
    create table gvg_defense(id uuid primary key,guild text,bastion integer,type text,tower integer,team integer,is_ally boolean,heroes jsonb,
      youtube_url text,record_status text,created_at timestamptz default now());
    create table gvg_reset_operations(id uuid primary key,portal_guild_id uuid,state text);
    create function _gvg_reset_code(text) returns text language sql immutable as $$ select regexp_replace(upper(btrim($1)),'\\s+','_','g') $$;`);
  const resetSql=await readFile(new URL("./fixtures/gvg-ally-reset-context.sql",import.meta.url),"utf8");
  const start=resetSql.indexOf("create function public._gvg_reset_context(");
  const end=resetSql.indexOf("end $$;",start)+"end $$;".length;
  ok(start>=0&&end>start,"Use the actual installed reset authorization helper, not a permissive mock");
  await db.exec(resetSql.slice(start,end));
  await query("insert into portal_organizations values($1,true),($2,true)",[org,other]);
  for(const [gid,code,oid] of [[g2,"G2",org],[g8,"G8",org],[g9,"G9",org],[gx,"MAD G1",other]])await query("insert into portal_guilds values($1,$2,$3,true)",[gid,code,oid]);
  for(const [mid,name,assignment,role] of [[admin,"Admin","BB Bastion","admin"],[paul,"Paul","B2 Tour 3","member"],[thanatos,"Thanatos","Bastion 1","member"]]) {
    await query("insert into guild_members(id,watcher_name,guild_code,assignment,role,personal_forum_post_url) values($1,$2,'G2',$3,$4,$5)",
      [mid,name,assignment,role,"https://discord.com/channels/111111111111111111/222222222222222222"]);
  }
  await query("insert into guild_members(id,watcher_name,guild_code,assignment,role) values($1,'Foreign','MAD G1','Bastion 1','admin')",[id(110)]);
  for(const [did,bastion,type,tower,team,guild,ally] of [[d1,1,"fortress",null,1,"G2",true],[d2,1,"fortress",null,2,"G2",true],
    [d3,2,"tower",3,1,"G2",true],[d4,2,"tower",3,2,"G2",true],[foreign,1,"fortress",null,1,"MAD_G1",true],[id(205),1,"fortress",null,1,"G2",false]]) {
    await query("insert into gvg_defense(id,bastion,type,tower,team,guild,is_ally,heroes,record_status) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [did,bastion,type,tower,team,guild,ally,JSON.stringify(heroes),ally?"pas_record":null]);
  }
  const before=await fingerprint();
  const preflight=(await db.query(await readFile(new URL("./gvg_ally_followup_preflight.sql",import.meta.url),"utf8"))).rows[0].gvg_ally_followup_preflight;
  equal(preflight.all_checks_ok,true);
  await db.exec(await readFile(new URL("./gvg_ally_followup.sql",import.meta.url),"utf8"));
  equal(await fingerprint(),before,"Installation changes no existing member, defense, PB or Rorkesh field");
  const verified=(await db.query(await readFile(new URL("./gvg_ally_followup_verify.sql",import.meta.url),"utf8"))).rows[0].gvg_ally_followup_verify;
  equal(verified.all_checks_ok,true,JSON.stringify(verified.checks));equal(verified.states,0);equal(verified.provisional_assignments,0);
  equal(verified.delivery_enabled,false);equal(verified.reset_connected,false);

  await scenario("Closed by default; opening is independent from record status",async()=>{
    equal((await read()).states,[]);const original=await fingerprint();
    const data=await save(d1,"opened",{opened:true});equal(data.states.find(s=>s.defense_id===d1).opened,true);
    equal(data.states.find(s=>s.defense_id===d1).owner_member_id,thanatos);equal(await fingerprint(),original);
    equal(data.defenses.find(d=>d.id===d2).record_status,"pas_record");
    equal((await save(d1,"opened",{opened:false})).states.find(s=>s.defense_id===d1).opened,false);
  });
  await scenario("Atomic swap updates both teams, not captures, videos or openings",async()=>{
    await save(d1,"opened",{opened:true});
    const data=await save(d1,"owner",{member_id:paul});
    equal(data.members.find(m=>m.id===paul).assignment,"Bastion 1");equal(data.members.find(m=>m.id===thanatos).assignment,"B2 Tour 3");
    for(const [did,owner] of [[d1,paul],[d2,paul],[d3,thanatos],[d4,thanatos]]) {
      const state=data.states.find(s=>s.defense_id===did);equal(state.owner_member_id,owner);equal(state.owner_confirmed,true);
    }
    equal(data.states.find(s=>s.defense_id===d1).opened,true);equal(data.states.find(s=>s.defense_id===d2).opened,false);
    equal(data.members.every(m=>m.guild_code==="G2"),true);equal(data.provisional_member_ids,[]);
    equal(await one("select bool_and(pb='{"+`"Rorkesh":17`+"}'::jsonb) from guild_members"),true);
  });
  await scenario("Unassigned replacement displaces owner into a free provisional position",async()=>{
    await query("update guild_members set assignment=null where id=$1",[paul]);
    const data=await save(d1,"owner",{member_id:paul});
    const old=data.members.find(m=>m.id===thanatos);ok(old.assignment);ok(old.assignment!=="Bastion 1");
    equal(data.provisional_member_ids,[thanatos]);equal(data.members.find(m=>m.id===paul).assignment,"Bastion 1");
    equal(data.members.find(m=>m.id===thanatos).guild_code,"G2");
  });
  await scenario("Full roster leaves only assignment empty, never converts or transfers",async()=>{
    await query("update guild_members set assignment=null where id=$1",[paul]);
    const slots=[];for(let b=1;b<=4;b++){slots.push(`Bastion ${b}`);for(let t=1;t<=5;t++)slots.push(`B${b} Tour ${t}`);}for(let t=1;t<=5;t++)slots.push(`BB Tour ${t}`);slots.push("BB Bastion");
    let n=400;for(const slot of slots.filter(s=>!["Bastion 1","BB Bastion"].includes(s)))await query("insert into guild_members(id,watcher_name,guild_code,assignment) values($1,'Occupied','G2',$2)",[id(n++),slot]);
    const data=await save(d1,"owner",{member_id:paul});equal(data.members.find(m=>m.id===thanatos).assignment,null);
    equal(await one("select community_access_type from guild_members where id=$1",[thanatos]),"guild");
  });
  await scenario("Stale edits fail with zero partial writes",async()=>{
    const stale=await read();await query("update guild_members set assignment='BB Tour 2' where id=$1",[paul]);
    const f=await fingerprint();await fails(()=>save(d1,"owner",{member_id:paul},stale),/affectations ont change/);
    equal(await fingerprint(),f);equal((await read()).states,[]);
    const same=await read();await save(d1,"opened",{opened:true},same);
    await fails(()=>save(d1,"opened",{opened:false},same),/defense a change/);
  });
  await scenario("Subsequent roster changes invalidate recipient confirmation",async()=>{
    await save(d1,"owner",{member_id:thanatos});
    await query("update guild_members set assignment='BB Tour 5' where id=$1",[thanatos]);
    const data=await read();equal(data.states.find(s=>s.defense_id===d1).owner_confirmed,false);equal(data.states.find(s=>s.defense_id===d2).owner_confirmed,false);
  });
  await scenario("Cross-organization, inactive and community members denied; community_status does not exclude active members",async()=>{
    await fails(()=>save(d1,"owner",{member_id:id(110)}),/Joueur actif/);
    await fails(()=>one("select read_gvg_ally_followup($1,$2)",[gx,admin]),/organization_forbidden/);
    equal((await read()).members.length,3);
    await query("update guild_members set roster_status='inactive' where id=$1",[paul]);await fails(()=>save(d1,"owner",{member_id:paul}),/Joueur actif/);
    await query("update guild_members set roster_status='active',community_access_type='community' where id=$1",[paul]);await fails(()=>save(d1,"owner",{member_id:paul}),/Joueur actif/);
  });
  await scenario("Reset freezes edits without changing the existing reset functions",async()=>{
    await query("insert into gvg_reset_operations values($1,$2,'prepared')",[id(700),g2]);
    await fails(()=>save(d1,"opened",{opened:true}),/Reset GvG en cours/);equal((await read()).states,[]);
  });
  await scenario("Explicit video selection is limited to an exact allied composition in the same guild and map",async()=>{
    await save(d1,"video",{video_defense_id:d2});
    await fails(()=>save(d1,"video",{video_defense_id:d3}),/Video hors guilde/);
    await fails(()=>save(d1,"video",{video_defense_id:foreign}),/Video hors guilde/);
    await query("update gvg_defense set heroes=jsonb_set(heroes,'{0,direction}','\"N\"') where id=$1",[d2]);
    await fails(()=>save(d1,"video",{video_defense_id:d2}),/Video hors guilde/);
  });
  await scenario("New and historical guilds use catalog identities, not guild names",async()=>{
    for(const [gid,code] of [[g8,"G8"],[g9,"G9"]]){await query("insert into gvg_defense(id,guild,bastion,type,tower,team,is_ally,heroes) values($1,$2,1,'tower',1,1,true,$3)",[id(gid===g8?800:900),code,JSON.stringify(heroes)]);
      const data=await one("select read_gvg_ally_followup($1,$2)",[gid,admin]);equal(data.defenses.length,1);equal(data.members,[]);}
  });

  const base={id:d1,guild:"G2",is_ally:true,type:"tower",bastion:1,tower:1,team:1,heroes,record_status:"pas_record",created_at:"2026-11-07T10:00:00Z"};
  const copies=Array.from({length:4},(_,n)=>({...base,id:id(900+n),bastion:n+1}));
  const members=copies.map((d,n)=>({id:id(950+n),watcher_name:`Player ${n}`,assignment:`B${n+1} Tour 1`,guild_code:"G2",personal_forum_post_url:"https://discord.com/channels/111111111111111111/222222222222222222"}));
  const states=copies.map((d,n)=>({defense_id:d.id,opened:true,owner_confirmed:true,owner_member_id:members[n].id}));
  const A="https://youtu.be/aaaaaaaaaaa",B="https://youtu.be/bbbbbbbbbbb",old="https://youtu.be/ccccccccccc";
  const preview=(defenses=copies,extra={})=>buildAllyFollowupPreview({defenses,members,states,...extra});
  equal(buildAllyGroups([...copies,{...base,id:id(999),guild:"G9"}]).length,1);equal(buildAllyGroups(copies)[0].ids.length,4);
  equal(buildAllyGroups([base,{...base,id:d2,type:"fortress"}]).length,0);
  equal(allySignature({...base,heroes:heroes.slice(0,4)}),null);
  equal(allySignature(base),allySignature({...base,heroes:heroes.map(h=>({...h,champion:h.champion.replace(/ /g,"")}))}),"Bank and captured champion spacing identify the same layout");
  equal(allySignature({...base,heroes:heroes.map((h,n)=>({...h,position:n===4?"B1":h.position}))}),null);
  equal(allySignature(base),await one("select _gvg_ally_signature(row($1,'G2',1,'tower',1,1,true,$2,null,'pas_record',now())::gvg_defense)",[d1,JSON.stringify(heroes)]));
  for(const fixture of [heroes.map((h,n)=>({...h,champion:n===0?"\u00c9lowyn2":h.champion})),heroes.map((h,n)=>({...h,direction:n===0?"WEST":h.direction})),
    heroes.slice(0,4),heroes.map((h,n)=>({...h,position:n===0?"H11":h.position})),null,{}]) {
    equal(await one("select _gvg_ally_signature(row($1,'G2',1,'tower',1,1,true,$2,null,'pas_record',now())::gvg_defense)",[d1,JSON.stringify(fixture)]),
      allySignature({...base,heroes:fixture}),"SQL and JS use exactly the same grouping rules");
  }
  const oneVideo=copies.map((d,n)=>({...d,youtube_url:n===0?A:null}));let report=preview(oneVideo);equal(report.ready,4);equal(report.sent,0);equal(report.delivery_enabled,false);
  equal(report.rows[0].video.source,"own");equal(report.rows[1].video.source,"group");
  ok(renderAllyFeedbackMessage(report.rows[1]).includes("pas de preuve"));
  const twoVideos=oneVideo.map((d,n)=>({...d,youtube_url:n===1?B:d.youtube_url}));report=preview(twoVideos);
  equal(report.ready,2);equal(report.rows[2].reasons.includes("Choisir la video du groupe"),true);
  report=preview(twoVideos,{states:states.map((s,n)=>({...s,video_defense_id:n>=2?copies[1].id:null}))});equal(report.ready,4);equal(report.rows[2].video.url,B);
  report=preview(oneVideo.map((d,n)=>({...d,record_status:n===3?"a_record":"record"})));equal(report.rows[2].video,null);ok(report.rows[2].reasons.includes("Record de cette session encore en attente"));
  report=preview(oneVideo,{historicalRuns:[{guild:"G2",signature:allySignature(base),youtube_url:old,created_at:"2026-10-01"},
    {guild:"G2",signature:allySignature(base),youtube_url:A,created_at:"2026-10-01"},{guild:"G9",signature:allySignature(base),youtube_url:B,created_at:"2026-10-01"}]});equal(report.rows[0].history.length,1);
  equal(preview(oneVideo,{states:states.map(s=>({...s,opened:false}))}).ready,0);
  equal(preview(oneVideo,{provisional_member_ids:[members[0].id]}).ready,3);
  equal(preview(oneVideo,{members:members.map(m=>({...m,personal_forum_post_url:""}))}).ready,0);
  equal(personalThreadReference("https://discord.com.evil.test/channels/111111111111111111/222222222222222222"),null);
  equal(youtubeReference("https://youtu.be.evil.test/aaaaaaaaaaa"),null);
  equal(youtubeReference("http://youtu.be/aaaaaaaaaaa"),null);
  const emptyMessage=renderAllyFeedbackMessage(preview(copies).rows[0]);
  ok(emptyMessage.includes("Aucune video n'est disponible pour le moment"),"Empty video list has an explicit unavailable message");
  ok(!emptyMessage.includes("exemples deja disponibles"),"Never promise examples when the history is empty");
  ok(!emptyMessage.includes("Autres manieres"),"No historical section without an actual video");
  const historyOnly=preview(copies,{historicalRuns:[{guild:"G2",signature:allySignature(base),youtube_url:old,created_at:"2026-10-01"}]}).rows[0];
  const historyMessage=renderAllyFeedbackMessage(historyOnly);
  ok(historyMessage.includes("voici des exemples deja disponibles"));
  ok(historyMessage.includes(old));
  const currentOnly=renderAllyFeedbackMessage(preview(oneVideo).rows[0]);
  ok(currentOnly.includes(A));ok(!currentOnly.includes("exemples deja disponibles"));ok(!currentOnly.includes("Autres manieres"));
  const { testAllyDeliverySql } = await import("./test-gvg-ally-delivery-sql.mjs");
  await testAllyDeliverySql({ db, query, one, scenario, fails, equal, ok, id, g2, g8, g9, gx, admin, thanatos, d1, d2, foreign });
  console.log(`Allied followup: ${groups} SQL scenarios and ${assertions} assertions passed; isolated PostgreSQL, no real reset, message or production connection. Verify: ${verified.checks.length}/${verified.checks.length}.`);
} finally { await db.close(); }
