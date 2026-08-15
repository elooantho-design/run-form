import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isValidIntersaisonAssignmentRole,
  normalizeIntersaisonAssignmentRole,
} from "../api/_portal-intersaison-core.js";

assert.equal(normalizeIntersaisonAssignmentRole("member"), "member");
assert.equal(normalizeIntersaisonAssignmentRole("officer"), "officer");
assert.equal(normalizeIntersaisonAssignmentRole("leader"), "leader");
assert.equal(normalizeIntersaisonAssignmentRole("unknown"), "member");
assert.equal(isValidIntersaisonAssignmentRole("member"), true);
assert.equal(isValidIntersaisonAssignmentRole("officer"), true);
assert.equal(isValidIntersaisonAssignmentRole("leader"), true);
assert.equal(isValidIntersaisonAssignmentRole("superadmin"), false);
assert.equal(isValidIntersaisonAssignmentRole("captain"), false);
assert.equal(isValidIntersaisonAssignmentRole("guild_leader"), false);

const rolesSql = readFileSync(new URL("./intersaison_roles.sql", import.meta.url), "utf8");
const preflightSql = readFileSync(new URL("./intersaison_roles_preflight.sql", import.meta.url), "utf8");
const verifySql = readFileSync(new URL("./intersaison_roles_verify.sql", import.meta.url), "utf8");
const mutationSql = readFileSync(
  new URL("./intersaison_v2_assignment_mutations_rpc.sql", import.meta.url),
  "utf8",
);
const finalizeSql = readFileSync(new URL("./intersaison_v2_finalize_campaign_rpc.sql", import.meta.url), "utf8");
const createSql = readFileSync(new URL("./intersaison_v2_create_campaign_rpc.sql", import.meta.url), "utf8");
const portalIntersaisonApi = readFileSync(new URL("../api/portal-intersaison.js", import.meta.url), "utf8");
const portalIntersaisonTab = readFileSync(
  new URL("../src/components/PortalIntersaisonTab.jsx", import.meta.url),
  "utf8",
);
const portalLanguage = readFileSync(new URL("../src/lib/portalLanguage.jsx", import.meta.url), "utf8");

assert.match(preflightSql, /Read-only preflight/);
assert.match(preflightSql, /information_schema\.columns/);
assert.match(preflightSql, /campaign\.status = 'active'/);
assert.match(preflightSql, /intersaison_role_column_exists/);

assert.match(rolesSql, /^begin;/);
assert.match(rolesSql, /commit;\s*$/);
assert.match(rolesSql, /add column if not exists intersaison_role text/);
assert.match(rolesSql, /alter column intersaison_role set default 'member'/);
assert.match(rolesSql, /campaign\.status = 'active'/);
assert.match(rolesSql, /and assignment\.intersaison_role is null/);
assert.match(rolesSql, /intersaison_assignments_intersaison_role_check/);
assert.match(rolesSql, /in \('member', 'officer', 'leader'\)/);
assert.match(rolesSql, /create or replace function public\.save_intersaison_assignment_role_for_organization/);
assert.match(rolesSql, /security definer/);
assert.match(rolesSql, /set search_path = public/);
assert.match(rolesSql, /campaign\.status = 'active'\s+for update/);
assert.match(rolesSql, /assignment\.campaign_id = p_campaign_id\s+for update/);
assert.match(rolesSql, /v_assignment\.organization_id is distinct from p_organization_id/);
assert.match(rolesSql, /revoke all on function public\.save_intersaison_assignment_role_for_organization/);
assert.match(rolesSql, /grant execute on function public\.save_intersaison_assignment_role_for_organization/);
assert.doesNotMatch(rolesSql, /guild_members\s+.*role/s);
assert.doesNotMatch(rolesSql, /delete\s+from/i);
assert.doesNotMatch(rolesSql, /truncate/i);
assert.doesNotMatch(rolesSql, /drop\s+table/i);

assert.match(verifySql, /member_count/);
assert.match(verifySql, /officer_count/);
assert.match(verifySql, /leader_count/);
assert.match(verifySql, /null_count/);

assert.doesNotMatch(mutationSql, /intersaison_role/);
assert.doesNotMatch(finalizeSql, /intersaison_role/);
assert.doesNotMatch(createSql, /intersaison_role/);

assert.match(portalIntersaisonApi, /intersaison_role/);
assert.match(portalIntersaisonApi, /rpc\("save_intersaison_assignment_role_for_organization"/);
assert.match(portalIntersaisonApi, /action === "save-role"/);
assert.doesNotMatch(portalIntersaisonApi, /\.from\("intersaison_assignments"\)\s*\.update/s);

assert.match(portalIntersaisonTab, /usePortalLanguage/);
assert.match(portalIntersaisonTab, /intersaison\.role\.dialogLabel/);
assert.match(portalIntersaisonTab, /intersaison\.role\.column/);
assert.match(portalIntersaisonTab, /VISIBLE_INTERSAISON_ROLE_COUNTERS = \["leader", "officer"\]/);
assert.match(portalIntersaisonTab, /focusAssignmentRow/);
assert.match(portalIntersaisonTab, /scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/);
assert.match(portalIntersaisonTab, /rolePopover/);
assert.match(portalIntersaisonTab, /setSourceFilter\("Tous"\)/);
assert.match(portalLanguage, /"intersaison\.role\.column": "Role"/);
assert.match(portalLanguage, /"intersaison\.role\.dialogLabel": "Role in this Inter-season"/);
assert.match(portalLanguage, /"intersaison\.role\.column": "Rôle"/);
assert.match(portalLanguage, /"intersaison\.role\.dialogLabel": "Rôle dans cette Inter-saison"/);

console.log("Intersaison role tests passed.");
