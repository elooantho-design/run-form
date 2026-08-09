import assert from "node:assert/strict";
import {
  filterMembersForMemberDataActor,
  resolveMemberDataEditPermission,
  resolveMemberDataViewPermission,
  serializeMemberDataPermissions,
} from "../api/_member-data-permissions.js";

const principal = {
  id: "member-a",
  watcher_name: "Darius",
  role: "member",
  guild_code: "G1",
  primary_member_id: null,
};

const secondaryB = {
  id: "member-b",
  watcher_name: "Darius G2",
  role: "member",
  guild_code: "G2",
  primary_member_id: principal.id,
};

const secondaryC = {
  id: "member-c",
  watcher_name: "Darius MAD",
  role: "member",
  guild_code: "MAD G1",
  primary_member_id: principal.id,
};

const unrelated = {
  id: "member-d",
  watcher_name: "Autre MAD",
  role: "member",
  guild_code: "MAD G1",
  primary_member_id: null,
};

const leader = {
  id: "leader",
  watcher_name: "Leader",
  role: "leader",
  guild_code: "G1",
  primary_member_id: null,
};

const admin = {
  id: "admin",
  watcher_name: "Admin",
  role: "admin",
  guild_code: "G1",
  primary_member_id: null,
};

function canEdit(actor, target) {
  return resolveMemberDataEditPermission(actor, target);
}

function canView(actor, target) {
  return resolveMemberDataViewPermission(actor, target);
}

assert.deepEqual(canEdit(principal, principal), { canEdit: true, reason: "self" });
assert.deepEqual(canEdit(principal, secondaryB), { canEdit: true, reason: "linked_secondary" });
assert.deepEqual(canEdit(principal, secondaryC), { canEdit: true, reason: "linked_secondary" });
assert.deepEqual(canEdit(principal, unrelated), { canEdit: false, reason: "denied" });

assert.deepEqual(canEdit(secondaryB, secondaryB), { canEdit: true, reason: "self" });
assert.deepEqual(canEdit(secondaryB, principal), { canEdit: false, reason: "denied" });
assert.deepEqual(canEdit(secondaryB, secondaryC), { canEdit: false, reason: "denied" });
assert.deepEqual(canEdit(secondaryB, unrelated), { canEdit: false, reason: "denied" });

assert.equal(canEdit(leader, unrelated).canEdit, true);
assert.equal(canEdit(admin, secondaryB).canEdit, true);
assert.equal(canEdit(admin, unrelated).canEdit, false);

assert.deepEqual(canView(principal, secondaryC), { canView: true, reason: "linked_secondary" });
assert.equal(serializeMemberDataPermissions(principal, secondaryC).editReason, "linked_secondary");

const unlinkedB = { ...secondaryB, primary_member_id: null };
assert.deepEqual(canEdit(principal, unlinkedB), { canEdit: false, reason: "denied" });

const filteredWithoutGuild = filterMembersForMemberDataActor([principal, secondaryB, secondaryC, unrelated], principal).map(
  (member) => member.id,
);
assert.deepEqual(filteredWithoutGuild, ["member-a", "member-b", "member-c"]);

const filteredG1 = filterMembersForMemberDataActor([principal, secondaryB, secondaryC, unrelated], principal, {
  guildCode: "G1",
}).map((member) => member.id);
assert.deepEqual(filteredG1, ["member-a"]);

const filteredG2 = filterMembersForMemberDataActor([principal, secondaryB, secondaryC, unrelated], principal, {
  guildCode: "G2",
}).map((member) => member.id);
assert.deepEqual(filteredG2, ["member-b"]);

console.log("linked secondary member-data permission tests passed");
