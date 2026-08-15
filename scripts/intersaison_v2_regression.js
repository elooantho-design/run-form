import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildIntersaisonValidationPreview,
  getActiveGuildCodesForOrganization,
  isValidIntersaisonAssignmentRole,
  normalizeIntersaisonAssignmentRole,
  selectEligibleRosterMembers,
} from "../api/_portal-intersaison-core.js";

const paladinId = "org-paladin";
const madId = "org-mad";
const aowId = "org-aow";
const guilds = [
  { organization_id: paladinId, guild_code: "G1", is_active: true },
  { organization_id: paladinId, guild_code: "G2", is_active: true },
  { organization_id: madId, guild_code: "MAD G1", is_active: true },
  { organization_id: aowId, guild_code: "AOW1", is_active: true },
  { organization_id: aowId, guild_code: "AOW2", is_active: true },
];
const members = [
  { id: "player-a", watcher_name: "Player A", guild_code: "G1", role: "member", roster_status: "active" },
  { id: "player-b", watcher_name: "Player B", guild_code: "G2", role: "member", roster_status: "active" },
  { id: "kadichon", watcher_name: "Kadichon", guild_code: "G1", role: "admin", roster_status: "non_roster" },
  { id: "moontoon", watcher_name: "Moontoon", guild_code: "G1", role: "admin", roster_status: "non_roster" },
  { id: "mad-player", watcher_name: "MAD Player", guild_code: "MAD G1", role: "member", roster_status: "active" },
  { id: "community", watcher_name: "Community", guild_code: null, role: "community_member", roster_status: "active" },
];

assert.deepEqual(
  selectEligibleRosterMembers({ members, guilds, organizationId: paladinId }).map((member) => member.id),
  ["player-a", "player-b"],
);
assert.deepEqual(
  selectEligibleRosterMembers({ members, guilds, organizationId: madId }).map((member) => member.id),
  ["mad-player"],
);
assert.deepEqual(getActiveGuildCodesForOrganization(guilds, aowId), ["AOW1", "AOW2"]);

const campaign = { id: "campaign-paladin", organization_id: paladinId, status: "active" };
const dashboards = [
  { id: "dash-g1", campaign_id: campaign.id, organization_id: paladinId, code: "G1", is_draft: false },
  { id: "dash-g2", campaign_id: campaign.id, organization_id: paladinId, code: "G2", is_draft: false },
  { id: "dash-draft", campaign_id: campaign.id, organization_id: paladinId, code: "BROUILLON", is_draft: true },
];
const preview = buildIntersaisonValidationPreview({
  campaign,
  dashboards,
  assignments: [
    {
      id: "a",
      organization_id: paladinId,
      dashboard_id: "dash-g2",
      member_id: "player-a",
      watcher_name: "Player A",
      source_guild_code: "G1",
    },
    {
      id: "b",
      organization_id: paladinId,
      dashboard_id: "dash-draft",
      member_id: "player-b",
      watcher_name: "Player B",
      source_guild_code: "G2",
    },
  ],
  members,
  memberGuilds: guilds,
  activeGuilds: guilds.filter((guild) => guild.organization_id === paladinId),
});
assert.deepEqual(preview.guildTransfers.map((item) => [item.memberId, item.from, item.to]), [["player-a", "G1", "G2"]]);
assert.deepEqual(preview.communityConversions.map((item) => [item.memberId, item.from]), [["player-b", "G2"]]);
assert.equal(preview.blockedAssignments.length, 0);

const contaminatedPreview = buildIntersaisonValidationPreview({
  campaign,
  dashboards,
  assignments: [
    {
      id: "mad",
      organization_id: paladinId,
      dashboard_id: "dash-g1",
      member_id: "mad-player",
      watcher_name: "MAD Player",
      source_guild_code: "MAD G1",
    },
  ],
  members,
  memberGuilds: guilds,
  activeGuilds: guilds.filter((guild) => guild.organization_id === paladinId),
});
assert.equal(contaminatedPreview.blockedAssignments.length, 1);
assert.equal(contaminatedPreview.blockedAssignments[0].reason, "member_cross_tenant");

