export function cleanLinkedAccountText(value) {
  return String(value || "").trim();
}

export function getLinkedMemberId(member) {
  return cleanLinkedAccountText(member?.id);
}

export function getPrimaryMemberId(member) {
  return cleanLinkedAccountText(member?.primary_member_id || member?.primaryMemberId);
}

export function getLinkedWatcherName(member) {
  return cleanLinkedAccountText(member?.watcher_name || member?.watcherName || member?.name);
}

export function getLinkedGuildCode(member) {
  return cleanLinkedAccountText(member?.guild_code || member?.guildCode);
}

export function isSecondaryAccount(member) {
  return Boolean(getPrimaryMemberId(member));
}

export function getLinkedAccountRole(member) {
  return isSecondaryAccount(member) ? "secondary" : "primary";
}

export function validateSecondaryLink({ primary, secondary, secondaryChildrenCount = 0 } = {}) {
  const errors = [];
  const primaryId = getLinkedMemberId(primary);
  const secondaryId = getLinkedMemberId(secondary);
  const existingSecondaryPrimaryId = getPrimaryMemberId(secondary);

  if (!primaryId) errors.push("Compte principal introuvable.");
  if (!secondaryId) errors.push("Compte secondaire introuvable.");
  if (primaryId && secondaryId && primaryId === secondaryId) {
    errors.push("Un compte ne peut pas etre secondaire de lui-meme.");
  }
  if (getPrimaryMemberId(primary)) {
    errors.push("Le compte principal choisi est deja un compte secondaire.");
  }
  if (existingSecondaryPrimaryId && existingSecondaryPrimaryId !== primaryId) {
    errors.push("Ce compte secondaire est deja rattache a un autre principal. Delie-le d'abord.");
  }
  if (Number(secondaryChildrenCount) > 0) {
    errors.push("Ce compte possede deja des comptes secondaires. Delie-les avant de le rattacher.");
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function getEffectiveDiscordId(member, primary = null) {
  if (isSecondaryAccount(member) && primary) {
    return cleanLinkedAccountText(primary.discord_id || primary.discordId);
  }
  return cleanLinkedAccountText(member?.discord_id || member?.discordId);
}

export function buildLinkedAccountSearchText(row) {
  const link = row?.accountLink || {};
  return [
    row?.watcher_name,
    row?.watcherName,
    row?.name,
    row?.guild_code,
    row?.guildCode,
    link.primaryWatcherName,
    link.primaryGuildCode,
    link.secondaryCount ? "compte secondaire" : "",
  ]
    .map(cleanLinkedAccountText)
    .filter(Boolean)
    .join(" ");
}

export function buildLinkedAccountSummary(member, { primary = null, linkedAccounts = [] } = {}) {
  const status = getLinkedAccountRole(member);
  const visibleLinkedAccounts = (linkedAccounts || []).filter(
    (linked) => getLinkedMemberId(linked) !== getLinkedMemberId(member),
  );

  return {
    status,
    isPrimary: status === "primary",
    isSecondary: status === "secondary",
    primaryMemberId: getPrimaryMemberId(member) || null,
    primaryName: primary ? getLinkedWatcherName(primary) : "",
    primaryGuildCode: primary ? getLinkedGuildCode(primary) : "",
    linkedAccounts: visibleLinkedAccounts,
    secondaryCount: visibleLinkedAccounts.filter((linked) => getPrimaryMemberId(linked) === getLinkedMemberId(member)).length,
  };
}
