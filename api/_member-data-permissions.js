import {
  isPortalAdminRole,
  isPortalCommunityRole,
  isPortalLeaderRole,
} from "./_portal-auth.js";
import {
  COMMUNITY_SPACE_KEY,
  PALADIN_CLUSTER_GUILD_CODES,
  PALADIN_SPACE_KEY,
  getGuildSpaceKey,
  isPaladinGuildCode,
  normalizeGuildCode,
  normalizeGuildCodeKey,
} from "../src/lib/guildScope.js";

function sameId(left, right) {
  return Boolean(left && right && String(left) === String(right));
}

function isActorLeader(actor) {
  return isPortalLeaderRole(actor?.role);
}

function isActorAdmin(actor) {
  return isPortalAdminRole(actor?.role);
}

export function isCommunityMemberDataScope(member) {
  return member?.community_access_type === "community" || isPortalCommunityRole(member?.role);
}

export function getMemberDataGuildCode(member) {
  return isCommunityMemberDataScope(member) ? COMMUNITY_SPACE_KEY : normalizeGuildCode(member?.guild_code || "G1");
}

export function getMemberDataSpaceKey(member) {
  if (isCommunityMemberDataScope(member)) return COMMUNITY_SPACE_KEY;
  return getGuildSpaceKey(getMemberDataGuildCode(member));
}

export function isDirectLinkedSecondaryTarget(actor, target) {
  if (!actor?.id || !target?.id || !target?.primary_member_id) return false;
  return !sameId(actor.id, target.id) && sameId(target.primary_member_id, actor.id);
}

export function resolveMemberDataViewPermission(actor, target) {
  if (!actor || !target) return { canView: false, reason: "denied" };
  if (isActorLeader(actor)) return { canView: true, reason: "leader" };
  if (sameId(actor.id, target.id)) return { canView: true, reason: "self" };
  if (isDirectLinkedSecondaryTarget(actor, target)) return { canView: true, reason: "linked_secondary" };
  if (isCommunityMemberDataScope(actor) || isCommunityMemberDataScope(target)) {
    return { canView: false, reason: "denied" };
  }
  return getMemberDataSpaceKey(actor) === getMemberDataSpaceKey(target)
    ? { canView: true, reason: "same_scope" }
    : { canView: false, reason: "denied" };
}

export function resolveMemberDataEditPermission(actor, target) {
  if (!actor || !target) return { canEdit: false, reason: "denied" };
  if (isActorLeader(actor)) return { canEdit: true, reason: "leader" };
  if (sameId(actor.id, target.id)) return { canEdit: true, reason: "self" };
  if (isDirectLinkedSecondaryTarget(actor, target)) return { canEdit: true, reason: "linked_secondary" };
  if (isCommunityMemberDataScope(actor) || isCommunityMemberDataScope(target)) {
    return { canEdit: false, reason: "denied" };
  }
  return isActorAdmin(actor) && getMemberDataSpaceKey(actor) === getMemberDataSpaceKey(target)
    ? { canEdit: true, reason: "admin" }
    : { canEdit: false, reason: "denied" };
}

export function canViewOwnedMemberData(actor, target) {
  return resolveMemberDataViewPermission(actor, target).canView;
}

export function canEditOwnedMemberData(actor, target) {
  return resolveMemberDataEditPermission(actor, target).canEdit;
}

export function serializeMemberDataPermissions(actor, target) {
  const view = resolveMemberDataViewPermission(actor, target);
  const edit = resolveMemberDataEditPermission(actor, target);
  return {
    canView: view.canView,
    viewReason: view.reason,
    canEdit: edit.canEdit,
    editReason: edit.reason,
  };
}

export function filterMembersForMemberDataActor(members, actor, options = {}) {
  const targetGuildCode = normalizeGuildCodeKey(options.guildCode);
  const canIncludeLinkedSecondary = (member) => {
    if (!isDirectLinkedSecondaryTarget(actor, member)) return false;
    if (!targetGuildCode) return true;
    return normalizeGuildCodeKey(member.guild_code) === targetGuildCode;
  };

  if (isActorLeader(actor)) {
    if (!targetGuildCode) return members;
    return members.filter(
      (member) => normalizeGuildCodeKey(member.guild_code) === targetGuildCode || canIncludeLinkedSecondary(member),
    );
  }

  if (isCommunityMemberDataScope(actor)) {
    return members.filter((member) => sameId(member.id, actor.id) || canIncludeLinkedSecondary(member));
  }

  const actorSpaceKey = getMemberDataSpaceKey(actor);

  if (targetGuildCode && isPaladinGuildCode(targetGuildCode) && actorSpaceKey === PALADIN_SPACE_KEY) {
    return members.filter(
      (member) => normalizeGuildCodeKey(member.guild_code) === targetGuildCode || canIncludeLinkedSecondary(member),
    );
  }

  return members.filter((member) => {
    if (canIncludeLinkedSecondary(member)) return true;
    if (isCommunityMemberDataScope(member)) return false;
    const rowGuildCode = normalizeGuildCodeKey(member.guild_code);
    if (!rowGuildCode) return actorSpaceKey === PALADIN_SPACE_KEY;
    if (actorSpaceKey === PALADIN_SPACE_KEY) return PALADIN_CLUSTER_GUILD_CODES.includes(rowGuildCode);
    return getGuildSpaceKey(rowGuildCode) === actorSpaceKey && (!targetGuildCode || rowGuildCode === targetGuildCode);
  });
}
