import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildLibraryEquivalenceState,
  buildGuildDefenseLibraryMergePlan,
  detectLibraryDefenseSimilarities,
  findLibraryDefenseSimilarityCandidates,
  getEquivalentImportTargetStatus,
  markLibrarySimilarityReview,
  scoreGuildDefenseLibraryRoot,
} from "../api/_guild-defense-library-equivalence.js";
import {
  createLocalDefenseReviewSignature,
  createLocalDefenseSimilaritySignature,
  localDefenseHasCompleteLayout,
} from "../api/_gvg-enemy-defense-bank.js";

const PALADIN_ORG = "11111111-1111-4111-8111-111111111111";
const MAD_ORG = "22222222-2222-4222-8222-222222222222";
const TEST_SIMI_ID = "0a97a0d8-10f1-4752-a683-ca9f2d3b86ff";
const TEST_SIMI_ENEMY_ID = "0595e39b-c99e-4198-918d-dc88c546e4f3";
const TEST_SIMI_ENEMY_FINGERPRINT = "ba2edc3509b86aecb7f3658ea68c26d8cbc16b4aa3d63e825d495a8b0c16da4a";
const TEST_SIMI_SIMILARITY_SIGNATURE = "6b54dd124eb564a74888a45f880c2d3c94a7295a47b0f80cc7d35243d027c0e2";
const TEST_SIMI_LAYOUT = [
  ["comtedracula", "A2", "E"],
  ["brokkir", "A5", "E"],
  ["eirlys", "B3", "E"],
  ["oren", "A3", "E"],
  ["valara", "B4", "E"],
];
const TEST_SIMI_REORDERED_LAYOUT = [
  ["brokkir", null, null],
  ["comtedracula", null, null],
  ["valara", null, null],
  ["oren", null, null],
  ["eirlys", null, null],
];

function makeSlots(layout, { includeLayout = true } = {}) {
  return layout.map(([name, position, direction], index) => ({
    slot_index: index,
    champion_id: `champ-${name}`,
    champions: { id: `champ-${name}`, name },
    position: includeLayout ? position : null,
    direction: includeLayout ? direction : null,
  }));
}

function makeDefense({
  id,
  name,
  organizationId = PALADIN_ORG,
  guildCode,
  sourceDefenseId = null,
  sourceEnemyDefenseId = null,
  sourceEnemyDefenseFingerprint = null,
  tier = "S",
  faction = "",
  layout = TEST_SIMI_LAYOUT,
  includeLayout = true,
  imageUrl = "",
  conditions = [],
  infoBlocks = [],
  mergedIntoDefenseId = null,
  isHidden = false,
  createdAt = "2026-08-24T12:00:00.000Z",
} = {}) {
  return {
    id,
    name,
    tier,
    type: "Tour",
    faction,
    guild_code: guildCode,
    organization_id: organizationId,
    is_hidden: isHidden,
    is_global: true,
    source_defense_id: sourceDefenseId,
    merged_into_defense_id: mergedIntoDefenseId,
    merged_at: mergedIntoDefenseId ? "2026-08-25T12:00:00.000Z" : null,
    merged_by_member_id: mergedIntoDefenseId ? "member-admin" : null,
    source_enemy_defense_id: sourceEnemyDefenseId,
    source_enemy_defense_fingerprint: sourceEnemyDefenseFingerprint,
    source_enemy_portal_guild_id: sourceEnemyDefenseId ? "portal-guild-g3" : null,
    source_enemy_label: sourceEnemyDefenseId ? "G3 - Taux de defaite 14,3 %" : null,
    source_enemy_imported_at: sourceEnemyDefenseId ? "2026-08-24T12:00:00.000Z" : null,
    image_url: imageUrl,
    created_at: createdAt,
    guild_defense_slots: makeSlots(layout, { includeLayout }),
    guild_defense_conditions: conditions,
    guild_defense_blocks: infoBlocks,
  };
}

function makeLibraryReview(leftDefense, rightDefense, { status = "identical", organizationId = PALADIN_ORG, id = "review-merge" } = {}) {
  return {
    id,
    organization_id: organizationId,
    left_defense_id: leftDefense.id,
    right_defense_id: rightDefense.id,
    status,
    left_identity_signature: createLocalDefenseReviewSignature(leftDefense) || createLocalDefenseSimilaritySignature(leftDefense),
    right_identity_signature: createLocalDefenseReviewSignature(rightDefense) || createLocalDefenseSimilaritySignature(rightDefense),
    similarity_signature: createLocalDefenseSimilaritySignature(leftDefense),
  };
}

