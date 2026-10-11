import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const portalAccessSource = readFileSync("api/portal-access.js", "utf8");
const guildManagementSource = readFileSync("src/components/PortalGuildManagementTab.jsx", "utf8");
const migrationSql = readFileSync("scripts/guild_admin_vision.sql", "utf8");
const preflightSql = readFileSync("scripts/guild_admin_vision_preflight.sql", "utf8");
const verifySql = readFileSync("scripts/guild_admin_vision_verify.sql", "utf8");

assert.match(migrationSql, /create table if not exists public\.guild_member_admin_vision_state/i);
assert.match(migrationSql, /manual_verified boolean not null default false/i);
assert.match(migrationSql, /discord_status text not null default 'not_checked'/i);
assert.match(migrationSql, /unique \(organization_id, guild_code, member_id\)/i);
assert.match(migrationSql, /discord_status in \('not_checked', 'verified', 'missing_invalid', 'not_found', 'error'\)/i);
assert.match(migrationSql, /enable row level security/i);
assert.match(migrationSql, /to service_role/i);

assert.match(preflightSql, /guild_members_required_columns/i);
assert.match(preflightSql, /portal_guilds_required_columns/i);
assert.match(verifySql, /required_columns/i);
assert.match(verifySql, /'15'/, "verify expects the exact admin vision column count");
assert.match(verifySql, /cross_organization_state_rows/i);

assert.match(portalAccessSource, /GUILD_ADMIN_VISION_TABLE = "guild_member_admin_vision_state"/);
assert.match(portalAccessSource, /guild-admin-vision-load/);
assert.match(portalAccessSource, /guild-admin-vision-toggle-member/);
assert.match(portalAccessSource, /guild-admin-vision-launch-check/);
assert.match(portalAccessSource, /resolveAdminVisionLaunchTargets/);
assert.match(portalAccessSource, /requiresConfirmation: true/);
assert.match(portalAccessSource, /verifyDiscordGuildMember\(member\.discord_id, target\.guildCode\)/);
assert.match(portalAccessSource, /discord_status: "not_checked"/);
assert.match(portalAccessSource, /isPaladinGlobalGuildAdmin\(admin, actorScope\)/);
assert.match(portalAccessSource, /Vision admin limitee a ta propre guilde/);
assert.match(portalAccessSource, /Verification cluster reservee aux administrateurs du site/);
assert.match(portalAccessSource, /\/guilds\/\$\{encodeURIComponent\(guildId\)\}\/members\/\$\{encodeURIComponent\(cleanDiscordId\)\}/);

assert.match(guildManagementSource, /Vision admin/);
assert.match(guildManagementSource, /Lancer une verification/);
assert.match(guildManagementSource, /Ma guilde/);
assert.match(guildManagementSource, /Ensemble du cluster/);
assert.match(guildManagementSource, /guild-admin-vision-launch-check/);
assert.match(guildManagementSource, /error\.payload = data/);
assert.match(guildManagementSource, /sortAdminVisionMembers/);
assert.match(guildManagementSource, /left\.manualVerified \? 1 : -1/);
assert.doesNotMatch(guildManagementSource, /onClick=\{startAdminVisionRosterCheck\}/);
assert.doesNotMatch(guildManagementSource, />\s*Verifier les ID Discord\s*</);

console.log("guild admin vision tests passed");
