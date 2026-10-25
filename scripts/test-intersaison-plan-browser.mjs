import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";
import sharp from "sharp";

if (!process.env.PLAYWRIGHT_MODULE_PATH) throw new Error("PLAYWRIGHT_MODULE_PATH required.");
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href);
const output = resolve(process.env.PLAN_TEST_OUTPUT || ".plan-browser-test");
await mkdir(output, { recursive: true });
const moduleId = "virtual:intersaison-plan-test";
const fixture = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import Workspace from '/src/components/IntersaisonSurveyTwoWorkspace.jsx';
  import { buildSurveyChoiceForecast } from '/src/lib/intersaisonSurveyChoices.js';
  import '/src/index.css';
  const id = n => '20000000-0000-4000-8000-'+String(n).padStart(12,'0');
  const guildNames=['Legend','Imperatores','Loyalty','Collegium','Senatores','Legacy','Magistratus'];
  const guilds = Object.fromEntries(Array.from({length:9},(_,i)=>['G'+(i+1),{name:i===7?'Une guilde additionnelle au nom particulièrement long pour vérifier le retour à la ligne':guildNames[i]||'Guilde '+(i+1),objective:'Objectifs officiels',existingId:i<7?id(i+100):null}]));
  const members = Array.from({length:30},(_,i)=>({id:id(i+1),watcher_name:i===0?'UnPseudoSansEspacesExtrêmementLongPourVérifierQueLeTexteResteIntégralDansLImage':'Joueur '+String(i+1).padStart(2,'0'),guild_code:'G1',discord_id:'111111111111111111'}));
  const avatarBase='https://vps-aad12be0.vps.ovh.net/assets/discord-avatars/';
  members[0].discord_avatar_url=members[1].discord_avatar_url=avatarBase+'a'.repeat(64)+'.webp?v=0123456789abcdef';
  members[2].discord_avatar_url=avatarBase+'b'.repeat(64)+'.webp?v=0123456789abcdef';
  members[3].discord_avatar_url='https://cdn.discordapp.com/avatars/private/avatar.png';
  members[4].discord_avatar_url=avatarBase+'c'.repeat(64)+'.webp?v=0123456789abcdef';
  members.push({id:id(50),watcher_name:'Compte communautaire autorisé',guild_code:null,community_access_type:'community'});
  const placements = members.slice(0,29).map(m=>({id:'placement-'+m.id,member_id:m.id,member_key:m.id,member_name_snapshot:m.watcher_name,action:'set',guild_code:'G1',revision:1,actor_name:'Admin'}));
  const recipients=[{id:'recipient-29',member_id:id(29),member_key:id(29)}];
  const responses=[{survey_recipient_id:'recipient-29',poll_number:2,is_current:true,first_choice_guild_code:'G1',second_choice_guild_code:'G2',comment_text:'Réponse conservée après retrait'}];
  const roles=[{member_key:id(29),forecast_role:'officer',revision:1}];
  const buildForecast=()=>{
    const forecast=buildSurveyChoiceForecast({members:members.slice(0,30),placements,recipients,responses,roles,guilds:Object.entries(guilds).map(([code,g])=>({code,...g}))});
    forecast.players.forEach(p=>{p.canPlace=true;});
    return forecast;
  };
  const forecast = buildForecast();
  const plan = {seasonId:id(200),revision:12,appliedRevision:11,closedAt:null,guilds,removalReady:true};
  const campaign = {id:id(300),poll_number:2,is_test:false,status:'closed',target_guild_codes:Object.keys(guilds),objective_snapshot:{}};
  const workspace = {supported:true,schemaReady:true,seasonId:plan.seasonId,lifecycleReady:true,forecastRolesReady:true,plan,forecast,members,choiceCampaign:campaign,candidates:{}};
  const center = {organization:{organizationKey:'paladin'},season:{id:plan.seasonId},surveySchemaReady:true,campaigns:[{id:campaign.id,pollNumber:2,status:'closed',isTest:false}]};
  window.calls=[];
  const request = async body => {
    window.calls.push(body);
    if(body.action==='load-survey-two-workspace') return {workspace};
    if(body.action==='load-survey-two-preparation') return {preparation:{supported:true,schemaReady:true,seasonId:plan.seasonId,
      guilds:Object.entries(guilds).map(([code,g])=>({code,name:g.name})),
      version:{id:id(400),versionNumber:1,status:'official',objectives:Object.fromEntries(Object.keys(guilds).map(code=>[code,'Objectifs officiels']))},history:[]}};
    if(body.action==='load-survey-forecast-avatars') return {avatars:{}};
    if(body.action==='preview-survey-two-launch') throw new Error('canceling statement due to statement timeout');
    if(body.action==='preview-forecast-application') return {preview:{seasonId:plan.seasonId,revision:12,fingerprint:'a'.repeat(32),canApply:true,blockers:[],creations:[{code:'G8',name:guilds.G8.name}],changes:[{member_id:id(1),member_name:members[0].watcher_name,current_guild:'G1',target_guild:'G8'},{member_id:id(30),member_name:'Sans affectation',current_guild:'G1',target_guild:null}]}};
    if(body.action==='apply-forecast-plan') { await new Promise(r=>setTimeout(r,200));return {result:{transferred:1,community:1,createdGuilds:1}}; }
    if(body.action==='save-forecast-member') {
      placements.push({id:'new-'+placements.length,member_key:body.memberId,action:body.placementMode==='unassigned'?'exclude':body.guildCode?'set':'remove',guild_code:body.guildCode,revision:placements.length+1,actor_name:'Admin'});
      plan.revision++;workspace.forecast=buildForecast();return {};
    }
    if(body.action==='save-forecast-guild') return {};
    throw new Error('Unmocked operation '+body.action);
  };
  window.setClosed = value => {plan.closedAt=value?'2026-10-25':null;render();};
  const root=createRoot(document.getElementById('root'));
  const render=()=>root.render(React.createElement(Workspace,{request,center,pollNumber:2,onRefresh:async()=>{},onCenterChange:()=>{},forecastVisible:true,onForecastVisibleChange:()=>{}}));
  render();