function mapDefenseLikePortal(row) {
  const detailedSlots = [...(row.guild_defense_slots || [])]
    .sort((a, b) => (a.slot_index ?? 0) - (b.slot_index ?? 0))
    .map((slot) => ({
      slotIndex: slot.slot_index ?? null,
      slot_index: slot.slot_index ?? null,
      championId: slot.champion_id || null,
      champion_id: slot.champion_id || null,
      champion: slot.champions?.name || slot.champions?.portal_name || slot.champions?.english_name || "",
      portalName: slot.champions?.portal_name || "",
      portal_name: slot.champions?.portal_name || "",
      englishName: slot.champions?.english_name || "",
      english_name: slot.champions?.english_name || "",
      position: slot.position || null,
      direction: slot.direction || null,
    }));

  return {
    id: row.id,
    name: row.name || "",
    tier: row.tier || "meta_s",
    type: row.type || "Tour",
    guildCode: row.guild_code || "",
    guild_code: row.guild_code || "",
    organizationId: row.organization_id || "",
    organization_id: row.organization_id || "",
    sourceDefenseId: row.source_defense_id || null,
    source_defense_id: row.source_defense_id || null,
    mergedIntoDefenseId: row.merged_into_defense_id || null,
    merged_into_defense_id: row.merged_into_defense_id || null,
    sourceEnemyDefenseId: row.source_enemy_defense_id || null,
    source_enemy_defense_id: row.source_enemy_defense_id || null,
    isHidden: Boolean(row.is_hidden),
    is_hidden: Boolean(row.is_hidden),
    slots: detailedSlots.map((slot) => slot.champion).filter(Boolean),
    detailedSlots,
    detailed_slots: detailedSlots,
    image: row.image_url || "",
    image_url: row.image_url || "",
    conditions: row.guild_defense_conditions || [],
    infoBlocks: row.guild_defense_blocks || [],
  };
}

function getSlot(defense, championName) {
  return defense.guild_defense_slots.find((slot) => slot.champions.name === championName);
}

function createSupabaseStub({ defenses = [], reviews = [], enemies = [] } = {}) {
  const state = {
    defenses: structuredClone(defenses),
    reviews: structuredClone(reviews),
    enemies: structuredClone(enemies),
  };

  const applyFilters = (rows, filters) =>
    rows.filter((row) =>
      filters.every((filter) => String(row?.[filter.column] ?? "") === String(filter.value ?? "")),
    );

  const upsertReviewRows = (rows) => {
    for (const row of rows || []) {
      const existing = state.reviews.find(
        (review) =>
          String(review.left_defense_id) === String(row.left_defense_id) &&
          String(review.right_defense_id) === String(row.right_defense_id),
      );
      if (existing) Object.assign(existing, row);
      else state.reviews.push({ id: `review-${state.reviews.length + 1}`, created_at: "2026-08-24T12:00:00.000Z", ...row });
    }
    return { data: null, error: null };
  };

  const updateRows = (table, payload, filters, inFilter) => {
    if (table === "guild_defense_slots") {
      const defenseId = filters.find((filter) => filter.column === "defense_id")?.value;
      const slotIndex = filters.find((filter) => filter.column === "slot_index")?.value;
      if (defenseId !== undefined && slotIndex !== undefined) {
        const defense = state.defenses.find((row) => String(row.id) === String(defenseId));
        const slot = defense?.guild_defense_slots.find((row) => Number(row.slot_index) === Number(slotIndex));
        if (slot) Object.assign(slot, payload);
      }
    }

    if (table === "guild_defenses" && inFilter?.column === "id") {
      const ids = new Set((inFilter.values || []).map(String));
      state.defenses
        .filter((row) => ids.has(String(row.id)))
        .forEach((row) => Object.assign(row, payload));
    }

    if (table === "guild_defense_library_similarity_reviews") {
      const reviewId = filters.find((filter) => filter.column === "id")?.value;
      state.reviews
        .filter((row) => String(row.id) === String(reviewId))
        .forEach((row) => Object.assign(row, payload));
    }
  };

  const readRows = (table, filters = []) => {
    if (table === "guild_defenses") return structuredClone(applyFilters(state.defenses, filters));
    if (table === "guild_defense_library_similarity_reviews") return structuredClone(applyFilters(state.reviews, filters));
    if (table === "gvg_enemy_defenses") return structuredClone(applyFilters(state.enemies, filters));
    return [];
  };

  const supabase = {
    from(table) {
      const query = {
        error: null,
        filters: [],
        inFilter: null,
        payload: null,
        operation: "select",
        select() {
          return this;
        },
        eq(column, value) {
          this.filters.push({ column, value });
          if (this.operation === "update") updateRows(table, this.payload, this.filters, this.inFilter);
          return this;
        },
        or() {
          return this;
        },
        limit() {
          return { data: readRows(table, this.filters), error: null };
        },
        order() {
          return { data: readRows(table, this.filters), error: null };
        },
        maybeSingle() {
          return { data: readRows(table, this.filters)[0] || null, error: null };
        },
        in(column, values) {
          this.inFilter = { column, values };
          if (table === "gvg_enemy_defenses") {
            const ids = new Set((values || []).map(String));
            return { data: structuredClone(state.enemies.filter((row) => ids.has(String(row.id)))), error: null };
          }
          if (this.operation === "update") updateRows(table, this.payload, this.filters, this.inFilter);
          return { data: null, error: null };
        },
        update(payload) {
          this.operation = "update";
          this.payload = payload;
          return this;
        },
        upsert(rows) {
          return upsertReviewRows(rows);
        },
      };
      return query;
    },
  };

  return { supabase, state };
}

