import { normalizeGuildCodeKey } from "./guildScope.js";

export function getDefenseRootId(defense) {
  return defense?.sourceDefenseId || defense?.source_defense_id || defense?.id || null;
}

export function defenseBelongsToGuild(defense, guildCode) {
  return normalizeGuildCodeKey(defense?.guildCode || defense?.guild_code) === normalizeGuildCodeKey(guildCode);
}

export function isImportedDefense(defense) {
  return Boolean(defense?.sourceDefenseId || defense?.source_defense_id);
}

export function isHiddenDefense(defense) {
  return Boolean(defense?.isHidden || defense?.is_hidden);
}

export function getDefenseOriginGuildCode(defense) {
  return defense?.originGuildCode || defense?.origin_guild_code || defense?.sourceGuildCode || defense?.source_guild_code || "";
}

export function isInheritedDefense(defense, activeGuildCode) {
  if (!defense?.id) return false;
  if (defense.sourceDefenseId || defense.source_defense_id) return false;

  return Boolean(defense.isGlobal || defense.is_global) && !defenseBelongsToGuild(defense, activeGuildCode);
}

export function resolveDefenseVariantsForGuild(defenses = [], guildCode) {
  const activeGuildKey = normalizeGuildCodeKey(guildCode);

  return (defenses || []).filter((defense) => {
    if (!defense?.id || isHiddenDefense(defense)) return false;
    return normalizeGuildCodeKey(defense.guildCode || defense.guild_code) === activeGuildKey;
  });
}

export function getDefenseAssignmentId(member, slot) {
  if (slot === 1) return member?.defense1Id || member?.defense_1_id || "";
  if (slot === 2) return member?.defense2Id || member?.defense_2_id || "";
  return "";
}

export function getDefenseAssignmentName(member, slot) {
  if (slot === 1) return member?.defense1 || member?.defense_1 || "";
  if (slot === 2) return member?.defense2 || member?.defense_2 || "";
  return "";
}

export function resolveAssignedDefense(defenses = [], member, slot) {
  const defenseId = getDefenseAssignmentId(member, slot);
  if (defenseId) {
    const byId = defenses.find((defense) => String(defense?.id || "") === String(defenseId));
    if (byId) return byId;
  }

  const defenseName = getDefenseAssignmentName(member, slot);
  if (!defenseName || defenseName === "--" || defenseName === "—") return null;

  const memberGuildCode = member?.guildCode || member?.guild_code || "";
  return (
    defenses.find(
      (defense) =>
        String(defense?.name || "") === String(defenseName) &&
        (!memberGuildCode || defenseBelongsToGuild(defense, memberGuildCode)),
    ) ||
    defenses.find((defense) => String(defense?.name || "") === String(defenseName)) ||
    null
  );
}

export function buildDefenseLibraryEntries({
  nativeDefenses = [],
  localDefenses = [],
  targetGuildCode = "",
  manageableGuildCodes = [],
} = {}) {
  const targetGuildKey = normalizeGuildCodeKey(targetGuildCode);
  const manageableGuildKeys = new Set((manageableGuildCodes || []).map(normalizeGuildCodeKey).filter(Boolean));
  const localBySourceAndGuild = new Set();

  (localDefenses || []).forEach((defense) => {
    const sourceId = defense?.sourceDefenseId || defense?.source_defense_id;
    const guildKey = normalizeGuildCodeKey(defense?.guildCode || defense?.guild_code);
    if (!sourceId || !guildKey || isHiddenDefense(defense)) return;
    localBySourceAndGuild.add(`${sourceId}:${guildKey}`);
  });

  return (nativeDefenses || []).map((defense) => {
    const sourceId = defense?.id || "";
    const originGuildCode = defense?.guildCode || defense?.guild_code || "";
    const originGuildKey = normalizeGuildCodeKey(originGuildCode);
    const alreadyNative = originGuildKey === targetGuildKey;
    const alreadyImported = localBySourceAndGuild.has(`${sourceId}:${targetGuildKey}`);

    return {
      ...defense,
      originGuildCode,
      libraryTargetStatus: alreadyNative ? "native" : alreadyImported ? "imported" : "available",
      importTargets: [...manageableGuildKeys].map((guildKey) => {
        const nativeInGuild = originGuildKey === guildKey;
        const importedInGuild = localBySourceAndGuild.has(`${sourceId}:${guildKey}`);

        return {
          guildCode: manageableGuildCodes.find((guildCode) => normalizeGuildCodeKey(guildCode) === guildKey) || guildKey,
          status: nativeInGuild ? "native" : importedInGuild ? "imported" : "available",
        };
      }),
    };
  });
}
