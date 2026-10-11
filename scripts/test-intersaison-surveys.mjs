import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  INTERSAISON_SURVEY_DM_INTERACTION_OBJECTIVES,
  INTERSAISON_SURVEY_ONE_DEFAULT_MESSAGE,
  buildSurveyGuildCards,
  getSurveyMemberDeliveryStatus,
} from "../api/_intersaison-surveys.js";

const guilds = Array.from({ length: 7 }, (_, index) => ({
  id: `guild-${index + 1}`,
  guild_code: `G${index + 1}`,
  display_name: `G${index + 1}`,
}));
const members = [
  ...Array.from({ length: 31 }, (_, index) => ({
    id: `g1-${String(index + 1).padStart(2, "0")}`,
    watcher_name: `Joueur ${String(index + 1).padStart(2, "0")}`,
    guild_code: "G1",
    discord_id: `111111111111111${String(index + 1).padStart(3, "0")}`,
  })),
  { id: "g2-sent", watcher_name: "Envoye", guild_code: "G2", discord_id: "222222222222222222" },
  { id: "g3-failed", watcher_name: "Erreur", guild_code: "G3", discord_id: "" },
  { id: "g4-responded", watcher_name: "Repondu", guild_code: "G4", discord_id: "444444444444444444" },
];
const surveyRecipients = [
  { id: "sr-sent", member_id: "g2-sent", guild_dm_recipient_id: "dm-sent", delivery_status: "queued" },
  {
    id: "sr-failed",
    member_id: "g3-failed",
    guild_dm_recipient_id: null,
    delivery_status: "missing_invalid",
    last_error: "ID Discord manquant",
  },
  {
    id: "sr-responded",
    member_id: "g4-responded",
    guild_dm_recipient_id: "dm-responded",
    delivery_status: "confirmed",
    responded_at: "2026-09-01T12:00:00Z",
  },
];
const dmRecipients = [
  { id: "dm-sent", status: "sent", sent_at: "2026-09-01T10:00:00Z" },
  { id: "dm-responded", status: "confirmed", confirmed_at: "2026-09-01T12:00:00Z" },
];
const responses = [
  {
    id: "response-1",
    survey_recipient_id: "sr-responded",
    objective_text: "Jouer tranquille mais organisé.",
    responded_at: "2026-09-01T12:00:00Z",
  },
];

assert.equal(
  INTERSAISON_SURVEY_DM_INTERACTION_OBJECTIVES,
  "intersaison_objectives",
  "campaign interaction type is stable for the worker",
);
assert.match(
  INTERSAISON_SURVEY_ONE_DEFAULT_MESSAGE,
  /Quel objectif aimerais-tu que ta guilde poursuive/,
  "default survey 1 message asks for free objectives",
);

const cards = buildSurveyGuildCards({ guilds, members, surveyRecipients, dmRecipients, responses });
assert.equal(cards.length, 7, "all seven guild cards are preserved");
assert.equal(cards[0].members.length, 31, "guild cards are not capped to 30 members");
assert.equal(cards[0].targeted, 0, "members without campaign rows remain neutral");
assert.equal(cards[1].members[0].delivery.color, "orange", "sent unanswered DM is orange");
assert.equal(cards[2].members[0].delivery.color, "red", "missing Discord ID is red");
assert.equal(cards[3].members[0].delivery.color, "green", "free-text response is green");
assert.equal(cards[3].members[0].response.objective_text, "Jouer tranquille mais organisé.");

assert.equal(getSurveyMemberDeliveryStatus().color, "neutral", "no campaign remains neutral");
assert.equal(
  getSurveyMemberDeliveryStatus({ surveyRecipient: { delivery_status: "queued" } }).color,
  "red",
  "queued DM is treated as awaiting action",
);

const apiSource = await readFile(new URL("../api/portal-intersaison.js", import.meta.url), "utf8");
const helperSource = await readFile(new URL("../api/_intersaison-surveys.js", import.meta.url), "utf8");
const discordSource = await readFile(new URL("../src/lib/discordReproServer.js", import.meta.url), "utf8");
const tabSource = await readFile(new URL("../src/components/PortalIntersaisonTab.jsx", import.meta.url), "utf8");
const centerSource = await readFile(
  new URL("../src/components/PortalIntersaisonSurveyCenter.jsx", import.meta.url),
  "utf8",
);
const migrationSql = await readFile(new URL("./intersaison_surveys.sql", import.meta.url), "utf8");
const preflightSql = await readFile(new URL("./intersaison_surveys_preflight.sql", import.meta.url), "utf8");
const verifySql = await readFile(new URL("./intersaison_surveys_verify.sql", import.meta.url), "utf8");
const testModePreflightSql = await readFile(
  new URL("./intersaison_surveys_test_mode_preflight.sql", import.meta.url),
  "utf8",
);
const testModeMigrationSql = await readFile(new URL("./intersaison_surveys_test_mode.sql", import.meta.url), "utf8");
const testModeVerifySql = await readFile(
  new URL("./intersaison_surveys_test_mode_verify.sql", import.meta.url),
  "utf8",
);

