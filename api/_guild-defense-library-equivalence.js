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
  organization_id,
  image_url,
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

function isHiddenDefense(defense) {
  return Boolean(defense?.is_hidden || defense?.isHidden);
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

export function isLibraryEquivalenceSchemaMissing(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  const code = String(error?.code || "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    code === "PGRST204" ||
    code === "42703" ||
    message.includes("guild_defense_library_similarity_reviews") ||
    message.includes("guild_defense_library_equivalence_touch_updated_at")
  );
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

function buildReviewRow({ organizationId, leftDefense, rightDefense, status, reviewerName = null }) {
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

  if (!similaritySignature || similaritySignature !== getDefenseSimilaritySignature(right)) return null;

  return {
    organization_id: organizationId,
    left_defense_id: left.id,
    right_defense_id: right.id,
    status,
    reviewed_by_member_id: null,
    reviewed_by_name: status === "identical" ? reviewerName : null,
    reviewed_at: status === "identical" ? now : null,
    left_identity_signature: getDefenseIdentitySignature(left),
    right_identity_signature: getDefenseIdentitySignature(right),
    similarity_signature: similaritySignature,
    updated_at: now,
  };
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
    if (review.status !== "pending" || !reviewIsCurrent(review, defensesById)) continue;
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
