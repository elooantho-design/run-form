import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DISCORD_DEFENSE_DM_CAPABILITY,
  DISCORD_LOG_REMINDERS_CAPABILITY,
  hasDiscordCapability,
  isMissingPortalDiscordCapabilitiesTable,
  serializeDiscordCapabilities,
} from "../api/_portal-discord-capabilities.js";
import {
  MEMBER_ACTIVITY_REMINDER_COOLDOWN_MS,
  MEMBER_ACTIVITY_REMINDER_TYPES,
  buildLastSuccessfulMemberRemindersByMemberId,
  isRecentSuccessfulMemberReminder,
} from "../api/_portal-member-activity.js";

const now = "2026-08-30T10:00:00.000Z";
const reminders = buildLastSuccessfulMemberRemindersByMemberId([
  {
    id: "success-pb-old",
    member_id: "member-a",
    reminder_type: MEMBER_ACTIVITY_REMINDER_TYPES.PB,
    status: "success",
    created_at: "2026-08-20T10:00:00.000Z",
  },
  {
    id: "success-pb-recent",
    member_id: "member-a",
    reminder_type: MEMBER_ACTIVITY_REMINDER_TYPES.PB,
    status: "success",
    created_at: "2026-08-28T10:00:00.000Z",
  },
  {
    id: "failed-demonic",
    member_id: "member-a",
    reminder_type: MEMBER_ACTIVITY_REMINDER_TYPES.DEMONIC,
    status: "failed",
    created_at: "2026-08-29T10:00:00.000Z",
  },
]);

assert.equal(reminders.get("member-a").pb.id, "success-pb-recent", "latest successful reminder wins per module");
assert.equal(reminders.get("member-a").demonic, undefined, "failed reminder is not considered latest successful state");
assert.equal(
  isRecentSuccessfulMemberReminder(reminders.get("member-a").pb, now),
  true,
  "recent successful reminder creates a handled cell for the same module",
);
assert.equal(
  isRecentSuccessfulMemberReminder(
    { status: "success", createdAt: "2026-08-22T09:59:59.000Z" },
    now,
  ),
  false,
  "successful reminder older than seven days no longer handles stale data",
);
assert.equal(MEMBER_ACTIVITY_REMINDER_COOLDOWN_MS, 7 * 24 * 60 * 60 * 1000, "cooldown is exactly seven days");

const paladinCapabilities = serializeDiscordCapabilities([
  { capability_key: DISCORD_LOG_REMINDERS_CAPABILITY, enabled: true },
  { capability_key: DISCORD_DEFENSE_DM_CAPABILITY, enabled: true },
]);
const madCapabilities = serializeDiscordCapabilities([
  { capability_key: DISCORD_LOG_REMINDERS_CAPABILITY, enabled: false },
  { capability_key: DISCORD_DEFENSE_DM_CAPABILITY, enabled: false },
]);
const futureCapabilities = serializeDiscordCapabilities([]);

assert.equal(hasDiscordCapability(paladinCapabilities, DISCORD_LOG_REMINDERS_CAPABILITY), true, "Paladin can enable log reminders");
assert.equal(hasDiscordCapability(paladinCapabilities, DISCORD_DEFENSE_DM_CAPABILITY), true, "Paladin can enable defense DM");
assert.equal(hasDiscordCapability(madCapabilities, DISCORD_LOG_REMINDERS_CAPABILITY), false, "MAD starts with log reminders disabled");
assert.equal(hasDiscordCapability(madCapabilities, DISCORD_DEFENSE_DM_CAPABILITY), false, "MAD starts with defense DM disabled");
assert.equal(hasDiscordCapability(futureCapabilities, DISCORD_LOG_REMINDERS_CAPABILITY), false, "future org defaults to disabled");
assert.equal(
  isMissingPortalDiscordCapabilitiesTable({ code: "42P01", message: 'relation "portal_organization_capabilities" does not exist' }),
  true,
  "missing capability migration is detected",
);

const saasPortalSource = await readFile(new URL("../src/SaasPortal.jsx", import.meta.url), "utf8");
const portalActivitySource = await readFile(new URL("../api/portal-activity.js", import.meta.url), "utf8");
const guildManagementSource = await readFile(new URL("../src/components/PortalGuildManagementTab.jsx", import.meta.url), "utf8");
const portalAccessSource = await readFile(new URL("../api/portal-access.js", import.meta.url), "utf8");
const licensesSource = await readFile(new URL("../api/portal-licenses.js", import.meta.url), "utf8");
const migrationSql = await readFile(new URL("../scripts/portal_member_reminders.sql", import.meta.url), "utf8");
const verifySql = await readFile(new URL("../scripts/portal_member_reminders_verify.sql", import.meta.url), "utf8");