const rootA = makeDefense({
  id: TEST_SIMI_ID,
  name: "Test simi",
  guildCode: "G2",
  sourceEnemyDefenseId: TEST_SIMI_ENEMY_ID,
  sourceEnemyDefenseFingerprint: TEST_SIMI_ENEMY_FINGERPRINT,
  includeLayout: true,
});
const rootB = makeDefense({
  id: "44444444-4444-4444-8444-444444444444",
  name: "Test simi copy",
  guildCode: "G4",
  layout: TEST_SIMI_REORDERED_LAYOUT,
  includeLayout: false,
});
const childG3FromA = makeDefense({
  id: "33333333-3333-4333-8333-333333333333",
  name: "Test simi imported",
  guildCode: "G3",
  sourceDefenseId: TEST_SIMI_ID,
  includeLayout: false,
});
const divergedChildG5 = makeDefense({
  id: "55555555-5555-4555-8555-555555555555",
  name: "Diverged child",
  guildCode: "G5",
  sourceDefenseId: TEST_SIMI_ID,
  layout: [
    ["comtedracula", "A2", "E"],
    ["brokkir", "A5", "E"],
    ["eirlys", "B3", "E"],
    ["oren", "A3", "E"],
    ["khadgrim", "B4", "E"],
  ],
  includeLayout: false,
});
const madRoot = makeDefense({
  id: "66666666-6666-4666-8666-666666666666",
  name: "MAD mirror",
  organizationId: MAD_ORG,
  guildCode: "MAD G1",
  includeLayout: false,
});

const mappedRootA = mapDefenseLikePortal(rootA);
const mappedRootB = mapDefenseLikePortal(rootB);
const stringOnlyRootA = {
  ...mappedRootA,
  detailedSlots: undefined,
  detailed_slots: undefined,
  slots: mappedRootA.slots,
};

assert.equal(
  createLocalDefenseSimilaritySignature(rootA),
  TEST_SIMI_SIMILARITY_SIGNATURE,
  "Test simi keeps the expected type plus unordered-five-heroes signature",
);
assert.equal(
  createLocalDefenseSimilaritySignature(rootB),
  TEST_SIMI_SIMILARITY_SIGNATURE,
  "Test simi 2 keeps the same signature with a different hero order",
);
assert.equal(
  createLocalDefenseSimilaritySignature(mappedRootA),
  createLocalDefenseSimilaritySignature(rootA),
  "mapped Portal rows keep the same similarity signature as raw Supabase rows",
);
assert.equal(
  createLocalDefenseReviewSignature(mappedRootA),
  createLocalDefenseReviewSignature(rootA),
  "mapped detailedSlots keep the same review signature as raw guild_defense_slots",
);
assert.equal(
  createLocalDefenseReviewSignature(mappedRootB),
  createLocalDefenseReviewSignature(rootB),
  "mapped detailedSlots keep null-layout review signatures current",
);
assert.equal(createLocalDefenseReviewSignature(stringOnlyRootA), null, "simple name slots do not invent a layout signature");
assert.equal(localDefenseHasCompleteLayout(stringOnlyRootA), false, "simple name slots never count as complete layout");

const pendingStub = createSupabaseStub({
  defenses: [rootA, rootB, childG3FromA, divergedChildG5, madRoot],
  reviews: [],
});

const pendingResult = await detectLibraryDefenseSimilarities(pendingStub.supabase, {
  organizationId: PALADIN_ORG,
  rootDefenseIds: [rootA.id],
});
assert.equal(pendingResult.pendingCreated, 1, "matching native roots with incomplete layout create one pending review");
assert.equal(pendingStub.state.reviews.length, 1, "one Paladin review is stored");
assert.equal(pendingStub.state.reviews[0].status, "pending", "review starts pending");
assert.equal(
  pendingStub.state.reviews.some((review) => String(review.left_defense_id) === madRoot.id || String(review.right_defense_id) === madRoot.id),
  false,
  "same heroes in another tenant never become library candidates",
);

let equivalenceState = buildLibraryEquivalenceState(pendingStub.state.defenses, pendingStub.state.reviews);
assert.equal(
  getEquivalentImportTargetStatus(rootB, "G3", pendingStub.state.defenses, equivalenceState).status,
  "available",
  "pending-only similarities do not block imports through equivalence",
);
const mappedPendingState = buildLibraryEquivalenceState(
  pendingStub.state.defenses.map(mapDefenseLikePortal),
  pendingStub.state.reviews,
);
assert.equal(
  mappedPendingState.byDefenseId.get(rootA.id)?.pendingCount,
  1,
  "existing pending reviews stay current after rows are mapped for the Portal UI",
);
assert.equal(
  mappedPendingState.byDefenseId.get(rootB.id)?.pendingCount,
  1,
  "mapped Test simi 2 also exposes the pending library badge",
);

const secondPendingResult = await detectLibraryDefenseSimilarities(pendingStub.supabase, {
  organizationId: PALADIN_ORG,
  rootDefenseIds: [rootA.id],
});
assert.equal(secondPendingResult.pendingCreated, 0, "global recalculation does not duplicate existing pending reviews");
assert.equal(secondPendingResult.pendingUpdated, 0, "global recalculation leaves reusable pending reviews unchanged");
assert.equal(pendingStub.state.reviews.length, 1, "idempotent recalculation keeps one review row");

const draftG7 = makeDefense({
  id: "draft-g7",
  name: "Draft G7",
  guildCode: "G7",
  includeLayout: false,
});
const preCreateWarning = findLibraryDefenseSimilarityCandidates(
  pendingStub.state.defenses,
  pendingStub.state.reviews,
  draftG7,
  "G7",
  { organizationId: PALADIN_ORG },
);
assert.equal(preCreateWarning.draftSignature, TEST_SIMI_SIMILARITY_SIGNATURE, "pre-create uses the shared similarity signature");
assert.equal(preCreateWarning.candidates.length, 2, "pre-create finds matching native roots in the organization");
assert.equal(
  preCreateWarning.candidates.every((candidate) => candidate.targetStatus === "available"),
  true,
  "pre-create offers import only when the target guild does not already own the family",
);

