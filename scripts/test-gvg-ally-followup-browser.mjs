import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { buildAllyGroups, buildAllyFollowupPreview, renderAllyFeedbackMessage } from "../src/lib/gvgAllyFollowup.js";
import { attachAllyDeliveries } from "../api/_gvg-ally-delivery.js";

if(!process.env.PLAYWRIGHT_MODULE_PATH||!process.env.ALLY_TEST_OUTPUT)throw Error("Local Playwright runtime and external output directory required");
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href);
const root=fileURLToPath(new URL("../",import.meta.url)),output=resolve(process.env.ALLY_TEST_OUTPUT);
assert.ok(!output.startsWith(root),"Browser artifacts must stay outside the repository");
await mkdir(output,{recursive:true});
const socket=createNetServer();await new Promise(r=>socket.listen(0,"127.0.0.1",r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import GvgPanelTab from '/src/components/GvgPanelTab.jsx';import GvgAdminTab from '/src/components/GvgAdminTab.jsx';import {configurePortalGuildCatalog} from '/src/lib/guildScope.js';import '/src/index.css';
configurePortalGuildCatalog({organizationKey:'paladin',guilds:['G2','G8','G9'].map(guild_code=>({guild_code}))});
const session={role:'leader',isAdmin:true,isLeader:true,guildCode:'G2',memberId:'b8130000-0000-4000-8000-000000000001'};
createRoot(document.getElementById('root')).render(location.search.includes('reset')?<GvgAdminTab session={session}/>:<GvgPanelTab session={session}/>);`;
const server=await createServer({configFile:false,root,envDir:output,envPrefix:"ONLY_ALLY_TEST_",cacheDir:resolve(output,"vite-cache"),resolve:{alias:{"@":resolve(root,"src")}},
  server:{host:"127.0.0.1",port,strictPort:true},plugins:[{
    name:"ally-browser-fixture",enforce:"pre",
    resolveId(source){if(source.endsWith("/lib/portalLanguage"))return "\0ally-language";if(source==="/virtual-ally.jsx")return source;},
    load(source){if(source==="\0ally-language")return "export function usePortalLanguage(){return {language:'fr',t:(key,fallback)=>fallback||key};}";if(source==="/virtual-ally.jsx")return entry;},
    configureServer(server){server.middlewares.use((req,res,next)=>{if(req.url.split('?')[0]!=="/__ally")return next();res.setHeader("content-type","text/html");
      server.transformIndexHtml(req.url,'<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body class="dark" style="background:#09090b;color:white"><main style="padding:12px"><div id="root"></div></main><script type="module" src="/virtual-ally.jsx"></script></body></html>').then(html=>res.end(html));});},
  },react(),tailwind()]});
await server.listen();const browser=await chromium.launch({headless:true,channel:"msedge"});
const id=n=>`b8130000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const heroes=["Elowyn","Valara","Nezha","Erlang Shen","Nastya"].map((champion,n)=>({champion,position:`B${n+1}`,direction:"E"}));
let assertions=0;const check=(a,b,label)=>{assert.deepEqual(a,b,label);assertions++;};const reports=[];
try{
  for(const width of [1440,768,390,320]){
    const page=await browser.newPage({viewport:{width,height:1000}}),errors=[],writes=[];let guild="G1",revision=0,fail=false;
    page.on("pageerror",error=>errors.push(error.message));
    let defenses=[1,2,3,4].map((b,n)=>({id:id(20+n),guild,bastion:b,type:"tower",tower:1,team:1,is_ally:true,heroes,record_status:"pas_record",created_at:"2026-11-07T10:00:00Z",youtube_url:n===0?"https://youtu.be/aaaaaaaaaaa":null}));
    let members=defenses.map((d,n)=>({id:id(40+n),watcher_name:n===0?"Thanatos":"Joueur "+n,assignment:`B${n+1} Tour 1`,guild_code:guild,personal_forum_post_url:"https://discord.com/channels/111111111111111111/222222222222222222"}));let states=[];
    let enabled=false,deliveries=[],sendFailure=null;const resetWrites=[],timeline=[];
    const payload=(preview=false)=>{let p=buildAllyFollowupPreview({defenses,members,states});if(preview)for(const row of p.rows)if(row.opened)row.message=renderAllyFeedbackMessage(row);
      if(enabled)p=attachAllyDeliveries(p,deliveries);
      return {guild,defenses,members,states,provisional_member_ids:[],roster_version:"a".repeat(32),snapshot_version:"b".repeat(32),ally_groups:buildAllyGroups(defenses),preview:p,delivery_enabled:enabled,sent:p.sent};};
    await page.route("**/*",async route=>{
      const url=new URL(route.request().url()),body=route.request().postData()?route.request().postDataJSON():null;
      if(url.pathname==="/api/gvg-data"){
        if(body?.action==="record_sessions")return route.fulfill({json:{success:true,sessions:[]}});
        if(body?.action==="calculate_groups")return route.fulfill({json:{success:true,updated_enemy_groups:0,matched_mirror_groups:0,mirror_map:{}}});
        guild=url.searchParams.get("guild")||guild;defenses=defenses.map(d=>({...d,guild}));members=members.map(m=>({...m,guild_code:guild}));
        return route.fulfill({json:{items:defenses}});
      }
      if(url.pathname==="/api/gvg-ally-followup"){
        if(body?.action==="send"){
          writes.push(body);timeline.push("send");const status=body.defense_id===sendFailure?"failed":"sent";
          deliveries=deliveries.filter(r=>r.defense_id!==body.defense_id);deliveries.push({defense_id:body.defense_id,status,error_reason:status==="failed"?"Espace personnel introuvable":null});
          return route.fulfill({json:{...payload(true),delivery_result:{status,attempted:true,...(status==="failed"?{error:"Espace personnel introuvable"}:{})}}});
        }
        if(body&&body.action!=="preview"){
          writes.push(body);if(fail){fail=false;return route.fulfill({status:409,json:{error:"Les affectations ont change. Actualisez."}});}
          const defense=defenses.find(d=>d.id===body.defense_id);let state=states.find(s=>s.defense_id===body.defense_id);
          if(!state){state={defense_id:defense.id,opened:false,revision:0};states.push(state);}state.revision=++revision;
          if(body.action==="opened"){state.opened=body.opened;const owner=members.find(m=>m.assignment===`B${defense.bastion} Tour 1`);state.owner_member_id=owner.id;state.owner_confirmed=true;}
          if(body.action==="owner"){
            const old=members.find(m=>m.assignment===`B${defense.bastion} Tour 1`),chosen=members.find(m=>m.id===body.member_id),former=chosen.assignment;
            chosen.assignment=old.assignment;old.assignment=former;state.owner_member_id=chosen.id;state.owner_confirmed=true;
          }
          if(body.action==="video")state.video_defense_id=body.video_defense_id;
        }
        return route.fulfill({json:payload(body?.action==="preview")});
      }
      if(url.pathname==="/api/gvg-reset"){
        resetWrites.push(body);timeline.push("reset");return route.fulfill({json:{success:true,operation_id:id(500),retained_images:0}});
      }
      if(url.hostname!=="127.0.0.1")return route.abort();return route.continue();
    });
    await page.goto(`http://127.0.0.1:${port}/__ally`);
    const rows=page.locator("[data-ally-followup]");await rows.first().waitFor();check(await rows.count(),4);
    check(await rows.locator('input[type="checkbox"]:checked').count(),0,"New allied defenses start closed");
    check(await rows.first().getByTitle("Defenses alliees identiques").innerText(),"1");
    await page.getByRole("button",{name:"Calcul groupes",exact:true}).click();
    await page.getByText(/Calcul groupes termine/).waitFor();await rows.first().waitFor();check(await rows.count(),4,"Calculation success must not hide the grids");
    await rows.first().getByRole("checkbox").click();await page.waitForFunction(()=>document.querySelector('input[type="checkbox"]')?.checked);
    check(await page.locator('[data-ally-opened]').count(),1,"An opened defense has a red stamp above the owner");
    await rows.first().getByRole("combobox").selectOption(id(41));
    const modal=page.getByRole("dialog",{name:"Confirmer l'affectation"});await modal.waitFor();
    check(writes.filter(w=>w.action==="owner").length,0,"Dropdown selection opens a confirmation before a roster write");
    await modal.getByRole("button",{name:"Annuler",exact:true}).click();check(writes.filter(w=>w.action==="owner").length,0);
    await rows.first().getByRole("combobox").selectOption(id(41));await modal.getByRole("button",{name:"Confirmer",exact:true}).click();
    await page.waitForFunction(expected=>document.querySelector('[data-ally-followup] select')?.value===expected,id(41));
    check(writes.filter(w=>w.action==="owner").length,1);check(members.find(m=>m.id===id(40)).assignment,"B2 Tour 1");
    await page.getByRole("button",{name:"Retours allies",exact:true}).click();const preview=page.getByRole("dialog",{name:"Retours allies - previsualisation"});await preview.waitFor();
    await preview.getByText("Envois desactives",{exact:true}).waitFor();await preview.getByText(/Ta defense a ete ouverte/).waitFor();
    check(await preview.getByRole("button",{name:/Envoyer|Reset/}).count(),0,"Preview has no send or reset command");
    await page.screenshot({path:resolve(output,`ally-preview-${width}.png`),fullPage:true});
    check(await preview.evaluate(el=>el.scrollWidth>el.clientWidth+1),false,"Preview fits the viewport");await preview.getByRole("button",{name:"Fermer",exact:true}).click();
    await page.screenshot({path:resolve(output,`ally-pilotage-${width}.png`),fullPage:true});
    await rows.first().screenshot({path:resolve(output,`ally-row-${width}.png`)});
    check(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,"No horizontal page overflow");
    fail=true;await rows.first().getByRole("checkbox").click();await page.getByRole("alert").getByText(/Les affectations ont change/).waitFor();
    check(await rows.first().getByRole("checkbox").isChecked(),true,"Conflict reloads server state instead of keeping a false optimistic value");
    defenses=defenses.map(defense=>({...defense,youtube_url:null}));
    await page.getByRole("button",{name:"Retours allies",exact:true}).click();await preview.waitFor();
    await preview.getByText(/Aucune video n'est disponible pour le moment/).waitFor();
    check(await preview.getByText(/exemples deja disponibles|Autres manieres/).count(),0,"No examples promised when neither current nor historical videos exist");
    await page.screenshot({path:resolve(output,`ally-empty-video-${width}.png`),fullPage:true});
    await preview.getByRole("button",{name:"Fermer",exact:true}).click();
    await page.getByRole("button",{name:"G8",exact:true}).click();await rows.first().waitFor();
    await page.waitForTimeout(200);check(await rows.count(),4);check(errors,[]);
    enabled=true;defenses=defenses.map((d,n)=>({...d,youtube_url:n===0?"https://youtu.be/aaaaaaaaaaa":null}));
    await page.getByRole("button",{name:"Retours allies",exact:true}).click();await preview.getByRole("button",{name:"Envoyer les retours prets"}).waitFor();
    const beforeSend=writes.filter(w=>w.action==="send").length;
    await preview.getByRole("button",{name:"Envoyer les retours prets"}).click();check(writes.filter(w=>w.action==="send").length,beforeSend,"First click is only a confirmation");
    await preview.getByRole("button",{name:"Confirmer l'envoi"}).click();await preview.getByText("Aucun retour restant a envoyer.").waitFor();
    check(writes.filter(w=>w.action==="send").length,beforeSend+1);check(await preview.getByRole("button",{name:"Envoyer les retours prets"}).isDisabled(),true);
    await preview.getByRole("button",{name:"Fermer",exact:true}).click();await rows.nth(1).getByRole("checkbox").click();
    await page.getByRole("button",{name:"Retours allies",exact:true}).click();await preview.getByRole("button",{name:"Envoyer les retours prets"}).click();await preview.getByRole("button",{name:"Confirmer l'envoi"}).click();
    await preview.getByText("Aucun retour restant a envoyer.").waitFor();check(writes.filter(w=>w.action==="send").length,beforeSend+2,"A new opening sends only its own feedback");
    check(writes.filter(w=>w.action==="send"&&w.defense_id===defenses[0].id).length,1,"The previously sent defense is never re-sent");
    await preview.getByRole("button",{name:"Fermer",exact:true}).click();
    const initializeReset=async()=>{
      deliveries=[];states=defenses.slice(0,2).map(d=>({defense_id:d.id,opened:true,owner_confirmed:true,owner_member_id:members.find(m=>m.assignment===`B${d.bastion} Tour 1`).id}));
      await page.goto(`http://127.0.0.1:${port}/__ally?reset`);
      await page.getByRole("button",{name:/^Reset G2/}).waitFor();await page.getByRole("button",{name:/^Reset G2/}).click();
      await page.getByRole("button",{name:"Oui, continuer"}).click();
    };
    await initializeReset();await page.getByRole("button",{name:/Oui, sauvegarder/}).click();await page.getByRole("dialog").getByText(/2 ouvertes/).waitFor();
    check(resetWrites.length,0,"Two confirmations have not yet triggered the reset");
    await page.getByRole("button",{name:"Annuler",exact:true}).click();check(resetWrites.length,0,"Cancelling the feedback choice does not reset or send");
    await initializeReset();await page.getByRole("button",{name:/Oui, sauvegarder/}).click();
    const beforeSkip=writes.filter(w=>w.action==="send").length;
    await page.getByRole("button",{name:"Ignorer les envois et poursuivre"}).click();await page.getByText(/Reset OK/).waitFor();
    check(resetWrites.length,1);check(resetWrites[0].saveEnemyDefenses,true);check(writes.filter(w=>w.action==="send").length,beforeSkip,"Skipping creates no sent receipt");check(deliveries,[]);
    sendFailure=defenses[0].id;await initializeReset();await page.getByRole("button",{name:/Non, r.*initialiser sans sauvegarder/}).click();
    await page.getByRole("dialog").getByRole("button",{name:"Envoyer et poursuivre"}).waitFor();
    await page.screenshot({path:resolve(output,`ally-reset-choice-${width}.png`),fullPage:true});
    check(await page.getByRole("dialog").evaluate(el=>el.scrollWidth>el.clientWidth+1),false,"Reset feedback fits mobile and desktop");
    await page.getByRole("button",{name:"Envoyer et poursuivre"}).click();await page.getByText(/Reset OK/).waitFor();
    check(resetWrites.length,2);check(resetWrites[1].saveEnemyDefenses,false);check(timeline.slice(-3),["send","send","reset"],"All attempts finish before the normal reset starts");
    await page.getByText(/1 envoyes, 1 echecs/).waitFor();check(deliveries.map(r=>r.status),["failed","sent"],"One Discord rejection does not block the other delivery or reset");
    check(errors,[]);reports.push({width,assertionsPassed:true,writes:writes.length});await page.close();
  }
  await writeFile(resolve(output,"results.json"),JSON.stringify({assertions,reports},null,2));console.log(`Allied browser: ${assertions} assertions passed across four viewports; real Pilotage, localhost only, no real message or reset.`);
}finally{await browser.close();await server.close();}
