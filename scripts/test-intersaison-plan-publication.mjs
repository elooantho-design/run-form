import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ROSTER_GUILD_CRESTS, buildRosterPublication } from "../src/lib/intersaisonPlanPublication.js";

globalThis.fetch = () => { throw new Error("Real network forbidden in publication tests."); };
assert.deepEqual(Object.keys(ROSTER_GUILD_CRESTS), ["G1", "G2", "G3", "G4", "G5", "G6", "G7"]);
assert.ok(Object.isFrozen(ROSTER_GUILD_CRESTS));
assert.equal(ROSTER_GUILD_CRESTS.G2, ROSTER_GUILD_CRESTS.G3);
assert.equal(ROSTER_GUILD_CRESTS.G5, ROSTER_GUILD_CRESTS.G6);
assert.equal(ROSTER_GUILD_CRESTS.G5, ROSTER_GUILD_CRESTS.G7);
assert.notEqual(ROSTER_GUILD_CRESTS.G1, ROSTER_GUILD_CRESTS.G2);
assert.equal(ROSTER_GUILD_CRESTS.G8, undefined);
assert.equal(new Set(Object.values(ROSTER_GUILD_CRESTS)).size, 4);
for (const path of new Set(Object.values(ROSTER_GUILD_CRESTS))) {
  const bytes = await readFile(new URL(`../public${path}`, import.meta.url));
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "original PNG assets remain valid");
}
const forecast = { guilds: [{ code: "G1", name: "Legend", players: [
  { memberKey: "alt", name: "Zorro", discordUserId: "shared", avatarUrl: `https://vps-aad12be0.vps.ovh.net/assets/discord-avatars/${"a".repeat(64)}.webp?v=0123456789abcdef`, answer: { comment_text: "Private" } },
  { memberKey: "main", name: "Alice", discordUserId: "shared", avatarUrl: `https://vps-aad12be0.vps.ovh.net/assets/discord-avatars/${"a".repeat(64)}.webp?v=0123456789abcdef` },
] }] };
const original = structuredClone(forecast);
const items = buildRosterPublication(forecast, 2, new Date(2026, 9, 25));
assert.deepEqual(items[0].names, ["Alice", "Zorro"]);
assert.equal(items[0].count, 2, "secondary accounts remain separate");
assert.ok(!JSON.stringify(items).includes("Private"));
assert.ok(!JSON.stringify(items).includes("discordUserId"));
assert.ok(!JSON.stringify(items).includes("shared"));
assert.equal(items[0].avatarUrls[0], forecast.guilds[0].players[1].avatarUrl, "alphabetical names retain their associated avatar");
assert.equal(items[0].avatarUrls[0], items[0].avatarUrls[1], "secondary accounts retain the shared avatar without merging names");
assert.equal(buildRosterPublication({guilds:[{code:"G2",name:"Imperatores",players:[{memberKey:"unsafe",name:"Unsafe",avatarUrl:"https://cdn.discordapp.com/avatars/private/avatar.png"}]}]},2)[0].avatarUrls[0], "", "Discord and arbitrary external URLs are never loaded by publication");
assert.deepEqual(forecast, original, "adding a crest never changes the plan data");
assert.throws(() => buildRosterPublication({ guilds: [{ ...forecast.guilds[0], players: [forecast.guilds[0].players[0], forecast.guilds[0].players[0]] }] }, 2), /plusieurs fois/);
console.log("Publication passed: exact G1-G7 crests, four original PNGs, unknown-guild fallback, alphabetical names with associated VPS-only avatars, separate secondary accounts, privacy and immutable forecast data. No network.");