const preCreateAlreadyPresent = findLibraryDefenseSimilarityCandidates(
  pendingStub.state.defenses,
  pendingStub.state.reviews,
  { ...draftG7, guild_code: "G4" },
  "G4",
  { organizationId: PALADIN_ORG },
);
assert.equal(
  preCreateAlreadyPresent.candidates.some(
    (candidate) => candidate.targetStatus === "native" && String(candidate.viaDefenseId) === String(rootB.id),
  ),
  true,
  "pre-create marks the target guild as already present instead of proposing a duplicate import",
);
const preCreateMad = findLibraryDefenseSimilarityCandidates(
  pendingStub.state.defenses,
  pendingStub.state.reviews,
  makeDefense({ id: "draft-mad", organizationId: MAD_ORG, guildCode: "MAD G2", includeLayout: false }),
  "MAD G2",
  { organizationId: MAD_ORG },
);
assert.equal(preCreateMad.candidates.length, 1, "pre-create remains tenant-isolated for MAD");
assert.equal(preCreateMad.candidates[0]?.defense?.id, madRoot.id, "MAD pre-create does not see Paladin roots");

const createAnywayRoot = makeDefense({
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "Create anyway root",
  guildCode: "G7",
  includeLayout: false,
});
const createAnywayStub = createSupabaseStub({ defenses: [rootA, rootB, createAnywayRoot], reviews: [] });
const createAnywayResult = await detectLibraryDefenseSimilarities(createAnywayStub.supabase, {
  organizationId: PALADIN_ORG,
  rootDefenseIds: [createAnywayRoot.id],
});
assert.equal(createAnywayResult.pendingCreated, 2, "create-anyway stores pending human reviews against existing roots");
assert.equal(createAnywayStub.state.reviews.length, 2, "create-anyway does not collapse the new root into an import");

const reviewResult = await markLibrarySimilarityReview(pendingStub.supabase, {
  organizationId: PALADIN_ORG,
  reviewId: pendingStub.state.reviews[0].id,
  status: "identical",
  reviewer: { memberId: "member-admin", name: "Admin" },
});
assert.equal(reviewResult.ok, true, "manual identical validation succeeds");
assert.deepEqual(reviewResult.propagation.conflicts, [], "compatible family has no propagation conflict");
assert.deepEqual(
  [...reviewResult.propagation.skipped.map((item) => [item.id, item.reason])],
  [[divergedChildG5.id, "diverged"]],
  "diverged descendants are skipped without blocking compatible propagation",
);

const rootBAfter = pendingStub.state.defenses.find((defense) => defense.id === rootB.id);
const childG3After = pendingStub.state.defenses.find((defense) => defense.id === childG3FromA.id);
const divergedAfter = pendingStub.state.defenses.find((defense) => defense.id === divergedChildG5.id);
for (const defense of [rootBAfter, childG3After]) {
  assert.equal(localDefenseHasCompleteLayout(defense), true, `${defense.name} receives the complete validated layout`);
  assert.equal(getSlot(defense, "valara")?.position, "B4", `${defense.name} receives Valara B4`);
  assert.equal(getSlot(defense, "valara")?.direction, "E", `${defense.name} receives Valara E`);
  assert.equal(defense.source_enemy_defense_id, TEST_SIMI_ENEMY_ID, `${defense.name} receives the enemy link`);
}
assert.equal(localDefenseHasCompleteLayout(divergedAfter), false, "diverged child is not force-enriched");
assert.equal(divergedAfter.source_enemy_defense_id, null, "diverged child does not receive the enemy link");

equivalenceState = buildLibraryEquivalenceState(pendingStub.state.defenses, pendingStub.state.reviews);
const rootBFamily = equivalenceState.byDefenseId.get(rootB.id);
assert.deepEqual(
  rootBFamily.presentGuilds.map((entry) => entry.guildCode).sort(),
  ["G2", "G3", "G4"],
  "family presence includes native roots and compatible descendants only",
);
assert.equal(
  getEquivalentImportTargetStatus(rootBAfter, "G3", pendingStub.state.defenses, equivalenceState).status,
  "equivalent-imported",
  "import from equivalent root is blocked when target guild already owns a compatible child",
);
assert.equal(
  getEquivalentImportTargetStatus(rootBAfter, "G5", pendingStub.state.defenses, equivalenceState).status,
  "available",
  "diverged child does not block a fresh import for that guild",
);
assert.equal(
  getEquivalentImportTargetStatus(rootBAfter, "MAD G1", pendingStub.state.defenses, equivalenceState).status,
  "available",
  "another tenant remains isolated even with the same five heroes",
);

