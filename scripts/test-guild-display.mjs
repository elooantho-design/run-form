import assert from "node:assert/strict";
import {
  getGuildDisplayName,
  PALADIN_GUILD_DISPLAY_NAMES,
} from "../src/lib/guildDisplay.js";

assert.equal(getGuildDisplayName({ guildCode: "G1", organizationKey: "paladin" }), "Legend");
assert.equal(getGuildDisplayName({ guildCode: "G2", organizationKey: "paladin" }), "Imperatores");
assert.equal(getGuildDisplayName({ guildCode: "G3", organizationKey: "paladin" }), "Loyalty");
assert.equal(getGuildDisplayName({ guildCode: "G4", organizationKey: "paladin" }), "Collegium");
assert.equal(getGuildDisplayName({ guildCode: "G5", organizationKey: "paladin" }), "Senatores");
assert.equal(getGuildDisplayName({ guildCode: "G6", organizationKey: "paladin" }), "Legacy");
assert.equal(getGuildDisplayName({ guildCode: "G7", organizationKey: "paladin" }), "Magistratus");
assert.equal(getGuildDisplayName({ guildCode: "MAD G1", organizationKey: "mad" }), "MAD G1");
assert.equal(getGuildDisplayName({ guildCode: "G1", organizationKey: "mad" }), "G1");
assert.equal(getGuildDisplayName({ guildCode: "UNKNOWN", organizationKey: "paladin" }), "UNKNOWN");
assert.equal(getGuildDisplayName({ guildCode: null, emptyFallback: "Sans guilde" }), "Sans guilde");

const guilds = [
  {
    guild_code: "G1",
    display_name: "Nom Supabase",
    organization_key: "paladin",
  },
];
assert.equal(getGuildDisplayName({ guildCode: "G1", organizationKey: "paladin", guilds }), "Nom Supabase");

const genericGuilds = [
  {
    guild_code: "G1",
    display_name: "G1",
    organization_key: "paladin",
  },
];
assert.equal(getGuildDisplayName({ guildCode: "G1", organizationKey: "paladin", guilds: genericGuilds }), "Legend");

const watcherName = "Darius G2";
assert.equal(watcherName, "Darius G2");
assert.equal(PALADIN_GUILD_DISPLAY_NAMES.G2, "Imperatores");

console.log("guild display tests passed");