const leaderDraftPreview = buildIntersaisonValidationPreview({
  campaign,
  dashboards,
  assignments: [
    { id: "leader-a", organization_id: paladinId, dashboard_id: "dash-draft", member_id: "leader", watcher_name: "Leader" },
  ],
  members: [{ id: "leader", watcher_name: "Leader", guild_code: "G1", role: "leader", roster_status: "active" }],
  memberGuilds: guilds,
  activeGuilds: guilds.filter((guild) => guild.organization_id === paladinId),
});
assert.equal(leaderDraftPreview.blockedAssignments[0].reason, "leader_cannot_be_converted_to_community");

const fakeDraftPreview = buildIntersaisonValidationPreview({
  campaign,
  dashboards: [
    ...dashboards,
    { id: "dash-fake-draft", campaign_id: campaign.id, organization_id: paladinId, code: "ARCHIVE", is_draft: true },
  ],
  assignments: [
    {
      id: "fake-draft",
      organization_id: paladinId,
      dashboard_id: "dash-fake-draft",
      member_id: "player-a",
      watcher_name: "Player A",
    },
  ],
  members,
  memberGuilds: guilds,
  activeGuilds: guilds.filter((guild) => guild.organization_id === paladinId),
});
assert.equal(fakeDraftPreview.blockedAssignments.length, 1);
assert.equal(fakeDraftPreview.blockedAssignments[0].reason, "draft_dashboard_must_be_brouillon");

const fakeBrouillonPreview = buildIntersaisonValidationPreview({
  campaign,
  dashboards: [
    ...dashboards,
    { id: "dash-fake-brouillon", campaign_id: campaign.id, organization_id: paladinId, code: "BROUILLON", is_draft: false },
  ],
  assignments: [
    {
      id: "fake-brouillon",
      organization_id: paladinId,
      dashboard_id: "dash-fake-brouillon",
      member_id: "player-a",
      watcher_name: "Player A",
    },
  ],
  members,
  memberGuilds: guilds,
  activeGuilds: guilds.filter((guild) => guild.organization_id === paladinId),
});
assert.equal(fakeBrouillonPreview.blockedAssignments.length, 1);
assert.equal(fakeBrouillonPreview.blockedAssignments[0].reason, "brouillon_dashboard_must_be_draft");

const crossCampaignDashboardPreview = buildIntersaisonValidationPreview({
  campaign,
  dashboards: [
    ...dashboards,
    { id: "dash-other-campaign", campaign_id: "other-campaign", organization_id: paladinId, code: "G2", is_draft: false },
  ],
  assignments: [
    {
      id: "wrong-dashboard",
      organization_id: paladinId,
      dashboard_id: "dash-other-campaign",
      member_id: "player-a",
      watcher_name: "Player A",
      source_guild_code: "G1",
    },
  ],
  members,
  memberGuilds: guilds,
  activeGuilds: guilds.filter((guild) => guild.organization_id === paladinId),
});
assert.equal(crossCampaignDashboardPreview.blockedAssignments.length, 1);
assert.equal(crossCampaignDashboardPreview.blockedAssignments[0].reason, "dashboard_cross_campaign");

const wrongAssignmentOrganizationPreview = buildIntersaisonValidationPreview({
  campaign,
  dashboards,
  assignments: [
    {
      id: "wrong-assignment-org",
      organization_id: madId,
      dashboard_id: "dash-g2",
      member_id: "player-a",
      watcher_name: "Player A",
      source_guild_code: "G1",
    },
  ],
  members,
  memberGuilds: guilds,
  activeGuilds: guilds.filter((guild) => guild.organization_id === paladinId),
});
assert.equal(wrongAssignmentOrganizationPreview.blockedAssignments.length, 1);
assert.equal(wrongAssignmentOrganizationPreview.blockedAssignments[0].reason, "assignment_cross_tenant");

const wrongDashboardOrganizationPreview = buildIntersaisonValidationPreview({
  campaign,
  dashboards: [
    ...dashboards,
    { id: "dash-wrong-org", campaign_id: campaign.id, organization_id: madId, code: "G2", is_draft: false },
  ],
  assignments: [
    {
      id: "wrong-dashboard-org",
      organization_id: paladinId,
      dashboard_id: "dash-wrong-org",
      member_id: "player-a",
      watcher_name: "Player A",
      source_guild_code: "G1",
    },
  ],
  members,
  memberGuilds: guilds,
  activeGuilds: guilds.filter((guild) => guild.organization_id === paladinId),
});
assert.equal(wrongDashboardOrganizationPreview.blockedAssignments.length, 1);
assert.equal(wrongDashboardOrganizationPreview.blockedAssignments[0].reason, "dashboard_cross_tenant");