const autoRootA = makeDefense({
  id: "77777777-7777-4777-8777-777777777777",
  name: "Auto A",
  guildCode: "G1",
  includeLayout: true,
});
const autoRootB = makeDefense({
  id: "88888888-8888-4888-8888-888888888888",
  name: "Auto B",
  guildCode: "G6",
  includeLayout: true,
});
const autoStub = createSupabaseStub({ defenses: [autoRootA, autoRootB], reviews: [] });
const autoResult = await detectLibraryDefenseSimilarities(autoStub.supabase, {
  organizationId: PALADIN_ORG,
  rootDefenseIds: [autoRootA.id],
});
assert.equal(autoResult.autoIdenticalCreated, 1, "two complete matching layouts auto-create an identical equivalence");
assert.equal(autoStub.state.reviews[0]?.status, "identical", "auto review is marked identical");
assert.equal(
  createLocalDefenseReviewSignature(autoRootA),
  createLocalDefenseReviewSignature(autoRootB),
  "auto-identical depends on the exact complete layout signature",
);
assert.notEqual(
  createLocalDefenseSimilaritySignature(rootA),
  createLocalDefenseSimilaritySignature(divergedChildG5),
  "a changed hero invalidates structural family compatibility",
);

const conflictRootA = makeDefense({
  id: "99999999-9999-4999-8999-999999999999",
  name: "Conflict A",
  guildCode: "G1",
  sourceEnemyDefenseId: "enemy-a",
  sourceEnemyDefenseFingerprint: "fingerprint-a",
  includeLayout: true,
});
const conflictRootB = makeDefense({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Conflict B",
  guildCode: "G2",
  sourceEnemyDefenseId: "enemy-b",
  sourceEnemyDefenseFingerprint: "fingerprint-b",
  includeLayout: true,
});
const conflictStub = createSupabaseStub({
  defenses: [conflictRootA, conflictRootB],
  reviews: [],
  enemies: [
    { id: "enemy-a", defense_fingerprint: "fingerprint-a" },
    { id: "enemy-b", defense_fingerprint: "fingerprint-b" },
  ],
});
const conflictDetect = await detectLibraryDefenseSimilarities(conflictStub.supabase, {
  organizationId: PALADIN_ORG,
  rootDefenseIds: [conflictRootA.id],
});
assert.equal(conflictDetect.autoIdenticalCreated, 0, "enemy fingerprint conflict blocks automatic identical");
assert.equal(conflictDetect.pendingCreated, 1, "enemy fingerprint conflict remains a human pending review");
await assert.rejects(
  () => markLibrarySimilarityReview(conflictStub.supabase, {
    organizationId: PALADIN_ORG,
    reviewId: conflictStub.state.reviews[0].id,
    status: "identical",
    reviewer: { memberId: "member-admin", name: "Admin" },
  }),
  /Liens adverses differents/,
  "manual identical validation is blocked when enemy fingerprints conflict",
);

const emptyMergeA = makeDefense({
  id: "merge-empty-a",
  name: "Alpha",
  guildCode: "G1",
  includeLayout: false,
  tier: "meta_s",
  createdAt: "2026-08-24T09:00:00.000Z",
});
const emptyMergeB = makeDefense({
  id: "merge-empty-b",
  name: "Beta",
  guildCode: "G2",
  includeLayout: false,
  tier: "meta_s",
  createdAt: "2026-08-24T10:00:00.000Z",
});
const emptyRowsBeforePreview = structuredClone([emptyMergeA, emptyMergeB]);
const emptyPlan = buildGuildDefenseLibraryMergePlan(emptyRowsBeforePreview, [makeLibraryReview(emptyMergeA, emptyMergeB)], {
  organizationId: PALADIN_ORG,
  reviewId: "review-merge",
});
assert.equal(emptyPlan.canMerge, true, "two identical empty native roots can be merged after human identical review");
assert.equal(emptyPlan.canonical.id, emptyMergeA.id, "oldest root wins deterministic tie-breaker when scores are equal");
assert.deepEqual(emptyRowsBeforePreview, [emptyMergeA, emptyMergeB], "merge preview does not mutate defense rows");

const richMergeA = makeDefense({
  id: "merge-rich-a",
  name: "Test",
  guildCode: "G1",
  includeLayout: false,
  tier: "meta_s",
  createdAt: "2026-08-24T09:00:00.000Z",
});
const richMergeB = makeDefense({
  id: "merge-rich-b",
  name: "Arbitre complet",
  guildCode: "G3",
  includeLayout: true,
  imageUrl: "https://example.test/image.png",
  sourceEnemyDefenseId: "enemy-shared",
  sourceEnemyDefenseFingerprint: "enemy-shared-fp",
  conditions: [{ champion_id: "champ-brokkir", min_awakening: 1 }],
  infoBlocks: [{ block_type: "note", content: "Rotation precise" }],
  faction: "Infernal",
  createdAt: "2026-08-24T10:00:00.000Z",
});
const richPlan = buildGuildDefenseLibraryMergePlan([richMergeA, richMergeB], [makeLibraryReview(richMergeA, richMergeB, { id: "review-rich" })], {
  organizationId: PALADIN_ORG,
  reviewId: "review-rich",
});
assert.equal(richPlan.canMerge, true, "empty root plus complete root can be merged");
assert.equal(richPlan.canonical.id, richMergeB.id, "complete root is selected as canonical even if newer");
assert.ok(richPlan.canonicalScore.score > richPlan.absorbedScore.score, "canonical score explains why the complete root wins");