`;
const server = await createServer({ server: { host: "127.0.0.1", port: 0, strictPort: false }, plugins: [{
  name: "isolated-plan-preview",
  resolveId(id) { return id === moduleId ? `\0${id}` : null; },
  load(id) { if (id === `\0${moduleId}`) return fixture; },
  configureServer(vite) {
    vite.middlewares.use(async (req,res,next) => {
      if (req.url !== "/isolated-plan") return next();
      res.setHeader("content-type","text/html;charset=utf-8");
      res.end(await vite.transformIndexHtml("/isolated-plan",`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#09090b;padding:16px"><div id="root"></div><script type="module" src="/@id/__x00__${moduleId}"></script></body></html>`));
    });
  },
}] });
let browser;
try {
  await server.listen();
  const address=server.httpServer.address();
  browser=await chromium.launch({channel:"msedge",headless:true});
  const errors=[];
  const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
  page.on("pageerror",e=>errors.push(e.message));
  await page.route("**/*",route=>route.request().url().startsWith(`http://127.0.0.1:${address.port}`) ? route.continue() : route.abort());
  const avatarBytes=await sharp({create:{width:64,height:64,channels:3,background:{r:30,g:120,b:200}}}).webp().toBuffer();
  await page.route('https://vps-aad12be0.vps.ovh.net/assets/discord-avatars/**',route=>route.request().url().includes('/'+'a'.repeat(64)+'.webp')
    ? route.fulfill({status:200,body:avatarBytes,contentType:'image/webp',headers:{'access-control-allow-origin':'*'}})
    : route.request().url().includes('/'+'c'.repeat(64)+'.webp')
      ? route.fulfill({status:200,body:avatarBytes,contentType:'image/webp',headers:{'access-control-allow-origin':'https://not-authorized.invalid'}})
      : route.fulfill({status:404,body:'Unavailable'}));
  await page.goto(`http://127.0.0.1:${address.port}/isolated-plan`);
  await page.getByRole("heading",{name:/Plan prévisionnel · Version/}).waitFor();
  assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.action==='preview-survey-two-launch').length),0);
  await page.getByText("Objectifs des guildes",{exact:true}).click();
  assert.equal(await page.locator('section[aria-label="Préparation des objectifs"] textarea').count(),9);
  await page.getByRole("button",{name:"Prévisualiser le sondage n° 2",exact:true}).click();
  await page.getByRole("dialog").getByText(/G9 — Guilde 9/).waitFor();
  await page.keyboard.press("Escape");
  await page.getByText("Objectifs des guildes",{exact:true}).click();
  for(const [width,height] of [[1440,1000],[1024,768],[390,844],[320,740]]) {
    await page.setViewportSize({width,height});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),`No horizontal overflow at ${width}`);
    await page.screenshot({path:resolve(output,`forecast-${width}.png`),fullPage:true});
  }
  await page.getByRole("button",{name:"Ajouter une guilde",exact:true}).click();
  await page.getByRole("textbox",{name:"Nom de la guilde"}).fill("Nouvelle guilde");
  await page.getByRole("textbox",{name:"Objectifs",exact:true}).fill("Objectif du brouillon isolé");
  await page.getByRole("button",{name:"Enregistrer le brouillon"}).click();
  await page.getByRole("dialog").waitFor({state:"hidden"});
  assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.action==='save-forecast-guild').length),1);
  await page.getByRole("button",{name:"Ajouter un joueur",exact:true}).click();
  await page.getByRole("option",{name:/Compte communautaire autorisé/}).waitFor({state:"attached"});
  await page.keyboard.press("Escape");
  const downloadPromise=page.waitForEvent("download");
  await page.evaluate(()=>{
    window.renderedText=[];window.drawnCrests=[];window.drawnAvatars=[];window.publicationImageRequests=[];
    const src=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
    Object.defineProperty(HTMLImageElement.prototype,'src',{...src,set(value){window.publicationImageRequests.push(value);src.set.call(this,value);}});
    const draw=CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText=function(text,...args){window.renderedText.push(text);return draw.call(this,text,...args);};
    const drawImage=CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage=function(image,...args){
      const path=new URL(image.src).pathname;
      if(path.startsWith('/guild-crests/')){const[x,y,width,height]=args;window.drawnCrests.push({src:path,x,y,width,height,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight});}
      else window.drawnAvatars.push({src:path,args});
      return drawImage.call(this,image,...args);
    };
  });
  await page.getByRole("button",{name:"Image G1",exact:true}).click();
  const download=await downloadPromise;
  const png=resolve(output,"plan-G1.png");await download.saveAs(png);
  const rendered=await page.evaluate(()=>window.renderedText.join(''));
  assert.ok(rendered.includes("UnPseudoSansEspacesExtrêmementLongPourVérifierQueLeTexteResteIntégralDansLImage"));
  assert.ok(!/111111111111111111|Premier choix|Commentaire/.test(rendered),"publication contains names only, no private survey data");
  const metadata=await sharp(png).metadata();assert.equal(metadata.width,1000);assert.ok(metadata.height>1600);
  const {data,info}=await sharp(png).removeAlpha().raw().toBuffer({resolveWithObject:true});
  let dark=0;for(let y=200;y<info.height-60;y++) for(let x=55;x<950;x++){const p=(y*info.width+x)*info.channels;if(data[p]<100&&data[p+1]<100&&data[p+2]<100) dark++;}
  assert.ok(dark>10000,"Export contains real text, not a blank canvas");
  const drawnAvatars=await page.evaluate(()=>window.drawnAvatars);
  assert.equal(drawnAvatars.length,2,"shared avatars remain separate; missing, invalid and CORS-blocked images use a fallback without tainting the PNG");
  assert.ok(drawnAvatars.every(a=>a.src==='/assets/discord-avatars/'+'a'.repeat(64)+'.webp'));
  assert.equal(await page.evaluate(()=>window.publicationImageRequests.filter(src=>src.includes('/assets/discord-avatars/'+'a'.repeat(64)+'.webp')).length),1,"shared avatars are loaded only once per export");
  assert.ok(!(await page.evaluate(()=>window.publicationImageRequests)).some(src=>src.includes('cdn.discordapp.com')));
  const firstAvatar=drawnAvatars[0].args;
  const avatarPixel=(Math.round(firstAvatar[5]+20)*info.width+80)*info.channels;
  assert.ok(data[avatarPixel+2]>160&&data[avatarPixel]<80,"the downloaded PNG contains the cached avatar pixels");
  const expectedCrests=['legend','imperatores-loyalty','imperatores-loyalty','collegium','senatores-legacy-magistratus','senatores-legacy-magistratus','senatores-legacy-magistratus'];
  for(let n=2;n<=8;n++) {
    const nextDownload=page.waitForEvent('download');
    await page.getByRole('button',{name:'Image G'+n,exact:true}).click();
    await (await nextDownload).saveAs(resolve(output,'plan-G'+n+'.png'));
  }
  const crests=await page.evaluate(()=>window.drawnCrests);
  assert.equal(crests.length,7,"the eighth guild has no invented or reused crest");
  for(const [index,crest] of crests.entries()) {
    assert.equal(crest.src,'/guild-crests/'+expectedCrests[index]+'.png');
    assert.ok(Math.abs(crest.width/crest.height-crest.naturalWidth/crest.naturalHeight)<0.00001,"crests retain their original aspect ratio");
    assert.ok(crest.x>=720&&crest.x+crest.width<=940&&crest.y===40);
    const region=await sharp(await sharp(resolve(output,'plan-G'+(index+1)+'.png')).extract({left:Math.ceil(crest.x)+8,top:48,width:Math.floor(crest.width)-16,height:Math.floor(crest.height)-16}).toBuffer()).stats();
    assert.ok(region.channels.slice(0,3).some(channel=>channel.mean<210),"the downloaded PNG contains real crest pixels");
  }
  let unexpectedDownloads=0;
  const onUnexpectedDownload=()=>{unexpectedDownloads++;};
  const failurePage=await browser.newPage({viewport:{width:390,height:844},acceptDownloads:true});
  failurePage.on('pageerror',e=>errors.push(e.message));
  failurePage.on('download',onUnexpectedDownload);
  await failurePage.route('**/*',route=>route.request().url().startsWith(`http://127.0.0.1:${address.port}`)?route.continue():route.abort());
  const missingCrest=route=>route.fulfill({status:404,body:'Not found'});
  await failurePage.route('**/guild-crests/imperatores-loyalty.png',missingCrest);
  await failurePage.goto(`http://127.0.0.1:${address.port}/isolated-plan`);
  await failurePage.getByRole('button',{name:'Image G2',exact:true}).click();
  await failurePage.getByRole('alert').filter({hasText:'Blason de Imperatores indisponible'}).waitFor();
  assert.equal(unexpectedDownloads,0,"a missing crest reports an explicit error, never a silently incomplete image");
  await failurePage.close();
  // Exclusion is distinct from clearing an override: preserve the answer, role and reminder status.
  await page.getByRole("button",{name:"Ouvrir Joueur 29",exact:true}).click();
  let playerDialog=page.getByRole("dialog",{name:"Joueur 29",exact:true});
  page.once("dialog",d=>d.dismiss());
  await playerDialog.getByRole("button",{name:"Retirer du plan",exact:true}).click();
  assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.action==='save-forecast-member').length),0,"cancel has no write");
  page.once("dialog",d=>d.accept());
  await playerDialog.getByRole("button",{name:"Retirer du plan",exact:true}).click();
  await playerDialog.waitFor({state:"hidden"});
  const unassigned=page.getByRole("region",{name:"Joueurs sans affectation prévisionnelle"});
  await unassigned.getByRole("button",{name:"Ouvrir Joueur 29",exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.calls.filter(c=>c.action==='save-forecast-member').map(c=>({guildCode:c.guildCode,placementMode:c.placementMode,role:c.forecastRole}))),
    [{guildCode:null,placementMode:"unassigned",role:"officer"}]);
  assert.match(await unassigned.innerText(),/Retiré du plan/);
  for(const code of ['',...Array.from({length:9},(_,i)=>'G'+(i+1))]) {
    await page.getByRole("combobox",{name:"Guilde actuelle des joueurs sans affectation",exact:true}).selectOption(code);
    assert.equal(await unassigned.getByRole("button",{name:/^Ouvrir /}).count(),!code||code==='G1'?2:0);
  }
  await page.getByRole("combobox",{name:"Guilde actuelle des joueurs sans affectation",exact:true}).selectOption('');
  await unassigned.getByRole("button",{name:"Ouvrir Joueur 29",exact:true}).click();
  playerDialog=page.getByRole("dialog",{name:"Joueur 29",exact:true});
  await playerDialog.getByText("Réponse conservée après retrait",{exact:true}).waitFor();
  assert.equal(await playerDialog.getByRole("button",{name:"Retirer du plan",exact:true}).count(),0);
  await playerDialog.getByRole("button",{name:"Modifier le placement",exact:true}).click();
  assert.equal(await page.getByRole("combobox",{name:"Guilde prévisionnelle",exact:true}).inputValue(),"__unassigned");
  await page.getByRole("combobox",{name:"Guilde prévisionnelle",exact:true}).selectOption('G3');
  await page.getByRole("button",{name:"Enregistrer",exact:true}).click();
  await page.getByRole("dialog").waitFor({state:"hidden"});
  assert.equal(await unassigned.getByRole("button",{name:"Ouvrir Joueur 29",exact:true}).count(),0,"explicit placement restores the same account");
  await page.getByRole("button",{name:"Ouvrir Joueur 29",exact:true}).click();
  playerDialog=page.getByRole("dialog",{name:"Joueur 29",exact:true});
  for(const [width,height] of [[1440,1000],[390,844],[320,740]]) {
    await page.setViewportSize({width,height});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
    await page.screenshot({path:resolve(output,`removal-dialog-${width}.png`)});
  }
  await page.keyboard.press("Escape");
  page.once("dialog",d=>d.accept());
  await page.getByRole("button",{name:"M'envoyer un test",exact:true}).click();
  await page.getByRole("alert").filter({hasText:'statement timeout'}).waitFor();
  await page.getByRole("heading",{name:/Plan prévisionnel · Version/}).waitFor();
  assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.action==='preview-survey-two-launch').length),1);
  assert.equal(await page.getByRole("button",{name:"Ouvrir Joueur 29",exact:true}).count(),1,"explicit launch-preview failure does not remove roster tables");
  await page.getByRole("button",{name:"Valider et appliquer le plan",exact:true}).click();
  await page.getByRole("button",{name:"Confirmer l’application",exact:true}).waitFor();
  assert.ok(await page.getByRole("button",{name:"Confirmer l’application",exact:true}).isDisabled());
  assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.action==='apply-forecast-plan').length),0,"preview never applies anything");
  await page.getByRole("checkbox",{name:/Je confirme les changements/}).check();
  await page.getByRole("button",{name:"Confirmer l’application",exact:true}).evaluate(button=>{button.click();button.click();});
  await page.getByRole("dialog").waitFor({state:"hidden"});
  assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.action==='apply-forecast-plan').length),1,"double clicks produce only one explicit request");
  assert.ok(!(await page.evaluate(()=>window.calls)).some(c=>/^(launch|queue)|close-survey/.test(c.action)),"No campaign mutation exists in the tested flow");
  await page.evaluate(()=>window.setClosed(true));
  await page.getByRole("button",{name:"Préparer une nouvelle Inter-saison",exact:true}).waitFor();
  assert.equal(await page.getByRole("button",{name:"Ajouter une guilde",exact:true}).count(),0,"closed cycles are read-only");
  assert.deepEqual(errors,[]);
  console.log("Browser passed: actual forecast components at 1440/1024/390/320px, explicit removal/cancel/reintegration, all guild filters, preserved answer and role, guild draft, community dropdown, application preview/double-click lock, PNG pixels. Isolated fixtures only; external requests blocked.");
} finally { await browser?.close();await server.close(); }
