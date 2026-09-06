import {
  createLocalDefenseReviewSignature,
  createLocalDefenseSimilaritySignature,
  localDefenseHasCompleteLayout,
  normalizeGvgChampionSimilarityKey,
  normalizeGvgDirection,
  normalizeGvgMapType,
  normalizeGvgPosition,
} from "./_gvg-enemy-defense-bank.js";
import { normalizeGuildCodeKey } from "../src/lib/guildScope.js";

export const GUILD_DEFENSE_LIBRARY_EQUIVALENCE_MESSAGE =
  "Migration equivalences bibliotheque defenses requise.";

const SIMILARITY_HERO_COUNT = 5;
const LIBRARY_DEFENSE_SELECT = `
  id,
  name,
  tier,
  type,
  faction,
  guild_code,
  is_global,
  is_hidden,
  merged_into_defense_id,
  merged_at,
  merged_by_member_id,
  organization_id,
  image_url,
  created_at,
  source_defense_id,
  source_guild_code,
  source_defense_name,
  source_enemy_defense_id,
  source_enemy_defense_fingerprint,
  source_enemy_portal_guild_id,
  source_enemy_label,
  source_enemy_imported_at,
  guild_defense_slots (
    slot_index,
    champion_id,
    position,
    direction,
    champions (
      id,
      name,
      portal_name,
      english_name
    )
  )
`;

function cleanText(value) {
  return String(value || "").trim();
}

function readSlotChampion(slot) {
  return (
    slot?.champions?.name ||
    slot?.champions?.portal_name ||
    slot?.champions?.english_name ||
    slot?.champion ||
    slot?.name ||
    slot?.hero ||
    slot
  );
}

function readDefenseSlots(defense) {
  return Array.isArray(defense?.guild_defense_slots)
    ? defense.guild_defense_slots
    : Array.isArray(defense?.detailedSlots)
      ? defense.detailedSlots
      : Array.isArray(defense?.detailed_slots)
        ? defense.detailed_slots
        : Array.isArray(defense?.slots)
          ? defense.slots
          : [];
}

function getDefenseSourceId(defense) {
  return defense?.source_defense_id || defense?.sourceDefenseId || null;
}

function getDefenseMergedIntoId(defense) {
  return defense?.merged_into_defense_id || defense?.mergedIntoDefenseId || null;
}

function isHiddenDefense(defense) {
  return Boolean(defense?.is_hidden || defense?.isHidden || getDefenseMergedIntoId(defense));
}

function isNativeLibraryDefense(defense) {
  return Boolean(defense?.id && !getDefenseSourceId(defense) && !isHiddenDefense(defense));
}

function sortPairIds(leftId, rightId) {
  const ids = [String(leftId || ""), String(rightId || "")].filter(Boolean).sort();
  return ids.length === 2 && ids[0] !== ids[1] ? ids : [];
}

function makePairKey(leftId, rightId) {
  const ids = sortPairIds(leftId, rightId);
  return ids.length === 2 ? `${ids[0]}:${ids[1]}` : "";
}

function getDefenseSimilaritySignature(defense) {
  return createLocalDefenseSimilaritySignature(defense);
}

function getDefenseIdentitySignature(defense) {
  return createLocalDefenseReviewSignature(defense) || createLocalDefenseSimilaritySignature(defense);
}

function reviewPairKey(review) {
  return makePairKey(review?.left_defense_id, review?.right_defense_id);
}

function reviewIsCurrent(review, defensesById = new Map()) {
  const left = defensesById.get(String(review?.left_defense_id || ""));
  const right = defensesById.get(String(review?.right_defense_id || ""));
  if (!left || !right) return false;

  return (
    getDefenseSimilaritySignature(left) &&
    getDefenseSimilaritySignature(left) === getDefenseSimilaritySignature(right) &&
    getDefenseIdentitySignature(left) === review?.left_identity_signature &&
    getDefenseIdentitySignature(right) === review?.right_identity_signature
  );
}

function addGraphEdge(adjacency, leftId, rightId) {
  if (!leftId || !rightId || leftId === rightId) return;
  if (!adjacency.has(leftId)) adjacency.set(leftId, new Set());
  if (!adjacency.has(rightId)) adjacency.set(rightId, new Set());
  adjacency.get(leftId).add(rightId);
  adjacency.get(rightId).add(leftId);
}

function buildIdenticalAdjacency(reviews = [], defensesById = new Map()) {
  const adjacency = new Map();

  for (const review of reviews || []) {
    if (review?.status !== "identical" || !reviewIsCurrent(review, defensesById)) continue;
    addGraphEdge(adjacency, String(review.left_defense_id), String(review.right_defense_id));
  }

  return adjacency;
}

function getConnectedComponent(seedId, adjacency = new Map()) {
  const seed = String(seedId || "");
  if (!seed) return new Set();

  const seen = new Set([seed]);
  const queue = [seed];

  while (queue.length) {
    const current = queue.shift();
    for (const next of adjacency.get(current) || []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }

  return seen;
}

export function resolveDefenseRootId(defenseId, defensesById = new Map()) {
  let currentId = String(defenseId || "");
  const visited = new Set();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const current = defensesById.get(currentId);
    const sourceId = current ? getDefenseSourceId(current) : null;
    if (!sourceId) return currentId;
    currentId = String(sourceId);
  }

  return String(defenseId || "");
}

function mapDefenseSummary(defense) {
  return {
    id: defense?.id || "",
    name: defense?.name || "",
    guildCode: defense?.guild_code || defense?.guildCode || "",
    guild_code: defense?.guild_code || defense?.guildCode || "",
    type: defense?.type || "",
    imageUrl: defense?.image_url || defense?.imageUrl || defense?.image || "",
    image_url: defense?.image_url || defense?.imageUrl || defense?.image || "",
    sourceEnemyDefenseId: defense?.source_enemy_defense_id || defense?.sourceEnemyDefenseId || null,
    source_enemy_defense_id: defense?.source_enemy_defense_id || defense?.sourceEnemyDefenseId || null,
    mergedIntoDefenseId: getDefenseMergedIntoId(defense),
    merged_into_defense_id: getDefenseMergedIntoId(defense),
  };
}

function readDefenseConditions(defense) {
  return Array.isArray(defense?.guild_defense_conditions)
    ? defense.guild_defense_conditions
    : Array.isArray(defense?.conditions)
      ? defense.conditions
      : [];
}

function readDefenseBlocks(defense) {
  return Array.isArray(defense?.guild_defense_blocks)
    ? defense.guild_defense_blocks
    : Array.isArray(defense?.infoBlocks)
      ? defense.infoBlocks
      : Array.isArray(defense?.info_blocks)
        ? defense.info_blocks
        : [];
}

function getDefenseImageUrl(defense) {
  return cleanText(defense?.image_url || defense?.imageUrl || defense?.image);
}

function getDefenseGuildCode(defense) {
  return cleanText(defense?.guild_code || defense?.guildCode);
}

function hasDefenseEnemyLink(defense) {
  return Boolean(defense?.source_enemy_defense_id || defense?.sourceEnemyDefenseId || defense?.source_enemy_defense_fingerprint || defense?.sourceEnemyDefenseFingerprint);
}

function getEnemyLinkIdentity(defense) {
  const enemyId = cleanText(defense?.source_enemy_defense_id || defense?.sourceEnemyDefenseId);
  const fingerprint = cleanText(defense?.source_enemy_defense_fingerprint || defense?.sourceEnemyDefenseFingerprint);
  if (!enemyId && !fingerprint) return "";
  return fingerprint || `id:${enemyId}`;
}

