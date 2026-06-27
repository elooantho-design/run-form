import { isPaladinGuildCode, normalizeGuildCodeKey } from "@/lib/guildScope";

export function getDefenseRootId(defense) {
  return defense?.sourceDefenseId || defense?.source_defense_id || defense?.id || null;
}

export function defenseBelongsToGuild(defense, guildCode) {
  return normalizeGuildCodeKey(defense?.guildCode || defense?.guild_code) === normalizeGuildCodeKey(guildCode);
}

export function isInheritedDefense(defense, activeGuildCode) {
  if (!defense?.id) return false;
  if (defense.sourceDefenseId || defense.source_defense_id) return false;
  if (!isPaladinGuildCode(activeGuildCode)) return false;

  return Boolean(defense.isGlobal || defense.is_global) && !defenseBelongsToGuild(defense, activeGuildCode);
}

export function resolveDefenseVariantsForGuild(defenses = [], guildCode) {
  const activeGuildKey = normalizeGuildCodeKey(guildCode);
  const localByRootId = new Map();
  const hiddenRootIds = new Set();

  (defenses || []).forEach((defense) => {
    const rootId = getDefenseRootId(defense);
    if (!rootId || !defense.sourceDefenseId) return;
    if (normalizeGuildCodeKey(defense.guildCode) !== activeGuildKey) return;

    if (defense.isHidden) {
      hiddenRootIds.add(String(rootId));
      return;
    }

    localByRootId.set(String(rootId), defense);
  });

  const resolved = [];
  const emittedRootIds = new Set();

  (defenses || []).forEach((defense) => {
    const rootId = getDefenseRootId(defense);
    if (!rootId) return;

    const rootKey = String(rootId);
    if (emittedRootIds.has(rootKey) || hiddenRootIds.has(rootKey)) return;

    const localVariant = localByRootId.get(rootKey);
    if (localVariant) {
      resolved.push(localVariant);
      emittedRootIds.add(rootKey);
      return;
    }

    if (defense.isHidden) return;
    resolved.push(defense);
    emittedRootIds.add(rootKey);
  });

  return resolved;
}
