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
assert.match(discordSource, /function buildWizardConditionsModal/, "team selection can open a modal from encoded wizard context");
assert.match(discordSource, /gvg_repro_create_wizard:/, "wizard modal submit carries guild/bastion/location/team context");
assert.match(discordSource, /\[REPRO TEAM\]/, "team selection has targeted diagnostic logs");
assert.match(discordSource, /function discordMessageUpdate/, "wizard select steps can edit the existing ephemeral message");
assert.match(discordSource, /type: 7/, "wizard component interactions update the existing message instead of replying again");
assert.match(discordSource, /buildLocationSelectResponse\(guild, bastion, \{ update: true \}\)/, "bastion selection edits the wizard message");
assert.match(discordSource, /buildTeamSelectResponse\(guild, bastion, location, \{ update: true \}\)/, "location selection edits the wizard message");
assert.match(discordSource, /function discordDeferredMessageUpdate/, "modal submit can defer an update to the wizard message");
assert.match(discordSource, /type: 6/, "modal submit uses deferred message update instead of a new thinking reply");
assert.match(discordSource, /deleteDeferredInteractionResponse/, "successful submit deletes the wizard ephemeral message");
assert.match(discordSource, /\[REPRO SUBMIT\]/, "submit path has temporary diagnostic logs");
assert.match(discordSource, /function buildAlreadyOpenConfirmation/, "opened defenses require explicit confirmation");
assert.match(discordSource, /Une demande de repro est deja active/, "duplicate active request is blocked");
assert.match(discordSource, /Aucun salon repro n'est configure pour cette guilde/, "guilds without a repro channel cannot open the creation form");
assert.match(discordSource, /postGuildReproAnnouncementMessage/, "creation pings the guild role once");
assert.doesNotMatch(discordSource, /postCompatibleMembersMessage/, "compatible individual pings are removed");
assert.doesNotMatch(discordSource, /Joueurs compatibles/, "compatible member lists are not posted publicly");
assert.doesNotMatch(discordSource, /Une nouvelle reproduction est disponible/, "joining a repro must not create a public announcement");
assert.match(discordSource, /warning_active/, "non-compliant awakenings are persisted as immutable warning state");
assert.match(discordSource, /gvg_repro_confirm_join:/, "non-compliant repro requires confirmation");
assert.match(discordSource, /gvg_repro_cancel_mine:/, "members can cancel their own repro");
assert.match(discordSource, /gvg_repro_confirm_open:/, "open action requires confirmation");
assert.match(discordSource, /gvg_repro_force_cancel:/, "admin force delete has a dedicated confirmation path");
assert.match(discordSource, /gvg_repro_cleanup_public:/, "admins can remove stored parasite public announcements only");
assert.match(discordSource, /buildHeroPreviewEmbed/, "hero images are rendered as Discord embed thumbnails");
assert.match(discordSource, /thumbnail = \{ url: heroUrl \}/, "hero images are sent as inline thumbnails, not markdown links");
assert.doesNotMatch(discordSource, /\`\[\$\{name\}\]\(\$\{heroUrl\}\)\`/, "hero image URLs must not be rendered as clickable markdown labels");
assert.match(discordSource, /buildDiscordUserAvatarUrl/, "reproducer avatars use Discord CDN URLs");
assert.match(discordSource, /embed\/avatars/, "default Discord avatars are supported");
assert.match(discordSource, /discordDeferredEphemeral/, "slow Discord interactions are deferred before backend work");
assert.match(serverSource, /__discordDeferred/, "API sends deferred ACKs before running slow Discord tasks");
assert.match(serverSource, /import \{ waitUntil \} from "@vercel\/functions"/, "deferred Discord tasks use Vercel waitUntil");
assert.match(serverSource, /function scheduleDiscordDeferredTask/, "Discord deferred tasks are attached to the Vercel invocation lifecycle");
assert.doesNotMatch(serverSource, /await\s+deferredTask\(\)/, "deferred Discord work must not rely on an await after res.json");
assert.match(
  serverSource,
  /res\.status\(200\)\.json\(response\);\s*scheduleDiscordDeferredTask\(deferredTask, "component"\);/,
  "component interactions ACK first and continue through waitUntil",
);
assert.match(
  serverSource,
  /res\.status\(200\)\.json\(response\);\s*scheduleDiscordDeferredTask\(deferredTask, "modal"\);/,
  "modal interactions ACK first and continue through waitUntil",
);
assert.match(discordSource, /"officier", "officer"/, "officer role can cancel an empty request");
assert.match(discordSource, /interactive_workflow_no_auto_reopen/, "panel return no longer recreates per-defense Discord cards");

const teamBranch = discordSource.slice(
  discordSource.indexOf('if (customId.startsWith("gvg_repro_team:"))'),
  discordSource.indexOf('if (customId.startsWith("gvg_repro_create_confirm:"))'),
);
assert.match(teamBranch, /buildWizardConditionsModal/, "team selection returns the modal directly");
assert.doesNotMatch(teamBranch, /\bawait\b/, "team selection must not await network work before opening the modal");
assert.doesNotMatch(teamBranch, /loadGvgDefenseByWizard/, "team selection must not load gvg_defense before opening the modal");
assert.doesNotMatch(teamBranch, /resolveMemberByDiscordUserForGuild/, "team selection must not resolve guild_members before opening the modal");
assert.doesNotMatch(teamBranch, /getActiveRequestForDefense/, "team selection must not query active repro requests before opening the modal");

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
const incompletePurgeIndex = resetSource.indexOf("reset_discord_purge_incomplete", resetBodyStart);
const deleteMatch = [...resetSource.matchAll(/\.from\("gvg_defense"\)[\s\S]{0,80}\.delete\(\)/g)].at(-1);
const deleteIndex = deleteMatch?.index ?? -1;
assert.ok(purgeIndex >= 0, "reset must purge Discord first");
assert.ok(incompletePurgeIndex > purgeIndex, "reset must log incomplete Discord purge after trying to purge");
assert.ok(incompletePurgeIndex < archiveIndex, "reset must block before enemy archive when Discord empty confirmation fails");
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
  resetSource,
  /reset_discord_purge_incomplete/,
  "reset must log Discord purge details before blocking",
);
assert.match(
  discordSource,
  /DISCORD_PURGE_VERIFY_ATTEMPTS = 5/,
  "Discord purge retries final empty-channel verification",
);
assert.match(
  discordSource,
  /DISCORD_PURGE_VERIFY_DELAY_MS = 400/,
  "Discord purge waits briefly between empty-channel verification attempts",
);
assert.match(
  discordSource,
  /channel_empty_confirmed: channelEmptyConfirmed/,
  "Discord purge success is based on confirmed empty-channel refetch",
);
assert.match(
  discordSource,
  /warnings: channelEmptyConfirmed \? errors : \[\]/,
  "intermediate Discord purge errors are preserved as warnings when the channel ends empty",
);
assert.match(
  discordSource,
  /fatal_errors: channelEmptyConfirmed \? \[\] : errors/,
  "Discord purge errors remain fatal when the final empty-channel check fails",
);
assert.match(discordSource, /remaining_message_ids/, "Discord purge logs remaining message ids when verification fails");
assert.match(discordSource, /verification_attempts/, "Discord purge reports final verification attempt count");

assert.match(serverSource, /handleDiscordReproComponentInteraction/, "Discord component interactions use the workflow router");
assert.match(serverSource, /handleDiscordReproModalInteraction/, "Discord modals use the workflow router");
assert.match(discordSource, /GUILD_DM_ACK_PREFIX = "gdmack:"/, "guild DM ack buttons are known by the HTTP interaction router");
assert.ok(
  discordSource.indexOf("isGuildDmAckCustomId(customId)") < discordSource.indexOf('return discordEphemeral("Interaction Discord non geree.")'),
  "gdmack buttons must be routed before the generic Discord fallback",
);
assert.match(discordSource, /handleGuildDmAckHttpInteraction/, "gdmack buttons have a dedicated HTTP interaction handler");

assert.match(migrationSql, /create table if not exists public\.gvg_discord_repro_controls/);
assert.match(migrationSql, /create table if not exists public\.gvg_discord_repro_participants/);
assert.match(migrationSql, /gvg_discord_repro_controls_guild_active_uidx/);
assert.match(migrationSql, /gvg_discord_repro_participants_active_member_uidx/);
assert.match(migrationSql, /add column if not exists min_awakenings jsonb/);
assert.match(verifySql, /duplicate_active_controls/);
assert.match(verifySql, /duplicate_active_participants/);

const {
  handleDiscordReproComponentInteraction,
  purgeDiscordReproChannelForGuild,
} = await import("../src/lib/discordReproServer.js");

function makeDiscordSnowflake(ms = Date.now()) {
  return String((BigInt(ms - 1420070400000) << 22n) + 1n);
}

function jsonResponse(status, payload = null) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => (payload === null ? "" : JSON.stringify(payload)),
    json: async () => payload,
  };
}

function makeSupabaseMock() {
  return {
    activityLogs: [],
    from(table) {
      return {
        table,
        data: [],
        error: null,
        count: 0,
        select() {
          this.data = [];
          return this;
        },
        update() {
          this.error = null;
          this.count = 0;
          return this;
        },
        insert(payload) {
          if (table === "portal_activity_logs") this.activityLogs?.push?.(payload);
          return { error: null };
        },
        eq() {
          return this;
        },
        in() {
          return this;
        },
      };
    },
  };
}

function makeGuildDmAckSupabaseMock() {
  const db = {
    guild_dm_campaigns: [
      { id: "campaign-ack", status: "sending", sent_count: 1, confirmed_count: 0, failed_count: 0 },
    ],
    guild_dm_recipients: [
      {
        id: "recipient-ack",
        campaign_id: "campaign-ack",
        discord_user_id: "user-ack",
        status: "sent",
        sent_at: "2026-09-26T10:00:00Z",
        confirmed_at: null,
      },
    ],
  };

  function createQuery(table) {
    return {
      table,
      filters: [],
      updatePayload: null,
      selectColumns: "",
      select(columns = "*") {
        this.selectColumns = columns;
        return this;
      },
      update(payload) {
        this.updatePayload = payload;
        return this;
      },
      eq(column, value) {
        this.filters.push([column, value]);
        return this;
      },
      filterRows() {
        return (db[this.table] || []).filter((row) =>
          this.filters.every(([column, value]) => String(row[column]) === String(value)),
        );
      },
      execute() {
        const rows = this.filterRows();
        if (this.updatePayload) {
          for (const row of rows) Object.assign(row, this.updatePayload);
        }
        return { data: rows.map((row) => ({ ...row })), error: null };
      },
      maybeSingle() {
        const result = this.execute();
        return Promise.resolve({ data: result.data[0] || null, error: null });
      },
      single() {
        const result = this.execute();
        return Promise.resolve({ data: result.data[0] || null, error: null });
      },
      then(resolve, reject) {
        return Promise.resolve(this.execute()).then(resolve, reject);
      },
    };
  }

  return {
    db,
    from(table) {
      return createQuery(table);
    },
  };
}

async function testGuildDmAckHttpRouting() {
  const previousFetch = globalThis.fetch;
  const previousToken = process.env.DISCORD_BOT_TOKEN;
  process.env.DISCORD_BOT_TOKEN = "test-token";

  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null });
    return jsonResponse(200, { ok: true });
  };

  try {
    const supabase = makeGuildDmAckSupabaseMock();
    const interaction = {
      type: 3,
      application_id: "app-test",
      token: "interaction-token",
      channel_id: "dm-channel",
      user: { id: "user-ack" },
      message: { id: "dm-message", channel_id: "dm-channel" },
      data: { custom_id: "gdmack:recipient-ack" },
    };

    const response = await handleDiscordReproComponentInteraction(supabase, interaction);
    assert.equal(response.type, 5, "gdmack must ACK immediately through a deferred response");
    assert.equal(response.__discordDeferred, true, "gdmack deferred work must be attached to waitUntil by the API layer");
    await response.deferredTask();

    const recipient = supabase.db.guild_dm_recipients[0];
    assert.equal(recipient.status, "confirmed", "gdmack confirmation updates recipient status");
    assert.ok(recipient.confirmed_at, "gdmack confirmation stores confirmed_at");
    assert.equal(supabase.db.guild_dm_campaigns[0].confirmed_count, 1, "gdmack refreshes campaign counters");
    assert.ok(
      requests.some((request) =>
        request.method === "PATCH" &&
        request.url.includes("/channels/dm-channel/messages/dm-message") &&
        request.body?.components?.[0]?.components?.[0]?.disabled === true
      ),
      "gdmack disables the Discord button on the original DM message",
    );
    assert.ok(
      requests.some((request) =>
        request.method === "PATCH" &&
        request.url.includes("/webhooks/app-test/interaction-token/messages/@original") &&
        /confirme/.test(request.body?.content || "")
      ),
      "gdmack edits the deferred ephemeral response with a confirmation",
    );

    const secondClick = await handleDiscordReproComponentInteraction(supabase, interaction);
    assert.equal(secondClick.type, 5, "second gdmack click remains handled");
    await secondClick.deferredTask();
    assert.equal(supabase.db.guild_dm_recipients[0].status, "confirmed", "second gdmack click is idempotent");

    const unknown = await handleDiscordReproComponentInteraction(
      supabase,
      { type: 3, user: { id: "user-ack" }, data: { custom_id: "unknown_button" } },
    );
    assert.match(unknown?.data?.content || "", /non geree/, "unknown buttons keep the generic fallback");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = previousToken;
  }
}

async function runPurgeVerificationScenario({ verificationPages, verificationErrorAt = 0 }) {
  const previousFetch = globalThis.fetch;
  const previousToken = process.env.DISCORD_BOT_TOKEN;
  const previousChannel = process.env.DISCORD_REPRO_CHANNEL_ID_G1;
  process.env.DISCORD_BOT_TOKEN = "test-token";
  process.env.DISCORD_REPRO_CHANNEL_ID_G1 = "channel-g1";

  const deletedId = makeDiscordSnowflake();
  let messageListCalls = 0;

  globalThis.fetch = async (url, options = {}) => {
    const method = options.method || "GET";
    const value = String(url);
    if (method === "GET" && value.includes("/channels/channel-g1/messages?")) {
      messageListCalls += 1;
      if (messageListCalls === 1) return jsonResponse(200, [{ id: deletedId }]);
      const verificationCall = messageListCalls - 1;
      if (verificationErrorAt === verificationCall) return jsonResponse(504, { message: "Gateway Timeout" });
      return jsonResponse(200, verificationPages[Math.min(verificationCall - 1, verificationPages.length - 1)] || []);
    }
    if (method === "DELETE" && value.includes(`/messages/${deletedId}`)) return jsonResponse(204);
    throw new Error(`Unexpected Discord request in test: ${method} ${value}`);
  };

  try {
    return await purgeDiscordReproChannelForGuild(makeSupabaseMock(), "G1", {
      reason: "test",
      source: "test",
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = previousToken;
    if (previousChannel === undefined) delete process.env.DISCORD_REPRO_CHANNEL_ID_G1;
    else process.env.DISCORD_REPRO_CHANNEL_ID_G1 = previousChannel;
  }
}

await testGuildDmAckHttpRouting();

const staleThenEmpty = await runPurgeVerificationScenario({
  verificationPages: [[{ id: "stale-message" }], []],
});
assert.equal(staleThenEmpty.channel_empty_confirmed, true, "stale Discord verification should retry until empty");
assert.equal(staleThenEmpty.verification_attempts, 2, "stale Discord verification should stop after the empty retry");
assert.equal(staleThenEmpty.remaining_messages, 0, "empty retry should allow reset to continue");

const neverEmpty = await runPurgeVerificationScenario({
  verificationPages: [[{ id: "still-present" }]],
});
assert.equal(neverEmpty.channel_empty_confirmed, false, "non-empty Discord channel must keep reset blocked");
assert.equal(neverEmpty.verification_attempts, 5, "non-empty Discord channel should exhaust verification retries");
assert.deepEqual(neverEmpty.remaining_message_ids, ["still-present"], "non-empty Discord verification should expose blocking message ids");

const verifyFailure = await runPurgeVerificationScenario({
  verificationPages: [],
  verificationErrorAt: 1,
});
assert.equal(verifyFailure.channel_empty_confirmed, false, "Discord verification errors must keep reset blocked");
assert.equal(verifyFailure.remaining_messages, null, "failed Discord verification should not fake an empty channel");
assert.equal(verifyFailure.fatal_errors.some((error) => error.mode === "verify_empty"), true, "verification failure should be fatal");

console.log("gvg discord repro workflow tests passed");
