import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildLibraryEquivalenceState,
  buildLibraryEquivalenceMergeCandidates,
  buildGuildDefenseLibraryMergePlan,
  detectLibraryDefenseSimilarities,
  findLibraryDefenseSimilarityCandidates,
  getEquivalentImportTargetStatus,
  isLibraryEquivalenceSchemaMissing,
  isMissingSchemaObjectError,
  markLibrarySimilarityReview,
  recordLibrarySimilarityDecision,
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
  type = "Tour",
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
    type,
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

assert.equal(
  isMissingSchemaObjectError(
    { code: "42703", message: 'column "source_defense_id" does not exist' },
    { columns: ["source_defense_id"] },
  ),
  true,
  "42703 with a real missing column is classified as schema missing",
);
assert.equal(
  isMissingSchemaObjectError(
    { code: "42P01", message: 'relation "guild_defense_library_merges" does not exist' },
    { tables: ["guild_defense_library_merges"] },
  ),
  true,
  "42P01 with a real missing table is classified as schema missing",
);
assert.equal(
  isMissingSchemaObjectError(
    { code: "42883", message: "function public.merge_guild_defense_library_roots(uuid, uuid) does not exist" },
    { functions: ["merge_guild_defense_library_roots"] },
  ),
  true,
  "42883 with a real missing RPC is classified as schema missing",
);
assert.equal(
  isMissingSchemaObjectError(
    {
      code: "23505",
      message: 'duplicate key value violates unique constraint "guild_defenses_unique_active_import_idx"',
      details: "Key (organization_id, guild_code, source_defense_id)=(org, G6, root) already exists.",
    },
    { columns: ["source_defense_id"] },
  ),
  false,
  "business constraint errors mentioning source_defense_id are not schema missing",
);
assert.equal(
  isLibraryEquivalenceSchemaMissing({
    code: "P0001",
    message: "Collision locale impossible a resoudre: merged_into_defense_id deja renseigne.",
  }),
  false,
  "business errors mentioning merged_into_defense_id keep their original meaning",
);
assert.equal(
  isLibraryEquivalenceSchemaMissing({
    code: "P0001",
    message: "Collision locale impossible a resoudre dans G6: source_defense_id present.",
  }),
  false,
  "local collision business errors are not transformed into migration errors",
);

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
    const persistedRows = [];
    for (const row of rows || []) {
      const existing = state.reviews.find(
        (review) =>
          String(review.left_defense_id) === String(row.left_defense_id) &&
          String(review.right_defense_id) === String(row.right_defense_id),
      );
      if (existing) {
        Object.assign(existing, row);
        persistedRows.push(structuredClone(existing));
      } else {
        const persisted = { id: `review-${state.reviews.length + 1}`, created_at: "2026-08-24T12:00:00.000Z", ...row };
        state.reviews.push(persisted);
        persistedRows.push(structuredClone(persisted));
      }
    }
    return persistedRows;
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
          const data = upsertReviewRows(rows);
          return {
            data: null,
            error: null,
            select() {
              return this;
            },
            single() {
              return { data: data[0] || null, error: null };
            },
            maybeSingle() {
              return { data: data[0] || null, error: null };
            },
          };
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
const bastionSignatureA = createLocalDefenseSimilaritySignature(makeDefense({
  id: "signature-bastion-a",
  type: "Bastion",
  guildCode: "G1",
  includeLayout: false,
}));
const bastionSignatureB = createLocalDefenseSimilaritySignature(makeDefense({
  id: "signature-fortress-b",
  type: "Forteresse",
  guildCode: "G2",
  layout: TEST_SIMI_REORDERED_LAYOUT,
  includeLayout: false,
}));
assert.equal(bastionSignatureA, bastionSignatureB, "Bastion, Forteresse and fortress normalize to the same library similarity type");
assert.notEqual(
  bastionSignatureA,
  createLocalDefenseSimilaritySignature(makeDefense({
    id: "signature-different-hero",
    type: "Bastion",
    guildCode: "G3",
    layout: [
      ["comtedracula", null, null],
      ["brokkir", null, null],
      ["eirlys", null, null],
      ["oren", null, null],
      ["volka", null, null],
    ],
    includeLayout: false,
  })),
  "changing one hero still invalidates a library similarity signature",
);
assert.notEqual(
  createLocalDefenseReviewSignature(rootA),
  createLocalDefenseReviewSignature(makeDefense({
    id: "signature-obsolete-direction",
    guildCode: "G1",
    layout: [
      ["comtedracula", "A2", "N"],
      ["brokkir", "A5", "E"],
      ["eirlys", "B3", "E"],
      ["oren", "A3", "E"],
      ["valara", "B4", "E"],
    ],
    includeLayout: true,
  })),
  "changing a validated direction still makes the review identity obsolete",
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
const createAnywayDecision = await recordLibrarySimilarityDecision(createAnywayStub.supabase, {
  organizationId: PALADIN_ORG,
  leftDefenseId: createAnywayRoot.id,
  rightDefenseId: rootA.id,
  status: "different",
  reviewer: { memberId: "member-admin", name: "Admin" },
});
assert.equal(createAnywayDecision.ok, true, "create-anyway persists an explicit different review");
assert.equal(createAnywayStub.state.reviews.length, 1, "one explicit create-anyway decision is stored");
assert.equal(createAnywayStub.state.reviews[0].status, "different", "create-anyway decision is stored as different");
assert.equal(createAnywayStub.state.reviews[0].reviewed_by_name, "Admin", "different decisions keep the reviewer name");

const createAnywayAfterOneDecision = await detectLibraryDefenseSimilarities(createAnywayStub.supabase, {
  organizationId: PALADIN_ORG,
  rootDefenseIds: [createAnywayRoot.id],
});
assert.equal(createAnywayAfterOneDecision.pendingCreated, 1, "create-anyway does not recreate pending for the refused root");
assert.equal(createAnywayStub.state.reviews.length, 2, "unreviewed candidates still get their own pending review");
assert.equal(
  createAnywayStub.state.reviews.some((review) => review.status === "pending" && String(review.left_defense_id) !== String(rootA.id) && String(review.right_defense_id) !== String(rootA.id)),
  true,
  "rejecting one candidate does not mark every matching root as different",
);

const createAnywaySecondDecision = await recordLibrarySimilarityDecision(createAnywayStub.supabase, {
  organizationId: PALADIN_ORG,
  leftDefenseId: createAnywayRoot.id,
  rightDefenseId: rootB.id,
  status: "different",
  reviewer: { memberId: "member-admin", name: "Admin" },
});
assert.equal(createAnywaySecondDecision.ok, true, "create-anyway can persist a second explicit different review");
const createAnywayAfterAllDecisions = await detectLibraryDefenseSimilarities(createAnywayStub.supabase, {
  organizationId: PALADIN_ORG,
  rootDefenseIds: [createAnywayRoot.id],
});
assert.equal(createAnywayAfterAllDecisions.pendingCreated, 0, "all refused candidates stay out of pending recalculation");
assert.equal(
  findLibraryDefenseSimilarityCandidates(createAnywayStub.state.defenses, createAnywayStub.state.reviews, createAnywayRoot, "G7", { organizationId: PALADIN_ORG }).candidates.length,
  0,
  "pre-create warning skips reusable different reviews",
);

const newIdenticalStub = createSupabaseStub({ defenses: [rootA, rootB], reviews: [] });
const newIdenticalDecision = await recordLibrarySimilarityDecision(newIdenticalStub.supabase, {
  organizationId: PALADIN_ORG,
  leftDefenseId: rootA.id,
  rightDefenseId: rootB.id,
  status: "identical",
  reviewer: { memberId: "member-admin", name: "Admin" },
});
assert.equal(newIdenticalDecision.ok, true, "edit-identical decision can create a new review");
assert.equal(newIdenticalDecision.status, "identical", "edit-identical decision keeps the identical status");
assert.ok(newIdenticalDecision.reviewId, "new edit-identical decision returns the generated review id");
assert.equal(newIdenticalDecision.review_id, newIdenticalDecision.reviewId, "new edit-identical decision returns snake_case review id too");
assert.equal(newIdenticalStub.state.reviews.length, 1, "new edit-identical decision creates one persisted review");
assert.equal(newIdenticalDecision.reviewId, newIdenticalStub.state.reviews[0].id, "new edit-identical decision returns the persisted review id");
const newIdenticalMergePlan = buildGuildDefenseLibraryMergePlan(newIdenticalStub.state.defenses, newIdenticalStub.state.reviews, {
  organizationId: PALADIN_ORG,
  reviewId: newIdenticalDecision.reviewId,
});
assert.equal(newIdenticalMergePlan.reviewId, newIdenticalDecision.reviewId, "returned review id can immediately reopen the merge preview");
assert.equal(newIdenticalMergePlan.canMerge, true, "new edit-identical review is usable by the merge plan");

const existingPendingReview = makeLibraryReview(rootA, rootB, {
  id: "review-existing-pending",
  status: "pending",
});
const existingPendingStub = createSupabaseStub({ defenses: [rootA, rootB], reviews: [existingPendingReview] });
const existingPendingDecision = await recordLibrarySimilarityDecision(existingPendingStub.supabase, {
  organizationId: PALADIN_ORG,
  leftDefenseId: rootA.id,
  rightDefenseId: rootB.id,
  status: "identical",
  reviewer: { memberId: "member-admin", name: "Admin" },
});
assert.equal(existingPendingDecision.ok, true, "edit-identical decision can update an existing pending review");
assert.equal(existingPendingDecision.reviewId, existingPendingReview.id, "existing pending review keeps and returns its original id");
assert.equal(existingPendingStub.state.reviews.length, 1, "existing pending review is updated instead of duplicated");
assert.equal(existingPendingStub.state.reviews[0].status, "identical", "existing pending review becomes identical");

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
const equivalenceMergeResume = buildLibraryEquivalenceMergeCandidates(
  pendingStub.state.defenses,
  pendingStub.state.reviews,
  rootA.id,
  { organizationId: PALADIN_ORG },
);
assert.equal(equivalenceMergeResume.mergeCandidates.length, 1, "validated equivalence details expose one resumable merge candidate");
assert.equal(
  equivalenceMergeResume.mergeCandidates[0].review.id,
  pendingStub.state.reviews[0].id,
  "resumable merge candidate keeps the original IDENTICAL review id",
);
assert.equal(
  equivalenceMergeResume.mergeCandidates[0].equivalentDefenseId,
  rootB.id,
  "resumable merge candidate is attached to the equivalent root shown in the modal",
);
const rootLocalPreservationPlan = buildGuildDefenseLibraryMergePlan(
  pendingStub.state.defenses,
  pendingStub.state.reviews,
  { organizationId: PALADIN_ORG, reviewId: pendingStub.state.reviews[0].id },
);
assert.equal(rootLocalPreservationPlan.rootLocalPresence.action, "convert_absorbed_root", "cross-guild absorbed root is preserved as a local copy when no canonical copy exists");
assert.equal(rootLocalPreservationPlan.rootLocalPresence.guildCode, rootB.guild_code, "absorbed root guild keeps a local presence");
assert.equal(rootLocalPreservationPlan.rootLocalPresence.keepDefenseId, rootB.id, "absorbed root keeps its own id as the local copy");
assert.deepEqual(
  rootLocalPreservationPlan.guildsAfter.map((entry) => entry.guildCode).sort(),
  ["G2", "G3", "G4"],
  "preview keeps the same guild presence after root-local conversion",
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

const sameGuildRootA = makeDefense({ id: "merge-same-guild-a", name: "Same Guild A", guildCode: "G1", includeLayout: false });
const sameGuildRootB = makeDefense({ id: "merge-same-guild-b", name: "Same Guild B", guildCode: "G1", includeLayout: false, createdAt: "2026-08-24T13:00:00.000Z" });
const sameGuildPlan = buildGuildDefenseLibraryMergePlan(
  [sameGuildRootA, sameGuildRootB],
  [makeLibraryReview(sameGuildRootA, sameGuildRootB, { id: "review-same-guild" })],
  { organizationId: PALADIN_ORG, reviewId: "review-same-guild" },
);
assert.equal(sameGuildPlan.canMerge, true, "same-guild roots can still merge into one local defense");
assert.equal(sameGuildPlan.rootLocalPresence.action, "covered_by_canonical_root", "same-guild absorbed root is covered by the canonical root");
assert.deepEqual(
  sameGuildPlan.guildsAfter.map((entry) => entry.guildCode).sort(),
  ["G1"],
  "same-guild merge keeps one local guild presence",
);

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

const canonicalRootWithG5Copy = makeDefense({ id: "merge-g5-canonical", name: "Canonical G1", guildCode: "G1", includeLayout: false, createdAt: "2026-08-24T09:00:00.000Z" });
const absorbedRootG5 = makeDefense({ id: "merge-g5-absorbed", name: "Absorbed G5", guildCode: "G5", includeLayout: false, createdAt: "2026-08-24T10:00:00.000Z" });
const existingCanonicalCopyG5 = makeDefense({
  id: "merge-g5-canonical-copy",
  name: "Canonical copy G5",
  guildCode: "G5",
  sourceDefenseId: canonicalRootWithG5Copy.id,
  includeLayout: false,
  infoBlocks: [
    { block_type: "text", content: "bloc 1" },
    { block_type: "text", content: "bloc 2" },
    { block_type: "text", content: "bloc 3" },
  ],
});
const g5CollisionPlan = buildGuildDefenseLibraryMergePlan(
  [canonicalRootWithG5Copy, absorbedRootG5, existingCanonicalCopyG5],
  [makeLibraryReview(canonicalRootWithG5Copy, absorbedRootG5, { id: "review-g5-existing-copy" })],
  { organizationId: PALADIN_ORG, reviewId: "review-g5-existing-copy" },
);
assert.equal(g5CollisionPlan.canMerge, true, "absorbed root can merge when a canonical local copy already exists in its guild");
assert.equal(g5CollisionPlan.rootLocalPresence.action, "merge_absorbed_root_with_existing_copy", "absorbed root is treated as a local collision when a canonical copy exists");
assert.equal(g5CollisionPlan.localCollisions[0].absorbedRoot, true, "root-local collision is marked explicitly");
assert.equal(g5CollisionPlan.localCollisions[0].keepDefenseId, existingCanonicalCopyG5.id, "richer existing canonical copy is kept in the absorbed guild");
assert.deepEqual(
  g5CollisionPlan.guildsAfter.map((entry) => entry.guildCode).sort(),
  ["G1", "G5"],
  "existing-copy collision still preserves the absorbed guild after merge",
);

const canonicalRootWithThinG6Copy = makeDefense({
  id: "merge-g6-canonical",
  name: "Oren Dane Fortoresse",
  guildCode: "G5",
  includeLayout: false,
  imageUrl: "https://example.test/oren.webp",
});
const absorbedRootG6 = makeDefense({
  id: "merge-g6-absorbed-root",
  name: "Test v3",
  guildCode: "G6",
  includeLayout: false,
  imageUrl: "https://example.test/test-v3.webp",
  createdAt: "2026-08-24T10:00:00.000Z",
});
const existingCanonicalCopyG6 = makeDefense({
  id: "merge-g6-canonical-copy",
  name: "Test v4",
  guildCode: "G6",
  sourceDefenseId: canonicalRootWithThinG6Copy.id,
  includeLayout: false,
  createdAt: "2026-08-24T11:00:00.000Z",
});
const absorbedRootWinsCollisionPlan = buildGuildDefenseLibraryMergePlan(
  [canonicalRootWithThinG6Copy, absorbedRootG6, existingCanonicalCopyG6],
  [makeLibraryReview(canonicalRootWithThinG6Copy, absorbedRootG6, { id: "review-g6-absorbed-root-wins" })],
  { organizationId: PALADIN_ORG, reviewId: "review-g6-absorbed-root-wins" },
);
assert.equal(absorbedRootWinsCollisionPlan.canMerge, true, "Oren/Test v3 style root-local collision remains mergeable in the JS plan");
assert.equal(
  absorbedRootWinsCollisionPlan.rootLocalPresence.action,
  "merge_absorbed_root_with_existing_copy",
  "absorbed root and existing canonical local copy are treated as one local collision",
);
assert.equal(
  absorbedRootWinsCollisionPlan.localCollisions[0].keepDefenseId,
  absorbedRootG6.id,
  "the absorbed root can win the local collision when it carries the richer local data",
);
assert.equal(
  absorbedRootWinsCollisionPlan.localCollisions[0].hideDefenseId,
  existingCanonicalCopyG6.id,
  "the weaker existing canonical local copy is the one hidden after references move",
);
assert.deepEqual(
  absorbedRootWinsCollisionPlan.guildsAfter.map((entry) => entry.guildCode).sort(),
  ["G5", "G6"],
  "absorbed-root-wins collision still preserves both guild presences",
);

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

const realFortoRoot = makeDefense({
  id: "real-forto-root",
  name: "Forto Arbitre Dassomi",
  guildCode: "G1",
  includeLayout: false,
  infoBlocks: [
    { block_type: "text", content: "strat 1" },
    { block_type: "text", content: "strat 2" },
  ],
});
const realArbitreRoot = makeDefense({ id: "real-arbitre-root", name: "Arbitre", guildCode: "G5", includeLayout: false, createdAt: "2026-08-24T13:00:00.000Z" });
const realArbitreG2 = makeDefense({ id: "real-arbitre-g2", name: "Arbitre", guildCode: "G2", sourceDefenseId: realArbitreRoot.id, includeLayout: false });
const realFortoG2 = makeDefense({
  id: "real-forto-g2",
  name: "Forto Arbitre Dassomi",
  guildCode: "G2",
  sourceDefenseId: realFortoRoot.id,
  includeLayout: false,
  infoBlocks: [
    { block_type: "text", content: "strat 1" },
    { block_type: "text", content: "strat 2" },
  ],
});
const realG2CollisionPlan = buildGuildDefenseLibraryMergePlan(
  [realFortoRoot, realArbitreRoot, realArbitreG2, realFortoG2],
  [makeLibraryReview(realFortoRoot, realArbitreRoot, { id: "review-real-g2" })],
  { organizationId: PALADIN_ORG, reviewId: "review-real-g2" },
);
const realG2Collision = realG2CollisionPlan.localCollisions.find((collision) => collision.guildCode === "G2");
assert.equal(realG2CollisionPlan.canMerge, true, "real G2 collision remains mergeable");
assert.equal(realG2Collision.keepDefenseId, realFortoG2.id, "G2 keeps the Forto copy because it carries the two info blocks");
assert.equal(realG2Collision.hideDefenseId, realArbitreG2.id, "G2 hides the empty Arbitre copy after member references are repointed");

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
const postMergeResume = buildLibraryEquivalenceMergeCandidates(
  [
    fleetRootA,
    { ...fleetRootB, is_hidden: true, merged_into_defense_id: fleetRootA.id },
    fleetAChildG2,
    { ...fleetBChildG4, source_defense_id: fleetRootA.id },
  ],
  [makeLibraryReview(fleetRootA, fleetRootB, { id: "review-post-merge" })],
  fleetRootA.id,
  { organizationId: PALADIN_ORG },
);
assert.equal(postMergeResume.mergeCandidates.length, 0, "merged roots no longer expose a resumable merge action");
const rootLocalCopyAfterMerge = { ...rootB, source_defense_id: rootA.id, sourceDefenseId: rootA.id };
const remainingNativeRoot = makeDefense({
  id: "merge-remaining-native-root",
  name: "Remaining native root",
  guildCode: "G6",
  includeLayout: true,
});
const multiIdenticalAfterMergeResume = buildLibraryEquivalenceMergeCandidates(
  [rootA, rootLocalCopyAfterMerge, remainingNativeRoot],
  [
    makeLibraryReview(rootA, rootB, { id: "review-root-local-copy-stale" }),
    makeLibraryReview(rootB, remainingNativeRoot, { id: "review-local-copy-to-root" }),
    makeLibraryReview(rootA, remainingNativeRoot, { id: "review-remaining-native-root" }),
  ],
  rootA.id,
  { organizationId: PALADIN_ORG },
);
assert.deepEqual(
  multiIdenticalAfterMergeResume.mergeCandidates.map((candidate) => candidate.review.id),
  ["review-remaining-native-root"],
  "after one root is converted to a local copy, only the remaining native root can resume a merge",
);
assert.equal(
  multiIdenticalAfterMergeResume.mergeCandidates[0].equivalentDefenseId,
  remainingNativeRoot.id,
  "resumable merge candidates never point at the converted local copy",
);
const convertedCopyResume = buildLibraryEquivalenceMergeCandidates(
  [rootA, rootLocalCopyAfterMerge, remainingNativeRoot],
  [
    makeLibraryReview(rootA, rootB, { id: "review-root-local-copy-stale" }),
    makeLibraryReview(rootB, remainingNativeRoot, { id: "review-local-copy-to-root" }),
    makeLibraryReview(rootA, remainingNativeRoot, { id: "review-remaining-native-root" }),
  ],
  rootLocalCopyAfterMerge.id,
  { organizationId: PALADIN_ORG },
);
assert.equal(convertedCopyResume.mergeCandidates.length, 0, "a converted local copy cannot reopen a root merge plan");
const convertedRootImportState = buildLibraryEquivalenceState(
  [
    rootA,
    { ...rootB, source_defense_id: rootA.id },
    childG3After,
  ],
  [makeLibraryReview(rootA, rootB, { id: "review-converted-root" })],
);
assert.equal(
  getEquivalentImportTargetStatus(rootA, rootB.guild_code, [rootA, { ...rootB, source_defense_id: rootA.id }, childG3After], convertedRootImportState).status,
  "imported",
  "absorbed guild is detected as already present after root-local conversion",
);
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
  portalSource,
  adminDefensesTabSource,
  preflightSql,
  migrationSql,
  verifySql,
  mergePreflightSql,
  mergeMigrationSql,
  mergeVerifySql,
  mergeV2PreflightSql,
  mergeV2Sql,
  mergeV2VerifySql,
  mergeV3PreflightSql,
  mergeV3Sql,
  mergeV3VerifySql,
  mergeV4PreflightSql,
  mergeV4Sql,
  mergeV4VerifySql,
  mergeV5Sql,
  mergeV5VerifySql,
] = await Promise.all([
  readFile(new URL("../api/_guild-defense-library-equivalence.js", import.meta.url), "utf8"),
  readFile(new URL("../api/portal-admin-defenses.js", import.meta.url), "utf8"),
  readFile(new URL("../api/gvg-enemy-defense-bank.js", import.meta.url), "utf8"),
  readFile(new URL("../src/SaasPortal.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/AdminDefensesTab.jsx", import.meta.url), "utf8"),
  readFile(new URL("../scripts/guild_defense_library_equivalence_preflight.sql", import.meta.url), "utf8"),
  readFile(new URL("../scripts/guild_defense_library_equivalence.sql", import.meta.url), "utf8"),
  readFile(new URL("../scripts/guild_defense_library_equivalence_verify.sql", import.meta.url), "utf8"),
  readFile(new URL("../scripts/guild_defense_library_merge_preflight.sql", import.meta.url), "utf8"),
  readFile(new URL("../scripts/guild_defense_library_merge.sql", import.meta.url), "utf8"),
  readFile(new URL("../scripts/guild_defense_library_merge_verify.sql", import.meta.url), "utf8"),
  readFile(new URL("../scripts/guild_defense_library_merge_v2_preflight.sql", import.meta.url), "utf8"),
  readFile(new URL("../scripts/guild_defense_library_merge_v2.sql", import.meta.url), "utf8"),
  readFile(new URL("../scripts/guild_defense_library_merge_v2_verify.sql", import.meta.url), "utf8"),
  readFile(new URL("../scripts/guild_defense_library_merge_v3_preflight.sql", import.meta.url), "utf8"),
  readFile(new URL("../scripts/guild_defense_library_merge_v3.sql", import.meta.url), "utf8"),
  readFile(new URL("../scripts/guild_defense_library_merge_v3_verify.sql", import.meta.url), "utf8"),
  readFile(new URL("../scripts/guild_defense_library_merge_v4_preflight.sql", import.meta.url), "utf8"),
  readFile(new URL("../scripts/guild_defense_library_merge_v4.sql", import.meta.url), "utf8"),
  readFile(new URL("../scripts/guild_defense_library_merge_v4_verify.sql", import.meta.url), "utf8"),
  readFile(new URL("../scripts/guild_defense_library_merge_v5.sql", import.meta.url), "utf8"),
  readFile(new URL("../scripts/guild_defense_library_merge_v5_verify.sql", import.meta.url), "utf8"),
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
assert.match(adminApiSource, /librarySimilarityDecisionResults\.push\(result\)/, "admin API keeps every persisted similarity decision result");
assert.match(adminApiSource, /library_similarity_decision_results: librarySimilarityDecisionResults/, "admin API returns persisted decision results to the frontend");
assert.match(portalSource, /function getPortalDefenseSimilarityMode/, "Portal UI derives a similarity modal mode");
assert.match(portalSource, /isExistingPortalDefenseDraft\(draft\) \? "edit" : "create"/, "Portal UI falls back to draft id for edit similarity warnings");
assert.match(portalSource, /const isEditSimilarityWarning = similarDefenseMode === "edit"/, "Portal UI keeps one edit/create mode per similarity modal");
assert.match(portalSource, /IDENTIQUE/, "edit similarity modal exposes the IDENTIQUE action");
assert.match(portalSource, /DIFFÉRENTE/, "edit similarity modal exposes the DIFFERENTE action");
{
  const importButtonIndex = portalSource.indexOf("Importer cette defense dans");
  const importGateIndex = portalSource.lastIndexOf("{!isEditSimilarityWarning ? (", importButtonIndex);
  assert.ok(importButtonIndex >= 0, "create similarity modal keeps the import action");
  assert.ok(
    importGateIndex >= 0 && importButtonIndex - importGateIndex < 1200,
    "edit similarity modal does not expose the create import action",
  );
}
assert.match(portalSource, /isEditSimilarityWarning \? "ANNULER"/, "edit similarity modal exposes a global ANNULER action");
assert.match(portalSource, /isEditSimilarityWarning\s*\?\s*"Appliquer la modification"/, "edit similarity modal applies an existing defense edit after all decisions");
assert.match(portalSource, /status === "identical" && \(item\.reviewId \|\| item\.review_id\)/, "Portal UI waits for an identical decision with a real review id");
assert.match(portalSource, /setLibraryMergeOpenRequest\(\{[\s\S]*reviewId: identicalDecision\.reviewId \|\| identicalDecision\.review_id/, "Portal UI opens the merge plan from the returned review id");
assert.match(portalSource, /const clearLibraryMergeOpenRequest = useCallback\(\(\) => \{[\s\S]*setLibraryMergeOpenRequest\(null\)/, "Portal UI can clear a consumed automatic merge request");
assert.match(portalSource, /onLibraryMergeRequestConsumed=\{clearLibraryMergeOpenRequest\}/, "Portal UI passes the merge request consume callback to the library modal");
assert.match(adminDefensesTabSource, /onLibraryMergeRequestConsumed = null/, "Admin defenses tab accepts the automatic merge request consume callback");
assert.match(adminDefensesTabSource, /consumeOpenLibraryMergeRequest\(reviewId\);[\s\S]*onDataChanged\?\.\(\)/, "successful library merge consumes the automatic request before refreshing data");
assert.match(adminDefensesTabSource, /finally \{[\s\S]*consumeOpenLibraryMergeRequest\(reviewId\);/, "automatic merge preview is consumed after it is opened or fails");
assert.match(adminDefensesTabSource, /Code: \$\{data\.code\}/, "library merge UI keeps Supabase error codes visible");
assert.match(adminDefensesTabSource, /Details: \$\{data\.details\}/, "library merge UI keeps Supabase error details visible");
assert.match(adminDefensesTabSource, /whitespace-pre-line/, "library merge errors preserve code/details/hint line breaks");
assert.match(adminApiSource, /action === "library-merge-preview"/, "admin API exposes merge preview without mutation");
assert.match(adminApiSource, /mergeCandidates/, "equivalence details API exposes resumable merge candidates");
assert.match(adminApiSource, /action === "library-merge"/, "admin API exposes explicit merge action");
assert.match(adminApiSource, /merge_guild_defense_library_roots/, "admin API delegates merge mutation to a transactional RPC");
assert.doesNotMatch(
  adminApiSource,
  /message\.includes\(columnName\.toLowerCase\(\)\)/,
  "admin API no longer treats any business message mentioning a column as schema missing",
);
assert.match(
  adminApiSource,
  /isMissingSchemaObjectError\(error,\s*\{[\s\S]*columns: GUILD_LIBRARY_SCHEMA_COLUMNS/,
  "admin API classifies missing library schema through strict schema error codes",
);
assert.match(
  adminApiSource,
  /buildPortalErrorPayload\(error, "Fusion bibliotheque impossible\."\)/,
  "admin API preserves real merge error code/details/hint for non-schema failures",
);
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
assert.match(helperSource, /const nativeRowsById = new Map/, "equivalence details builds merge candidates only from active native roots");
assert.match(helperSource, /nativeRowsById\.get\(equivalentId\)/, "equivalence details refuses converted local copies as merge targets");
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
assert.match(mergeV2PreflightSql, /read-only/i, "merge V2 preflight is explicitly read-only");
assert.match(mergeV2Sql, /create or replace function public\.merge_guild_defense_library_roots/, "merge V2 replaces the existing RPC instead of creating a second workflow");
assert.match(mergeV2Sql, /absorbed_root_preserved_as_local_copy/, "merge V2 records absorbed-root local preservation");
assert.match(mergeV2Sql, /source_defense_id = v_canonical\.id/, "merge V2 can convert a cross-guild absorbed root into a canonical local copy");
assert.match(mergeV2Sql, /guild_defense_library_repoint_references\(\s*v_hide_child_id,\s*v_keep_child_id\s*\)/, "merge V2 repoints members to the kept local defense during collisions");
assert.match(mergeV2Sql, /if not v_absorbed_root_handled then[\s\S]*guild_defense_library_repoint_references\(\s*v_absorbed\.id,\s*v_canonical\.id\s*\)/, "merge V2 only repoints absorbed root to canonical when it was not preserved locally");
assert.match(mergeV2Sql, /v_absorbed_root_preserved := true[\s\S]*v_root_reference_result := jsonb_build_object\([\s\S]*absorbed_root_preserved_as_local_copy/, "merge V2 skips root reference repointing when the absorbed root is kept as local copy");
assert.match(mergeV2VerifySql, /active_absorbed_rows_still_native_after_merge/, "merge V2 verify detects absorbed roots that incorrectly remain native");
assert.match(mergeV2VerifySql, /active_absorbed_rows_with_wrong_source_after_merge/, "merge V2 verify audits converted absorbed roots");
assert.match(mergeV3PreflightSql, /read-only/i, "merge V3 preflight is explicitly read-only");
assert.match(mergeV3PreflightSql, /review_similarity_signatures_are_sha256/, "merge V3 preflight verifies review signatures are stored as JS SHA-256 hashes");
assert.match(mergeV3Sql, /guild_defense_library_js_sha256/, "merge V3 computes SQL signatures as SHA-256 like the JS matcher");
assert.match(mergeV3Sql, /guild_defense_library_js_map_type/, "merge V3 centralizes JS-compatible map type normalization");
assert.match(mergeV3Sql, /'fortress', 'forteresse', 'bastion'/, "merge V3 keeps fortress, forteresse and bastion equivalent");
assert.match(mergeV3Sql, /'comtedracula', 'countdracula'/, "merge V3 keeps the Count Dracula alias used by JS");
assert.match(mergeV3Sql, /'capitainereve', 'captainreve'/, "merge V3 keeps the Captain Reve alias used by JS");
assert.match(mergeV3Sql, /create or replace function public\.guild_defense_library_review_signature/, "merge V3 adds a SQL review identity signature with layout fields");
assert.doesNotMatch(mergeV3Sql, /champion_id::text/, "merge V3 signatures use JS champion names instead of old champion_id text signatures");
assert.match(mergeV3Sql, /coalesce\(to_json\(slots\.direction\)::text, 'null'\)/, "merge V3 identity signatures preserve null directions like JS");
assert.match(mergeV3Sql, /coalesce\(to_json\(slots\.position\)::text, 'null'\)/, "merge V3 identity signatures preserve null positions like JS");
assert.match(mergeV3VerifySql, /identical_reviews_similarity_mismatch/, "merge V3 verify detects false or stale similarity mismatches");
assert.match(mergeV3VerifySql, /identical_reviews_identity_mismatch/, "merge V3 verify detects genuinely obsolete identical reviews");
assert.match(mergeV4PreflightSql, /guild_defense_conditions', 'champion_id', 'bigint'/, "merge V4 preflight checks the real condition champion_id bigint type");
assert.match(mergeV4PreflightSql, /helper_condition_key_signature[\s\S]*bigint, integer/, "merge V4 preflight exposes the condition helper signature mismatch");
assert.match(mergeV4Sql, /drop function if exists public\.guild_defense_library_condition_key\(uuid, integer\)/, "merge V4 removes the obsolete uuid condition helper signature");
assert.match(mergeV4Sql, /p_champion_id bigint/, "merge V4 recreates the condition helper with the real bigint champion id type");
assert.doesNotMatch(mergeV4Sql, /p_champion_id uuid/, "merge V4 does not recreate the faulty uuid condition helper");
assert.match(mergeV4Sql, /guild_defense_library_condition_key\(bigint, integer\)/, "merge V4 grants and documents the corrected condition helper");
assert.match(mergeV4PreflightSql, /check_name = 'helper_condition_key_signature' and actual_value = 'uuid, integer' then 'INFO'/, "merge V4 preflight treats the old uuid helper as an expected pre-migration diagnostic");
assert.match(mergeV4PreflightSql, /sample_defenses_with_multiple_conditions[\s\S]*'informational'[\s\S]*'INFO'/, "merge V4 preflight does not block when live data has no multi-condition defense sample");
assert.match(mergeV4VerifySql, /condition_key_bigint_literal_call/, "merge V4 verify smoke-tests the corrected helper deterministically");
assert.match(mergeV4VerifySql, /condition_key_bigint_with_real_condition/, "merge V4 verify smoke-tests the corrected helper on a real condition row");
assert.match(mergeV4VerifySql, /merge_score_counts_distinct_condition_keys/, "merge V4 verify inspects multi-condition scoring logic without depending on live fixtures");
assert.match(mergeV4VerifySql, /merge_score_zero_condition_sample/, "merge V4 verify smoke-tests merge_score without conditions");
assert.match(mergeV4VerifySql, /merge_score_multi_condition_sample/, "merge V4 verify smoke-tests merge_score with multiple conditions");
assert.match(mergeV4VerifySql, /real_case_forto_arbitre_dassomi_arbitre_score_type_safe/, "merge V4 verify covers the live Forto Arbitre Dassomi / Arbitre case without mutating it");
assert.match(mergeV4VerifySql, /identical_reviews_similarity_mismatch/, "merge V4 verify keeps the V3 similarity signature invariant");
assert.match(mergeV4VerifySql, /active_absorbed_rows_still_native_after_merge/, "merge V4 verify keeps the V2 absorbed-root preservation invariant");
assert.match(mergeV5Sql, /Correction V5 de la fusion Bibliotheque/, "merge V5 migration is versioned and explicit");
assert.doesNotMatch(mergeV5Sql, /drop index[\s\S]*guild_defenses_unique_active_import_idx/i, "merge V5 keeps the unique active import index");
assert.doesNotMatch(mergeV5Sql, /\bdelete\s+from\s+public\.guild_defenses\b/i, "merge V5 never deletes defense rows");
{
  const rootCollisionStart = mergeV5Sql.indexOf("v_existing_absorbed_guild_copy.id, v_absorbed.id");
  const rootCollisionEnd = mergeV5Sql.indexOf("v_absorbed_root_handled := true", rootCollisionStart);
  const rootCollisionSql = mergeV5Sql.slice(rootCollisionStart, rootCollisionEnd);
  const rootRepointIndex = rootCollisionSql.indexOf("guild_defense_library_repoint_references");
  const rootHideIndex = rootCollisionSql.indexOf("is_hidden = true");
  const rootKeeperImportIndex = rootCollisionSql.indexOf("source_defense_id = v_canonical.id");
  assert.ok(rootCollisionStart >= 0 && rootCollisionEnd > rootCollisionStart, "merge V5 exposes the absorbed-root local collision block");
  assert.ok(rootRepointIndex >= 0, "merge V5 root collision repoints references to the kept local defense");
  assert.ok(rootHideIndex > rootRepointIndex, "merge V5 root collision hides the losing local defense after reference repoint");
  assert.ok(rootKeeperImportIndex > rootHideIndex, "merge V5 root collision imports the kept defense only after freeing the unique index");
}
{
  const childCollisionStart = mergeV5Sql.indexOf("v_keep_child_id := public.guild_defense_library_preferred_defense(v_existing_child.id, v_child.id)");
  const childCollisionEnd = mergeV5Sql.indexOf("v_local_collisions := v_local_collisions || jsonb_build_array(jsonb_build_object(", childCollisionStart);
  const childCollisionSql = mergeV5Sql.slice(childCollisionStart, childCollisionEnd);
  const childRepointIndex = childCollisionSql.indexOf("guild_defense_library_repoint_references");
  const childHideIndex = childCollisionSql.indexOf("is_hidden = true");
  const childKeeperImportIndex = childCollisionSql.indexOf("source_defense_id = v_canonical.id");
  assert.ok(childCollisionStart >= 0 && childCollisionEnd > childCollisionStart, "merge V5 exposes the descendant local collision block");
  assert.ok(childRepointIndex >= 0, "merge V5 descendant collision repoints references to the kept local defense");
  assert.ok(childHideIndex > childRepointIndex, "merge V5 descendant collision hides the losing local defense after reference repoint");
  assert.ok(childKeeperImportIndex > childHideIndex, "merge V5 descendant collision imports the kept defense only after freeing the unique index");
}
assert.match(mergeV5VerifySql, /root_collision_hides_loser_before_keeper_import/, "merge V5 verify checks the absorbed-root collision order");
assert.match(mergeV5VerifySql, /child_collision_hides_loser_before_keeper_import/, "merge V5 verify checks the descendant collision order");
assert.match(mergeV5VerifySql, /unique_active_import_index_preserved/, "merge V5 verify confirms the unique active import index is still present");
assert.match(mergeV5VerifySql, /regexp_replace\(body, '\[\[:space:\]\]\+', ' ', 'g'\)/, "merge V5 verify normalizes PostgreSQL function source whitespace");
assert.match(mergeV5VerifySql, /v_existing_absorbed_guild_copy\.id, v_absorbed\.id/, "merge V5 verify anchors the root collision on the preferred-defense call");
assert.match(mergeV5VerifySql, /substring\(normalized_body from root_collision_start\), 'for v_child in'/, "merge V5 verify ends the root collision segment at the descendant loop");
assert.match(mergeV5VerifySql, /v_existing_child\.id, v_child\.id/, "merge V5 verify anchors the child collision on the preferred-defense call");
assert.match(mergeV5VerifySql, /substring\(normalized_body from child_collision_start\), 'if not v_absorbed_root_handled then'/, "merge V5 verify ends the child collision segment at the root fallback");
assert.doesNotMatch(mergeV5VerifySql, /strpos\(body, 'v_absorbed_root_handled := true'\)/, "merge V5 verify does not use the fragile global root handled marker");
{
  const normalizedMergeV5Sql = mergeV5Sql.toLowerCase().replace(/\s+/g, " ");
  const rootVerifyMarker = "guild_defense_library_preferred_defense(v_existing_absorbed_guild_copy.id, v_absorbed.id)";
  const childVerifyMarker = "guild_defense_library_preferred_defense(v_existing_child.id, v_child.id)";
  assert.ok(normalizedMergeV5Sql.includes(rootVerifyMarker), "merge V5 normalized source contains the root verify marker");
  assert.ok(normalizedMergeV5Sql.includes(childVerifyMarker), "merge V5 normalized source contains the child verify marker");
  assert.ok(mergeV5VerifySql.includes(`'${rootVerifyMarker}'`), "merge V5 verify uses the root marker that exists in normalized source");
  assert.ok(mergeV5VerifySql.includes(`'${childVerifyMarker}'`), "merge V5 verify uses the child marker that exists in normalized source");
}

console.log("Guild defense library equivalence tests passed");
