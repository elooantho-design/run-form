import assert from "node:assert/strict";
import {
  buildLinkedAccountSearchText,
  buildLinkedAccountSummary,
  getEffectiveDiscordId,
  validateSecondaryLink,
} from "../src/lib/linkedAccounts.js";

const principal = {
  id: "principal-id",
  watcher_name: "Darius",
  guild_code: "G1",
  discord_id: "123456789012345678",
  personal_forum_post_url: "https://discord.com/channels/1/2/3",
};

const secondary = {
  id: "secondary-id",
  watcher_name: "DariusAlt",
  guild_code: "G7",
  discord_id: "999999999999999999",
  primary_member_id: "principal-id",
  personal_forum_post_url: "https://discord.com/channels/4/5/6",
};

const secondaryTwo = {
  id: "secondary-two-id",
  watcher_name: "DariusG7",
  guild_code: "G7",
  primary_member_id: "principal-id",
};

assert.equal(validateSecondaryLink({ primary: principal, secondary, secondaryChildrenCount: 0 }).ok, true);

assert.equal(
  validateSecondaryLink({
    primary: { ...principal, id: "other-principal-id", watcher_name: "Other" },
    secondary,
    secondaryChildrenCount: 0,
  }).ok,
  false,
  "a secondary already linked to A cannot be relinked to another principal without explicit unlink",
);

assert.equal(
  validateSecondaryLink({ primary: principal, secondary: principal, secondaryChildrenCount: 0 }).ok,
  false,
  "self-link must be refused",
);

assert.equal(
  validateSecondaryLink({ primary: secondary, secondary: secondaryTwo, secondaryChildrenCount: 0 }).ok,
  false,
  "a secondary account cannot be used as principal",
);

assert.equal(
  validateSecondaryLink({ primary: principal, secondary, secondaryChildrenCount: 1 }).ok,
  false,
  "a member that already owns secondaries cannot become secondary",
);

assert.equal(
  getEffectiveDiscordId(secondary, principal),
  principal.discord_id,
  "secondary effective Discord ID must come from principal",
);

assert.equal(
  secondary.personal_forum_post_url,
  "https://discord.com/channels/4/5/6",
  "forum URL remains per account and is not inherited",
);

const primarySummary = buildLinkedAccountSummary(principal, {
  linkedAccounts: [principal, secondary, secondaryTwo],
});
assert.equal(primarySummary.status, "primary");
assert.equal(primarySummary.secondaryCount, 2);

const secondarySummary = buildLinkedAccountSummary(secondary, {
  primary: principal,
  linkedAccounts: [principal, secondary, secondaryTwo],
});
assert.equal(secondarySummary.status, "secondary");
assert.equal(secondarySummary.primaryName, "Darius");

const searchText = buildLinkedAccountSearchText({
  watcher_name: "DariusAlt",
  guild_code: "G7",
  accountLink: {
    primaryWatcherName: "Darius",
    primaryGuildCode: "G1",
  },
});
assert.match(searchText, /DariusAlt/);
assert.match(searchText, /Darius/);
assert.match(searchText, /G1/);

console.log("linked account tests passed");
