export function cleanIntersaisonText(value) {
  return String(value || "").trim();
}

export function normalizeIntersaisonCode(value) {
  return cleanIntersaisonText(value).toUpperCase().replace(/\s+/g, " ");
}

export function normalizeIntersaisonRole(value) {
  return cleanIntersaisonText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function isIntersaisonLeaderRole(value) {
  return normalizeIntersaisonRole(value) === "leader";
}

export function isActiveRosterMember(member) {
  return cleanIntersaisonText(member?.roster_status || "active").toLowerCase() === "active";
}

export function mapGuildsByCode(guilds = []) {
  const result = new Map();
  for (const guild of guilds || []) {
    const code = normalizeIntersaisonCode(guild?.guild_code || guild?.guildCode);
    if (code) result.set(code, guild);
  }
  return result;
}

export function getActiveGuildCodesForOrganization(guilds = [], organizationId) {
  return (guilds || [])
    .filter((guild) => String(guild?.organization_id || guild?.organizationId || "") === String(organizationId || ""))
    .filter((guild) => guild?.is_active === true || guild?.isActive === true)
    .map((guild) => normalizeIntersaisonCode(guild.guild_code || guild.guildCode))
    .filter(Boolean);
}

export function selectEligibleRosterMembers({ members = [], guilds = [], organizationId }) {
  const activeGuildCodes = new Set(getActiveGuildCodesForOrganization(guilds, organizationId));
  return (members || []).filter((member) => {
    const guildCode = normalizeIntersaisonCode(member?.guild_code || member?.guildCode);
    return guildCode && activeGuildCodes.has(guildCode) && isActiveRosterMember(member);
  });
}

export function buildIntersaisonValidationPreview({
  campaign,
  dashboards = [],
  assignments = [],
  members = [],
  memberGuilds = [],
  activeGuilds = [],
}) {
  const campaignId = campaign?.id || campaign?.campaignId || "";
  const organizationId = campaign?.organization_id || campaign?.organizationId || "";
  const dashboardById = new Map((dashboards || []).map((dashboard) => [String(dashboard.id), dashboard]));
  const memberById = new Map((members || []).map((member) => [String(member.id), member]));
  const memberGuildByCode = mapGuildsByCode(memberGuilds);
  const activeGuildByCode = mapGuildsByCode(
    (activeGuilds || []).filter((guild) => String(guild.organization_id || "") === String(organizationId)),
  );
  const guildTransfers = [];
  const communityConversions = [];
  const unchangedGuildPlacements = [];
  const blockedAssignments = [];

  for (const assignment of assignments || []) {
    const assignmentId = assignment?.id || null;
    const member = assignment?.member_id ? memberById.get(String(assignment.member_id)) : null;
    const dashboard = assignment?.dashboard_id ? dashboardById.get(String(assignment.dashboard_id)) : null;
    const baseBlock = {
      assignmentId,
      memberId: assignment?.member_id || null,
      watcherName: assignment?.watcher_name || member?.watcher_name || "",
      sourceGuildCode: assignment?.source_guild_code || member?.guild_code || null,
      dashboardId: assignment?.dashboard_id || null,
      targetGuildCode: assignment?.target_guild_code || null,
    };

    if (String(assignment?.organization_id || assignment?.organizationId || "") !== String(organizationId || "")) {
      blockedAssignments.push({
        ...baseBlock,
        reason: "assignment_cross_tenant",
        assignmentOrganizationId: assignment?.organization_id || assignment?.organizationId || null,
        campaignOrganizationId: organizationId || null,
      });
      continue;
    }

    if (!member) {
      blockedAssignments.push({ ...baseBlock, reason: "member_missing" });
      continue;
    }

    const memberGuildCode = normalizeIntersaisonCode(member.guild_code);
    const memberGuild = memberGuildByCode.get(memberGuildCode);
    if (!memberGuildCode || !memberGuild) {
      blockedAssignments.push({ ...baseBlock, reason: "member_guild_not_mapped" });
      continue;
    }

    if (String(memberGuild.organization_id || "") !== String(organizationId)) {
      blockedAssignments.push({
        ...baseBlock,
        reason: "member_cross_tenant",
        memberOrganizationId: memberGuild.organization_id || null,
        campaignOrganizationId: organizationId || null,
      });
      continue;
    }

    if (memberGuild.is_active !== true) {
      blockedAssignments.push({ ...baseBlock, reason: "member_guild_inactive" });
      continue;
    }

    if (!dashboard) {
      blockedAssignments.push({ ...baseBlock, reason: "dashboard_missing" });
      continue;
    }

    if (String(dashboard.campaign_id || dashboard.campaignId || "") !== String(campaignId || "")) {
      blockedAssignments.push({
        ...baseBlock,
        reason: "dashboard_cross_campaign",
        dashboardCampaignId: dashboard.campaign_id || dashboard.campaignId || null,
        campaignId: campaignId || null,
      });
      continue;
    }

    if (String(dashboard.organization_id || "") !== String(organizationId)) {
      blockedAssignments.push({
        ...baseBlock,
        reason: "dashboard_cross_tenant",
        dashboardOrganizationId: dashboard.organization_id || null,
        campaignOrganizationId: organizationId || null,
      });
      continue;
    }

    const dashboardCode = normalizeIntersaisonCode(dashboard.code);
    const isTrueDraft = dashboard.is_draft === true;
    const isRealGuildDashboard = dashboard.is_draft === false && dashboardCode !== "BROUILLON";

    if (isTrueDraft && dashboardCode !== "BROUILLON") {
      blockedAssignments.push({ ...baseBlock, reason: "draft_dashboard_must_be_brouillon" });
      continue;
    }

    if (dashboardCode === "BROUILLON" && !isTrueDraft) {
      blockedAssignments.push({ ...baseBlock, reason: "brouillon_dashboard_must_be_draft" });
      continue;
    }

    if (isTrueDraft && dashboardCode === "BROUILLON") {
      if (isIntersaisonLeaderRole(member.role)) {
        blockedAssignments.push({ ...baseBlock, reason: "leader_cannot_be_converted_to_community" });
        continue;
      }

      communityConversions.push({
        assignmentId,
        memberId: member.id,
        watcherName: assignment.watcher_name || member.watcher_name || "",
        from: member.guild_code || assignment.source_guild_code || null,
      });
      continue;
    }

    if (!isRealGuildDashboard) {
      blockedAssignments.push({ ...baseBlock, reason: "dashboard_invalid_draft_state" });
      continue;
    }

    const targetGuildCode = dashboardCode;
    const targetGuild = activeGuildByCode.get(targetGuildCode);
    if (!targetGuild) {
      blockedAssignments.push({
        ...baseBlock,
        reason: "target_guild_not_active_for_organization",
        targetGuildCode: dashboard.code || assignment.target_guild_code || null,
      });
      continue;
    }

    const transfer = {
      assignmentId,
      memberId: member.id,
      watcherName: assignment.watcher_name || member.watcher_name || "",
      from: member.guild_code || assignment.source_guild_code || null,
      to: targetGuild.guild_code || dashboard.code,
    };

    if (normalizeIntersaisonCode(transfer.from) === normalizeIntersaisonCode(transfer.to)) {
      unchangedGuildPlacements.push(transfer);
    } else {
      guildTransfers.push(transfer);
    }
  }

  return {
    guildTransfers,
    communityConversions,
    unchangedGuildPlacements,
    blockedAssignments,
  };
}
