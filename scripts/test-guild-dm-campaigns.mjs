import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  GUILD_DM_MAX_MESSAGE_LENGTH,
  buildGuildDmRecipientPlan,
  cleanDiscordUserId,
  normalizeGuildCompareKey,
  resolveManageableGuildRowsForActorFromRows,
  resolveRequestedGuildCodes,
  summarizeGuildReachability,
  validateGuildDmMessage,
} from "../api/_guild-dm-campaigns.js";

const actor = { id: "admin-mad", role: "admin", guild_code: "MAD G1" };
const portalGuildRows = [
  { guild_code: "G1", organization_id: "paladin", is_active: true },
  { guild_code: "G2", organization_id: "paladin", is_active: true },
  { guild_code: "MAD G1", organization_id: "mad", is_active: true },
  { guild_code: "MAD G2", organization_id: "mad", is_active: true },
  { guild_code: "OLD G1", organization_id: "mad", is_active: false },
];

assert.equal(normalizeGuildCompareKey("MAD   G1"), "MAD_G1", "comparison key tolerates repeated spaces");
assert.equal(normalizeGuildCompareKey("mad_g1"), "MAD_G1", "comparison key tolerates underscore technical variants");
assert.equal(cleanDiscordUserId("123456789012345678"), "123456789012345678", "valid Discord IDs are kept");
assert.equal(cleanDiscordUserId("not-discord"), "", "invalid Discord IDs are treated as missing");
assert.equal(validateGuildDmMessage("  Bonjour  "), "Bonjour", "messages are trimmed only at the edges");
assert.throws(
  () => validateGuildDmMessage("x".repeat(GUILD_DM_MAX_MESSAGE_LENGTH + 1)),
  /Message trop long/,
  "message length is enforced server-side",
);

const manageableGuilds = resolveManageableGuildRowsForActorFromRows(actor, portalGuildRows);
assert.deepEqual(
  manageableGuilds.map((row) => row.guild_code),
  ["MAD G1", "MAD G2"],
  "client admin only sees guilds from the same organization",
);

const resolved = resolveRequestedGuildCodes(["MAD_G1", "G1"], manageableGuilds);
assert.deepEqual(resolved.selected, ["MAD G1"], "requested technical key resolves to canonical Portal guild code");
assert.deepEqual(resolved.denied, ["G1"], "backend refuses guilds outside manageable scope");

const members = [
  { id: "a", watcher_name: "A", guild_code: "MAD G1", discord_id: "111111111111111111", roster_status: "active" },
  { id: "b", watcher_name: "B", guild_code: "MAD G1", discord_id: "", roster_status: "active" },
  { id: "c", watcher_name: "C", guild_code: "MAD G2", discord_id: "222222222222222222", roster_status: "active" },
  { id: "c-duplicate", watcher_name: "C alt", guild_code: "MAD G2", discord_id: "222222222222222222", roster_status: "active" },
  { id: "inactive", watcher_name: "Inactive", guild_code: "MAD G2", discord_id: "333333333333333333", roster_status: "inactive" },
];

const reachability = summarizeGuildReachability(members, manageableGuilds);
assert.deepEqual(
  reachability.map((guild) => [guild.guildCode, guild.reachableMembers, guild.missingDiscordMembers]),
  [
    ["MAD G1", 1, 1],
    ["MAD G2", 2, 0],
  ],
  "guild counters include active members and missing Discord IDs",
);

const plan = buildGuildDmRecipientPlan(members, ["MAD G1", "MAD G2"]);
assert.equal(plan.reachableCount, 2, "deduplication avoids duplicate Discord DMs");
assert.equal(plan.missingDiscordCount, 1, "members without Discord ID are excluded from recipients");
assert.equal(plan.duplicateCount, 1, "duplicate Discord IDs are reported");
assert.deepEqual(
  plan.recipients.map((recipient) => recipient.discordUserId),
  ["111111111111111111", "222222222222222222"],
  "recipient plan keeps one row per Discord user",
);

const apiSource = await readFile(new URL("../api/portal-guild-dm.js", import.meta.url), "utf8");
const helperSource = await readFile(new URL("../api/_guild-dm-campaigns.js", import.meta.url), "utf8");
const guildManagementSource = await readFile(new URL("../src/components/PortalGuildManagementTab.jsx", import.meta.url), "utf8");
const modalSource = await readFile(new URL("../src/components/GuildDmCampaignModal.jsx", import.meta.url), "utf8");
const migrationSql = await readFile(new URL("../scripts/guild_dm_campaigns.sql", import.meta.url), "utf8");
const verifySql = await readFile(new URL("../scripts/guild_dm_campaigns_verify.sql", import.meta.url), "utf8");

assert.match(apiSource, /requirePortalAdminSession/, "campaign endpoints require admin or leader Portal session");
assert.match(apiSource, /resolveRequestedGuildCodes/, "backend revalidates manageable guild scope");
assert.doesNotMatch(apiSource, /sendDiscordDm|DISCORD_TOKEN|discord\.com\/api/i, "Portal API does not send real Discord DMs");
assert.match(helperSource, /discord_id/, "member Discord snapshot is sourced from guild_members.discord_id");
assert.match(guildManagementSource, /GuildDmCampaignModal/, "Gestion guilde mounts the DM modal");
assert.match(guildManagementSource, /guildManagement\.guildDmButton/, "DM button lives in Gestion guilde actions");
assert.match(modalSource, /Nouveau message/, "modal has new-message tab");
assert.match(modalSource, /Historique/, "modal has history tab");
assert.match(modalSource, /retry-pending/, "modal exposes retry for non-confirmed recipients");
assert.doesNotMatch(guildManagementSource, /active === ["']guild-dm|Messages prives Discord["']\s*:/, "no main dashboard navigation tab is introduced");
assert.match(migrationSql, /create table if not exists public\.guild_dm_campaigns/, "migration creates campaigns table");
assert.match(migrationSql, /create table if not exists public\.guild_dm_recipients/, "migration creates recipients table");
assert.match(migrationSql, /unique index if not exists guild_dm_recipients_campaign_discord_uidx/, "migration deduplicates recipients per campaign");
assert.match(verifySql, /cross_organization_recipients/, "verify checks tenant integrity");

console.log("guild DM campaign tests passed");
