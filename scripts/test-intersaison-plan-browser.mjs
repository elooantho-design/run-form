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
  const guilds = Object.fromEntries(Array.from({length:9},(_,i)=>['G'+(i+1),{name:i===7?'Une guilde additionnelle au nom particulièrement long pour vérifier le retour à la ligne':'Guilde '+(i+1),objective:'Objectifs officiels',existingId:i<7?id(i+100):null}]));
  const members = Array.from({length:30},(_,i)=>({id:id(i+1),watcher_name:i===0?'UnPseudoSansEspacesExtrêmementLongPourVérifierQueLeTexteResteIntégralDansLImage':'Joueur '+String(i+1).padStart(2,'0'),guild_code:'G1',discord_id:'111111111111111111'}));
  members.push({id:id(50),watcher_name:'Compte communautaire autorisé',guild_code:null,community_access_type:'community'});
  const placements = members.slice(0,29).map(m=>({id:'placement-'+m.id,member_id:m.id,member_key:m.id,member_name_snapshot:m.watcher_name,action:'set',guild_code:'G1',revision:1,actor_name:'Admin'}));
  const forecast = buildSurveyChoiceForecast({members:members.slice(0,30),placements,guilds:Object.entries(guilds).map(([code,g])=>({code,...g}))});
  const plan = {seasonId:id(200),revision:12,appliedRevision:11,closedAt:null,guilds};
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
    if(body.action==='preview-forecast-application') return {preview:{seasonId:plan.seasonId,revision:12,fingerprint:'a'.repeat(32),canApply:true,blockers:[],creations:[{code:'G8',name:guilds.G8.name}],changes:[{member_id:id(1),member_name:members[0].watcher_name,current_guild:'G1',target_guild:'G8'},{member_id:id(30),member_name:'Sans affectation',current_guild:'G1',target_guild:null}]}};
    if(body.action==='apply-forecast-plan') { await new Promise(r=>setTimeout(r,200));return {result:{transferred:1,community:1,createdGuilds:1}}; }
    if(body.action==='save-forecast-guild'||body.action==='save-forecast-member') return {};
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
  await page.goto(`http://127.0.0.1:${address.port}/isolated-plan`);
  await page.getByRole("heading",{name:/Plan prévisionnel · Version/}).waitFor();
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
  await page.evaluate(()=>{window.renderedText=[];const draw=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...args){window.renderedText.push(text);return draw.call(this,text,...args);};});
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
  await page.getByRole("button",{name:"Valider et appliquer le plan",exact:true}).click();
  await page.getByRole("button",{name:"Confirmer l’application",exact:true}).waitFor();
  assert.ok(await page.getByRole("button",{name:"Confirmer l’application",exact:true}).isDisabled());
  assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.action==='apply-forecast-plan').length),0,"preview never applies anything");
  await page.getByRole("checkbox",{name:/Je confirme les changements/}).check();
  await page.getByRole("button",{name:"Confirmer l’application",exact:true}).evaluate(button=>{button.click();button.click();});
  await page.getByRole("dialog").waitFor({state:"hidden"});
  assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.action==='apply-forecast-plan').length),1,"double clicks produce only one explicit request");
  assert.ok(!(await page.evaluate(()=>window.calls)).some(c=>/launch|queue|remind|close-survey/.test(c.action)),"No campaign action exists in the tested flow");
  await page.evaluate(()=>window.setClosed(true));
  await page.getByRole("button",{name:"Préparer une nouvelle Inter-saison",exact:true}).waitFor();
  assert.equal(await page.getByRole("button",{name:"Ajouter une guilde",exact:true}).count(),0,"closed cycles are read-only");
  assert.deepEqual(errors,[]);
  console.log("Browser passed: actual forecast components at 1440/1024/390/320px, guild draft, authorized community dropdown, explicit preview, double-click lock, PNG download/pixels. Isolated fixtures only; external requests blocked.");
} finally { await browser?.close();await server.close(); }