assert.match(saasPortalSource, /function MemberReminderModal/, "generic MemberReminderModal exists");
assert.match(saasPortalSource, /reminderType: memberActivityReminderTypes\.SITE_PRESENCE/, "Presence cell is clickable");
assert.match(saasPortalSource, /reminderType: memberActivityReminderTypes\.PB/, "PB cell is clickable");
assert.match(saasPortalSource, /reminderType: memberActivityReminderTypes\.DEMONIC/, "Demonic cell is clickable");
assert.match(saasPortalSource, /reminderType: memberActivityReminderTypes\.HERO_BOX/, "Hero box cell is clickable");
assert.match(
  saasPortalSource,
  /currentGvgStratViewedAt", statusId: "gvgStratStatus", label: "Strat GVG en cours", emptyLabel: "Non consultee" \}/,
  "current GVG strat column is not a reminder target",
);
assert.match(
  saasPortalSource,
  /lastGvgReproAt", statusId: "reproStatus", label: "Derniere repro", emptyLabel: "Aucune repro" \}/,
  "last repro column is not a reminder target",
);
assert.match(saasPortalSource, /getMemberActivityReminderInterventionState/, "cell icon is computed separately from freshness");
assert.match(saasPortalSource, /tone === "fresh"[\s\S]{0,120}icon: "check"/, "fresh data always shows handled check");
assert.match(saasPortalSource, /isRecentMemberActivityReminder\(lastReminder\)/, "stale data uses recent successful reminder");
assert.match(saasPortalSource, /window\.localStorage/, "date simulation is local to the admin browser");
assert.doesNotMatch(saasPortalSource, /last_pb_update_at\s*=/, "date simulation does not mutate real PB dates");
assert.match(saasPortalSource, /buildMemberReminderMessage/, "contextual reminder messages are generated");
assert.match(saasPortalSource, /Tes PB ne semblent pas encore avoir ete renseignes/, "PB never-filled template exists");
assert.match(saasPortalSource, /box de monstres demoniaques n'a pas ete mise a jour/, "Demonic dated template exists");
assert.match(saasPortalSource, /box de heros ne semble pas encore avoir ete renseignee/, "Hero box never-filled template exists");
assert.doesNotMatch(saasPortalSource, /Relancer toute la guilde|Relancer tous les rouges|Envoyer tous les rappels/i, "no mass reminder UI exists");

assert.match(portalActivitySource, /action === "send-reminder"/, "manual send-reminder endpoint exists");
assert.match(portalActivitySource, /action === "update-reminder-discord-id"/, "Discord ID correction endpoint exists");
assert.match(portalActivitySource, /requirePortalAdminSession/, "reminder endpoints require admin session");
assert.match(portalActivitySource, /loadScopedReminderTarget/, "reminder endpoints validate scoped member access");
assert.match(portalActivitySource, /\.eq\("organization_id", organizationId\)/, "history is scoped by organization");
assert.match(portalActivitySource, /hasDiscordCapability\(capabilityAccess\.capabilities, DISCORD_LOG_REMINDERS_CAPABILITY\)/, "log reminders are gated server-side");
assert.match(portalActivitySource, /sendDiscordDm/, "existing Discord DM helper is reused");
assert.match(portalActivitySource, /status: "failed"/, "failed Discord attempts are persisted but not successful");

assert.match(guildManagementSource, /DISCORD_DEFENSE_DM_CAPABILITY/, "guild management reads defense DM capability");
assert.match(guildManagementSource, /defenseDiscordEnabled/, "guild management disables only Discord defense actions");
assert.match(portalAccessSource, /hasDiscordCapability\(discordCapabilityAccess\.capabilities, DISCORD_DEFENSE_DM_CAPABILITY\)/, "defense DM is gated server-side");

assert.match(licensesSource, /Fonctionnalites Discord|DISCORD_LOG_REMINDERS_CAPABILITY|DISCORD_DEFENSE_DM_CAPABILITY/s, "licenses expose Discord capability controls");
assert.match(migrationSql, /create table if not exists public\.portal_member_reminders/, "migration creates member reminders table");
assert.match(migrationSql, /create table if not exists public\.portal_organization_capabilities/, "migration creates organization capabilities table");
assert.match(migrationSql, /org\.organization_key = 'paladin'/, "migration seeds Paladin capabilities by organization_key");
assert.match(migrationSql, /where org\.organization_key in \('paladin', 'mad'\)/, "migration seeds Paladin and MAD without UUIDs");
assert.match(verifySql, /paladin_discord_log_reminders/, "verify checks Paladin log reminders");
assert.match(verifySql, /mad_discord_defense_dm/, "verify checks MAD defense DM disabled");

console.log("portal member reminder tests passed");
