import assert from "node:assert/strict";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

const {
  applyMemberEditUpdatePolicy,
  canAdminManageTarget,
  canManageEditableGuildMember,
  findCanonicalPortalGuildCode,
  isCommunityAccount,
  isPaladinGlobalGuildAdmin,
} = await import("../api/portal-access.js");
const {
  filterMembersForMemberDataActor,
  isCommunityMemberDataScope,
} = await import("../api/_member-data-permissions.js");

const paladinScope = { organizationKey: "paladin", allowedGuildCodes: ["G1", "G2", "G7", "MAD G1", "GUILDTEST G1"] };
const madScope = { organizationKey: "mad", allowedGuildCodes: ["MAD G1"] };

const leader = { id: "leader", watcher_name: "Leader", role: "leader", guild_code: "G1" };
const paladinAdmin = { id: "admin-paladin-g2", watcher_name: "Admin Paladin G2", role: "admin", guild_code: "G2" };
const madAdmin = { id: "admin-mad", watcher_name: "Admin MAD", role: "admin", guild_code: "MAD G1" };
const memberG1 = { id: "member-g1", watcher_name: "Member G1", role: "member", guild_code: "G1" };
const memberG2 = { id: "member-g2", watcher_name: "Member G2", role: "member", guild_code: "G2" };
const memberG7 = { id: "member-g7", watcher_name: "Member G7", role: "member", guild_code: "G7" };
const communityMember = {
  id: "community",
  watcher_name: "Community",
  role: "community_member",
  guild_code: null,
  community_access_type: "community",
  community_status: "active",
};
const targetAdminPaladin = { id: "target-admin-paladin", watcher_name: "Target Admin Paladin", role: "admin", guild_code: "G2" };
const targetAdminMad = { id: "target-admin-mad", watcher_name: "Target Admin MAD", role: "admin", guild_code: "MAD G1" };
const targetLeader = { id: "target-leader", watcher_name: "Target Leader", role: "leader", guild_code: "G1" };
const madMember = { id: "mad-member", watcher_name: "MAD Member", role: "member", guild_code: "MAD G1" };
const madSecondary = {
  ...madMember,
  id: "mad-secondary",
  watcher_name: "MAD Secondary",
  primary_member_id: "member-g1",
};
const ordinaryActor = { id: "ordinary", watcher_name: "Ordinary", role: "member", guild_code: "G1" };
const portalGuildRows = [{ guild_code: "G1" }, { guild_code: "G2" }, { guild_code: "MAD G1" }];

function editablePolicySucceeds(actor, target, patch, scope = {}) {
  assert.doesNotThrow(() => applyMemberEditUpdatePolicy({ admin: actor, target, patch, editableScope: true, scope }));
}

function editablePolicyFails(actor, target, patch, scope = {}) {
  assert.throws(
    () => applyMemberEditUpdatePolicy({ admin: actor, target, patch, editableScope: true, scope }),
    /leader|perimetre|refusee/i,
  );
}

function guildManagementPolicySucceeds(actor, target, patch, options = {}) {
  assert.doesNotThrow(() => applyMemberEditUpdatePolicy({ admin: actor, target, patch, ...options }));
}

function guildManagementPolicyFails(actor, target, patch, options = {}) {
  assert.throws(
    () => applyMemberEditUpdatePolicy({ admin: actor, target, patch, ...options }),
    /leader|perimetre|refusee/i,
  );
}

assert.equal(isPaladinGlobalGuildAdmin(paladinAdmin, paladinScope), true, "Paladin admin scope is resolved from organization");
assert.equal(isPaladinGlobalGuildAdmin(paladinAdmin, madScope), false, "Paladin-like guild code is not enough with another organization");
assert.equal(isPaladinGlobalGuildAdmin(paladinAdmin), false, "global Paladin scope is not granted without resolved organization");
assert.equal(isPaladinGlobalGuildAdmin(leader, paladinScope), false, "leader uses its own bypass, not the Paladin admin helper");
assert.equal(findCanonicalPortalGuildCode("MAD G1", portalGuildRows), "MAD G1", "canonical Portal guild code keeps spaces");
assert.equal(findCanonicalPortalGuildCode("MAD_G1", portalGuildRows), "MAD G1", "technical underscore key resolves to Portal canonical value");
assert.equal(findCanonicalPortalGuildCode("mad   g1", portalGuildRows), "MAD G1", "case and repeated spaces resolve to Portal canonical value");
assert.equal(findCanonicalPortalGuildCode("mad_g1", [{ guildCode: "MAD G1" }]), "MAD G1", "serialized guild rows also resolve to Portal canonical value");
assert.equal(findCanonicalPortalGuildCode("UNKNOWN G1", portalGuildRows), "", "unknown guild code is not silently normalized");

