import assert from "node:assert/strict";
import { filterMembersForMemberDataActor, resolveMemberDataViewPermission, resolveMemberDataEditPermission } from "../api/_member-data-permissions.js";
import { PALADIN_CLUSTER_GUILD_CODES } from "../src/lib/guildScope.js";
import { assertPersonalDataActor, resolvePersonalMemberId } from "../src/lib/memberDataSelection.js";

globalThis.fetch = () => { throw new Error("Production access forbidden in member-data tests."); };
const member = (n, guild) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`, watcher_name: `Player ${n}`, guild_code: guild, role: "member" });
const historic = member(1,"G1");
const g8a = member(8,"G8"), g8b = member(18,"G8"), g9 = member(9,"G9"), g10 = member(10,"G10");
const foreign = member(20,"MAD G1");
const rows = [historic,g8a,g8b,g9,g10,foreign];
const original = structuredClone(rows);
assert.equal(PALADIN_CLUSTER_GUILD_CODES.includes("G8"),false,"test must reproduce cold server state, not a configured browser catalog");
for (const actor of [historic,g8a,g8b,g9,g10]) {
  const visible = filterMembersForMemberDataActor(rows,actor);
  assert.ok(visible.some(row=>row.id===actor.id),`${actor.guild_code}: authenticated self must never disappear`);
  assert.ok(!visible.some(row=>row.id===foreign.id),"organizations remain separated");
  assert.equal(resolveMemberDataEditPermission(actor,actor).canEdit,true);
  assert.equal(resolveMemberDataEditPermission(actor,foreign).canEdit,false);
}
assert.deepEqual(filterMembersForMemberDataActor(rows,g8a,{guildCode:"G8"}).map(m=>m.id),[g8a.id,g8b.id]);
assert.deepEqual(filterMembersForMemberDataActor(rows,g9,{guildCode:"G9"}).map(m=>m.id),[g9.id]);
assert.deepEqual(filterMembersForMemberDataActor(rows,g10,{guildCode:"G10"}).map(m=>m.id),[g10.id]);
for (const actor of [null,{}, {guild_code:"G8",role:"leader"}]) {
  assert.deepEqual(filterMembersForMemberDataActor(rows,actor),[]);
  assert.equal(resolveMemberDataViewPermission(actor,historic).canView,false);
  assert.equal(resolveMemberDataEditPermission(actor,historic).canEdit,false);
}
const unscopedA={...member(30,null)}, unscopedB={...member(31,null)};
assert.equal(resolveMemberDataViewPermission(unscopedA,unscopedB).canView,false,"missing guild is never an implicit Paladin scope");
assert.deepEqual(filterMembersForMemberDataActor([unscopedA,unscopedB,historic],unscopedA).map(m=>m.id),[unscopedA.id]);
assert.deepEqual(rows,original,"scope resolution does not alter identities or real guilds");
for (const actor of [historic,g8a,g8b,g9,g10]) {
  assert.equal(resolvePersonalMemberId(rows,actor.id),actor.id);
  assert.equal(resolvePersonalMemberId(rows,actor.id,"unknown"),"");
  assert.equal(resolvePersonalMemberId(rows.filter(m=>m.id!==actor.id),actor.id),"","no alphabetic or positional fallback");
  assertPersonalDataActor({actorMemberId:actor.id},actor.id);
  assert.throws(()=>assertPersonalDataActor({actorMemberId:historic.id},actor.id===historic.id?g8a.id:actor.id),/introuvable/);
}
assert.equal(resolvePersonalMemberId(rows,"unknown",historic.id),"");
assert.equal(resolvePersonalMemberId(rows,null,historic.id),"");
assert.throws(()=>assertPersonalDataActor({},null),/introuvable/);
console.log("Dynamic member-data scope passed: cold G1-G7/G8/G9/G10, independent users, self writes, denied foreign writes, unresolved identities and immutable roster.");
