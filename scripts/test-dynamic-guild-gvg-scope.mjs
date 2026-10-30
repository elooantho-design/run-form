import assert from "node:assert/strict";
import { normalizeGvgGuildCode, getVisibleGvgGuildCodes } from "../src/lib/guildScope.js";
import { resolveRunScope, getRunTargetGuildCode, canUseRunTargetGuild, stratMatchesRunScope } from "../src/lib/runScopeServer.js";
import { buildSourceGvgKey, resolvePortalGuildForGvgGuild } from "../api/_gvg-enemy-defense-bank.js";

globalThis.fetch = () => { throw new Error("No network in GvG scope tests"); };
const db = { from() { throw new Error("Paladin does not require an external license or untrusted identity lookup"); } };
const sourceKeys = new Set();
for (const guild of ["G1", "G7", "G8", "G9", "G10"]) {
  const actor = { id: "actor-" + guild, guild_code: guild, role: "admin" };
  const scope = await resolveRunScope(db, { body: { session: { memberId: "forged", guildCode: "G1" } } }, actor);
  assert.equal(scope.memberId, actor.id);
  assert.equal(scope.guildCode, guild);
  assert.equal(scope.canUseGvg, true);
  assert.equal(getRunTargetGuildCode(scope, guild), guild);
  assert.equal(normalizeGvgGuildCode(" " + guild.toLowerCase() + " "), guild);
  assert.ok(getVisibleGvgGuildCodes({ guildCode: guild }).includes(guild));
  assert.equal(canUseRunTargetGuild(scope, "MAD G1"), false);
  assert.equal(stratMatchesRunScope({ guild_code: "MAD G1" }, scope), false);
  sourceKeys.add(buildSourceGvgKey(guild, [{ id: "same-defense", created_at: "2026-10-30" }]));
}
assert.equal(sourceKeys.size, 5, "identical defense IDs from different guilds have distinct source GvG identities");
assert.equal((await resolveRunScope(db, { body: { session: { memberId: "forged", guildCode: "G8", role: "admin" } } })).canUseGvg, false);
const guildRows = ["G8", "G9", "G10"].map(code => ({ id: "guild-" + code, guild_code: code, organization_id: "paladin" }));
const catalogDb = { from(table) {
  assert.equal(table, "portal_guilds");
  return { select() { return this; }, eq() { return this; }, then(resolve) { return Promise.resolve({ data: guildRows, error: null }).then(resolve); } };
} };
for (const guild of ["G8", "G9", "G10"]) {
  const resolved = await resolvePortalGuildForGvgGuild(catalogDb, guild);
  assert.equal(resolved.id, "guild-" + guild);
  assert.equal(resolved.organization_id, "paladin");
}
console.log("Dynamic GvG scopes OK: trusted identities, distinct G8/G9/G10 codes and source keys, organization isolation, dynamic catalog, no capture/network.");