const disabledTargetGuildPreview = buildIntersaisonValidationPreview({
  campaign,
  dashboards,
  assignments: [
    {
      id: "disabled-target",
      organization_id: paladinId,
      dashboard_id: "dash-g2",
      member_id: "player-a",
      watcher_name: "Player A",
      source_guild_code: "G1",
    },
  ],
  members,
  memberGuilds: guilds,
  activeGuilds: guilds.filter((guild) => guild.organization_id === paladinId && guild.guild_code !== "G2"),
});
assert.equal(disabledTargetGuildPreview.blockedAssignments.length, 1);
assert.equal(disabledTargetGuildPreview.blockedAssignments[0].reason, "target_guild_not_active_for_organization");

const mixedInvalidPreview = buildIntersaisonValidationPreview({
  campaign,
  dashboards,
  assignments: [
    ...Array.from({ length: 20 }, (_, index) => ({
      id: `valid-${index + 1}`,
      organization_id: paladinId,
      dashboard_id: index % 2 === 0 ? "dash-g1" : "dash-g2",
      member_id: index % 2 === 0 ? "player-a" : "player-b",
      watcher_name: index % 2 === 0 ? "Player A" : "Player B",
      source_guild_code: index % 2 === 0 ? "G1" : "G2",
    })),
    {
      id: "invalid-cross-tenant",
      organization_id: madId,
      dashboard_id: "dash-g1",
      member_id: "player-a",
      watcher_name: "Player A",
      source_guild_code: "G1",
    },
  ],
  members,
  memberGuilds: guilds,
  activeGuilds: guilds.filter((guild) => guild.organization_id === paladinId),
});
assert.equal(mixedInvalidPreview.blockedAssignments.length, 1);
assert.equal(mixedInvalidPreview.blockedAssignments[0].reason, "assignment_cross_tenant");

const multiAccountPreview = buildIntersaisonValidationPreview({
  campaign,
  dashboards,
  assignments: [
    {
      id: "darius-main",
      organization_id: paladinId,
      dashboard_id: "dash-g2",
      member_id: "darius-main",
      watcher_name: "Darius",
      source_guild_code: "G1",
    },
    {
      id: "darius-alt",
      organization_id: paladinId,
      dashboard_id: "dash-draft",
      member_id: "darius-alt",
      watcher_name: "DariusAlt",
      source_guild_code: "G2",
    },
  ],
  members: [
    ...members,
    { id: "darius-main", watcher_name: "Darius", guild_code: "G1", role: "leader", roster_status: "active" },
    { id: "darius-alt", watcher_name: "DariusAlt", guild_code: "G2", role: "member", roster_status: "active" },
  ],
  memberGuilds: guilds,
  activeGuilds: guilds.filter((guild) => guild.organization_id === paladinId),
});
assert.deepEqual(multiAccountPreview.guildTransfers.map((item) => item.memberId), ["darius-main"]);
assert.deepEqual(multiAccountPreview.communityConversions.map((item) => item.memberId), ["darius-alt"]);
assert.equal(normalizeIntersaisonAssignmentRole("officer"), "officer");
assert.equal(normalizeIntersaisonAssignmentRole("leader"), "leader");
assert.equal(normalizeIntersaisonAssignmentRole("captain"), "member");
assert.equal(isValidIntersaisonAssignmentRole("guild_leader"), false);

