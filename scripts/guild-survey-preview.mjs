import { createServer, transformWithEsbuild } from "vite";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const moduleId = "virtual:guild-survey-preview.jsx";
const fixture = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import Workspace from '/src/components/GuildSurveyWorkspace.jsx';
import Inbox from '/src/components/GuildSurveyInbox.jsx';
import {reorganizationSurvey} from '/src/lib/guildSurveys.js';
import '/src/index.css';
document.documentElement.classList.add('dark');
const id=n=>'51000000-0000-4000-8000-'+String(n).padStart(12,'0');
const guilds=Array.from({length:10},(_,i)=>({id:id(100+i),guild_code:'G'+(i+1),display_name:i===7?'DEUS':i===1?'Imperatores':i===9?'UneGuildeAuNomTresLongSansEspacesPourVerifierLeMobile':'Guilde '+(i+1),active_members:3}));
const preset=reorganizationSurvey(guilds);
const sample={...preset,id:id(300),revision:1,status:'open',effective_status:'open',created_by_name:'Responsable fictif',created_at:new Date().toISOString(),can_manage:true,
 questions:preset.questions.map((q,i)=>i===1?{...q,type:'multiple'}:q)};
let campaigns=[sample];
if(new URLSearchParams(location.search).has('closed')){sample.status='closed';sample.effective_status='closed';}
if(new URLSearchParams(location.search).has('readonly'))sample.can_manage=false;
if(new URLSearchParams(location.search).has('optional'))sample.questions[0].required=false;
let rows=Array.from({length:6},(_,i)=>({id:id(400+i),member_key:id(10+i),member_name_snapshot:i===0?'UnPseudoDeJoueurTresLongSansEspacesPourVerifierLeRetourALaLigneSurMobile':'Joueur '+(i+1),guild_code_snapshot:i%2?'G8':'G2',
 linked_accounts:i===0?2:1,eligibility:i===5?'missing_discord':'eligible',delivery_status:i===5?'missing_discord':'sent',
 response:i===1?{version:1,updated_at:new Date().toISOString(),answers:{project:'option_1',availability:['option_1','option_2'],comment:'Avis fictif'}}:null}));
let waves=[];
window.surveyCalls=[];
const copy=value=>structuredClone(value);
const detail=campaign=>({ok:true,campaign,recipients:rows,waves});
async function request(action,args={}){
 window.surveyCalls.push({action,args:copy(args)});
 await new Promise(resolve=>setTimeout(resolve,25));
 if(window.surveyConflict && ['publish','remind','answer'].includes(action)){window.surveyConflict=false;const error=new Error('Les destinataires ont change. Refaire la previsualisation.');error.status=409;throw error;}
 let c=campaigns.find(c=>c.id===args.surveyId)||sample;
 if(action==='list')return copy({guilds,surveys:campaigns.map(c=>({...c,recipients_count:c.status==='draft'?0:rows.length,responses_count:c.status==='draft'?0:rows.filter(r=>r.response).length})),deliveryReady:true});
 if(action==='detail')return copy(detail(c));
 if(action==='save'){
  c={...c,...args.payload,id:args.surveyId||crypto.randomUUID(),status:'draft',effective_status:'draft',can_manage:true,revision:c.revision+1};
  campaigns=campaigns.filter(s=>s.id!==c.id).concat(c);return copy(detail(c));
 }
 if(action==='preview'||action==='reminder-preview'){
  const recipients=rows.map(r=>({...r,eligibility:action==='reminder-preview'&&r.response?'responded':r.eligibility}));
  const eligible=recipients.filter(r=>r.eligibility==='eligible').length;
  return copy({recipients,participants:recipients.length,accounts:7,eligible,excluded:recipients.length-eligible,exclusions:{missing_discord:1,...(action==='reminder-preview'?{responded:1}:{})},deliveryReady:true,fingerprint:'a'.repeat(32)});
 }
 if(action==='publish'||action==='remind'){
  await new Promise(resolve=>setTimeout(resolve,120));c.status='open';c.effective_status='open';waves.push({id:args.payload.requestId});return {queued:action==='publish'?5:4};
 }
 if(action==='close'){c.status='closed';c.effective_status='closed';return copy(detail(c));}
 if(action==='mine')return copy({surveys:campaigns.filter(c=>c.status!=='draft').map(c=>({id:c.id,title:c.title,status:c.effective_status,responded:!!rows[0].response}))});
 if(action==='answer-form')return copy({campaign:c,recipient:{name:rows[0].member_name_snapshot,guild:rows[0].guild_code_snapshot},response:rows[0].response});
 if(action==='answer'){
  await new Promise(resolve=>setTimeout(resolve,100));rows[0].response={version:(rows[0].response?.version||0)+1,answers:args.payload.answers,updated_at:new Date().toISOString()};
  return {version:rows[0].response.version};
 }
 throw new Error('Unexpected simulated action '+action);
}
function App(){const [open,setOpen]=useState(true);const member=new URLSearchParams(location.search).get('mode')==='member';return <main className="min-h-screen bg-zinc-950 p-3 text-zinc-100">
 <p className="mb-4 text-xs text-amber-300">PREVISUALISATION LOCALE - Donnees fictives, aucun envoi Discord</p>
 {member?<Inbox request={request}/>:open?<Workspace request={request} initialCreate={new URLSearchParams(location.search).has('create')} activeGuildCode="G2" onClose={()=>setOpen(false)}/>:<button onClick={()=>setOpen(true)}>Sondages</button>}
 </main>}
createRoot(document.getElementById('root')).render(<App/>);
`;

export async function startGuildSurveyPreview(port = 5192) {
  const server = await createServer({ server: { host: "127.0.0.1", port, strictPort: true }, plugins: [{
    name: "isolated-guild-survey-preview",
    resolveId(id) { if (id === moduleId) return "\0" + moduleId; },
    async load(id) { if (id === "\0" + moduleId) return transformWithEsbuild(fixture, "guild-survey-preview.jsx", { loader: "jsx", jsx: "automatic" }); },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url.startsWith("/api/")) { res.statusCode = 403; res.end("Real APIs disabled in this isolated preview"); return; }
        if (!req.url.startsWith("/__guild-surveys-preview")) { next(); return; }
        res.setHeader("Content-Type", "text/html;charset=utf-8");
        res.end(await server.transformIndexHtml("/__guild-surveys-preview", `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/__x00__${moduleId}"></script></body></html>`));
      });
    },
  }] });
  await server.listen();
  return server;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const server = await startGuildSurveyPreview(Number(process.env.SURVEY_PREVIEW_PORT || 5192));
  server.printUrls();
  console.log("Isolated preview: /__guild-surveys-preview (all real APIs denied)");
}