assert.equal(canAdminManageTarget(leader, memberG1), true, "leader can edit member");
assert.equal(canAdminManageTarget(leader, targetAdminPaladin), true, "leader keeps admin edit rights");
assert.equal(canAdminManageTarget(leader, communityMember), true, "leader can edit community account");

assert.equal(canAdminManageTarget(paladinAdmin, memberG1), true, "generic helper keeps Paladin cluster admin scope");
assert.equal(canAdminManageTarget(paladinAdmin, memberG7), true, "generic helper allows Paladin G2 admin to manage G7");
assert.equal(canAdminManageTarget(paladinAdmin, communityMember), true, "generic helper allows Paladin admin to manage community account");
assert.equal(canAdminManageTarget(paladinAdmin, targetAdminPaladin), false, "generic helper blocks admin target");
assert.equal(
  canAdminManageTarget(paladinAdmin, targetAdminPaladin, { allowAdminTarget: true }),
  true,
  "guild-management actions can explicitly allow admin targets",
);
assert.equal(canAdminManageTarget(paladinAdmin, targetLeader), false, "generic helper blocks leader target");
assert.equal(
  canAdminManageTarget(paladinAdmin, targetLeader, { allowAdminTarget: true }),
  false,
  "leader target stays protected even for guild-management actions",
);
assert.equal(
  canAdminManageTarget(paladinAdmin, targetLeader, { allowLeaderTarget: true }),
  true,
  "specific guild-management actions can explicitly allow leader targets",
);
assert.equal(canAdminManageTarget(paladinAdmin, madMember), false, "generic helper remains cross-tenant restricted");

assert.equal(canManageEditableGuildMember(leader, targetAdminMad, madScope), true, "leader keeps all member-edit rights");
assert.equal(canManageEditableGuildMember(paladinAdmin, memberG1, paladinScope), true, "Paladin admin can edit G1 member");
assert.equal(canManageEditableGuildMember(paladinAdmin, memberG2, paladinScope), true, "Paladin admin can edit G2 member");
assert.equal(canManageEditableGuildMember(paladinAdmin, memberG7, paladinScope), true, "Paladin admin can edit G7 member");
assert.equal(canManageEditableGuildMember(paladinAdmin, communityMember, paladinScope), true, "Paladin admin can edit community member");
assert.equal(canManageEditableGuildMember(paladinAdmin, madMember, paladinScope), true, "Paladin admin can edit client member through member-edit");
assert.equal(canManageEditableGuildMember(paladinAdmin, madSecondary, paladinScope), true, "Paladin admin can edit linked secondary accounts");
assert.equal(canManageEditableGuildMember(paladinAdmin, targetAdminPaladin, paladinScope), true, "Paladin admin can edit Paladin admin");
assert.equal(canManageEditableGuildMember(paladinAdmin, targetAdminMad, paladinScope), true, "Paladin admin can edit client admin");
assert.equal(canManageEditableGuildMember(paladinAdmin, targetLeader, paladinScope), false, "Paladin admin cannot edit leader");
assert.equal(canManageEditableGuildMember(paladinAdmin, madMember), false, "Paladin admin global edit requires resolved organization scope");

assert.equal(canManageEditableGuildMember(madAdmin, madMember, madScope), true, "client admin keeps current own-guild scope");
assert.equal(canManageEditableGuildMember(madAdmin, memberG1, madScope), false, "client admin cannot edit Paladin G1");
assert.equal(canManageEditableGuildMember(madAdmin, memberG7, madScope), false, "client admin cannot edit Paladin G7");
assert.equal(canManageEditableGuildMember(ordinaryActor, memberG1, paladinScope), false, "member cannot edit another member");
assert.equal(canManageEditableGuildMember(ordinaryActor, targetAdminPaladin, paladinScope), false, "member cannot edit admin");
assert.equal(canManageEditableGuildMember(ordinaryActor, targetLeader, paladinScope), false, "member cannot edit leader");

const paladinAdminSearchResults = [
  memberG1,
  memberG7,
  communityMember,
  madMember,
  targetAdminPaladin,
  targetAdminMad,
  targetLeader,
]
  .filter((member) => canManageEditableGuildMember(paladinAdmin, member, paladinScope))
  .map((member) => member.id);

assert.deepEqual(
  paladinAdminSearchResults,
  ["member-g1", "member-g7", "community", "mad-member", "target-admin-paladin", "target-admin-mad"],
  "member-edit search exposes all non-leader accounts for Paladin admin",
);

editablePolicySucceeds(leader, memberG1, { role: "member" });
editablePolicySucceeds(leader, targetAdminPaladin, { role: "admin" });
editablePolicySucceeds(leader, communityMember, { role: "community_member" });

