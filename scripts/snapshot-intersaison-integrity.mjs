// GET requests only. Output contains counts/hashes, never credentials or response text.
import { readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { createHash } from "node:crypto";
const option=name=>process.argv[process.argv.indexOf(name)+1];
if (!process.argv.includes("--env-file") || !process.argv.includes("--output-file")) throw new Error("--env-file and --output-file required.");
const env=parseEnv(await readFile(option("--env-file"),"utf8"));
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase read credentials unavailable.");
const tables=["portal_organizations","portal_guilds","guild_members","intersaison_survey_seasons",
  "intersaison_survey_campaigns","intersaison_survey_recipients","intersaison_survey_responses",
  "intersaison_survey_placements","intersaison_survey_forecast_roles","intersaison_survey_objective_versions",
  "intersaison_survey_objective_items","guild_dm_campaigns","guild_dm_recipients"];
const digest=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value==="object") return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
  return value;
}
const snapshot={capturedAt:new Date().toISOString(),tables:{},surveyTwo:[]};
for (const table of tables) {
  const rows=[];
  for(let offset=0;;offset+=1000) {
    const url=new URL(`/rest/v1/${table}`,env.SUPABASE_URL);
    url.searchParams.set("select","*");url.searchParams.set("limit","1000");url.searchParams.set("offset",String(offset));
    // Composite objective-item PK does not have an id column.
    url.searchParams.set("order",table==="intersaison_survey_objective_items"?"version_id,guild_code":"id");
    const response=await fetch(url,{method:"GET",headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`}});
    if(!response.ok) throw new Error(`Read-only snapshot failed for ${table} (HTTP ${response.status}).`);
    const page=await response.json();rows.push(...page);if(page.length<1000)break;
  }
  const identities={};
  for(const original of rows) {
    const row={...original};
    // Additive columns are not business changes to the original survey data.
    if(table==="intersaison_survey_campaigns")delete row.guild_names;
    if(table==="intersaison_survey_objective_versions")delete row.guild_codes;
    const key=String(row.id || `${row.version_id}:${row.guild_code}`);
    identities[key]=digest(stable(row));
  }
  snapshot.tables[table]={count:rows.length,fingerprint:digest(stable(identities)),rows:identities};
  if(table==="intersaison_survey_campaigns")snapshot.surveyTwo=rows.filter(c=>c.poll_number===2&&!c.is_test&&c.status!=="cancelled")
    .map(c=>({id:c.id,seasonId:c.season_id,organizationId:c.organization_id,status:c.status}));
  if(table==="intersaison_survey_recipients")for(const campaign of snapshot.surveyTwo)campaign.recipients=rows.filter(r=>r.survey_campaign_id===campaign.id).length;
  if(table==="intersaison_survey_responses")for(const campaign of snapshot.surveyTwo)campaign.responses=rows.filter(r=>r.survey_campaign_id===campaign.id&&r.is_current).length;
}
await writeFile(option("--output-file"),JSON.stringify(snapshot,null,2),"utf8");
console.log(JSON.stringify({readOnly:true,capturedAt:snapshot.capturedAt,surveyTwo:snapshot.surveyTwo,
  tables:Object.fromEntries(Object.entries(snapshot.tables).map(([name,value])=>[name,{count:value.count,fingerprint:value.fingerprint}]))},null,2));