const imageRoot = makeDefense({
  id: "merge-image-root",
  name: "Image root",
  guildCode: "G1",
  includeLayout: false,
  imageUrl: "https://example.test/image-a.png",
});
const blockRoot = makeDefense({
  id: "merge-block-root",
  name: "Block root",
  guildCode: "G2",
  includeLayout: false,
  infoBlocks: [{ block_type: "note", content: "Do not lose this block" }],
});
const imageBlockPlan = buildGuildDefenseLibraryMergePlan([imageRoot, blockRoot], [makeLibraryReview(imageRoot, blockRoot, { id: "review-image-block" })], {
  organizationId: PALADIN_ORG,
  reviewId: "review-image-block",
});
assert.equal(imageBlockPlan.canMerge, true, "image root plus block root can be merged without loss");
assert.equal(imageBlockPlan.canonical.id, imageRoot.id, "image is a stronger canonical signal than a single info block");
assert.ok(imageBlockPlan.transfers.some((transfer) => transfer.type === "blocks"), "absorbed info blocks are listed for conservative union");

const layoutRoot = makeDefense({
  id: "merge-layout-root",
  name: "Layout root",
  guildCode: "G1",
  includeLayout: true,
});
const noLayoutRoot = makeDefense({
  id: "merge-no-layout-root",
  name: "No layout root",
  guildCode: "G2",
  includeLayout: false,
});
const layoutPlan = buildGuildDefenseLibraryMergePlan([layoutRoot, noLayoutRoot], [makeLibraryReview(layoutRoot, noLayoutRoot, { id: "review-layout" })], {
  organizationId: PALADIN_ORG,
  reviewId: "review-layout",
});
assert.equal(layoutPlan.canMerge, true, "complete layout root can absorb a no-layout duplicate");
assert.equal(layoutPlan.canonical.id, layoutRoot.id, "complete layout stays on the canonical root");

const sameEnemyLeft = makeDefense({
  id: "merge-same-enemy-left",
  name: "Same enemy left",
  guildCode: "G1",
  sourceEnemyDefenseId: "enemy-same",
  sourceEnemyDefenseFingerprint: "enemy-same-fp",
});
const sameEnemyRight = makeDefense({
  id: "merge-same-enemy-right",
  name: "Same enemy right",
  guildCode: "G2",
  sourceEnemyDefenseId: "enemy-same",
  sourceEnemyDefenseFingerprint: "enemy-same-fp",
});
const sameEnemyPlan = buildGuildDefenseLibraryMergePlan([sameEnemyLeft, sameEnemyRight], [makeLibraryReview(sameEnemyLeft, sameEnemyRight, { id: "review-same-enemy" })], {
  organizationId: PALADIN_ORG,
  reviewId: "review-same-enemy",
});
assert.equal(sameEnemyPlan.canMerge, true, "same enemy link stays compatible");

const enemyConflictPlan = buildGuildDefenseLibraryMergePlan([conflictRootA, conflictRootB], [makeLibraryReview(conflictRootA, conflictRootB, { id: "review-enemy-conflict" })], {
  organizationId: PALADIN_ORG,
  reviewId: "review-enemy-conflict",
});
assert.equal(enemyConflictPlan.canMerge, false, "different enemy links block library root merge");
assert.ok(enemyConflictPlan.conflicts.some((conflict) => conflict.type === "enemy_link_conflict"), "enemy conflict is explicit in the plan");

const layoutConflictB = makeDefense({
  id: "merge-layout-conflict-b",
  name: "Layout conflict B",
  guildCode: "G2",
  layout: [
    ["comtedracula", "A2", "N"],
    ["brokkir", "A5", "E"],
    ["eirlys", "B3", "E"],
    ["oren", "A3", "E"],
    ["valara", "B4", "E"],
  ],
  includeLayout: true,
});
const layoutConflictPlan = buildGuildDefenseLibraryMergePlan([layoutRoot, layoutConflictB], [makeLibraryReview(layoutRoot, layoutConflictB, { id: "review-layout-conflict" })], {
  organizationId: PALADIN_ORG,
  reviewId: "review-layout-conflict",
});
assert.equal(layoutConflictPlan.canMerge, false, "different complete layouts block library root merge");
assert.ok(layoutConflictPlan.conflicts.some((conflict) => conflict.type === "layout_conflict"), "layout conflict is explicit in the plan");

const fleetRootA = makeDefense({ id: "merge-fleet-a", name: "Fleet A", guildCode: "G1", includeLayout: false, createdAt: "2026-08-24T09:00:00.000Z" });
const fleetRootB = makeDefense({ id: "merge-fleet-b", name: "Fleet B", guildCode: "G3", includeLayout: false, createdAt: "2026-08-24T10:00:00.000Z" });
const fleetAChildG2 = makeDefense({ id: "merge-fleet-a-g2", name: "Fleet A G2", guildCode: "G2", sourceDefenseId: fleetRootA.id, includeLayout: false });
const fleetBChildG4 = makeDefense({ id: "merge-fleet-b-g4", name: "Fleet B G4", guildCode: "G4", sourceDefenseId: fleetRootB.id, includeLayout: false });
const fleetPlan = buildGuildDefenseLibraryMergePlan(
  [fleetRootA, fleetRootB, fleetAChildG2, fleetBChildG4],
  [makeLibraryReview(fleetRootA, fleetRootB, { id: "review-fleet" })],
  { organizationId: PALADIN_ORG, reviewId: "review-fleet" },
);
assert.equal(fleetPlan.canMerge, true, "roots with distinct local copies can be merged");
assert.deepEqual(
  fleetPlan.guilds.map((entry) => entry.guildCode).sort(),
  ["G1", "G2", "G3", "G4"],
  "merge plan reports every guild that will remain present through canonical family",
);
assert.deepEqual(fleetPlan.descendants.repointedDefenseIds, [fleetBChildG4.id], "absorbed descendants without collision are repointed");