function normalizeComparableText(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getConditionKey(condition) {
  const championId = cleanText(condition?.champion_id || condition?.championId);
  const championName = normalizeGvgChampionSimilarityKey(
    condition?.champions?.name ||
      condition?.champions?.portal_name ||
      condition?.champions?.english_name ||
      condition?.champion ||
      condition?.hero,
  );
  const minAwakening = Number(condition?.min_awakening ?? condition?.minAwakening ?? 0) || 0;
  return `${championId || championName}:a${minAwakening}`;
}

function getBlockKey(block) {
  return [
    normalizeComparableText(block?.block_type || block?.blockType || "text"),
    normalizeComparableText(block?.content),
  ].join(":");
}

function hasUsefulMetadata(value) {
  const text = normalizeComparableText(value);
  return Boolean(text && text !== "none" && text !== "aucun" && text !== "--" && text !== "meta_s");
}

function hasDescriptiveTitle(name) {
  const normalized = normalizeComparableText(name);
  if (normalized.length < 7) return false;
  return !["test", "defense", "def", "tour", "bastion", "copy", "copie"].some((token) => normalized === token || normalized.startsWith(`${token} `));
}

function getCreatedTime(defense) {
  const time = Date.parse(defense?.created_at || defense?.createdAt || "");
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

function getActiveDescendants(defenseRows = [], rootId = "") {
  const rootKey = String(rootId || "");
  return (defenseRows || []).filter(
    (defense) => String(getDefenseSourceId(defense) || "") === rootKey && !isHiddenDefense(defense),
  );
}

function getPresentGuildsForRoots(defenseRows = [], rootIds = []) {
  const rootSet = new Set((rootIds || []).map(String));
  const presentByGuild = new Map();

  for (const defense of defenseRows || []) {
    if (!defense?.id || isHiddenDefense(defense)) continue;
    const rowRootId = getDefenseSourceId(defense) ? String(getDefenseSourceId(defense)) : String(defense.id);
    if (!rootSet.has(rowRootId)) continue;
    const guildCode = getDefenseGuildCode(defense);
    const guildKey = normalizeGuildCodeKey(guildCode);
    if (!guildKey || presentByGuild.has(guildKey)) continue;
    presentByGuild.set(guildKey, {
      guildCode,
      guild_code: guildCode,
      viaDefenseId: defense.id,
      via_defense_id: defense.id,
      viaDefenseName: defense.name || "",
      via_defense_name: defense.name || "",
      status: getDefenseSourceId(defense) ? "imported" : "native",
    });
  }

  return [...presentByGuild.values()];
}

export function scoreGuildDefenseLibraryRoot(defense, defenseRows = []) {
  const descendants = getActiveDescendants(defenseRows, defense?.id);
  const presentGuilds = getPresentGuildsForRoots(defenseRows, [defense?.id]);
  const conditionCount = new Set(readDefenseConditions(defense).map(getConditionKey).filter(Boolean)).size;
  const blockCount = new Set(readDefenseBlocks(defense).map(getBlockKey).filter(Boolean)).size;
  const hasLayout = localDefenseHasCompleteLayout(defense);
  const hasEnemy = hasDefenseEnemyLink(defense);
  const hasImage = Boolean(getDefenseImageUrl(defense));
  const descriptiveTitle = hasDescriptiveTitle(defense?.name);
  const tierUseful = hasUsefulMetadata(defense?.tier);
  const factionUseful = hasUsefulMetadata(defense?.faction);

  const metrics = {
    layoutComplete: hasLayout,
    enemyLink: hasEnemy,
    image: hasImage,
    blockCount,
    conditionCount,
    activeCopyCount: descendants.length,
    presentGuildCount: presentGuilds.length,
    descriptiveTitle,
    tierUseful,
    factionUseful,
  };
  const score =
    (hasLayout ? 400 : 0) +
    (hasEnemy ? 250 : 0) +
    (hasImage ? 180 : 0) +
    Math.min(blockCount, 8) * 20 +
    Math.min(conditionCount, 8) * 15 +
    Math.min(presentGuilds.length, 10) * 12 +
    Math.min(descendants.length, 12) * 8 +
    (descriptiveTitle ? 30 : 0) +
    (tierUseful ? 10 : 0) +
    (factionUseful ? 10 : 0);

  const reasons = [];
  if (hasLayout) reasons.push("layout complet");
  if (hasEnemy) reasons.push("lien defense adverse");
  if (hasImage) reasons.push("image presente");
  if (blockCount) reasons.push(`${blockCount} bloc(s) info`);
  if (conditionCount) reasons.push(`${conditionCount} condition(s)`);
  if (presentGuilds.length) reasons.push(`${presentGuilds.length} guilde(s) concernee(s)`);
  if (descriptiveTitle) reasons.push("titre descriptif");
  if (tierUseful || factionUseful) reasons.push("tier/faction renseignes");
  if (!reasons.length) reasons.push("donnees minimales");

  return { score, reasons, metrics };
}

function compareScoredDefenses(left, right, defenseRows = []) {
  const leftScore = scoreGuildDefenseLibraryRoot(left, defenseRows);
  const rightScore = scoreGuildDefenseLibraryRoot(right, defenseRows);
  if (leftScore.score !== rightScore.score) return leftScore.score > rightScore.score ? -1 : 1;

  const leftCreated = getCreatedTime(left);
  const rightCreated = getCreatedTime(right);
  if (leftCreated !== rightCreated) return leftCreated < rightCreated ? -1 : 1;

  return String(left?.id || "").localeCompare(String(right?.id || ""));
}

function chooseCanonicalDefense(left, right, defenseRows = []) {
  const ordered = [left, right].sort((a, b) => compareScoredDefenses(a, b, defenseRows));
  const canonical = ordered[0];
  const absorbed = ordered[1];
  return {
    canonical,
    absorbed,
    canonicalScore: scoreGuildDefenseLibraryRoot(canonical, defenseRows),
    absorbedScore: scoreGuildDefenseLibraryRoot(absorbed, defenseRows),
  };
}

function hasSameCompleteLayout(left, right) {
  if (!localDefenseHasCompleteLayout(left) || !localDefenseHasCompleteLayout(right)) return true;
  return createLocalDefenseReviewSignature(left) === createLocalDefenseReviewSignature(right);
}

function hasCompatibleEnemyLink(left, right) {
  const leftEnemy = getEnemyLinkIdentity(left);
  const rightEnemy = getEnemyLinkIdentity(right);
  return !leftEnemy || !rightEnemy || leftEnemy === rightEnemy;
}

function buildTransferPlan(canonical, absorbed) {
  const transfers = [];

  if (!localDefenseHasCompleteLayout(canonical) && localDefenseHasCompleteLayout(absorbed)) {
    transfers.push({ type: "layout", label: "layout", action: "copy_from_absorbed" });
  }
  if (!hasDefenseEnemyLink(canonical) && hasDefenseEnemyLink(absorbed)) {
    transfers.push({ type: "enemy", label: "lien enemy", action: "copy_from_absorbed" });
  }
  if (!getDefenseImageUrl(canonical) && getDefenseImageUrl(absorbed)) {
    transfers.push({ type: "image", label: "image", action: "copy_from_absorbed" });
  } else if (getDefenseImageUrl(canonical) && getDefenseImageUrl(absorbed) && getDefenseImageUrl(canonical) !== getDefenseImageUrl(absorbed)) {
    transfers.push({ type: "image", label: "image absorbed conservee en audit", action: "audit_only" });
  }

  const canonicalConditions = new Set(readDefenseConditions(canonical).map(getConditionKey).filter(Boolean));
  const absorbedConditions = readDefenseConditions(absorbed).map(getConditionKey).filter(Boolean);
  const newConditionCount = absorbedConditions.filter((key) => !canonicalConditions.has(key)).length;
  if (newConditionCount) transfers.push({ type: "conditions", label: `${newConditionCount} condition(s)`, action: "union" });

  const canonicalBlocks = new Set(readDefenseBlocks(canonical).map(getBlockKey).filter(Boolean));
  const absorbedBlocks = readDefenseBlocks(absorbed).map(getBlockKey).filter(Boolean);
  const newBlockCount = absorbedBlocks.filter((key) => !canonicalBlocks.has(key)).length;
  if (newBlockCount) transfers.push({ type: "blocks", label: `${newBlockCount} bloc(s) info`, action: "union" });

  if (!hasUsefulMetadata(canonical?.tier) && hasUsefulMetadata(absorbed?.tier)) {
    transfers.push({ type: "tier", label: "tier", action: "copy_from_absorbed" });
  }
  if (!hasUsefulMetadata(canonical?.faction) && hasUsefulMetadata(absorbed?.faction)) {
    transfers.push({ type: "faction", label: "faction", action: "copy_from_absorbed" });
  }

  return transfers;
}

function buildLocalCollisionPlan(canonicalLocal, absorbedLocal, defenseRows = [], options = {}) {
  const ordered = [canonicalLocal, absorbedLocal].sort((a, b) => compareScoredDefenses(a, b, defenseRows));
  const keep = ordered[0];
  const hide = ordered[1];
  const conflicts = [];
  if (!hasSameCompleteLayout(keep, hide)) conflicts.push("layouts locaux complets differents");
  if (!hasCompatibleEnemyLink(keep, hide)) conflicts.push("liens enemy locaux incompatibles");

  return {
    guildCode: getDefenseGuildCode(absorbedLocal),
    guild_code: getDefenseGuildCode(absorbedLocal),
    keepDefenseId: keep.id,
    keep_defense_id: keep.id,
    keepDefenseName: keep.name || "",
    keep_defense_name: keep.name || "",
    hideDefenseId: hide.id,
    hide_defense_id: hide.id,
    hideDefenseName: hide.name || "",
    hide_defense_name: hide.name || "",
    canonicalCopyId: canonicalLocal.id,
    canonical_copy_id: canonicalLocal.id,
    absorbedCopyId: absorbedLocal.id,
    absorbed_copy_id: absorbedLocal.id,
    absorbedRoot: Boolean(options.absorbedRoot),
    absorbed_root: Boolean(options.absorbedRoot),
    canResolve: conflicts.length === 0,
    can_resolve: conflicts.length === 0,
    conflicts,
  };
}

function buildMergeGuildsAfter(canonical, absorbed, defenseRows = [], { rootLocalPresence = null, collisions = [] } = {}) {
  if (!canonical?.id || !absorbed?.id) return [];

  const canonicalId = String(canonical.id);
  const absorbedId = String(absorbed.id);
  const hiddenIds = new Set([absorbedId]);
  const convertedRootIds = new Set();
  const familySignature = getDefenseSimilaritySignature(canonical);

  const rootAction = rootLocalPresence?.action || "";
  if (rootAction === "convert_absorbed_root") {
    hiddenIds.delete(absorbedId);
    convertedRootIds.add(absorbedId);
  }

  for (const collision of collisions || []) {
    const hideId = String(collision.hideDefenseId || collision.hide_defense_id || "");
    const keepId = String(collision.keepDefenseId || collision.keep_defense_id || "");
    if (hideId) hiddenIds.add(hideId);
    if ((collision.absorbedRoot || collision.absorbed_root) && keepId === absorbedId) {
      hiddenIds.delete(absorbedId);
      convertedRootIds.add(absorbedId);
    }
  }

  const presentByGuild = new Map();
  for (const row of defenseRows || []) {
    const rowId = String(row?.id || "");
    if (!rowId || hiddenIds.has(rowId)) continue;
    if (!convertedRootIds.has(rowId) && isHiddenDefense(row)) continue;

    let rowRootId = getDefenseSourceId(row) ? String(getDefenseSourceId(row)) : rowId;
    if (rowRootId === absorbedId || convertedRootIds.has(rowId)) rowRootId = canonicalId;
    if (rowRootId !== canonicalId) continue;
    if (familySignature && getDefenseSimilaritySignature(row) !== familySignature) continue;

    const guildCode = getDefenseGuildCode(row);
    const guildKey = normalizeGuildCodeKey(guildCode);
    if (!guildKey || presentByGuild.has(guildKey)) continue;
    presentByGuild.set(guildKey, {
      guildCode,
      guild_code: guildCode,
      viaDefenseId: row.id,
      via_defense_id: row.id,
      viaDefenseName: row.name || "",
      via_defense_name: row.name || "",
      status: rowId === canonicalId ? "native" : "imported",
    });
  }

  return [...presentByGuild.values()];
}

function buildLocalCollisionPlans(canonical, absorbed, defenseRows = []) {
  const canonicalChildrenByGuild = new Map();
  for (const child of getActiveDescendants(defenseRows, canonical?.id)) {
    const guildKey = normalizeGuildCodeKey(getDefenseGuildCode(child));
    if (guildKey && !canonicalChildrenByGuild.has(guildKey)) canonicalChildrenByGuild.set(guildKey, child);
  }

  const collisions = [];
  const directRepointed = [];
  let rootLocalPresence = null;
  const canonicalGuildCode = getDefenseGuildCode(canonical);
  const absorbedGuildCode = getDefenseGuildCode(absorbed);
  const canonicalGuildKey = normalizeGuildCodeKey(canonicalGuildCode);
  const absorbedGuildKey = normalizeGuildCodeKey(absorbedGuildCode);

  if (absorbedGuildKey) {
    if (canonicalGuildKey && canonicalGuildKey === absorbedGuildKey) {
      rootLocalPresence = {
        action: "covered_by_canonical_root",
        guildCode: absorbedGuildCode,
        guild_code: absorbedGuildCode,
        keepDefenseId: canonical?.id || "",
        keep_defense_id: canonical?.id || "",
        absorbedDefenseId: absorbed?.id || "",
        absorbed_defense_id: absorbed?.id || "",
        message: `${absorbedGuildCode} reste couverte par la root conservee.`,
      };
    } else {
      const existingCanonicalLocal = canonicalChildrenByGuild.get(absorbedGuildKey) || null;
      if (existingCanonicalLocal) {
        const collision = buildLocalCollisionPlan(existingCanonicalLocal, absorbed, defenseRows, { absorbedRoot: true });
        collisions.push(collision);
        rootLocalPresence = {
          action: "merge_absorbed_root_with_existing_copy",
          guildCode: absorbedGuildCode,
          guild_code: absorbedGuildCode,
          keepDefenseId: collision.keepDefenseId,
          keep_defense_id: collision.keep_defense_id,
          hideDefenseId: collision.hideDefenseId,
          hide_defense_id: collision.hide_defense_id,
          message: `${absorbedGuildCode} possede deja une copie locale de la root conservee : une seule defense locale sera gardee.`,
        };
        if (String(collision.keepDefenseId || collision.keep_defense_id || "") === String(absorbed?.id || "")) {
          canonicalChildrenByGuild.set(absorbedGuildKey, absorbed);
        }
      } else {
        rootLocalPresence = {
          action: "convert_absorbed_root",
          guildCode: absorbedGuildCode,
          guild_code: absorbedGuildCode,
          keepDefenseId: absorbed?.id || "",
          keep_defense_id: absorbed?.id || "",
          sourceDefenseId: canonical?.id || "",
          source_defense_id: canonical?.id || "",
          sourceGuildCode: canonicalGuildCode,
          source_guild_code: canonicalGuildCode,
          sourceDefenseName: canonical?.name || "",
          source_defense_name: canonical?.name || "",
          message: `${absorbedGuildCode} conserve ${absorbed?.name || "la defense"} comme copie locale de ${canonical?.name || "la root conservee"}.`,
        };
        canonicalChildrenByGuild.set(absorbedGuildKey, absorbed);
      }
    }
  }

  for (const absorbedChild of getActiveDescendants(defenseRows, absorbed?.id)) {
    const guildKey = normalizeGuildCodeKey(getDefenseGuildCode(absorbedChild));
    const canonicalChild = guildKey ? canonicalChildrenByGuild.get(guildKey) : null;
    if (!canonicalChild) {
      directRepointed.push(absorbedChild);
      continue;
    }

    const collision = buildLocalCollisionPlan(canonicalChild, absorbedChild, defenseRows);
    collisions.push(collision);
    if (String(collision.keepDefenseId || collision.keep_defense_id || "") === String(absorbedChild.id || "")) {
      canonicalChildrenByGuild.set(guildKey, absorbedChild);
    }
  }

  return { collisions, directRepointed, rootLocalPresence };
}

export function buildGuildDefenseLibraryMergePlan(
  defenseRows = [],
  reviews = [],
  { organizationId = "", reviewId = "", leftDefenseId = "", rightDefenseId = "" } = {},
) {
  const organizationKey = String(organizationId || "");
  const rowsById = new Map((defenseRows || []).filter((row) => row?.id).map((row) => [String(row.id), row]));
  const requestedPairKey = leftDefenseId && rightDefenseId ? makePairKey(leftDefenseId, rightDefenseId) : "";
  const review = (reviews || []).find((row) => {
    if (reviewId && String(row?.id || "") === String(reviewId)) return true;
    return requestedPairKey && makePairKey(row?.left_defense_id, row?.right_defense_id) === requestedPairKey;
  });
  const conflicts = [];

  if (!review) {
    conflicts.push({ type: "review_missing", message: "Review bibliotheque introuvable." });
    return { ok: true, canMerge: false, can_merge: false, conflicts, transfers: [], localCollisions: [], local_collisions: [] };
  }

  const left = rowsById.get(String(review.left_defense_id || leftDefenseId || ""));
  const right = rowsById.get(String(review.right_defense_id || rightDefenseId || ""));
  if (!left || !right) conflicts.push({ type: "root_missing", message: "Une des deux roots est introuvable." });
  if (organizationKey && String(review.organization_id || "") !== organizationKey) {
    conflicts.push({ type: "review_tenant_mismatch", message: "Review hors organisation." });
  }
  if (review.status !== "identical") {
    conflicts.push({ type: "review_not_identical", message: "La paire doit d'abord etre validee IDENTIQUE." });
  }

  if (left && right) {
    const leftOrganization = String(left.organization_id || left.organizationId || "");
    const rightOrganization = String(right.organization_id || right.organizationId || "");
    if (!leftOrganization || !rightOrganization || leftOrganization !== rightOrganization) {
      conflicts.push({ type: "cross_tenant", message: "Fusion inter-organisation refusee." });
    }
    if (organizationKey && (leftOrganization !== organizationKey || rightOrganization !== organizationKey)) {
      conflicts.push({ type: "organization_mismatch", message: "Defense hors organisation active." });
    }
    if (getDefenseSourceId(left) || getDefenseSourceId(right)) {
      conflicts.push({ type: "non_native_root", message: "Seules deux roots natives peuvent etre fusionnees." });
    }
    if (isHiddenDefense(left) || isHiddenDefense(right)) {
      conflicts.push({ type: "inactive_root", message: "Une root est deja masquee ou fusionnee." });
    }
    const leftSignature = getDefenseSimilaritySignature(left);
    const rightSignature = getDefenseSimilaritySignature(right);
    if (!leftSignature || leftSignature !== rightSignature || leftSignature !== review.similarity_signature) {
      conflicts.push({ type: "signature_mismatch", message: "Signature structurelle differente ou obsolete." });
    }
    if (!reviewIsCurrent(review, rowsById)) {
      conflicts.push({ type: "review_obsolete", message: "Review obsolete apres changement de defense." });
    }
    if (!hasSameCompleteLayout(left, right)) {
      conflicts.push({ type: "layout_conflict", message: "Layouts complets differents." });
    }
    if (!hasCompatibleEnemyLink(left, right)) {
      conflicts.push({ type: "enemy_link_conflict", message: "Liens enemy incompatibles." });
    }
  }

  const choice = left && right ? chooseCanonicalDefense(left, right, defenseRows) : {};
  const { canonical, absorbed, canonicalScore, absorbedScore } = choice;
  const { collisions = [], directRepointed = [], rootLocalPresence = null } = canonical && absorbed
    ? buildLocalCollisionPlans(canonical, absorbed, defenseRows)
    : {};
  const unresolvedCollisions = collisions.filter((collision) => !collision.canResolve);
  for (const collision of unresolvedCollisions) {
    conflicts.push({
      type: "local_collision_conflict",
      message: `Collision locale impossible a resoudre sans arbitrage dans ${collision.guildCode || collision.guild_code}.`,
      guildCode: collision.guildCode || collision.guild_code,
      conflicts: collision.conflicts,
    });
  }

  const transfers = canonical && absorbed ? buildTransferPlan(canonical, absorbed) : [];
  const guilds = canonical && absorbed ? getPresentGuildsForRoots(defenseRows, [canonical.id, absorbed.id]) : [];
  const guildsAfter = canonical && absorbed
    ? buildMergeGuildsAfter(canonical, absorbed, defenseRows, { rootLocalPresence, collisions })
    : [];
  const canMerge = conflicts.length === 0;

  return {
    ok: true,
    canMerge,
    can_merge: canMerge,
    reviewId: review.id || "",
    review_id: review.id || "",
    canonical: canonical ? mapDefenseSummary(canonical) : null,
    absorbed: absorbed ? mapDefenseSummary(absorbed) : null,
    canonicalScore,
    canonical_score: canonicalScore,
    absorbedScore,
    absorbed_score: absorbedScore,
    reasons: canonicalScore?.reasons || [],
    guilds,
    guildsAfter,
    guilds_after: guildsAfter,
    rootLocalPresence,
    root_local_presence: rootLocalPresence,
    descendants: {
      repointedCount: directRepointed.length,
      repointed_count: directRepointed.length,
      repointedDefenseIds: directRepointed.map((defense) => defense.id),
      repointed_defense_ids: directRepointed.map((defense) => defense.id),
    },
    localCollisions: collisions,
    local_collisions: collisions,
    transfers,
    conflicts,
  };
}

export function buildLibraryEquivalenceState(defenses = [], reviews = []) {
  const visibleDefenses = (defenses || []).filter((defense) => defense?.id && !isHiddenDefense(defense));
  const defensesById = new Map(visibleDefenses.map((defense) => [String(defense.id), defense]));
  const nativeDefenses = visibleDefenses.filter(isNativeLibraryDefense);
  const nativeIds = new Set(nativeDefenses.map((defense) => String(defense.id)));
  const adjacency = buildIdenticalAdjacency(reviews, defensesById);
  const pendingCounts = new Map();

  for (const review of reviews || []) {
    if (review?.status !== "pending" || !reviewIsCurrent(review, defensesById)) continue;
    const leftId = String(review.left_defense_id || "");
    const rightId = String(review.right_defense_id || "");
    if (!nativeIds.has(leftId) || !nativeIds.has(rightId)) continue;
    pendingCounts.set(leftId, (pendingCounts.get(leftId) || 0) + 1);
    pendingCounts.set(rightId, (pendingCounts.get(rightId) || 0) + 1);
  }

  const byDefenseId = new Map();

  for (const nativeDefense of nativeDefenses) {
    const defenseId = String(nativeDefense.id);
    const familySignature = getDefenseSimilaritySignature(nativeDefense);
    const familyRootIds = [...getConnectedComponent(defenseId, adjacency)].filter((id) => nativeIds.has(id));
    if (!familyRootIds.length) familyRootIds.push(defenseId);
    const familyRootSet = new Set(familyRootIds);
    const equivalentDefenses = familyRootIds
      .filter((id) => id !== defenseId)
      .map((id) => mapDefenseSummary(defensesById.get(id)))
      .filter((defense) => defense.id);

    const presentByGuild = new Map();
    for (const row of visibleDefenses) {
      const rowRootId = resolveDefenseRootId(row.id, defensesById);
      if (!familyRootSet.has(rowRootId)) continue;
      if (familySignature && getDefenseSimilaritySignature(row) !== familySignature) continue;
      const guildCode = row.guild_code || row.guildCode || "";
      const guildKey = normalizeGuildCodeKey(guildCode);
      if (!guildKey || presentByGuild.has(guildKey)) continue;
      presentByGuild.set(guildKey, {
        guildCode,
        guild_code: guildCode,
        viaDefenseId: row.id,
        via_defense_id: row.id,
        viaDefenseName: row.name || "",
        via_defense_name: row.name || "",
        status: getDefenseSourceId(row) ? "imported" : "native",
      });
    }

    byDefenseId.set(defenseId, {
      familyRootIds,
      family_root_ids: familyRootIds,
      equivalentDefenseIds: equivalentDefenses.map((defense) => defense.id),
      equivalent_defense_ids: equivalentDefenses.map((defense) => defense.id),
      equivalentDefenses,
      equivalent_defenses: equivalentDefenses,
      equivalenceCount: equivalentDefenses.length,
      equivalence_count: equivalentDefenses.length,
      pendingCount: pendingCounts.get(defenseId) || 0,
      pending_count: pendingCounts.get(defenseId) || 0,
      presentGuilds: [...presentByGuild.values()],
      present_guilds: [...presentByGuild.values()],
    });
  }

  return { byDefenseId, adjacency, defensesById };
}

export function buildLibraryEquivalenceMergeCandidates(
  defenseRows = [],
  reviews = [],
  defenseId = "",
  { organizationId = "" } = {},
) {
  const seedId = String(defenseId || "");
  const organizationKey = String(organizationId || "");
  const visibleDefenses = (defenseRows || []).filter((defense) => {
    if (!defense?.id || isHiddenDefense(defense)) return false;
    if (!organizationKey) return true;
    return String(defense.organization_id || defense.organizationId || "") === organizationKey;
  });
  const scopedReviews = organizationKey
    ? (reviews || []).filter((review) => String(review.organization_id || review.organizationId || "") === organizationKey)
    : reviews;
  const state = buildLibraryEquivalenceState(visibleDefenses, scopedReviews);
  const family = state.byDefenseId.get(seedId);

  if (!family) {
    return {
      family: null,
      mergeCandidates: [],
      merge_candidates: [],
    };
  }

  const familyRootIds = new Set((family.familyRootIds || family.family_root_ids || [seedId]).map(String));
  const equivalentIds = (family.equivalentDefenseIds || family.equivalent_defense_ids || []).map(String);
  const nativeRowsById = new Map(
    visibleDefenses.filter(isNativeLibraryDefense).map((defense) => [String(defense.id), defense]),
  );
  if (!nativeRowsById.has(seedId)) {
    return {
      family,
      mergeCandidates: [],
      merge_candidates: [],
    };
  }
  const usableReviews = (scopedReviews || []).filter((review) => {
    if (review?.status !== "identical" || !reviewIsCurrent(review, state.defensesById)) return false;
    const leftId = String(review.left_defense_id || "");
    const rightId = String(review.right_defense_id || "");
    return familyRootIds.has(leftId) && familyRootIds.has(rightId) && nativeRowsById.has(leftId) && nativeRowsById.has(rightId);
  });

  const mergeCandidates = equivalentIds
    .map((equivalentId) => {
      const review =
        usableReviews.find((item) => makePairKey(item.left_defense_id, item.right_defense_id) === makePairKey(seedId, equivalentId)) ||
        usableReviews.find((item) => String(item.left_defense_id || "") === equivalentId || String(item.right_defense_id || "") === equivalentId);
      const leftDefense = review ? nativeRowsById.get(String(review.left_defense_id || "")) : null;
      const rightDefense = review ? nativeRowsById.get(String(review.right_defense_id || "")) : null;
      const equivalentDefense = nativeRowsById.get(equivalentId) || null;

      if (!review || !leftDefense || !rightDefense || !equivalentDefense) return null;

      return {
        review,
        leftDefense,
        left_defense: leftDefense,
        rightDefense,
        right_defense: rightDefense,
        equivalentDefense,
        equivalent_defense: equivalentDefense,
        equivalentDefenseId: equivalentId,
        equivalent_defense_id: equivalentId,
      };
    })
    .filter(Boolean);

  return {
    family,
    mergeCandidates,
    merge_candidates: mergeCandidates,
  };
}

export function getEquivalentImportTargetStatus(defense, targetGuildCode, localDefenses = [], equivalenceState = null) {
  const sourceId = String(defense?.id || "");
  const sourceSignature = getDefenseSimilaritySignature(defense);
  const targetGuildKey = normalizeGuildCodeKey(targetGuildCode);
  const sourceGuildKey = normalizeGuildCodeKey(defense?.guildCode || defense?.guild_code);
  const state = equivalenceState?.byDefenseId?.get(sourceId) || null;
  const familyRootIds = new Set(state?.familyRootIds || state?.family_root_ids || [sourceId]);

  if (sourceGuildKey && sourceGuildKey === targetGuildKey) {
    return { status: "native", viaDefenseId: sourceId, viaDefenseName: defense?.name || "" };
  }

  for (const row of localDefenses || []) {
    if (!row?.id || isHiddenDefense(row)) continue;
    const rowGuildKey = normalizeGuildCodeKey(row.guildCode || row.guild_code);
    if (!rowGuildKey || rowGuildKey !== targetGuildKey) continue;
    if (sourceSignature && getDefenseSimilaritySignature(row) !== sourceSignature) continue;

    const rowId = String(row.id);
    const sourceDefenseId = String(row.sourceDefenseId || row.source_defense_id || "");
    if (rowId === sourceId || sourceDefenseId === sourceId) {
      return {
        status: sourceDefenseId ? "imported" : "native",
        viaDefenseId: rowId,
        viaDefenseName: row.name || "",
      };
    }

    const rowRootId = resolveDefenseRootId(rowId, equivalenceState?.defensesById || new Map());
    if (familyRootIds.has(rowRootId)) {
      return {
        status: row.sourceDefenseId || row.source_defense_id ? "equivalent-imported" : "equivalent-native",
        viaDefenseId: rowId,
        viaDefenseName: row.name || "",
      };
    }
  }

  return { status: "available", viaDefenseId: null, viaDefenseName: "" };
}

export function findLibraryDefenseSimilarityCandidates(
  defenses = [],
  reviews = [],
  draftDefense = {},
  targetGuildCode = "",
  { organizationId = draftDefense?.organization_id || draftDefense?.organizationId || "" } = {},
) {
  const draftSignature = getDefenseSimilaritySignature(draftDefense);
  if (!draftSignature) {
    return {
      draftSignature: null,
      draft_signature: null,
      candidates: [],
    };
  }

  const organizationKey = String(organizationId || "");
  const visibleDefenses = (defenses || []).filter((defense) => {
    if (!defense?.id || isHiddenDefense(defense)) return false;
    if (!organizationKey) return true;
    return String(defense.organization_id || defense.organizationId || "") === organizationKey;
  });
  const scopedReviews = organizationKey
    ? (reviews || []).filter((review) => String(review.organization_id || review.organizationId || "") === organizationKey)
    : reviews;
  const equivalenceState = buildLibraryEquivalenceState(visibleDefenses, scopedReviews);
  const draftId = String(draftDefense?.id || "");
  const targetGuildKey = normalizeGuildCodeKey(targetGuildCode);
  const candidates = visibleDefenses
    .filter((defense) => isNativeLibraryDefense(defense))
    .filter((defense) => String(defense.id) !== draftId)
    .filter((defense) => getDefenseSimilaritySignature(defense) === draftSignature)
    .filter((defense) => findReusableReviewBetweenDefenses(scopedReviews, draftDefense, defense, organizationKey)?.status !== "different")
    .map((defense) => {
      const state = equivalenceState.byDefenseId.get(String(defense.id)) || {};
      const targetBucketRow = visibleDefenses.find((row) => {
        if (!row?.id || String(row.id) === draftId || isHiddenDefense(row)) return false;
        if (normalizeGuildCodeKey(row.guildCode || row.guild_code) !== targetGuildKey) return false;
        return getDefenseSimilaritySignature(row) === draftSignature;
      });
      const target = targetBucketRow
        ? {
            status: getDefenseSourceId(targetBucketRow) ? "imported" : "native",
            viaDefenseId: targetBucketRow.id,
            viaDefenseName: targetBucketRow.name || "",
          }
        : getEquivalentImportTargetStatus(defense, targetGuildCode, visibleDefenses, equivalenceState);

      return {
        defense,
        targetStatus: target.status,
        target_status: target.status,
        targetGuildCode,
        target_guild_code: targetGuildCode,
        viaDefenseId: target.viaDefenseId || null,
        via_defense_id: target.viaDefenseId || null,
        viaDefenseName: target.viaDefenseName || "",
        via_defense_name: target.viaDefenseName || "",
        presentGuilds: state.presentGuilds || state.present_guilds || [],
        present_guilds: state.presentGuilds || state.present_guilds || [],
        familyRootIds: state.familyRootIds || state.family_root_ids || [String(defense.id)],
        family_root_ids: state.familyRootIds || state.family_root_ids || [String(defense.id)],
      };
    });

  return {
    draftSignature,
    draft_signature: draftSignature,
    candidates,
  };
}

function getSchemaErrorText(error) {
  return `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
}

function schemaErrorMentionsAny(text, objectNames = []) {
  const names = (objectNames || []).map((name) => String(name || "").trim().toLowerCase()).filter(Boolean);
  return !names.length || names.some((name) => text.includes(name));
}

function isPostgrestMissingObjectError(error, objectNames = []) {
  const message = getSchemaErrorText(error);
  if (!/(schema cache|could not find|not found|does not exist|unknown)/i.test(message)) return false;
  return schemaErrorMentionsAny(message, objectNames);
}

export function isMissingSchemaObjectError(error, { columns = [], tables = [], functions = [] } = {}) {
  const message = getSchemaErrorText(error);
  const code = String(error?.code || "");

  if (code === "42703") return schemaErrorMentionsAny(message, columns);
  if (code === "42P01") return schemaErrorMentionsAny(message, tables);
  if (code === "42883") return schemaErrorMentionsAny(message, functions);
  if (code === "PGRST204") return isPostgrestMissingObjectError(error, columns);
  if (code === "PGRST205") return isPostgrestMissingObjectError(error, tables);
  if (code === "PGRST202") return isPostgrestMissingObjectError(error, functions);
  return false;
}

export function isLibraryEquivalenceSchemaMissing(error) {
  return isMissingSchemaObjectError(error, {
    columns: [
      "merged_into_defense_id",
      "merged_at",
      "merged_by_member_id",
    ],
    tables: [
      "guild_defense_library_similarity_reviews",
      "guild_defense_library_merges",
    ],
    functions: [
      "merge_guild_defense_library_roots",
      "guild_defense_library_equivalence_touch_updated_at",
      "guild_defense_library_similarity_signature",
      "guild_defense_library_review_signature",
      "guild_defense_library_identity_signature",
      "guild_defense_library_condition_key",
    ],
  });
}

export async function loadGuildDefenseRowsForEquivalence(supabase, organizationId) {
  const { data, error } = await supabase
    .from("guild_defenses")
    .select(LIBRARY_DEFENSE_SELECT)
    .eq("organization_id", organizationId)
    .or("is_hidden.is.null,is_hidden.eq.false")
    .limit(5000);

  if (error) throw error;
  return data || [];
}

export async function loadLibrarySimilarityReviews(supabase, organizationId) {
  const { data, error } = await supabase
    .from("guild_defense_library_similarity_reviews")
    .select(`
      id,
      organization_id,
      left_defense_id,
      right_defense_id,
      status,
      reviewed_by_member_id,
      reviewed_by_name,
      reviewed_at,
      left_identity_signature,
      right_identity_signature,
      similarity_signature,
      created_at,
      updated_at
    `)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

function buildReviewRow({ organizationId, leftDefense, rightDefense, status, reviewer = null, reviewerName = null }) {
  const pair = sortPairIds(leftDefense.id, rightDefense.id);
  if (pair.length !== 2) return null;

  const byId = new Map([
    [String(leftDefense.id), leftDefense],
    [String(rightDefense.id), rightDefense],
  ]);
  const left = byId.get(pair[0]);
  const right = byId.get(pair[1]);
  const similaritySignature = getDefenseSimilaritySignature(left);
  const now = new Date().toISOString();
  const normalizedReviewer = reviewer || {};
  const resolvedReviewerName = reviewerName || normalizedReviewer.name || "";
  const reviewed = status === "identical" || status === "different";

  if (!similaritySignature || similaritySignature !== getDefenseSimilaritySignature(right)) return null;

  return {
    organization_id: organizationId,
    left_defense_id: left.id,
    right_defense_id: right.id,
    status,
    reviewed_by_member_id: reviewed ? normalizedReviewer.memberId || null : null,
    reviewed_by_name: reviewed ? resolvedReviewerName : null,
    reviewed_at: reviewed ? now : null,
    left_identity_signature: getDefenseIdentitySignature(left),
    right_identity_signature: getDefenseIdentitySignature(right),
    similarity_signature: similaritySignature,
    updated_at: now,
  };
}

function findReusableReviewBetweenDefenses(reviews = [], leftDefense, rightDefense, organizationId = "") {
  const probe = buildReviewRow({
    organizationId,
    leftDefense,
    rightDefense,
    status: "pending",
  });
  if (!probe) return null;

  const pairKey = makePairKey(leftDefense?.id, rightDefense?.id);
  const existing = (reviews || []).find((review) => reviewPairKey(review) === pairKey);
  return existing && reviewIsReusable(existing, probe) ? existing : null;
}

function groupRootsBySimilarity(roots = []) {
  const buckets = new Map();

  for (const defense of roots) {
    const signature = getDefenseSimilaritySignature(defense);
    if (!signature) continue;
    if (!buckets.has(signature)) buckets.set(signature, []);
    buckets.get(signature).push(defense);
  }

  return buckets;
}

function reviewIsReusable(existing, reviewRow) {
  return (
    existing?.left_identity_signature === reviewRow.left_identity_signature &&
    existing?.right_identity_signature === reviewRow.right_identity_signature &&
    existing?.similarity_signature === reviewRow.similarity_signature
  );
}

function readLayoutByChampion(defense) {
  const mapType = normalizeGvgMapType(defense?.type || defense?.map_type || defense?.mapType);
  const byChampion = new Map();

  for (const slot of readDefenseSlots(defense)) {
    const championKey = normalizeGvgChampionSimilarityKey(readSlotChampion(slot));
    const position = normalizeGvgPosition(slot?.position || slot?.pos, mapType);
    const direction = normalizeGvgDirection(slot?.direction || slot?.dir);
    if (championKey && position && direction) byChampion.set(championKey, { position, direction });
  }

  return byChampion;
}

function buildSlotLayoutUpdatesFromSource(targetDefense, sourceDefense) {
  const sourceLayout = readLayoutByChampion(sourceDefense);
  const mapType = normalizeGvgMapType(targetDefense?.type || targetDefense?.map_type || targetDefense?.mapType);

  return readDefenseSlots(targetDefense)
    .map((slot) => {
      const championKey = normalizeGvgChampionSimilarityKey(readSlotChampion(slot));
      const sourceSlot = championKey ? sourceLayout.get(championKey) : null;
      if (!sourceSlot) return null;

      const position = normalizeGvgPosition(sourceSlot.position, mapType);
      const direction = normalizeGvgDirection(sourceSlot.direction);
      if (!position || !direction) return null;

      return {
        slotIndex: slot.slot_index ?? slot.slotIndex,
        position,
        direction,
      };
    })
    .filter((slot) => slot?.slotIndex !== null && slot?.slotIndex !== undefined);
}

function withLayoutApplied(defense, sourceDefense) {
  const updatesBySlot = new Map(
    buildSlotLayoutUpdatesFromSource(defense, sourceDefense).map((slot) => [slot.slotIndex, slot]),
  );

  return {
    ...defense,
    guild_defense_slots: readDefenseSlots(defense).map((slot) => {
      const update = updatesBySlot.get(slot.slot_index ?? slot.slotIndex);
      return update ? { ...slot, position: update.position, direction: update.direction } : slot;
    }),
  };
}

async function refreshFamilyReviewSignatures(supabase, { organizationId, reviews = [], familyRootIds = new Set(), rows = [] } = {}) {
  const rootSet = new Set([...familyRootIds].map(String));
  const rowsById = new Map((rows || []).map((row) => [String(row.id), row]));
  const updates = [];

  for (const review of reviews || []) {
    if (review?.status !== "identical" || !review?.id) continue;
    const leftId = String(review.left_defense_id || "");
    const rightId = String(review.right_defense_id || "");
    if (!rootSet.has(leftId) || !rootSet.has(rightId)) continue;

    const left = rowsById.get(leftId);
    const right = rowsById.get(rightId);
    const similaritySignature = left && right ? getDefenseSimilaritySignature(left) : null;
    if (!similaritySignature || similaritySignature !== getDefenseSimilaritySignature(right)) continue;

    updates.push(
      supabase
        .from("guild_defense_library_similarity_reviews")
        .update({
          left_identity_signature: getDefenseIdentitySignature(left),
          right_identity_signature: getDefenseIdentitySignature(right),
          similarity_signature: similaritySignature,
        })
        .eq("id", review.id)
        .eq("organization_id", organizationId),
    );
  }

  const results = await Promise.all(updates);
  const error = results.find((result) => result.error)?.error;
  if (error) throw error;
}

async function updateDefenseSlotLayouts(supabase, defense, sourceDefense) {
  const updates = buildSlotLayoutUpdatesFromSource(defense, sourceDefense);
  if (updates.length !== SIMILARITY_HERO_COUNT) return false;

  const results = await Promise.all(
    updates.map((slot) =>
      supabase
        .from("guild_defense_slots")
        .update({ position: slot.position, direction: slot.direction })
        .eq("defense_id", defense.id)
        .eq("slot_index", slot.slotIndex),
    ),
  );
  const error = results.find((result) => result.error)?.error;
  if (error) throw error;
  return true;
}

function chooseFamilyLayoutSource(rows = []) {
  const completeRows = rows.filter(localDefenseHasCompleteLayout);
  if (!completeRows.length) return { source: null, conflict: false, signatures: [] };

  const bySignature = new Map();
  for (const row of completeRows) {
    const signature = createLocalDefenseReviewSignature(row);
    if (!signature) continue;
    if (!bySignature.has(signature)) bySignature.set(signature, row);
  }

  return {
    source: bySignature.size === 1 ? [...bySignature.values()][0] : null,
    conflict: bySignature.size > 1,
    signatures: [...bySignature.keys()],
  };
}

async function chooseFamilyEnemyLinkSource(supabase, rows = [], organizationId) {
  const linkedRows = rows.filter((row) => row.source_enemy_defense_id);
  if (!linkedRows.length) return { source: null, conflict: false, enemyIds: [] };

  const enemyIds = [...new Set(linkedRows.map((row) => String(row.source_enemy_defense_id)).filter(Boolean))];
  if (enemyIds.length === 1) return { source: linkedRows[0], conflict: false, enemyIds };

  const { data, error } = await supabase
    .from("gvg_enemy_defenses")
    .select("id, defense_fingerprint")
    .in("id", enemyIds);
  if (error) throw error;

  const fingerprints = new Set((data || []).map((row) => row.defense_fingerprint).filter(Boolean));
  if (fingerprints.size === 1) return { source: linkedRows[0], conflict: false, enemyIds };

  return {
    source: null,
    conflict: true,
    enemyIds,
    organizationId,
    fingerprints: [...fingerprints],
  };
}

function buildEnemyLinkPayload(source) {
  return {
    source_enemy_defense_id: source.source_enemy_defense_id || null,
    source_enemy_defense_fingerprint: source.source_enemy_defense_fingerprint || null,
    source_enemy_portal_guild_id: source.source_enemy_portal_guild_id || null,
    source_enemy_label: source.source_enemy_label || null,
    source_enemy_imported_at: source.source_enemy_imported_at || new Date().toISOString(),
  };
}

function buildFamilyKnowledgeContext(defenseRows = [], reviews = [], seedDefenseIds = []) {
  const state = buildLibraryEquivalenceState(defenseRows, reviews);
  const rootIds = new Set(
    (seedDefenseIds || [])
      .map((id) => resolveDefenseRootId(id, state.defensesById))
      .filter(Boolean),
  );
  const familyRootIds = new Set();
  for (const rootId of rootIds) {
    for (const familyId of state.byDefenseId.get(rootId)?.familyRootIds || [rootId]) {
      familyRootIds.add(String(familyId));
    }
  }

  const skipped = [];
  const conflicts = [];
  const familyRootRows = [...familyRootIds]
    .map((rootId) => state.defensesById.get(rootId))
    .filter(Boolean);
  const familyRootSignatures = new Set(familyRootRows.map(getDefenseSimilaritySignature).filter(Boolean));

  if (familyRootSignatures.size !== 1) {
    conflicts.push({ type: "family_signature_conflict", signatures: [...familyRootSignatures] });
    return { state, familyRootIds, candidateRows: [], skipped, conflicts, familySignature: null };
  }
  const familySignature = [...familyRootSignatures][0];

  const candidateRows = [];
  for (const row of defenseRows) {
    const rootId = resolveDefenseRootId(row.id, state.defensesById);
    if (!familyRootIds.has(rootId) || isHiddenDefense(row)) continue;
    if (getDefenseSimilaritySignature(row) !== familySignature) {
      skipped.push({ id: row.id, reason: "diverged" });
      continue;
    }
    candidateRows.push(row);
  }

  return { state, familyRootIds, candidateRows, skipped, conflicts, familySignature };
}

export async function propagateLibraryEquivalenceKnowledge(
  supabase,
  { organizationId, seedDefenseIds = [] } = {},
) {
  if (!organizationId || !(seedDefenseIds || []).length) {
    return { layoutUpdatedIds: [], enemyLinkUpdatedIds: [], skipped: [], conflicts: [] };
  }

  const [defenseRows, reviews] = await Promise.all([
    loadGuildDefenseRowsForEquivalence(supabase, organizationId),
    loadLibrarySimilarityReviews(supabase, organizationId),
  ]);
  const { familyRootIds, candidateRows, skipped, conflicts } = buildFamilyKnowledgeContext(
    defenseRows,
    reviews,
    seedDefenseIds,
  );

  if (conflicts.length) {
    return { layoutUpdatedIds: [], enemyLinkUpdatedIds: [], skipped, conflicts };
  }

  const layoutChoice = chooseFamilyLayoutSource(candidateRows);
  if (layoutChoice.conflict) {
    conflicts.push({ type: "layout_conflict", signatures: layoutChoice.signatures });
  }

  const layoutUpdatedIds = [];
  if (layoutChoice.source && !layoutChoice.conflict) {
    for (const row of candidateRows) {
      const currentSignature = getDefenseSimilaritySignature(row);
      if (!currentSignature || currentSignature !== getDefenseSimilaritySignature(layoutChoice.source)) {
        skipped.push({ id: row.id, reason: "diverged" });
        continue;
      }

      const rowComplete = localDefenseHasCompleteLayout(row);
      if (rowComplete && createLocalDefenseReviewSignature(row) !== createLocalDefenseReviewSignature(layoutChoice.source)) {
        skipped.push({ id: row.id, reason: "layout_conflict" });
        continue;
      }

      const updated = await updateDefenseSlotLayouts(supabase, row, layoutChoice.source);
      if (updated) layoutUpdatedIds.push(String(row.id));
    }
  }

  const effectiveRows = candidateRows.map((row) =>
    layoutChoice.source && !layoutChoice.conflict ? withLayoutApplied(row, layoutChoice.source) : row,
  );
  await refreshFamilyReviewSignatures(supabase, {
    organizationId,
    reviews,
    familyRootIds,
    rows: effectiveRows,
  });

  const enemyChoice = await chooseFamilyEnemyLinkSource(supabase, effectiveRows, organizationId);
  if (enemyChoice.conflict) {
    conflicts.push({ type: "enemy_link_conflict", enemyIds: enemyChoice.enemyIds, fingerprints: enemyChoice.fingerprints });
  }

  const enemyLinkUpdatedIds = [];
  if (enemyChoice.source && !enemyChoice.conflict) {
    const payload = buildEnemyLinkPayload(enemyChoice.source);
    const updateIds = effectiveRows
      .filter((row) => {
        if (!getDefenseSimilaritySignature(row) || getDefenseSimilaritySignature(row) !== getDefenseSimilaritySignature(enemyChoice.source)) return false;
        if (!row.source_enemy_defense_id) return true;
        return String(row.source_enemy_defense_id) === String(payload.source_enemy_defense_id);
      })
      .filter((row) => String(row.source_enemy_defense_id || "") !== String(payload.source_enemy_defense_id || ""))
      .map((row) => row.id);

    if (updateIds.length) {
      const { error } = await supabase
        .from("guild_defenses")
        .update(payload)
        .in("id", updateIds);
      if (error) throw error;
      enemyLinkUpdatedIds.push(...updateIds.map(String));
    }
  }

  return { layoutUpdatedIds, enemyLinkUpdatedIds, skipped, conflicts };
}

export async function detectLibraryDefenseSimilarities(
  supabase,
  { organizationId, rootDefenseIds = [] } = {},
) {
  if (!organizationId) {
    return { ok: true, skipped: true, reason: "missing_organization", pendingCreated: 0, pendingUpdated: 0, autoIdenticalCreated: 0, autoIdenticalUpdated: 0, candidatesScanned: 0 };
  }

  const [defenseRows, existingReviews] = await Promise.all([
    loadGuildDefenseRowsForEquivalence(supabase, organizationId),
    loadLibrarySimilarityReviews(supabase, organizationId),
  ]);
  const defensesById = new Map(defenseRows.map((row) => [String(row.id), row]));
  const targetRootIds = new Set(
    (rootDefenseIds || [])
      .map((id) => resolveDefenseRootId(id, defensesById))
      .filter(Boolean),
  );
  const roots = defenseRows.filter(isNativeLibraryDefense);
  const buckets = groupRootsBySimilarity(roots);
  const state = buildLibraryEquivalenceState(defenseRows, existingReviews);
  const existingByPair = new Map((existingReviews || []).map((review) => [reviewPairKey(review), review]));
  const rowsToUpsert = [];
  const autoPairs = [];
  let pendingCreated = 0;
  let pendingUpdated = 0;
  let autoIdenticalCreated = 0;
  let autoIdenticalUpdated = 0;

  for (const bucket of buckets.values()) {
    for (let leftIndex = 0; leftIndex < bucket.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < bucket.length; rightIndex += 1) {
        const left = bucket[leftIndex];
        const right = bucket[rightIndex];
        if (targetRootIds.size && !targetRootIds.has(String(left.id)) && !targetRootIds.has(String(right.id))) continue;

        const leftFamily = new Set(state.byDefenseId.get(String(left.id))?.familyRootIds || [String(left.id)]);
        if (leftFamily.has(String(right.id))) continue;

        let status = localDefenseHasCompleteLayout(left) && localDefenseHasCompleteLayout(right) && createLocalDefenseReviewSignature(left) === createLocalDefenseReviewSignature(right)
          ? "identical"
          : "pending";
        if (status === "identical") {
          const enemyChoice = await chooseFamilyEnemyLinkSource(supabase, [left, right], organizationId);
          if (enemyChoice.conflict) status = "pending";
        }
        const reviewRow = buildReviewRow({
          organizationId,
          leftDefense: left,
          rightDefense: right,
          status,
          reviewerName: "Auto-match layout complet",
        });
        if (!reviewRow) continue;

        const pairKey = makePairKey(left.id, right.id);
        const existing = existingByPair.get(pairKey);
        if (existing && reviewIsReusable(existing, reviewRow) && (existing.status === "different" || existing.status === status)) {
          continue;
        }

        if (existing?.id) reviewRow.id = existing.id;
        rowsToUpsert.push(reviewRow);
        if (status === "identical") {
          autoPairs.push([left.id, right.id]);
          if (existing) autoIdenticalUpdated += 1;
          else autoIdenticalCreated += 1;
        } else if (existing) {
          pendingUpdated += 1;
        } else {
          pendingCreated += 1;
        }
      }
    }
  }

  if (rowsToUpsert.length) {
    const { error } = await supabase
      .from("guild_defense_library_similarity_reviews")
      .upsert(rowsToUpsert, { onConflict: "left_defense_id,right_defense_id" });
    if (error) throw error;
  }

  const propagationResults = [];
  for (const pair of autoPairs) {
    propagationResults.push(await propagateLibraryEquivalenceKnowledge(supabase, {
      organizationId,
      seedDefenseIds: pair,
    }));
  }

  return {
    ok: true,
    pendingCreated,
    pendingUpdated,
    autoIdenticalCreated,
    autoIdenticalUpdated,
    candidatesScanned: rowsToUpsert.length,
    propagationResults,
  };
}

export async function recordLibrarySimilarityDecision(
  supabase,
  { organizationId, leftDefenseId, rightDefenseId, status, reviewer = {} } = {},
) {
  const normalizedStatus = cleanText(status).toLowerCase();
  if (!organizationId || !leftDefenseId || !rightDefenseId || !["identical", "different"].includes(normalizedStatus)) {
    const error = new Error("Decision similarite bibliotheque invalide.");
    error.statusCode = 400;
    throw error;
  }

  const [defenseRows, existingReviews] = await Promise.all([
    loadGuildDefenseRowsForEquivalence(supabase, organizationId),
    loadLibrarySimilarityReviews(supabase, organizationId),
  ]);
  const defensesById = new Map(defenseRows.map((row) => [String(row.id), row]));
  const leftRootId = resolveDefenseRootId(leftDefenseId, defensesById);
  const rightRootId = resolveDefenseRootId(rightDefenseId, defensesById);
  const leftDefense = defensesById.get(String(leftRootId));
  const rightDefense = defensesById.get(String(rightRootId));

  if (!leftDefense || !rightDefense) {
    const error = new Error("Defense bibliotheque introuvable pour la decision.");
    error.statusCode = 404;
    throw error;
  }

  if (!isNativeLibraryDefense(leftDefense) || !isNativeLibraryDefense(rightDefense)) {
    return {
      ok: true,
      skipped: true,
      reason: "non_native_pair",
      status: normalizedStatus,
      reviewId: "",
      review_id: "",
    };
  }

  if (normalizedStatus === "identical") {
    const leftComplete = localDefenseHasCompleteLayout(leftDefense);
    const rightComplete = localDefenseHasCompleteLayout(rightDefense);
    if (leftComplete && rightComplete && createLocalDefenseReviewSignature(leftDefense) !== createLocalDefenseReviewSignature(rightDefense)) {
      const error = new Error("Layouts complets differents : validation identique bloquee.");
      error.statusCode = 409;
      throw error;
    }

    const familyContext = buildFamilyKnowledgeContext(defenseRows, existingReviews, [leftDefense.id, rightDefense.id]);
    if (familyContext.conflicts.length) {
      const error = new Error("Famille bibliotheque incompatible : validation identique bloquee.");
      error.statusCode = 409;
      throw error;
    }
    const enemyChoice = await chooseFamilyEnemyLinkSource(supabase, familyContext.candidateRows, organizationId);
    if (enemyChoice.conflict) {
      const error = new Error("Liens adverses differents : validation identique bloquee.");
      error.statusCode = 409;
      throw error;
    }
  }

  const reviewRow = buildReviewRow({
    organizationId,
    leftDefense,
    rightDefense,
    status: normalizedStatus,
    reviewer,
  });
  if (!reviewRow) {
    const error = new Error("Decision impossible : les defenses ne partagent pas la meme signature.");
    error.statusCode = 409;
    throw error;
  }

  const existing = existingReviews.find((review) => reviewPairKey(review) === makePairKey(leftDefense.id, rightDefense.id));
  if (existing?.id) reviewRow.id = existing.id;

  const { data: persistedReview, error: upsertError } = await supabase
    .from("guild_defense_library_similarity_reviews")
    .upsert([reviewRow], { onConflict: "left_defense_id,right_defense_id" })
    .select("id")
    .single();
  if (upsertError) throw upsertError;

  const persistedReviewId = persistedReview?.id || reviewRow.id || existing?.id || "";
  if (!persistedReviewId) {
    const error = new Error("Decision similarite bibliotheque enregistree sans id de review.");
    error.statusCode = 500;
    throw error;
  }

  const propagation = normalizedStatus === "identical"
    ? await propagateLibraryEquivalenceKnowledge(supabase, {
        organizationId,
        seedDefenseIds: [leftDefense.id, rightDefense.id],
      })
    : null;

  return {
    ok: true,
    skipped: false,
    status: normalizedStatus,
    reviewId: persistedReviewId,
    review_id: persistedReviewId,
    leftDefenseId: leftDefense.id,
    left_defense_id: leftDefense.id,
    rightDefenseId: rightDefense.id,
    right_defense_id: rightDefense.id,
    propagation,
  };
}

export async function loadLibrarySimilarityCandidates(
  supabase,
  { organizationId, defenseId } = {},
) {
  const [defenseRows, reviews] = await Promise.all([
    loadGuildDefenseRowsForEquivalence(supabase, organizationId),
    loadLibrarySimilarityReviews(supabase, organizationId),
  ]);
  const defensesById = new Map(defenseRows.map((row) => [String(row.id), row]));
  const rootId = resolveDefenseRootId(defenseId, defensesById);
  const candidates = [];

  for (const review of reviews || []) {
    if (!["pending", "identical"].includes(review.status) || !reviewIsCurrent(review, defensesById)) continue;
    if (String(review.left_defense_id) !== rootId && String(review.right_defense_id) !== rootId) continue;
    const leftDefense = defensesById.get(String(review.left_defense_id));
    const rightDefense = defensesById.get(String(review.right_defense_id));
    if (!leftDefense || !rightDefense) continue;
    candidates.push({ review, leftDefense, rightDefense });
  }

  return { defenseRows, reviews, rootId, candidates };
}

export async function markLibrarySimilarityReview(
  supabase,
  { organizationId, reviewId, status, reviewer = {} } = {},
) {
  const normalizedStatus = cleanText(status).toLowerCase();
  if (!organizationId || !reviewId || !["identical", "different"].includes(normalizedStatus)) {
    const error = new Error("Review bibliotheque et statut requis.");
    error.statusCode = 400;
    throw error;
  }

  const { data: review, error: reviewError } = await supabase
    .from("guild_defense_library_similarity_reviews")
    .select("id, organization_id, left_defense_id, right_defense_id, status, left_identity_signature, right_identity_signature, similarity_signature")
    .eq("id", reviewId)
    .maybeSingle();
  if (reviewError) throw reviewError;
  if (!review || String(review.organization_id) !== String(organizationId)) {
    const error = new Error("Review bibliotheque introuvable.");
    error.statusCode = 404;
    throw error;
  }

  const [rows, reviews] = await Promise.all([
    loadGuildDefenseRowsForEquivalence(supabase, organizationId),
    loadLibrarySimilarityReviews(supabase, organizationId),
  ]);
  const rowsById = new Map(rows.map((row) => [String(row.id), row]));
  const left = rowsById.get(String(review.left_defense_id));
  const right = rowsById.get(String(review.right_defense_id));
  if (!left || !right) {
    const error = new Error("Defense bibliotheque introuvable.");
    error.statusCode = 404;
    throw error;
  }

  if (normalizedStatus === "identical") {
    const leftComplete = localDefenseHasCompleteLayout(left);
    const rightComplete = localDefenseHasCompleteLayout(right);
    if (leftComplete && rightComplete && createLocalDefenseReviewSignature(left) !== createLocalDefenseReviewSignature(right)) {
      const error = new Error("Layouts complets differents : validation identique bloquee.");
      error.statusCode = 409;
      throw error;
    }

    const familyContext = buildFamilyKnowledgeContext(rows, reviews, [left.id, right.id]);
    if (familyContext.conflicts.length) {
      const error = new Error("Famille bibliotheque incompatible : validation identique bloquee.");
      error.statusCode = 409;
      throw error;
    }
    const enemyChoice = await chooseFamilyEnemyLinkSource(supabase, familyContext.candidateRows, organizationId);
    if (enemyChoice.conflict) {
      const error = new Error("Liens adverses differents : validation identique bloquee.");
      error.statusCode = 409;
      throw error;
    }
  }

  const leftSignature = getDefenseIdentitySignature(left);
  const rightSignature = getDefenseIdentitySignature(right);
  const similaritySignature = getDefenseSimilaritySignature(left);
  const { error: updateError } = await supabase
    .from("guild_defense_library_similarity_reviews")
    .update({
      status: normalizedStatus,
      reviewed_by_member_id: reviewer.memberId || null,
      reviewed_by_name: reviewer.name || "",
      reviewed_at: new Date().toISOString(),
      left_identity_signature: leftSignature,
      right_identity_signature: rightSignature,
      similarity_signature: similaritySignature,
    })
    .eq("id", reviewId);
  if (updateError) throw updateError;

  const propagation = normalizedStatus === "identical"
    ? await propagateLibraryEquivalenceKnowledge(supabase, {
        organizationId,
        seedDefenseIds: [left.id, right.id],
      })
    : null;

  return { ok: true, status: normalizedStatus, propagation };
}
