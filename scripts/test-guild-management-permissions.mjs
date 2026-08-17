import assert from "node:assert/strict";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

const {
  applyMemberEditUpdatePolicy,
  canAdminManageTarget,
  isCommunityAccount,
} = await import("../api/portal-access.js");
const {
  filterMembersForMemberDataActor,
  isCommunityMemberDataScope,
} = await import("../api/_member-data-permissions.js");

const leader = { id: "leader", watcher_name: "Leader", role: "leader", guild_code: "G1" };
const admin = { id: "admin", watcher_name: "Admin", role: "admin", guild_code: "G1" };
const member = { id: "member", watcher_name: "Member", role: "member", guild_code: "G2" };
const communityMember = {
  id: "community",
  watcher_name: "Community",
  role: "community_member",
  guild_code: null,
  community_access_type: "community",
  community_status: "active",
};
const targetAdmin = { id: "target-admin", watcher_name: "Target Admin", role: "admin", guild_code: "G2" };
const targetLeader = { id: "target-leader", watcher_name: "Target Leader", role: "leader", guild_code: "G1" };
const madMember = { id: "mad-member", watcher_name: "MAD Member", role: "member", guild_code: "MAD G1" };
const ordinaryActor = { id: "ordinary", watcher_name: "Ordinary", role: "member", guild_code: "G1" };

function policySucceeds(actor, target, patch) {
  assert.doesNotThrow(() => applyMemberEditUpdatePolicy({ admin: actor, target, patch }));
}

function policyFails(actor, target, patch) {
  assert.throws(() => applyMemberEditUpdatePolicy({ admin: actor, target, patch }), /leader|perimetre|refusee/i);
}

assert.equal(canAdminManageTarget(leader, member), true, "leader can edit member");
assert.equal(canAdminManageTarget(leader, targetAdmin), true, "leader keeps admin edit rights");
assert.equal(canAdminManageTarget(leader, communityMember), true, "leader can edit community account");

assert.equal(canAdminManageTarget(admin, member), true, "Paladin admin can edit standard member in Paladin cluster");
assert.equal(canAdminManageTarget(admin, communityMember), true, "Paladin admin can edit community member");
assert.equal(canAdminManageTarget(admin, targetAdmin), false, "admin cannot edit another admin");
assert.equal(canAdminManageTarget(admin, targetLeader), false, "admin cannot edit leader");
assert.equal(canAdminManageTarget(admin, madMember), false, "admin cannot edit cross-tenant member");

assert.equal(canAdminManageTarget(ordinaryActor, member), false, "member cannot edit another member");
assert.equal(canAdminManageTarget(ordinaryActor, targetAdmin), false, "member cannot edit admin");
assert.equal(canAdminManageTarget(ordinaryActor, targetLeader), false, "member cannot edit leader");

policySucceeds(leader, member, { role: "member" });
policySucceeds(leader, targetAdmin, { role: "admin" });
policySucceeds(leader, communityMember, { role: "community_member" });

policySucceeds(admin, member, { role: "member", guild_code: "G7" });
policySucceeds(admin, communityMember, { role: "community_member" });
policyFails(admin, member, { role: "admin" });
policyFails(admin, member, { role: "leader" });
policyFails(admin, madMember, { role: "member" });
assert.throws(
  () => applyMemberEditUpdatePolicy({ admin, target: member, patch: { role: "super_admin" } }),
  /Role invalide/,
  "arbitrary role values are refused",
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
  admin,
  target: staleCommunityMember,
  patch: { guild_code: "G2", role: "member", roster_status: "active" },
});

assert.equal(cleanupPatch.community_access_type, null);
assert.equal(cleanupPatch.community_status, null);
assert.equal(cleanupPatch.assignment, "Tour");
assert.equal(cleanupPatch.status, "\u00c0 faire");
assert.equal(cleanupPatch.defense_1, "--");
assert.equal(cleanupPatch.defense_2, "--");

const pbVisibleInG2 = filterMembersForMemberDataActor([staleCommunityMember], leader, { guildCode: "G2" });
assert.deepEqual(pbVisibleInG2.map((row) => row.id), ["mooncacke-like"]);

console.log("guild management permission tests passed");