const collisionRootA = makeDefense({ id: "merge-collision-a", name: "Collision A", guildCode: "G1", includeLayout: false });
const collisionRootB = makeDefense({ id: "merge-collision-b", name: "Collision B", guildCode: "G2", includeLayout: false, createdAt: "2026-08-24T10:00:00.000Z" });
const collisionAChild = makeDefense({ id: "merge-collision-a-g3", name: "Collision A G3", guildCode: "G3", sourceDefenseId: collisionRootA.id, includeLayout: false });
const collisionBChild = makeDefense({
  id: "merge-collision-b-g3",
  name: "Collision B G3",
  guildCode: "G3",
  sourceDefenseId: collisionRootB.id,
  includeLayout: false,
  imageUrl: "https://example.test/local-b.png",
});
const collisionPlan = buildGuildDefenseLibraryMergePlan(
  [collisionRootA, collisionRootB, collisionAChild, collisionBChild],
  [makeLibraryReview(collisionRootA, collisionRootB, { id: "review-collision" })],
  { organizationId: PALADIN_ORG, reviewId: "review-collision" },
);
assert.equal(collisionPlan.canMerge, true, "compatible local collision can be resolved conservatively");
assert.equal(collisionPlan.localCollisions.length, 1, "one same-guild local collision is reported");
assert.equal(collisionPlan.localCollisions[0].keepDefenseId, collisionBChild.id, "local collision keeps the richer local copy");

const postMergeState = buildLibraryEquivalenceState(
  [
    fleetRootA,
    { ...fleetRootB, is_hidden: true, merged_into_defense_id: fleetRootA.id },
    fleetAChildG2,
    { ...fleetBChildG4, source_defense_id: fleetRootA.id },
  ],
  [makeLibraryReview(fleetRootA, fleetRootB, { id: "review-post-merge" })],
);
assert.equal(postMergeState.byDefenseId.has(fleetRootB.id), false, "absorbed root is excluded from active library state");
assert.equal(
  getEquivalentImportTargetStatus(fleetRootA, "G4", [fleetRootA, fleetAChildG2, { ...fleetBChildG4, source_defense_id: fleetRootA.id }], postMergeState).status,
  "imported",
  "import after merge resolves former absorbed descendants through the canonical root",
);

const mergedDetectStub = createSupabaseStub({
  defenses: [fleetRootA, { ...fleetRootB, merged_into_defense_id: fleetRootA.id }],
  reviews: [],
});
const mergedDetectResult = await detectLibraryDefenseSimilarities(mergedDetectStub.supabase, {
  organizationId: PALADIN_ORG,
  rootDefenseIds: [fleetRootA.id],
});
assert.equal(mergedDetectResult.pendingCreated, 0, "recalculation ignores merged roots and does not recreate ghost pairs");
assert.equal(mergedDetectStub.state.reviews.length, 0, "merged roots do not become review candidates again");

const differentPlan = buildGuildDefenseLibraryMergePlan([emptyMergeA, emptyMergeB], [makeLibraryReview(emptyMergeA, emptyMergeB, { status: "different", id: "review-different" })], {
  organizationId: PALADIN_ORG,
  reviewId: "review-different",
});
assert.equal(differentPlan.canMerge, false, "review DIFFERENT blocks merge");
assert.ok(differentPlan.conflicts.some((conflict) => conflict.type === "review_not_identical"), "different review conflict is explicit");

const crossTenantPlan = buildGuildDefenseLibraryMergePlan([rootA, madRoot], [makeLibraryReview(rootA, madRoot, { id: "review-cross", organizationId: PALADIN_ORG })], {
  organizationId: PALADIN_ORG,
  reviewId: "review-cross",
});
assert.equal(crossTenantPlan.canMerge, false, "cross-tenant library merge is refused");
assert.ok(crossTenantPlan.conflicts.some((conflict) => conflict.type === "cross_tenant"), "tenant conflict is explicit");

const nonNativePlan = buildGuildDefenseLibraryMergePlan([rootA, childG3FromA], [makeLibraryReview(rootA, childG3FromA, { id: "review-non-native" })], {
  organizationId: PALADIN_ORG,
  reviewId: "review-non-native",
});
assert.equal(nonNativePlan.canMerge, false, "Bibliotheque root to non-root candidate cannot use the root merge path");
assert.ok(nonNativePlan.conflicts.some((conflict) => conflict.type === "non_native_root"), "non-root conflict is explicit");

const rootScore = scoreGuildDefenseLibraryRoot(richMergeB, [richMergeB]);
assert.ok(rootScore.metrics.layoutComplete, "canonical score records complete layout");
assert.ok(rootScore.metrics.enemyLink, "canonical score records enemy link");
assert.ok(rootScore.reasons.includes("layout complet"), "canonical score returns human-readable reasons");

