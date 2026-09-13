import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const discordSource = await readFile(new URL("../src/lib/discordReproServer.js", import.meta.url), "utf8");
const importSource = await readFile(new URL("../api/gvg-import.js", import.meta.url), "utf8");
const resetSource = await readFile(new URL("../api/gvg-reset.js", import.meta.url), "utf8");
const serverSource = await readFile(new URL("../api/gvg-server.js", import.meta.url), "utf8");
const migrationSql = await readFile(
  new URL("../scripts/gvg_discord_interactive_repro_workflow.sql", import.meta.url),
  "utf8",
);
const verifySql = await readFile(
  new URL("../scripts/gvg_discord_interactive_repro_workflow_verify.sql", import.meta.url),
  "utf8",
);

assert.match(discordSource, /const REPRO_CONTROL_TABLE = "gvg_discord_repro_controls"/);
assert.match(discordSource, /const REPRO_PARTICIPANT_TABLE = "gvg_discord_repro_participants"/);
assert.match(discordSource, /function buildMainControlPayload\(guild\)/);
assert.match(discordSource, /gvg_repro_start:/, "main message exposes a single entry button");
assert.match(discordSource, /gvg_repro_bastion:/, "wizard starts with bastion selection");
assert.match(discordSource, /gvg_repro_location:/, "wizard uses fortress\/tower selection");
assert.match(discordSource, /gvg_repro_team:/, "wizard ends with team selection");
assert.match(discordSource, /function buildAlreadyOpenConfirmation/, "opened defenses require explicit confirmation");
assert.match(discordSource, /Une demande de repro est deja active/, "duplicate active request is blocked");
assert.match(discordSource, /postCompatibleMembersMessage/, "compatible members are pinged in one reply");
assert.match(discordSource, /warning_active/, "non-compliant awakenings are persisted as immutable warning state");
assert.match(discordSource, /gvg_repro_confirm_join:/, "non-compliant repro requires confirmation");
assert.match(discordSource, /gvg_repro_cancel_mine:/, "members can cancel their own repro");
assert.match(discordSource, /gvg_repro_confirm_open:/, "open action requires confirmation");
assert.match(discordSource, /gvg_repro_force_cancel:/, "admin force delete has a dedicated confirmation path");
assert.match(discordSource, /"officier", "officer"/, "officer role can cancel an empty request");
assert.match(discordSource, /interactive_workflow_no_auto_reopen/, "panel return no longer recreates per-defense Discord cards");

const notifyBody = discordSource.slice(
  discordSource.indexOf("export async function notifyDiscordReproRequestsForDefenses"),
  discordSource.indexOf("async function deleteDiscordMessage"),
);
assert.match(notifyBody, /ensureDiscordReproMainMessageForGuild/, "GVG import creates one main message per guild");
assert.doesNotMatch(notifyBody, /sendReproRequestMessage\(supabase, defense\)/, "GVG import must not flood one message per defense");

assert.match(importSource, /notifyDiscordReproRequestsForDefenses\(supabase, data \|\| \[\]\)/);

const resetBodyStart = resetSource.indexOf("const defenseIds =");
const purgeIndex = resetSource.indexOf("purgeDiscordReproChannelForGuild", resetBodyStart);
const archiveIndex = resetSource.indexOf("archiveEnemyDefensesBeforeGvgReset", resetBodyStart);
const deleteMatch = [...resetSource.matchAll(/\.from\("gvg_defense"\)[\s\S]{0,80}\.delete\(\)/g)].at(-1);
const deleteIndex = deleteMatch?.index ?? -1;
assert.ok(purgeIndex >= 0, "reset must purge Discord first");
assert.ok(archiveIndex > purgeIndex, "enemy archive must run after Discord purge");
assert.ok(deleteIndex > archiveIndex, "current GVG clear must run after enemy archive");
assert.match(resetSource, /channel_empty_confirmed/, "reset must require confirmed empty Discord channel");
assert.doesNotMatch(
  resetSource,
  /discordReproCleanup\?\.\s*errors[\s\S]{0,80}length\s*>\s*0/,
  "intermediate Discord delete errors must not block reset when the channel is confirmed empty",
);
assert.match(
  resetSource,
  /channel_empty_confirmed !== true/,
  "reset must block when final Discord empty verification is missing or false",
);
assert.match(
  discordSource,
  /channel_empty_confirmed: remainingMessages === 0/,
  "Discord purge success is based on the final empty-channel refetch",
);
assert.match(
  discordSource,
  /warnings: remainingMessages === 0 \? errors : \[\]/,
  "intermediate Discord purge errors are preserved as warnings when the channel ends empty",
);
assert.match(
  discordSource,
  /fatal_errors: remainingMessages === 0 \? \[\] : errors/,
  "Discord purge errors remain fatal when the final empty-channel check fails",
);

assert.match(serverSource, /handleDiscordReproComponentInteraction/, "Discord component interactions use the workflow router");
assert.match(serverSource, /handleDiscordReproModalInteraction/, "Discord modals use the workflow router");

assert.match(migrationSql, /create table if not exists public\.gvg_discord_repro_controls/);
assert.match(migrationSql, /create table if not exists public\.gvg_discord_repro_participants/);
assert.match(migrationSql, /gvg_discord_repro_controls_guild_active_uidx/);
assert.match(migrationSql, /gvg_discord_repro_participants_active_member_uidx/);
assert.match(migrationSql, /add column if not exists min_awakenings jsonb/);
assert.match(verifySql, /duplicate_active_controls/);
assert.match(verifySql, /duplicate_active_participants/);

console.log("gvg discord repro workflow tests passed");
