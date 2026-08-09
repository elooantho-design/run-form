import assert from "node:assert/strict";

function normalizeCode(value) {
  return String(value || "").trim();
}

function activeGuildsForOrganization(guilds, organizationKey) {
  return guilds
    .filter((guild) => guild.organizationKey === organizationKey && guild.isActive)
    .map((guild) => guild.guildCode);
}

function membersForOrganization({ members, guilds, organizationKey }) {
  const allowedGuilds = new Set(activeGuildsForOrganization(guilds, organizationKey));
  return members.filter((member) => allowedGuilds.has(normalizeCode(member.guildCode)));
}

function canMoveToGuild({ guilds, organizationKey, targetGuildCode }) {
  return activeGuildsForOrganization(guilds, organizationKey).includes(normalizeCode(targetGuildCode));
}

const guilds = [
  { organizationKey: "paladin", guildCode: "G1", isActive: true },
  { organizationKey: "paladin", guildCode: "G7", isActive: true },
  { organizationKey: "paladin", guildCode: "G8", isActive: true },
  { organizationKey: "mad", guildCode: "MAD G1", isActive: true },
  { organizationKey: "age-of-war", guildCode: "AOW1", isActive: true },
  { organizationKey: "age-of-war", guildCode: "AOW2", isActive: true },
];

const members = [
  { id: "A", guildCode: "G1" },
  { id: "B", guildCode: "G7" },
  { id: "C", guildCode: "G8" },
  { id: "D", guildCode: "AOW1" },
  { id: "E", guildCode: "AOW2" },
  { id: "F", guildCode: "MAD G1" },
  { id: "G", guildCode: "" },
  { id: "H", guildCode: null },
];

assert.deepEqual(
  membersForOrganization({ members, guilds, organizationKey: "paladin" }).map((member) => member.id),
  ["A", "B", "C"],
);

assert.deepEqual(
  membersForOrganization({ members, guilds, organizationKey: "age-of-war" }).map((member) => member.id),
  ["D", "E"],
);

assert.deepEqual(
  membersForOrganization({ members, guilds, organizationKey: "mad" }).map((member) => member.id),
  ["F"],
);

assert.equal(canMoveToGuild({ guilds, organizationKey: "paladin", targetGuildCode: "AOW1" }), false);
assert.equal(canMoveToGuild({ guilds, organizationKey: "age-of-war", targetGuildCode: "G1" }), false);
assert.equal(canMoveToGuild({ guilds, organizationKey: "paladin", targetGuildCode: "G8" }), true);

const guildsWithFutureAow = [...guilds, { organizationKey: "age-of-war", guildCode: "AOW3", isActive: true }];
assert.deepEqual(activeGuildsForOrganization(guildsWithFutureAow, "age-of-war"), ["AOW1", "AOW2", "AOW3"]);

const guildsWithFuturePaladin = [...guilds, { organizationKey: "paladin", guildCode: "G9", isActive: true }];
assert.deepEqual(activeGuildsForOrganization(guildsWithFuturePaladin, "paladin"), ["G1", "G7", "G8", "G9"]);

console.log("Intersaison organization scope tests passed.");
