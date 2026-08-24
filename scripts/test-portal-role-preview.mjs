import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  PORTAL_REAL_VIEW_MODE,
  PORTAL_ROLE_PREVIEW_OPTIONS,
  buildPortalRolePreviewSession,
  getPortalSessionServerRole,
  isPortalRolePreviewManagerSession,
  normalizePortalRolePreviewMode,
  normalizePortalRolePreviewRole,
} from "../src/lib/portalRolePreview.js";
import {
  canShowPortalAdminItem,
  canShowPortalNavItem,
  canShowPortalPve,
} from "../src/lib/portalPermissions.js";

const fullPortalAccess = {
  canUsePortalCore: true,
  canUseGvg: true,
  canSearchRuns: true,
  canUseSupportProject: true,
  canManageOwnRuns: true,
  canUseLauncher: true,
  canUseValidation: true,
};

const leaderSession = {
  id: "member-leader",
  memberId: "member-leader",
  discordId: "discord-leader",
  name: "Darius",
  watcherName: "Darius",
  role: "leader",
  guild: "G1",
  guildCode: "G1",
  guild_code: "G1",
  accessType: "guild",
  access_type: "guild",
  isAdmin: true,
  admin: true,
  isLeader: true,
  leader: true,
};

const adminSession = {
  ...leaderSession,
  id: "member-admin",
  memberId: "member-admin",
  role: "admin",
  isLeader: false,
  leader: false,
};

const memberSession = {
  ...leaderSession,
  id: "member-basic",
  memberId: "member-basic",
  role: "member",
  isAdmin: false,
  admin: false,
  isLeader: false,
  leader: false,
};

assert.deepEqual(
  PORTAL_ROLE_PREVIEW_OPTIONS.map((option) => option.id),
  [
    PORTAL_REAL_VIEW_MODE,
    "member",
    "officer",
    "admin",
    "leader",
    "community_member",
    "content_creator",
  ],
  "preview options must stay explicit and ordered",
);

assert.equal(normalizePortalRolePreviewRole("membre"), "member");
assert.equal(normalizePortalRolePreviewRole("officier"), "officer");
assert.equal(normalizePortalRolePreviewRole("administrateur"), "admin");
assert.equal(normalizePortalRolePreviewRole("leader"), "leader");
assert.equal(normalizePortalRolePreviewRole("membre de la communauté"), "community_member");
assert.equal(normalizePortalRolePreviewRole("créateur de contenu"), "content_creator");
assert.equal(normalizePortalRolePreviewMode("unknown-role"), PORTAL_REAL_VIEW_MODE);

assert.equal(isPortalRolePreviewManagerSession(leaderSession), true, "leaders can use role preview");
assert.equal(isPortalRolePreviewManagerSession(adminSession), false, "admins cannot use role preview");
assert.equal(isPortalRolePreviewManagerSession(memberSession), false, "members cannot use role preview");

const memberPreview = buildPortalRolePreviewSession(leaderSession, "member");
assert.equal(memberPreview.role, "member");
assert.equal(memberPreview.isAdmin, false);
assert.equal(memberPreview.isLeader, false);
assert.equal(getPortalSessionServerRole(memberPreview), "leader");
assert.equal(leaderSession.role, "leader", "real session must not be mutated");

const communityPreview = buildPortalRolePreviewSession(leaderSession, "content_creator");
assert.equal(communityPreview.role, "content_creator");
assert.equal(communityPreview.guildCode, "COMMUNITY");
assert.equal(communityPreview.accessType, "community");
assert.equal(getPortalSessionServerRole(communityPreview), "leader");

const adminPreview = buildPortalRolePreviewSession(leaderSession, "admin");
assert.equal(adminPreview.role, "admin");
assert.equal(adminPreview.isAdmin, true);
assert.equal(adminPreview.isLeader, false);

assert.equal(
  canShowPortalNavItem({ id: "global-chat", leaderOnly: true }, memberPreview, fullPortalAccess),
  false,
  "leader-only tabs must hide in member preview",
);
assert.equal(
  canShowPortalNavItem({ id: "global-chat", leaderOnly: true }, buildPortalRolePreviewSession(adminSession, "leader"), fullPortalAccess),
  true,
  "leader preview should expose leader-only UI affordances",
);
assert.equal(
  canShowPortalAdminItem({
    item: { id: "guild-management", adminOnly: true },
    session: memberPreview,
    isAdminUser: false,
    isLeaderUser: false,
    isPaladinUser: true,
    portalAccess: fullPortalAccess,
  }),
  false,
  "admin tabs must hide in member preview",
);
assert.equal(canShowPortalPve(communityPreview, fullPortalAccess), true, "community preview can see PVE");

const shellSource = await readFile(new URL("../src/SaasPortal.jsx", import.meta.url), "utf8");
assert.match(
  shellSource,
  /const canUseRolePreview = isPortalRolePreviewManagerSession\(session\)/,
  "selector visibility must be based on the real session",
);
assert.match(
  shellSource,
  /buildPortalRolePreviewSession\(session, rolePreviewMode\)/,
  "effective session must be derived from the real session",
);
assert.match(shellSource, /<PortalRolePreviewSelector mode=\{rolePreviewMode\}/);
assert.match(shellSource, /session=\{effectiveSession\}/);

const payloadFiles = [
  "../src/components/RunSearchGrid.jsx",
  "../src/components/RunAddTab.jsx",
  "../src/components/RunEditTab.jsx",
  "../src/components/GvgCurrentTab.jsx",
  "../src/components/GvgPanelTab.jsx",
  "../src/components/GvgAdminTab.jsx",
];

for (const relativePath of payloadFiles) {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  assert.match(source, /getPortalSessionServerRole\(session\)/, `${relativePath} must keep the server role`);
  assert.doesNotMatch(source, /role:\s*session\?\.role\s*\|\|/, `${relativePath} must not send a simulated role`);
}

console.log("Portal role preview checks passed.");