const [
  helperSource,
  adminApiSource,
  enemyBankSource,
  preflightSql,
  migrationSql,
  verifySql,
  mergePreflightSql,
  mergeMigrationSql,
  mergeVerifySql,
] = await Promise.all([
  readFile(new URL("../api/_guild-defense-library-equivalence.js", import.meta.url), "utf8"),
  readFile(new URL("../api/portal-admin-defenses.js", import.meta.url), "utf8"),
  readFile(new URL("../api/gvg-enemy-defense-bank.js", import.meta.url), "utf8"),
  readFile(new URL("../scripts/guild_defense_library_equivalence_preflight.sql", import.meta.url), "utf8"),
  readFile(new URL("../scripts/guild_defense_library_equivalence.sql", import.meta.url), "utf8"),
  readFile(new URL("../scripts/guild_defense_library_equivalence_verify.sql", import.meta.url), "utf8"),
  readFile(new URL("../scripts/guild_defense_library_merge_preflight.sql", import.meta.url), "utf8"),
  readFile(new URL("../scripts/guild_defense_library_merge.sql", import.meta.url), "utf8"),
  readFile(new URL("../scripts/guild_defense_library_merge_verify.sql", import.meta.url), "utf8"),
]);

assert.match(helperSource, /guild_defense_library_similarity_reviews/, "helper uses a dedicated library equivalence review table");
assert.match(helperSource, /left_defense_id/, "helper stores undirected pair endpoints");
assert.match(helperSource, /right_defense_id/, "helper stores undirected pair endpoints");
assert.match(helperSource, /source_enemy_defense_id/, "helper can share validated enemy knowledge across an equivalent family");
assert.doesNotMatch(helperSource, /bottom_y\s*=\s*1555/, "library equivalence does not contain old Tour grid constants");
assert.match(adminApiSource, /action === "library-similarities"/, "admin API exposes library similarity review action");
assert.match(adminApiSource, /action === "library-recalculate"/, "admin API exposes targeted library recalculation");
assert.match(adminApiSource, /getEquivalentImportTargetStatus/, "admin API blocks duplicate imports through equivalence");
assert.match(adminApiSource, /loadPreCreateLibrarySimilarityWarning/, "admin API performs a pre-create library similarity check");
assert.match(adminApiSource, /allowSimilarLibraryDuplicate/, "admin API keeps create-anyway explicit");
assert.match(adminApiSource, /action === "library-merge-preview"/, "admin API exposes merge preview without mutation");
assert.match(adminApiSource, /action === "library-merge"/, "admin API exposes explicit merge action");
assert.match(adminApiSource, /merge_guild_defense_library_roots/, "admin API delegates merge mutation to a transactional RPC");
assert.match(enemyBankSource, /propagateLibraryEquivalenceKnowledge/, "enemy validation shares knowledge back to equivalent library roots");
assert.doesNotMatch(enemyBankSource, /merge_guild_defense_library_roots/, "Bibliotheque to Enemy validation never calls library root merge RPC");
assert.match(preflightSql, /guild_defense_library_similarity_reviews/, "preflight mentions the new equivalence table");
assert.match(migrationSql, /create table if not exists public\.guild_defense_library_similarity_reviews/, "migration creates the dedicated table");
assert.match(migrationSql, /organization_id uuid not null/, "migration keeps organization tenant isolation mandatory");
assert.match(migrationSql, /unique \(left_defense_id, right_defense_id\)/, "migration prevents duplicate review pairs");
assert.match(verifySql, /cross_tenant_review_pairs/, "verify audits cross-tenant review pairs");
assert.match(verifySql, /non_native_review_pairs/, "verify ensures reviews only connect native roots");
assert.match(helperSource, /buildGuildDefenseLibraryMergePlan/, "helper centralizes the merge preview plan");
assert.match(helperSource, /scoreGuildDefenseLibraryRoot/, "helper centralizes deterministic canonical scoring");
assert.match(helperSource, /merged_into_defense_id/, "helper excludes merged roots from active library state");
assert.match(mergePreflightSql, /read-only/i, "merge preflight is explicitly read-only");
assert.match(mergePreflightSql, /guild_defense_library_merges/, "merge preflight checks the audit table state");
assert.match(mergeMigrationSql, /create table if not exists public\.guild_defense_library_merges/, "merge migration creates the audit table");
assert.match(mergeMigrationSql, /add column if not exists merged_into_defense_id/, "merge migration adds the soft merge pointer");
assert.match(mergeMigrationSql, /merge_guild_defense_library_roots/, "merge migration defines the transactional RPC");
assert.match(mergeMigrationSql, /for update/, "merge RPC locks roots and review rows");
assert.match(mergeMigrationSql, /guild_members/, "merge RPC repoints member assignments");
assert.match(mergeMigrationSql, /cluster_defense_likes/, "merge RPC preserves likes when the table exists");
assert.match(mergeMigrationSql, /gvg_enemy_defense_similarity_reviews/, "merge RPC repoints enemy similarity reviews when the table exists");
assert.doesNotMatch(mergeMigrationSql, /\bdelete\s+from\s+public\.guild_defenses\b/i, "merge migration never physically deletes historical roots");
assert.match(mergeMigrationSql, /raise exception/, "merge RPC aborts the transaction on blocking conflicts");
assert.match(mergeVerifySql, /guild_defense_library_merge_columns/, "merge verify checks soft merge columns");
assert.match(mergeVerifySql, /absorbed_roots_still_visible/, "merge verify detects visible absorbed roots");
assert.match(mergeVerifySql, /cross_tenant_merge_rows/, "merge verify audits tenant isolation");
assert.match(mergeVerifySql, /duplicate_active_imports_after_merge/, "merge verify audits duplicate active imports after merge");

console.log("Guild defense library equivalence tests passed");