editablePolicySucceeds(paladinAdmin, memberG1, { role: "member", guild_code: "G7" }, paladinScope);
editablePolicySucceeds(paladinAdmin, communityMember, { role: "community_member" }, paladinScope);
editablePolicySucceeds(paladinAdmin, madMember, { role: "member" }, paladinScope);
editablePolicySucceeds(paladinAdmin, madMember, { guild_code: "G2", role: "member" }, paladinScope);
editablePolicySucceeds(paladinAdmin, targetAdminPaladin, { role: "admin", roster_status: "active" }, paladinScope);
editablePolicyFails(paladinAdmin, memberG1, { role: "admin" }, paladinScope);
editablePolicyFails(paladinAdmin, memberG1, { role: "leader" }, paladinScope);
editablePolicyFails(paladinAdmin, targetAdminPaladin, { role: "member" }, paladinScope);
editablePolicyFails(paladinAdmin, targetLeader, { role: "leader" }, paladinScope);
guildManagementPolicyFails(paladinAdmin, targetLeader, { status: "\u00c0 v\u00e9rifier" });
guildManagementPolicySucceeds(paladinAdmin, targetLeader, { status: "\u00c0 v\u00e9rifier" }, { allowLeaderTarget: true });
guildManagementPolicySucceeds(paladinAdmin, targetLeader, { assignment: "Bastion 2" }, { allowLeaderTarget: true });
guildManagementPolicySucceeds(paladinAdmin, targetLeader, { guild_code: "G7" }, { allowLeaderTarget: true });
guildManagementPolicyFails(paladinAdmin, targetLeader, { watcher_name: "Renamed leader" }, { allowLeaderTarget: true });
guildManagementPolicyFails(paladinAdmin, targetLeader, { personal_forum_post_url: "https://discord.com/channels/1/2" }, { allowLeaderTarget: true });
guildManagementPolicyFails(paladinAdmin, targetLeader, { role: "member" }, { allowLeaderTarget: true });
guildManagementPolicyFails(paladinAdmin, targetLeader, { guild_code: "MAD G1" }, { allowLeaderTarget: true });
assert.throws(
  () => applyMemberEditUpdatePolicy({ admin: paladinAdmin, target: memberG1, patch: { guild_code: "UNKNOWN G1" }, editableScope: true, scope: paladinScope }),
  /Guilde cible hors perimetre/i,
  "Paladin global member-edit still refuses unknown guild codes",
);

assert.throws(
  () => applyMemberEditUpdatePolicy({ admin: paladinAdmin, target: memberG1, patch: { role: "super_admin" }, editableScope: true, scope: paladinScope }),
  /Role invalide/,
  "arbitrary role values are refused",
);
assert.throws(
  () => applyMemberEditUpdatePolicy({ admin: paladinAdmin, target: madMember, patch: { role: "member" } }),
  /perimetre/i,
  "non member-edit policy keeps cross-tenant refusal",
);
assert.throws(
  () => applyMemberEditUpdatePolicy({ admin: paladinAdmin, target: memberG1, patch: { guild_code: "MAD G1" } }),
  /Guilde cible hors perimetre/i,
  "non member-edit policy cannot move a Paladin member to a client guild",
);

const staleCommunityMember = {
  id: "mooncacke-like",
  watcher_name: "Mooncacke",
  guild_code: "G2",
  role: "member",
  roster_status: "active",
  status: "Actif",
  assignment: "Communauté",
  community_access_type: "community",
  community_status: "active",
  primary_member_id: null,
  defense_1: "\u2014",
  defense_2: "\u2014",
};

assert.equal(isCommunityAccount(staleCommunityMember), false, "guild member with stale community flag is not a community account");
assert.equal(isCommunityMemberDataScope(staleCommunityMember), false, "member data scope ignores stale community flag when guild+role are standard");

const cleanupPatch = applyMemberEditUpdatePolicy({
  admin: paladinAdmin,
  target: staleCommunityMember,
  patch: { guild_code: "G2", role: "member", roster_status: "active" },
  editableScope: true,
  scope: paladinScope,
});

assert.equal(cleanupPatch.community_access_type, null);
assert.equal(cleanupPatch.community_status, "inactive");
assert.equal(cleanupPatch.assignment, "Tour");
assert.equal(cleanupPatch.status, "\u00c0 faire");
assert.equal(cleanupPatch.defense_1, "--");
assert.equal(cleanupPatch.defense_2, "--");

const pbVisibleInG2 = filterMembersForMemberDataActor([staleCommunityMember], leader, { guildCode: "G2" });
assert.deepEqual(pbVisibleInG2.map((row) => row.id), ["mooncacke-like"]);

console.log("guild management permission tests passed");