const finalizeSql = readFileSync(new URL("./intersaison_v2_finalize_campaign_rpc.sql", import.meta.url), "utf8");
const mutationSql = readFileSync(
  new URL("./intersaison_v2_assignment_mutations_rpc.sql", import.meta.url),
  "utf8",
);
const rolesSql = readFileSync(new URL("./intersaison_roles.sql", import.meta.url), "utf8");
const portalIntersaisonApi = readFileSync(new URL("../api/portal-intersaison.js", import.meta.url), "utf8");
const portalAccessApi = readFileSync(new URL("../api/portal-access.js", import.meta.url), "utf8");
const memberDeletePreflightSql = readFileSync(
  new URL("./intersaison_member_delete_preflight.sql", import.meta.url),
  "utf8",
);
const memberDeleteFkMigrationSql = readFileSync(
  new URL("./intersaison_member_delete_fk_migration.sql", import.meta.url),
  "utf8",
);
assert.match(finalizeSql, /status\s*=\s*'validated'/);
assert.match(finalizeSql, /validated_at\s*=\s*now\(\)/);
assert.match(finalizeSql, /'campaignStatus',\s*'validated'/);
assert.doesNotMatch(finalizeSql, /status\s*=\s*'completed'/);
assert.doesNotMatch(finalizeSql, /community_access_type\s*=\s*null/);
assert.doesNotMatch(finalizeSql, /community_status\s*=\s*null/);
assert.match(finalizeSql, /dashboard\.campaign_id\s*=\s*p_campaign_id/);
assert.match(finalizeSql, /v_locked_campaign_id uuid/);
assert.match(finalizeSql, /for update/);
assert.match(finalizeSql, /v_draft_count <> 1/);
assert.match(finalizeSql, /dashboard\.code = 'BROUILLON'/);
assert.match(finalizeSql, /dashboard\.is_draft = true/);
assert.match(finalizeSql, /dashboard\.is_draft = false/);
assert.match(finalizeSql, /get diagnostics v_updated_campaign_count = row_count/);
assert.match(finalizeSql, /v_updated_campaign_count <> 1/);
assert.match(
  finalizeSql,
  /from public\.intersaison_dashboards dashboard\s+where dashboard\.campaign_id = p_campaign_id\s+order by dashboard\.id\s+for update;/,
);
assert.match(
  finalizeSql,
  /from public\.intersaison_assignments assignment\s+where assignment\.campaign_id = p_campaign_id\s+order by assignment\.id\s+for update;/,
);
assert.match(
  finalizeSql,
  /from public\.guild_members member\s+where member\.id in \(\s+select assignment\.member_id\s+from public\.intersaison_assignments assignment\s+where assignment\.campaign_id = p_campaign_id/s,
);
assert.match(finalizeSql, /from public\.portal_guilds guild\s+where guild\.organization_id = p_organization_id/s);
assert.match(finalizeSql, /select member\.guild_code\s+from public\.intersaison_assignments assignment/s);
assert.match(finalizeSql, /select dashboard\.code\s+from public\.intersaison_dashboards dashboard/s);

assert.match(mutationSql, /create or replace function public\.move_intersaison_assignment_for_organization/);
assert.match(
  mutationSql,
  /create or replace function public\.toggle_intersaison_assignment_confirmation_for_organization/,
);
assert.match(mutationSql, /create or replace function public\.save_intersaison_assignment_wishes_for_organization/);
assert.match(mutationSql, /create or replace function public\.save_intersaison_assignment_note_for_organization/);
assert.match(mutationSql, /campaign\.status = 'active'\s+for update/);
assert.doesNotMatch(mutationSql, /campaign\.status in \('active',\s*'validated'\)/);
assert.match(mutationSql, /assignment\.campaign_id = p_campaign_id\s+for update/);
assert.match(mutationSql, /v_assignment\.organization_id is distinct from p_organization_id/);
assert.match(mutationSql, /dashboard\.campaign_id = p_campaign_id\s+for update/);
assert.match(mutationSql, /v_dashboard\.organization_id is distinct from p_organization_id/);
assert.match(mutationSql, /guild\.organization_id = p_organization_id/);
assert.match(mutationSql, /guild\.is_active = true/);
assert.doesNotMatch(mutationSql, /upper\(/);
assert.match(mutationSql, /with ordinality as wished\(guild_code, ordinality\)/);
assert.match(mutationSql, /guild\.guild_code = requested\.requested_code/);
assert.match(mutationSql, /v_invalid_wished_guild_codes is not null/);
assert.match(mutationSql, /Codes de guildes souhaites invalides ou hors organisation/);
assert.match(mutationSql, /array_agg\(guild\.guild_code order by requested\.first_position\)/);
assert.match(mutationSql, /revoke all on function public\.move_intersaison_assignment_for_organization/);
assert.match(mutationSql, /grant execute on function public\.save_intersaison_assignment_note_for_organization/);
assert.doesNotMatch(mutationSql, /intersaison_role/);
assert.doesNotMatch(finalizeSql, /intersaison_role/);
assert.match(rolesSql, /add column if not exists intersaison_role text/);
assert.match(rolesSql, /alter column intersaison_role set default 'member'/);
assert.match(rolesSql, /campaign\.status = 'active'/);
assert.match(rolesSql, /create or replace function public\.save_intersaison_assignment_role_for_organization/);
assert.match(rolesSql, /security definer/);
assert.match(rolesSql, /set search_path = public/);
assert.match(rolesSql, /campaign\.status = 'active'\s+for update/);
assert.match(rolesSql, /assignment\.campaign_id = p_campaign_id\s+for update/);
assert.match(rolesSql, /v_assignment\.organization_id is distinct from p_organization_id/);
assert.match(rolesSql, /grant execute on function public\.save_intersaison_assignment_role_for_organization/);
assert.doesNotMatch(rolesSql, /guild_members\s+.*role/s);

assert.match(portalIntersaisonApi, /rpc\("move_intersaison_assignment_for_organization"/);
assert.match(portalIntersaisonApi, /rpc\("toggle_intersaison_assignment_confirmation_for_organization"/);
assert.match(portalIntersaisonApi, /rpc\("save_intersaison_assignment_wishes_for_organization"/);
assert.match(portalIntersaisonApi, /rpc\("save_intersaison_assignment_note_for_organization"/);
assert.match(portalIntersaisonApi, /rpc\("save_intersaison_assignment_role_for_organization"/);
assert.match(portalIntersaisonApi, /action === "save-role"/);
assert.doesNotMatch(portalIntersaisonApi, /\.from\("intersaison_assignments"\)\s*\.update/s);
assert.doesNotMatch(portalIntersaisonApi, /\.from\("intersaison_notes"\)\s*\.insert/s);
assert.doesNotMatch(portalIntersaisonApi, /\.from\("intersaison_notes"\)\s*\.delete/s);
assert.doesNotMatch(portalIntersaisonApi, /status:\s*"cancelled"/);
assert.match(portalIntersaisonApi, /\.update\(\{ status: "archived" \}\)/);
assert.doesNotMatch(portalIntersaisonApi, /wishedGuildCodes[\s\S]*?map\(normalizeGuildCode\)/);
assert.match(portalIntersaisonApi, /p_wished_guild_codes: wishedGuildCodes/);

assert.match(portalAccessApi, /\.from\("intersaison_assignments"\)\s*\.select\("id, campaign_id"\)/s);
assert.match(portalAccessApi, /\.from\("intersaison_campaigns"\)\s*\.select\("id, label, status"\)/s);
assert.match(portalAccessApi, /status", "active"/);
assert.match(portalAccessApi, /Impossible de supprimer ce membre : il participe a une campagne Inter-saison active\./);
assert.match(portalAccessApi, /\.from\("intersaison_assignments"\)\s*\.update\(\{ member_id: null \}\)/s);
assert.match(portalAccessApi, /\.from\("intersaison_notes"\)\s*\.update\(\{ created_by_member_id: null \}\)/s);
assert.doesNotMatch(portalAccessApi, /\.from\("intersaison_assignments"\)\s*\.delete/s);
assert.doesNotMatch(portalAccessApi, /\.from\("intersaison_notes"\)\s*\.delete/s);
assert.doesNotMatch(portalAccessApi, /deleteRowsIfPresent\("intersaison_assignments"/);

assert.match(memberDeletePreflightSql, /constraint_info\.confdeltype/);
assert.match(memberDeletePreflightSql, /delete_blocker_sample_active_assignments/);
assert.match(memberDeleteFkMigrationSql, /begin;/);
assert.match(memberDeleteFkMigrationSql, /alter column member_id drop not null/);
assert.match(memberDeleteFkMigrationSql, /alter column created_by_member_id drop not null/);
assert.match(memberDeleteFkMigrationSql, /references public\.guild_members\(id\)\s+on delete set null/);
assert.match(memberDeleteFkMigrationSql, /commit;/);

console.log("Intersaison V2 tests passed.");
