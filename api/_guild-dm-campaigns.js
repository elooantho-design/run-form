export const GUILD_DM_CAMPAIGNS_TABLE = "guild_dm_campaigns";
export const GUILD_DM_RECIPIENTS_TABLE = "guild_dm_recipients";
export const GUILD_DM_MAX_MESSAGE_LENGTH = 1800;
export const GUILD_DM_TEST_MESSAGE_PREFIX = "🧪 Message de test";

export const GUILD_DM_CAMPAIGN_STATUSES = new Set([
  "queued",
  "sending",
  "completed",
  "partial",
  "failed",
  "cancelled",
]);

export const GUILD_DM_RECIPIENT_STATUSES = new Set([
  "queued",
  "sending",
  "sent",
  "confirmed",
  "failed",
  "cancelled",
]);

function cleanText(value) {
  return String(value || "").trim();
}

export function normalizeGuildCompareKey(value) {
  return cleanText(value)
    .toUpperCase()
    .replace(/[\s_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function normalizePortalGuildValue(value) {
  return cleanText(value).replace(/\s+/g, " ");
}

function normalizeText(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function isPortalAdminLikeRole(role) {
  return ["admin", "administrateur", "leader"].includes(normalizeText(role));
}

export function isPaladinGuildCode(value) {
  return /^G[1-7]$/.test(normalizeGuildCompareKey(value));
}

function getGuildSpaceKey(value) {
  const key = normalizeGuildCompareKey(value);
  if (!key) return "";
  if (isPaladinGuildCode(key)) return "PALADIN";
  const match = key.match(/^(.+?)_?G\d+$/);
  return (match?.[1] || key).replace(/_+$/g, "") || key;
}

export function isValidDiscordUserId(value) {
  return /^\d{15,25}$/.test(cleanText(value));
}

export function cleanDiscordUserId(value) {
  const discordId = cleanText(value);
  return isValidDiscordUserId(discordId) ? discordId : "";
}

export function isMissingGuildDmCampaignSchema(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes(GUILD_DM_CAMPAIGNS_TABLE) ||
    message.includes(GUILD_DM_RECIPIENTS_TABLE) ||
    message.includes("could not find the table")
  );
}

export function isMissingGuildDmTestColumn(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return (
    error?.code === "PGRST204" &&
    message.includes(GUILD_DM_CAMPAIGNS_TABLE) &&
    message.includes("is_test")
  );
}

function sortGuildRows(left, right) {
  const leftCode = normalizePortalGuildValue(left?.guild_code || left?.guildCode);
  const rightCode = normalizePortalGuildValue(right?.guild_code || right?.guildCode);
  const leftPaladin = leftCode.match(/^G(\d+)$/i);
  const rightPaladin = rightCode.match(/^G(\d+)$/i);
  if (leftPaladin && rightPaladin) return Number(leftPaladin[1]) - Number(rightPaladin[1]);
  return leftCode.localeCompare(rightCode, "fr", { sensitivity: "base", numeric: true });
}

export function resolveManageableGuildRowsForActorFromRows(actor, guildRows = []) {
  const actorGuildCode = normalizePortalGuildValue(actor?.guild_code || actor?.guildCode);
  const actorGuildKey = normalizeGuildCompareKey(actorGuildCode);
  if (!actorGuildKey || !isPortalAdminLikeRole(actor?.role)) return [];

  const activeRows = (guildRows || [])
    .filter((row) => row?.is_active !== false)
    .map((row) => ({
      ...row,
      guild_code: normalizePortalGuildValue(row?.guild_code || row?.guildCode),
    }))
    .filter((row) => row.guild_code);

  const actorRow =
    activeRows.find((row) => normalizeGuildCompareKey(row.guild_code) === actorGuildKey) || null;

  if (actorRow?.organization_id) {
    return activeRows
      .filter((row) => String(row.organization_id || "") === String(actorRow.organization_id))
      .sort(sortGuildRows);
  }

  const actorSpace = getGuildSpaceKey(actorGuildCode);
  return activeRows
    .filter((row) => getGuildSpaceKey(row.guild_code) === actorSpace)
    .sort(sortGuildRows);
}

export function resolveRequestedGuildCodes(requestedGuildCodes, manageableGuilds) {
  const byKey = new Map(
    (manageableGuilds || []).map((row) => [normalizeGuildCompareKey(row.guild_code || row.guildCode), row.guild_code || row.guildCode]),
  );
  const selected = [];
  const denied = [];

  (requestedGuildCodes || []).forEach((guildCode) => {
    const key = normalizeGuildCompareKey(guildCode);
    if (!key) return;
    const canonical = byKey.get(key);
    if (!canonical) {
      denied.push(normalizePortalGuildValue(guildCode));
      return;
    }
    if (!selected.some((value) => normalizeGuildCompareKey(value) === key)) {
      selected.push(canonical);
    }
  });

  return { selected, denied };
}

export function isActiveGuildMember(member) {
  const rosterStatus = normalizeText(member?.roster_status || member?.rosterStatus || "active");
  const communityAccessType = normalizeText(member?.community_access_type || member?.communityAccessType);
  const communityStatus = normalizeText(member?.community_status || member?.communityStatus);
  if (communityAccessType === "community" && communityStatus === "inactive") return false;
  return !rosterStatus || rosterStatus === "active";
}

function getMemberDisplayName(member) {
  return cleanText(member?.watcher_name || member?.watcherName || member?.name || member?.discord_id || "Joueur");
}

export function buildGuildDmRecipientPlan(members = [], selectedGuildCodes = []) {
  const selectedKeys = new Set((selectedGuildCodes || []).map(normalizeGuildCompareKey).filter(Boolean));
  const activeMembers = (members || []).filter(
    (member) => isActiveGuildMember(member) && selectedKeys.has(normalizeGuildCompareKey(member?.guild_code || member?.guildCode)),
  );
  const seenDiscordIds = new Set();
  const recipients = [];
  const missingMembers = [];
  const duplicates = [];

  activeMembers.forEach((member) => {
    const discordUserId = cleanDiscordUserId(member?.discord_id || member?.discordId || member?.discord_user_id);
    if (!discordUserId) {
      missingMembers.push(member);
      return;
    }

    if (seenDiscordIds.has(discordUserId)) {
      duplicates.push(member);
      return;
    }

    seenDiscordIds.add(discordUserId);
    recipients.push({
      memberId: member?.id || null,
      guildCode: normalizePortalGuildValue(member?.guild_code || member?.guildCode),
      memberName: getMemberDisplayName(member),
      discordUserId,
    });
  });

  return {
    activeMembers,
    recipients,
    missingMembers,
    duplicates,
    totalActiveMembers: activeMembers.length,
    reachableCount: recipients.length,
    missingDiscordCount: missingMembers.length,
    duplicateCount: duplicates.length,
  };
}

export function summarizeGuildReachability(members = [], manageableGuilds = []) {
  return (manageableGuilds || []).map((guild) => {
    const guildCode = normalizePortalGuildValue(guild?.guild_code || guild?.guildCode);
    const guildMembers = (members || []).filter(
      (member) =>
        isActiveGuildMember(member) &&
        normalizeGuildCompareKey(member?.guild_code || member?.guildCode) === normalizeGuildCompareKey(guildCode),
    );
    const reachableMembers = guildMembers.filter((member) => cleanDiscordUserId(member?.discord_id || member?.discordId)).length;
    return {
      guildCode,
      organizationId: guild?.organization_id || guild?.organizationId || "",
      totalActiveMembers: guildMembers.length,
      reachableMembers,
      missingDiscordMembers: Math.max(0, guildMembers.length - reachableMembers),
    };
  });
}

export function validateGuildDmMessage(message) {
  const cleanMessage = cleanText(message);
  if (!cleanMessage) {
    const error = new Error("Message obligatoire.");
    error.statusCode = 400;
    throw error;
  }
  if (cleanMessage.length > GUILD_DM_MAX_MESSAGE_LENGTH) {
    const error = new Error(`Message trop long (${GUILD_DM_MAX_MESSAGE_LENGTH} caracteres maximum).`);
    error.statusCode = 400;
    throw error;
  }
  return cleanMessage;
}

export function buildGuildDmTestMessage(message) {
  const cleanMessage = validateGuildDmMessage(message);
  return validateGuildDmMessage(`${GUILD_DM_TEST_MESSAGE_PREFIX}\n\n${cleanMessage}`);
}

export function serializeGuildDmCampaign(row, recipients = []) {
  const recipientRows = Array.isArray(recipients) ? recipients : [];
  const confirmedCount = recipientRows.filter((recipient) => recipient.confirmed_at || recipient.status === "confirmed").length;
  const failedCount = recipientRows.filter((recipient) => recipient.status === "failed").length;
  const queuedCount = recipientRows.filter((recipient) => ["queued", "sending"].includes(recipient.status)).length;
  const cancelledCount = recipientRows.filter((recipient) => recipient.status === "cancelled").length;
  const sentCount = recipientRows.filter((recipient) =>
    ["sent", "confirmed"].includes(recipient.status) || recipient.sent_at,
  ).length;
  const sentAwaitingCount = recipientRows.filter(
    (recipient) => !recipient.confirmed_at && recipient.status === "sent",
  ).length;
  const totalRecipients = Number(row?.total_recipients ?? recipientRows.length) || recipientRows.length;
  const pendingCount = Math.max(0, queuedCount + sentAwaitingCount);

  return {
    id: row?.id || "",
    organizationId: row?.organization_id || "",
    message: row?.message || "",
    messagePreview: cleanText(row?.message).slice(0, 140),
    isTest: Boolean(row?.is_test),
    targetGuildCodes: Array.isArray(row?.target_guild_codes) ? row.target_guild_codes : [],
    status: row?.status || "queued",
    createdByName: row?.created_by_name || "",
    totalRecipients,
    sentCount,
    sentAwaitingCount,
    queuedCount,
    confirmedCount,
    pendingCount,
    failedCount,
    cancelledCount,
    missingDiscordCount: Number(row?.missing_discord_count || 0),
    createdAt: row?.created_at || null,
    sentAt: row?.sent_at || null,
    updatedAt: row?.updated_at || null,
  };
}

export function serializeGuildDmRecipient(row) {
  return {
    id: row?.id || "",
    campaignId: row?.campaign_id || "",
    memberId: row?.member_id || null,
    guildCode: row?.guild_code || "",
    memberName: row?.member_name_snapshot || "Joueur",
    discordUserId: row?.discord_user_id || "",
    status: row?.status || "queued",
    sentAt: row?.sent_at || null,
    lastSentAt: row?.last_sent_at || null,
    confirmedAt: row?.confirmed_at || null,
    sendAttempts: Number(row?.send_attempts || 0),
    reminderCount: Number(row?.reminder_count || 0),
    lastAttemptAt: row?.last_attempt_at || null,
    lastError: row?.last_error || "",
  };
}