assert.match(helperSource, /buildSurveyGuildCards/, "survey card serialization lives in a shared helper");
assert.match(apiSource, /action === "load-survey-center"/, "survey center load action is exposed");
assert.match(apiSource, /action === "launch-survey-one"/, "survey 1 launch action is exposed");
assert.match(apiSource, /action === "launch-survey-one-test"/, "survey 1 personal test action is exposed");
assert.match(apiSource, /action === "queue-survey-recipient"/, "individual retry action is exposed");
assert.match(apiSource, /action === "queue-survey-reminders"/, "collective reminder action is exposed");
assert.match(apiSource, /action === "export-survey-one"/, "survey 1 export action is exposed");
assert.match(apiSource, /action === "finish-survey-season"/, "season can be finished to allow a future inter-season");
assert.match(apiSource, /assertSurveyGuildScopeSafe\(organizationId, guildCodes\)/, "survey member loading has an organization scope guard");
assert.match(apiSource, /\.eq\("organization_id", organization\.id\)[\s\S]{0,120}\.eq\("is_current", true\)/, "survey responses are loaded within the actor organization");
assert.match(apiSource, /\.from\(GUILD_DM_RECIPIENTS_TABLE\)[\s\S]{0,220}\.eq\("organization_id", organization\.id\)/, "DM recipients are scoped by organization");
assert.match(apiSource, /buildGuildDmRecipientPlan\(members, guildCodes\)/, "survey launch uses the existing DM queue plan");
assert.match(apiSource, /interaction_type: INTERSAISON_SURVEY_DM_INTERACTION_OBJECTIVES/, "DM campaign stores the survey interaction type");
assert.match(apiSource, /buildGuildDmTestMessage\(body\?\.message/, "personal survey tests reuse the DM test message wrapper");
assert.match(apiSource, /interaction_payload: \{ pollNumber: 1, source: "intersaison", mode: "test" \}/, "personal survey tests keep the survey interaction type in test mode");
assert.match(apiSource, /is_test: true,[\s\S]{0,140}status: "queued"/, "personal survey test DM campaigns are marked as tests");
assert.match(apiSource, /is_test: true,[\s\S]{0,160}\.select\("id"\)/, "personal survey test survey campaigns are marked as tests");
assert.match(apiSource, /const officialCampaigns = \(campaigns \|\| \[\]\)\.filter\(\(campaign\) => !campaign\.is_test\)/, "test survey campaigns are excluded from official tracking state");
assert.match(apiSource, /testCampaigns:/, "test survey campaigns are exposed separately from official tracking");
assert.match(apiSource, /campaignIds = officialCampaigns/, "recipients loaded for the center exclude test campaigns");
assert.match(apiSource, /INTERSAISON_SURVEY_RECIPIENTS_TABLE/, "survey recipients link dashboard rows to DM recipients");
assert.doesNotMatch(apiSource, /discord\.com\/api|DISCORD_BOT_TOKEN|user\.send|sendDiscordDm/i, "Portal API does not send real Discord DMs");

assert.match(discordSource, /export function buildGuildDmInteractionComponents/, "worker can render campaign-specific components");
assert.match(discordSource, /interactionType === "intersaison_objectives"/, "worker maps survey campaign to the objectives button");
assert.match(discordSource, /isIntersaisonObjectivesCustomId\(customId\)/, "component router opens the objectives modal");
assert.match(discordSource, /type: 9/, "objectives button opens a Discord modal");
assert.match(discordSource, /isIntersaisonObjectivesSubmitCustomId\(customId\)/, "modal router handles objectives submit");
assert.match(discordSource, /saveIntersaisonObjectivesResponse/, "modal submit persists the free-text response");
assert.match(discordSource, /buildIntersaisonObjectivesComponents\(dmRecipient\.id, \{ disabled: true \}\)/, "submitted survey disables the objectives button");
assert.match(discordSource, /interactionUserId !== String\(surveyRecipient\.discord_user_id \|\| ""\)/, "survey responses are restricted to the DM recipient");
assert.match(discordSource, /campaign\.organization_id[\s\S]{0,120}surveyRecipient\.organization_id/, "survey response handler rejects campaign/recipient organization mismatches");
assert.match(discordSource, /campaign\.status !== "open"/, "closed survey campaigns reject new responses");
const surveyBranchIndex = discordSource.indexOf('if (interactionType === "intersaison_objectives")');
const surveyButtonIndex = discordSource.indexOf("return buildIntersaisonObjectivesComponents", surveyBranchIndex);
const ackFallbackIndex = discordSource.indexOf("return buildGuildDmAckComponents", surveyBranchIndex);
assert.ok(
  surveyBranchIndex >= 0 && surveyButtonIndex > surveyBranchIndex && ackFallbackIndex > surveyButtonIndex,
  "survey objective campaigns render their own button before the legacy read-ack fallback",
);

assert.match(tabSource, /PortalIntersaisonSurveyCenter/, "new center is mounted in the Inter-saison tab");
assert.match(centerSource, /Centre de pilotage/, "survey center has a dedicated admin heading");
assert.match(centerSource, /Sondage 1 — Consultation des objectifs/, "survey 1 is visible");
assert.match(centerSource, /Sondage 2 — Choix de guilde/, "survey 2 placeholder is visible");
assert.match(centerSource, /Lancer le sondage 1/, "admin can start survey 1");
assert.match(centerSource, /M'envoyer un test/, "admin can queue a personal survey test");
assert.match(centerSource, /hors export officiel/, "personal survey tests are explicitly outside official exports");
assert.match(centerSource, /Dernier test personnel/, "personal survey tests have a separate status hint");
assert.match(centerSource, /Relances collectives/, "collective reminders are available");
assert.match(centerSource, /Exporter les réponses/, "response export is available");
assert.match(centerSource, /Clôturer l'inter-saison/, "admins can finish a season before starting a new one");
assert.match(centerSource, /Réessayer l'envoi/, "failed rows can be retried individually");

assert.match(preflightSql, /Read-only preflight/, "preflight is explicitly read-only");
assert.doesNotMatch(preflightSql, /\b(insert|update|delete|truncate|drop)\b/i, "preflight does not mutate data");
assert.match(preflightSql, /active_guild_code_duplicates/, "preflight detects cross-organization active guild code duplicates");
assert.match(migrationSql, /^begin;/, "migration is transactional");
assert.match(migrationSql, /commit;\s*$/i, "migration commits explicitly");
assert.match(migrationSql, /add column if not exists interaction_type text/, "migration extends DM campaigns with interaction type");
assert.match(migrationSql, /create table if not exists public\.intersaison_survey_seasons/, "migration creates survey seasons");
assert.match(migrationSql, /create table if not exists public\.intersaison_survey_campaigns/, "migration creates survey campaigns");
assert.match(migrationSql, /create table if not exists public\.intersaison_survey_recipients/, "migration creates survey recipients");
assert.match(migrationSql, /create table if not exists public\.intersaison_survey_responses/, "migration creates survey responses");
assert.match(migrationSql, /create table if not exists public\.intersaison_survey_guild_objectives/, "migration creates future guild objective table");
assert.doesNotMatch(migrationSql, /\btruncate\b|\bdrop table\b/i, "migration does not destroy existing data");
assert.match(verifySql, /guild_dm_interaction_columns/, "verify checks DM interaction columns");
assert.match(verifySql, /intersaison_survey_responses/, "verify checks response table");
assert.match(verifySql, /orphan_survey_responses/, "verify checks referential integrity");
assert.match(verifySql, /one_active_season_index/, "verify checks that finished seasons free the active season index");
assert.match(verifySql, /recipient_campaign_org_mismatches/, "verify checks recipient/campaign organization consistency");
assert.match(verifySql, /response_campaign_org_mismatches/, "verify checks response/campaign organization consistency");
assert.match(testModePreflightSql, /Read-only preflight/, "test-mode preflight is explicitly read-only");
assert.doesNotMatch(testModePreflightSql, /\b(insert|update|delete|truncate|drop)\b/i, "test-mode preflight does not mutate data");
assert.match(testModeMigrationSql, /add column if not exists is_test boolean not null default false/, "test-mode migration marks survey campaigns");
assert.match(testModeMigrationSql, /where status <> 'cancelled' and is_test = false/, "official survey uniqueness excludes test campaigns");
assert.match(testModeMigrationSql, /intersaison_survey_campaigns_org_test_created_idx/, "test survey campaigns are indexed separately");
assert.match(testModeVerifySql, /official_campaign_duplicates/, "test-mode verify checks official duplicate campaigns");
assert.match(testModeVerifySql, /test_campaigns_link_dm_test_campaigns/, "test-mode verify checks survey tests link to DM test campaigns");

console.log("Intersaison survey tests passed.");
