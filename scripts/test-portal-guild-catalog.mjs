import assert from "node:assert/strict";
import { loadPortalGuildCatalog } from "../api/_portal-guild-catalog.js";
import { configurePortalGuildCatalog, getVisibleGvgGuildCodes, getGuildSpaceKey, PALADIN_CLUSTER_GUILD_CODES } from "../src/lib/guildScope.js";
import { getGuildDisplayName } from "../src/lib/guildDisplay.js";
import { getRunScopeForGvgGuild, canUseRunTargetGuild, stratMatchesRunScope } from "../src/lib/runScopeServer.js";

globalThis.fetch=()=>{throw new Error("No network in catalog tests");};
const source={portal_organizations:[{id:"pal",organization_key:"paladin",is_active:true},{id:"mad",organization_key:"mad",is_active:true}],
  portal_guilds:[...Array.from({length:9},(_,i)=>({id:`g${i+1}`,guild_code:`G${i+1}`,organization_id:"pal",display_name:i===7?"Octava":`Nom ${i+1}`,is_active:true})),
    {id:"mad-g1",guild_code:"MAD G1",organization_id:"mad",display_name:"MAD",is_active:true},
    {id:"inactive",guild_code:"G10",organization_id:"pal",display_name:"Inactive",is_active:false}]};
class Query {
  constructor(table){this.table=table;this.filters=[];}
  select(){return this;}
  eq(key,value){this.filters.push(row=>row[key]===value);return this;}
  run(single=false){const data=source[this.table].filter(row=>this.filters.every(test=>test(row)));return {data:single?data[0]||null:data,error:null};}
  maybeSingle(){return this.run(true);}
  then(resolve,reject){return Promise.resolve(this.run()).then(resolve,reject);}
}
const db={from:table=>new Query(table)};
const catalog=await loadPortalGuildCatalog(db,{guild_code:"G8"});
assert.equal(catalog.guilds.length,9);
assert.equal(catalog.organizationId,"pal");
assert.ok(catalog.guilds.every(g=>g.organization_id==="pal"));
assert.equal((await loadPortalGuildCatalog(db,{guild_code:"MAD G1"})).guilds.length,1);
assert.deepEqual(await loadPortalGuildCatalog(db,{guild_code:null,community_access_type:"community"}),{guilds:[]});
assert.deepEqual(await loadPortalGuildCatalog(db,{guild_code:"G10"}),{guilds:[]});
globalThis.window={};
try {
  configurePortalGuildCatalog(catalog);
  assert.equal(PALADIN_CLUSTER_GUILD_CODES.length,9);
  assert.ok(getVisibleGvgGuildCodes({guildCode:"G1"}).includes("G9"));
  assert.equal(getGuildDisplayName({guildCode:"G8",organizationKey:"paladin"}),"Octava");
  assert.equal(getGuildDisplayName({guildCode:"MAD G1",organizationKey:"mad"}),"MAD G1");
  assert.deepEqual(getVisibleGvgGuildCodes({guildCode:"MAD G1"}),["MAD_G1"]);
  assert.equal(getGuildSpaceKey("G8"),"PALADIN");
  assert.equal(getGuildSpaceKey("MAD G8"),"MAD");
  const paladin=getRunScopeForGvgGuild("G8"),mad=getRunScopeForGvgGuild("MAD G1");
  assert.equal(canUseRunTargetGuild(paladin,"G9"),true);
  assert.equal(canUseRunTargetGuild(paladin,"MAD G1"),false);
  assert.equal(canUseRunTargetGuild(mad,"G8"),false);
  assert.equal(stratMatchesRunScope({guild_code:"G9"},paladin),true);
  assert.equal(stratMatchesRunScope({guild_code:"MAD G1"},paladin),false);
} finally {configurePortalGuildCatalog(null);delete globalThis.window;}
assert.equal(PALADIN_CLUSTER_GUILD_CODES.length,7);
console.log("Dynamic catalog passed: actual active guild ownership, nine-guild display, G8/G9 run scope, unchanged external organizations, community/inactive restrictions. No network.");
