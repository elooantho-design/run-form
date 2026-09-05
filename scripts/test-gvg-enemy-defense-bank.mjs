import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  GVG_ENEMY_DEFENSE_ARCHIVE_ENDPOINT,
  archiveEnemyDefenseImageOnVps,
  archiveEnemyDefensesBeforeGvgReset,
  aggregateEnemyDefenseOccurrences,
  buildEnemyDefenseCanonicalDefinition,
  buildSourceGvgKey,
  createDefenseSimilaritySignature,
  createEnemyDefenseFingerprint,
  createEnemyDefenseSimilaritySignature,
  createLocalDefenseSimilaritySignature,
  createLocalDefenseReviewSignature,
  detectEnemyDefenseSimilaritiesForArchive,
  enrichEnemyDefenseCompatibleLineage,
  extractGvgVpsPreviewSourcePath,
  getEnemyDefenseRateTone,
  getEnemyDefenseSuccessRate,
  getPermanentEnemyDefenseImagePath,
  getPermanentEnemyDefenseImageUrl,
  isPermanentEnemyDefenseImagePath,
  isPermanentEnemyDefenseImageUrl,
  isEnemyDefenseLinksSchemaMissing,
  normalizeGvgDirection,
  normalizeGvgChampionSimilarityKey,
  normalizeGvgPosition,
  recalculateEnemyDefenseSimilarities,
  sortEnemyDefenseBankRows,
  stableStringify,
} from "../api/_gvg-enemy-defense-bank.js";

process.env.GVG_PUBLIC_ASSETS_BASE_URL = "https://vps-aad12be0.vps.ovh.net";
delete process.env.VPS_PUBLIC_ASSETS_BASE_URL;
delete process.env.VITE_GVG_PUBLIC_ASSETS_BASE_URL;
delete process.env.VITE_ASSETS_BASE_URL;

const baseDefense = {
  id: "def-1",
  guild: "G3",
  type: "tower",
  is_ally: false,
  image_url: "https://vps-aad12be0.vps.ovh.net/public/jobs/g3/job_123/previews/def-1.webp",
  record_status: "open",
  created_at: "2026-08-24T10:00:00.000Z",
  updated_at: "2026-08-24T10:01:00.000Z",
  heroes: [
    { champion: "Khadgrim", position: "A5", direction: "East" },
    { champion: "Valara", position: "B4", direction: "E" },
    { champion: "Dame Alexandra", position: "C3", direction: "→" },
  ],
};

const sameDefenseDifferentOrder = {
  ...baseDefense,
  id: "def-2",
  record_status: null,
  heroes: [
    { direction: "E", position: "C3", champion: "Dame Alexandra" },
    { position: "B4", champion: "Valara2", direction: "EST" },
    { champion: "Khadgrim", direction: "E", position: "A5" },
  ],
};

const baseFingerprint = createEnemyDefenseFingerprint(baseDefense);
assert.equal(typeof baseFingerprint, "string", "a valid defense receives a SHA-256 fingerprint");
assert.equal(baseFingerprint.length, 64, "fingerprint uses a 64-char SHA-256 hex digest");
assert.equal(
  baseFingerprint,
  createEnemyDefenseFingerprint(sameDefenseDifferentOrder),
  "same semantic defense keeps the same fingerprint despite hero/object order and direction aliases",
);

assert.notEqual(
  baseFingerprint,
  createEnemyDefenseFingerprint({
    ...baseDefense,
    heroes: [{ champion: "Khadgrim", position: "A6", direction: "E" }],
  }),
  "changing a position changes the canonical defense",
);
assert.notEqual(
  baseFingerprint,
  createEnemyDefenseFingerprint({
    ...baseDefense,
    heroes: [{ champion: "Khadgrim", position: "A5", direction: "S" }],
  }),
  "changing a direction changes the canonical defense",
);
assert.notEqual(
  baseFingerprint,
  createEnemyDefenseFingerprint({
    ...baseDefense,
    heroes: [{ champion: "Valara", position: "A5", direction: "E" }],
  }),
  "changing a champion changes the canonical defense",
);

assert.deepEqual(
  buildEnemyDefenseCanonicalDefinition(baseDefense),
  buildEnemyDefenseCanonicalDefinition(sameDefenseDifferentOrder),
  "canonical definition is deterministic and stripped of row IDs, timestamps and image URLs",
);
assert.equal(
  stableStringify({ b: 2, a: 1 }),
  stableStringify({ a: 1, b: 2 }),
  "object key order does not change stable JSON",
);
assert.equal(normalizeGvgPosition("G10", "tower"), "G10", "tower positions support A1 -> G10");
assert.equal(normalizeGvgPosition("H11", "fortress"), "H11", "fortress positions support A1 -> H11");
assert.equal(normalizeGvgDirection("west"), "O", "west direction normalizes to the existing O convention");

const fiveHeroEnemy = {
  id: "enemy-five",
  map_type: "tower",
  canonical_definition: {
    map_type: "tower",
    heroes: [
      { champion: "Khadgrim", position: "A5", direction: "E" },
      { champion: "Valara", position: "B4", direction: "S" },
      { champion: "Dame Alexandra", position: "C3", direction: "N" },
      { champion: "Aurelius Gale", position: "D6", direction: "O" },
      { champion: "Captain Reve", position: "E2", direction: "E" },
    ],
  },
};
const fiveHeroLocalDifferentOrder = {
  id: "local-five",
  type: "Tour",
  guild_code: "G2",
  organization_id: "org-paladin",
  is_hidden: false,
  guild_defense_slots: [
    { slot_index: 3, champions: { name: "Dame Alexandra" } },
    { slot_index: 1, champions: { name: "Khadgrim" } },
    { slot_index: 5, champions: { name: "Captain Rêve" } },
    { slot_index: 4, champions: { name: "Aurelius Gale" } },
    { slot_index: 2, champions: { name: "Valara" } },
  ],
};
const fiveHeroSimilarity = createEnemyDefenseSimilaritySignature(fiveHeroEnemy);
assert.equal(typeof fiveHeroSimilarity, "string", "five hero enemy defense receives a similarity signature");
assert.equal(
  createLocalDefenseSimilaritySignature(fiveHeroLocalDifferentOrder),
  fiveHeroSimilarity,
  "similarity uses map type plus the same five heroes, independent of order and accents",
);
assert.equal(
  createDefenseSimilaritySignature({ mapType: "Forteresse", heroes: fiveHeroEnemy.canonical_definition.heroes }),
  createDefenseSimilaritySignature({ mapType: "Bastion", heroes: fiveHeroEnemy.canonical_definition.heroes }),
  "forteresse and bastion are the same structural type",
);
assert.notEqual(
  createDefenseSimilaritySignature({ mapType: "Forteresse", heroes: fiveHeroEnemy.canonical_definition.heroes }),
  fiveHeroSimilarity,
  "tower and fortress never match for similarity",
);
assert.equal(
  createDefenseSimilaritySignature({
    mapType: "tower",
    heroes: fiveHeroEnemy.canonical_definition.heroes.slice(0, 4),
  }),
  null,
  "similarity requires exactly five heroes",
);
assert.notEqual(
  createLocalDefenseSimilaritySignature({
    ...fiveHeroLocalDifferentOrder,
    guild_defense_slots: [
      ...fiveHeroLocalDifferentOrder.guild_defense_slots.slice(0, 4),
      { slot_index: 5, champions: { name: "Volka" } },
    ],
  }),
  fiveHeroSimilarity,
  "changing one hero removes the similarity candidate",
);

const testSimiEnemy = {
  id: "enemy-testsimi",
  map_type: "tower",
  canonical_definition: {
    map_type: "tower",
    heroes: [
      { champion: "Count Dracula", position: "A1", direction: "E" },
      { champion: "Erlis", position: "A2", direction: "S" },
      { champion: "Brokkir", position: "B3", direction: "N" },
      { champion: "Oren", position: "C4", direction: "O" },
      { champion: "Valara", position: "D5", direction: "E" },
    ],
  },
};
const testSimiLocalWithoutLayout = {
  id: "local-testsimi",
  type: "Tour",
  name: "TestSimi",
  guild_code: "G3",
  organization_id: "org-paladin",
  is_hidden: false,
  guild_defense_slots: [
    { slot_index: 1, champions: { name: "Comte Dracula" } },
    { slot_index: 2, champions: { name: "Erlis" } },
    { slot_index: 3, champions: { name: "Brokkir" } },
    { slot_index: 4, champions: { name: "Oren" } },
    { slot_index: 5, champions: { name: "Valara" } },
  ],
};
const testSimiEnemySignature = createEnemyDefenseSimilaritySignature(testSimiEnemy);
assert.equal(normalizeGvgChampionSimilarityKey("Comte Dracula"), "countdracula", "similarity aliases handle French Dracula naming");
assert.equal(
  createLocalDefenseSimilaritySignature(testSimiLocalWithoutLayout),
  testSimiEnemySignature,
  "TestSimi local no-layout defense is detected by type plus the same five heroes",
);
assert.equal(
  createLocalDefenseReviewSignature(testSimiLocalWithoutLayout) !== testSimiEnemySignature,
  true,
  "review signatures include layout confidence instead of collapsing no-layout locals into canonical identity",
);

assert.equal(
  isEnemyDefenseLinksSchemaMissing({
    code: "PGRST204",
    message: "Could not find the 'position' column of 'guild_defense_slots' in the schema cache",
  }),
  true,
  "missing guild_defense_slots.position still reports the links migration as missing",
);
assert.equal(
  isEnemyDefenseLinksSchemaMissing({
    code: "PGRST204",
    message: "Could not find the 'direction' column of 'defence_slot' in the schema cache",
  }),
  false,
  "unrelated strat/search column errors are not masked as enemy-link migration errors",
);
assert.equal(
  isEnemyDefenseLinksSchemaMissing({
    code: "23503",
    message: 'insert or update on table "gvg_enemy_defense_similarity_reviews" violates foreign key constraint',
  }),
  false,
  "foreign key errors on similarity reviews are not masked as a missing migration",
);
assert.equal(
  isEnemyDefenseLinksSchemaMissing({
    code: "23502",
    message: 'null value in column "local_defense_id" of relation "gvg_enemy_defense_similarity_reviews" violates not-null constraint',
  }),
  false,
  "not-null errors on similarity reviews are not masked as a missing migration",
);
assert.equal(
  isEnemyDefenseLinksSchemaMissing({
    code: "42501",
    message: 'new row violates row-level security policy for table "gvg_enemy_defense_similarity_reviews"',
  }),
  false,
  "RLS errors on similarity reviews are not masked as a missing migration",
);
assert.equal(
  isEnemyDefenseLinksSchemaMissing({
    code: "42P01",
    message: 'relation "public.gvg_enemy_defense_similarity_reviews" does not exist',
  }),
  true,
  "a genuinely missing similarity review table is reported as a missing links migration",
);
assert.equal(
  isEnemyDefenseLinksSchemaMissing({
    code: "42703",
    message: 'column guild_defenses.source_enemy_defense_id does not exist',
  }),
  true,
  "a genuinely missing source_enemy_defense_id column is reported as a missing links migration",
);

const fiveOccurrences = Array.from({ length: 5 }, (_, index) => ({
  ...baseDefense,
  id: `def-occ-${index + 1}`,
  record_status: index < 2 ? "open" : null,
  created_at: `2026-08-24T10:0${index}:00.000Z`,
  updated_at: `2026-08-24T10:0${index}:30.000Z`,
}));
const aggregated = aggregateEnemyDefenseOccurrences(fiveOccurrences);
assert.equal(aggregated.entries.length, 1, "five identical occurrences create one canonical entry");
assert.equal(aggregated.entries[0].encounters, 5, "five identical occurrences count as five encounters");
assert.equal(aggregated.entries[0].opened, 2, "two opened occurrences count as two opened defenses");

const secondResetSameDefense = aggregateEnemyDefenseOccurrences([
  { ...baseDefense, id: "second-1", record_status: "open" },
  { ...baseDefense, id: "second-2", record_status: "open" },
  { ...baseDefense, id: "second-3", record_status: "open" },
  { ...baseDefense, id: "second-4", record_status: null },
]);
const cumulativeStats = {
  encounters: aggregated.entries[0].encounters + secondResetSameDefense.entries[0].encounters,
  opened: aggregated.entries[0].opened + secondResetSameDefense.entries[0].opened,
};
assert.deepEqual(cumulativeStats, { encounters: 9, opened: 5 }, "a second reset updates stats without requiring a new canonical defense");
assert.equal(
  getPermanentEnemyDefenseImagePath(baseFingerprint, "G3/def-1.webp"),
  `enemy-defense-bank/${baseFingerprint}.webp`,
  "permanent image path is deterministic and based on the canonical hash",
);
assert.equal(
  getPermanentEnemyDefenseImageUrl(`enemy-defense-bank/${baseFingerprint}.webp`),
  `https://vps-aad12be0.vps.ovh.net/assets/enemy-defense-bank/${baseFingerprint}.webp`,
  "permanent image URL stays on the VPS public assets domain",
);
assert.equal(
  extractGvgVpsPreviewSourcePath(baseDefense.image_url),
  "/public/jobs/g3/job_123/previews/def-1.webp",
  "temporary VPS preview path is extracted from the current Portal image URL",
);
assert.equal(
  extractGvgVpsPreviewSourcePath(
    "/api/gvg-server?action=preview&guild=G3&jobId=job_123&file=def-1.webp",
  ),
  "/public/jobs/G3/job_123/previews/def-1.webp",
  "temporary VPS preview path can be recovered from the Vercel preview proxy fallback",
);
assert.equal(
  extractGvgVpsPreviewSourcePath("https://example.supabase.co/storage/v1/object/public/gvg-images/G3/def-1.webp"),
  null,
  "Supabase Storage URLs are not accepted as enemy defense bank preview sources",
);
assert.equal(
  extractGvgVpsPreviewSourcePath("https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/frame.png"),
  null,
  "sources outside /public/jobs/.../previews/ are refused",
);
assert.equal(
  extractGvgVpsPreviewSourcePath("https://vps-aad12be0.vps.ovh.net/public/jobs/g3/job_123/previews/../def-1.webp"),
  null,
  "path traversal in preview sources is refused",
);
assert.equal(
  isPermanentEnemyDefenseImagePath(`enemy-defense-bank/${baseFingerprint}.webp`, baseFingerprint),
  true,
  "VPS permanent image path is recognized",
);
assert.equal(
  isPermanentEnemyDefenseImageUrl(
    `https://vps-aad12be0.vps.ovh.net/assets/enemy-defense-bank/${baseFingerprint}.webp`,
    baseFingerprint,
  ),
  true,
  "VPS permanent image URL is recognized",
);

assert.equal(createEnemyDefenseFingerprint({ ...baseDefense, guild: "G1" }), baseFingerprint, "G1/G2/MAD can share one canonical defense");
assert.equal(createEnemyDefenseFingerprint({ ...baseDefense, guild: "MAD_G1" }), baseFingerprint, "tenant does not enter the canonical fingerprint");

assert.equal(getEnemyDefenseSuccessRate(0, 0), 0, "0 encounter rate is handled safely");
assert.equal(getEnemyDefenseSuccessRate(2, 5), 40, "opened / encounters rate is calculated correctly");
assert.equal(getEnemyDefenseRateTone(0), "solid", "0% is green/solid");
assert.equal(getEnemyDefenseRateTone(20), "solid", "20% is green/solid");
assert.equal(getEnemyDefenseRateTone(21), "warning", ">20% is yellow/warning");
assert.equal(getEnemyDefenseRateTone(50), "warning", "50% is yellow/warning");
assert.equal(getEnemyDefenseRateTone(51), "danger", ">50% is orange/danger");
assert.equal(getEnemyDefenseRateTone(80), "danger", "80% is orange/danger");
assert.equal(getEnemyDefenseRateTone(81), "critical", ">80% is red/critical");

const sortedRates = sortEnemyDefenseBankRows([
  { defense_fingerprint: "d", opened: 1, encounters: 1 },
  { defense_fingerprint: "b", opened: 1, encounters: 20 },
  { defense_fingerprint: "a", opened: 0, encounters: 12 },
  { defense_fingerprint: "c", opened: 1, encounters: 20 },
]).map((row) => row.defense_fingerprint);
assert.deepEqual(sortedRates, ["a", "b", "c", "d"], "sort uses rate asc, then encounters desc, then stable fingerprint");

function createArchiveSupabaseStub({ existingRows = [], rpcError = null } = {}) {
  const calls = [];
  const portalGuilds = [
    {
      id: "portal-g3",
      organization_id: "org-paladin",
      guild_code: "G3",
      display_name: "G3",
      is_active: true,
    },
    {
      id: "portal-mad-g1",
      organization_id: "org-mad",
      guild_code: "MAD G1",
      display_name: "Mad G1",
      is_active: true,
    },
  ];

  return {
    calls,
    from(table) {
      const query = {
        select() {
          return query;
        },
        eq(column, value) {
          calls.push({ type: "eq", table, column, value });
          if (table === "portal_guilds") {
            return Promise.resolve({ data: portalGuilds, error: null });
          }
          return query;
        },
        in(column, values) {
          calls.push({ type: "in", table, column, values });
          if (table === "gvg_enemy_defenses") {
            const wanted = new Set(values.map(String));
            return Promise.resolve({
              data: existingRows.filter((row) => wanted.has(String(row.defense_fingerprint))),
              error: null,
            });
          }
          return Promise.resolve({ data: [], error: null });
        },
      };
      return query;
    },
    rpc(name, args) {
      calls.push({ type: "rpc", name, args });
      if (rpcError) return Promise.resolve({ data: null, error: rpcError });
      return Promise.resolve({
        data: {
          already_processed: false,
          inserted_canonical: args.p_defenses.length,
          stats_upserted: args.p_defenses.length,
        },
        error: null,
      });
    },
  };
}

function createSimilaritySupabaseStub({
  existingReviews = [],
  localDefenseRows = null,
  enemyDefenseRows = null,
  statsRows = null,
} = {}) {
  const calls = [];
  const upserts = [];
  const updates = [];
  const portalGuilds = [
    { id: "guild-g1", organization_id: "org-paladin", guild_code: "G1", display_name: "G1", is_active: true },
    { id: "guild-g2", organization_id: "org-paladin", guild_code: "G2", display_name: "G2", is_active: true },
    { id: "guild-mad", organization_id: "org-mad", guild_code: "MAD G1", display_name: "Mad G1", is_active: true },
  ];
  const localDefenses = localDefenseRows || [
    fiveHeroLocalDifferentOrder,
    {
      ...fiveHeroLocalDifferentOrder,
      id: "local-hidden",
      is_hidden: true,
    },
    {
      ...fiveHeroLocalDifferentOrder,
      id: "local-cross-tenant",
      organization_id: "org-mad",
      guild_code: "MAD G1",
    },
    {
      ...fiveHeroLocalDifferentOrder,
      id: "local-wrong-hero",
      guild_defense_slots: [
        ...fiveHeroLocalDifferentOrder.guild_defense_slots.slice(0, 4),
        { slot_index: 5, champions: { name: "Volka" } },
      ],
    },
  ];
  const enemyDefenses = enemyDefenseRows || [fiveHeroEnemy];
  const enemyStats = statsRows || enemyDefenses.map((defense) => ({
    enemy_defense_id: defense.id,
    organization_id: "org-paladin",
    portal_guild_id: "guild-g2",
    encounters: 3,
    opened: 1,
  }));

  return {
    calls,
    upserts,
    updates,
    from(table) {
      const filters = {};
      const query = {
        select() {
          return query;
        },
        eq(column, value) {
          filters[column] = value;
          return query;
        },
        in(column, values) {
          filters[column] = values;
          return query;
        },
        update(payload) {
          query.updatePayload = payload;
          return query;
        },
        or() {
          return query;
        },
        limit() {
          return query;
        },
        upsert(rows, options) {
          calls.push({ type: "upsert", table, rows, options });
          upserts.push(...(Array.isArray(rows) ? rows : [rows]));
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve, reject) {
          try {
            return Promise.resolve(resolve(resolveQuery(table, filters, query.updatePayload)));
          } catch (error) {
            if (reject) return Promise.resolve(reject(error));
            return Promise.reject(error);
          }
        },
      };
      return query;
    },
  };

  function resolveQuery(table, filters, updatePayload = null) {
    calls.push({ type: "select", table, filters: { ...filters } });

    if (updatePayload) {
      updates.push({ table, filters: { ...filters }, payload: updatePayload });
      return { data: null, error: null };
    }

    if (table === "portal_guilds") {
      return {
        data: portalGuilds.filter(
          (guild) =>
            (!filters.organization_id || guild.organization_id === filters.organization_id) &&
            (filters.is_active === undefined || guild.is_active === filters.is_active),
        ),
        error: null,
      };
    }

    if (table === "guild_defenses") {
      return {
        data: localDefenses.filter(
          (defense) =>
            defense.organization_id === filters.organization_id &&
            defense.is_hidden !== true,
        ),
        error: null,
      };
    }

    if (table === "gvg_enemy_defense_guild_stats") {
      return {
        data: enemyStats.filter(
          (row) =>
            (!filters.organization_id || row.organization_id === filters.organization_id) &&
            (!filters.portal_guild_id || row.portal_guild_id === filters.portal_guild_id) &&
            (!filters.enemy_defense_id || row.enemy_defense_id === filters.enemy_defense_id),
        ),
        error: null,
      };
    }

    if (table === "gvg_enemy_defenses") {
      const wanted = new Set((filters.id || []).map(String));
      return {
        data: enemyDefenses.filter((defense) => !wanted.size || wanted.has(String(defense.id))),
        error: null,
      };
    }

    if (table === "gvg_enemy_defense_similarity_reviews") {
      return { data: existingReviews, error: null };
    }

    return { data: [], error: null };
  }
}

{
  const supabaseStub = createSimilaritySupabaseStub();
  const result = await detectEnemyDefenseSimilaritiesForArchive(supabaseStub, {
    organizationId: "org-paladin",
    enemyDefenses: [fiveHeroEnemy],
  });

  assert.equal(result.pendingCreated, 1, "one same-org local candidate creates one pending similarity review");
  assert.equal(supabaseStub.upserts.length, 1, "similarity detection upserts only the new candidate pair");
  assert.equal(supabaseStub.upserts[0].status, "pending", "new similarity reviews start as pending");
  assert.equal(supabaseStub.upserts[0].local_guild_code, "G2", "candidate review keeps the local guild code");
  assert.equal(
    supabaseStub.calls.filter((call) => call.table === "guild_defenses").length,
    1,
    "similarity detection loads local defenses in one batch query",
  );
}

{
  const supabaseStub = createSimilaritySupabaseStub({
    localDefenseRows: [testSimiLocalWithoutLayout],
  });
  const result = await detectEnemyDefenseSimilaritiesForArchive(supabaseStub, {
    organizationId: "org-paladin",
    enemyDefenses: [testSimiEnemy],
  });

  assert.equal(result.pendingCreated, 1, "manual TestSimi no-layout defense creates a pending similarity review");
  assert.equal(supabaseStub.upserts[0].status, "pending", "no-layout same heroes never auto-link as identical");
}

{
  const statsRows = [{
    enemy_defense_id: testSimiEnemy.id,
    organization_id: "org-paladin",
    portal_guild_id: "guild-g3",
    encounters: 12,
    opened: 2,
  }];
  const supabaseStub = createSimilaritySupabaseStub({
    localDefenseRows: [testSimiLocalWithoutLayout],
    enemyDefenseRows: [testSimiEnemy],
    statsRows,
  });
  const result = await recalculateEnemyDefenseSimilarities(supabaseStub, {
    organizationId: "org-paladin",
    portalGuild: { id: "guild-g3", guild_code: "G3" },
    enemyDefenseId: testSimiEnemy.id,
    localDefenseIds: [testSimiLocalWithoutLayout.id],
  });

  assert.equal(result.pendingCreated, 1, "targeted TestSimi recalculation creates exactly one pending review");
  assert.equal(result.enemyDefensesScanned, 1, "targeted recalculation scans only the requested enemy defense");
  assert.equal(supabaseStub.upserts.length, 1, "targeted recalculation creates one review row");
  assert.equal(supabaseStub.upserts[0].status, "pending", "targeted recalculation keeps no-layout TestSimi pending");
  assert.equal(
    supabaseStub.calls.some((call) => call.type === "upsert" && call.table === "gvg_enemy_defense_guild_stats"),
    false,
    "targeted recalculation never upserts enemy encounter/opened stats",
  );
  assert.deepEqual(
    statsRows[0],
    {
      enemy_defense_id: testSimiEnemy.id,
      organization_id: "org-paladin",
      portal_guild_id: "guild-g3",
      encounters: 12,
      opened: 2,
    },
    "targeted recalculation leaves encounter/opened stat rows unchanged",
  );
}

{
  const existingPendingReview = {
    id: "review-testsimi",
    enemy_defense_id: testSimiEnemy.id,
    local_defense_id: testSimiLocalWithoutLayout.id,
    status: "pending",
    local_identity_signature: createLocalDefenseReviewSignature(testSimiLocalWithoutLayout),
  };
  const supabaseStub = createSimilaritySupabaseStub({
    existingReviews: [existingPendingReview],
    localDefenseRows: [testSimiLocalWithoutLayout],
    enemyDefenseRows: [testSimiEnemy],
    statsRows: [{
      enemy_defense_id: testSimiEnemy.id,
      organization_id: "org-paladin",
      portal_guild_id: "guild-g3",
      encounters: 12,
      opened: 2,
    }],
  });
  const result = await recalculateEnemyDefenseSimilarities(supabaseStub, {
    organizationId: "org-paladin",
    portalGuild: { id: "guild-g3", guild_code: "G3" },
    enemyDefenseId: testSimiEnemy.id,
    localDefenseIds: [testSimiLocalWithoutLayout.id],
  });

  assert.equal(result.pendingCreated, 0, "a second targeted recalculation does not create another pending review");
  assert.equal(result.pendingUpdated, 0, "a second targeted recalculation leaves the existing pending review untouched");
  assert.equal(supabaseStub.upserts.length, 0, "idempotent targeted recalculation performs no duplicate upsert");
}

{
  const exactLayoutLocal = {
    ...fiveHeroLocalDifferentOrder,
    id: "local-exact-layout",
    guild_defense_slots: [
      { slot_index: 1, champions: { name: "Khadgrim" }, position: "A5", direction: "E" },
      { slot_index: 2, champions: { name: "Valara" }, position: "B4", direction: "S" },
      { slot_index: 3, champions: { name: "Dame Alexandra" }, position: "C3", direction: "N" },
      { slot_index: 4, champions: { name: "Aurelius Gale" }, position: "D6", direction: "O" },
      { slot_index: 5, champions: { name: "Captain Rêve" }, position: "E2", direction: "E" },
    ],
  };
  const supabaseStub = createSimilaritySupabaseStub({
    localDefenseRows: [exactLayoutLocal],
  });
  const result = await detectEnemyDefenseSimilaritiesForArchive(supabaseStub, {
    organizationId: "org-paladin",
    enemyDefenses: [fiveHeroEnemy],
    sourcePortalGuild: { id: "guild-g2", guild_code: "G2" },
  });

  assert.equal(result.autoIdenticalCreated, 1, "complete exact layout auto-links as identical");
  assert.equal(supabaseStub.upserts[0].status, "identical", "auto-match stores an identical review");
  assert.equal(
    supabaseStub.updates.filter((update) => update.table === "guild_defense_slots").length,
    5,
    "auto-match writes only the five structural slot layout rows",
  );
}

{
  const exactLayoutLocal = {
    ...fiveHeroLocalDifferentOrder,
    id: "local-exact-layout-recalc",
    guild_defense_slots: [
      { slot_index: 1, champions: { name: "Khadgrim" }, position: "A5", direction: "E" },
      { slot_index: 2, champions: { name: "Valara" }, position: "B4", direction: "S" },
      { slot_index: 3, champions: { name: "Dame Alexandra" }, position: "C3", direction: "N" },
      { slot_index: 4, champions: { name: "Aurelius Gale" }, position: "D6", direction: "O" },
      { slot_index: 5, champions: { name: "Captain Rêve" }, position: "E2", direction: "E" },
    ],
  };
  const supabaseStub = createSimilaritySupabaseStub({
    localDefenseRows: [exactLayoutLocal],
    enemyDefenseRows: [fiveHeroEnemy],
    statsRows: [{
      enemy_defense_id: fiveHeroEnemy.id,
      organization_id: "org-paladin",
      portal_guild_id: "guild-g2",
      encounters: 5,
      opened: 1,
    }],
  });
  const result = await recalculateEnemyDefenseSimilarities(supabaseStub, {
    organizationId: "org-paladin",
    portalGuild: { id: "guild-g2", guild_code: "G2" },
    enemyDefenseId: fiveHeroEnemy.id,
    localDefenseIds: [exactLayoutLocal.id],
  });

  assert.equal(result.autoIdenticalCreated, 1, "targeted recalculation can create an identical review when layouts match");
  assert.equal(result.autoIdenticalLineageSkipped, 1, "targeted recalculation disables local defense lineage propagation");
  assert.equal(supabaseStub.updates.length, 0, "targeted recalculation never updates local defense rows or slots");
}

{
  const completeLayoutDifferent = {
    ...fiveHeroLocalDifferentOrder,
    id: "local-different-layout",
    guild_defense_slots: [
      { slot_index: 1, champions: { name: "Khadgrim" }, position: "A6", direction: "E" },
      { slot_index: 2, champions: { name: "Valara" }, position: "B4", direction: "S" },
      { slot_index: 3, champions: { name: "Dame Alexandra" }, position: "C3", direction: "N" },
      { slot_index: 4, champions: { name: "Aurelius Gale" }, position: "D6", direction: "O" },
      { slot_index: 5, champions: { name: "Captain Rêve" }, position: "E2", direction: "E" },
    ],
  };
  const supabaseStub = createSimilaritySupabaseStub({
    localDefenseRows: [completeLayoutDifferent],
  });
  const result = await detectEnemyDefenseSimilaritiesForArchive(supabaseStub, {
    organizationId: "org-paladin",
    enemyDefenses: [fiveHeroEnemy],
  });

  assert.equal(result.autoIdenticalCreated, 0, "complete but different layout is not auto-linked");
  assert.equal(result.pendingCreated, 1, "complete but different layout remains a human-review candidate");
}

{
  const supabaseStub = createSimilaritySupabaseStub({
    existingReviews: [
      {
        id: "review-existing",
        enemy_defense_id: fiveHeroEnemy.id,
        local_defense_id: fiveHeroLocalDifferentOrder.id,
        status: "different",
        local_identity_signature: createLocalDefenseReviewSignature(fiveHeroLocalDifferentOrder),
      },
    ],
  });
  const result = await detectEnemyDefenseSimilaritiesForArchive(supabaseStub, {
    organizationId: "org-paladin",
    enemyDefenses: [fiveHeroEnemy],
  });

  assert.equal(result.pendingCreated, 0, "reviewed pairs are not proposed again when local identity is unchanged");
  assert.equal(result.pendingUpdated, 0, "unchanged different/identical reviews are not overwritten");
  assert.equal(supabaseStub.upserts.length, 0, "no upsert happens for an unchanged reviewed pair");
}

{
  const supabaseStub = createSimilaritySupabaseStub({
    existingReviews: [
      {
        id: "review-obsolete",
        enemy_defense_id: fiveHeroEnemy.id,
        local_defense_id: fiveHeroLocalDifferentOrder.id,
        status: "different",
        local_identity_signature: "old-local-signature",
      },
    ],
  });
  const result = await detectEnemyDefenseSimilaritiesForArchive(supabaseStub, {
    organizationId: "org-paladin",
    enemyDefenses: [fiveHeroEnemy],
  });

  assert.equal(result.pendingUpdated, 1, "local identity changes invalidate the old review into a fresh pending review");
  assert.equal(supabaseStub.upserts[0].id, "review-obsolete", "obsolete reviews are updated instead of duplicated");
  assert.equal(supabaseStub.upserts[0].status, "pending", "obsolete reviews return to pending");
}

{
  const sourceDefense = {
    ...testSimiLocalWithoutLayout,
    id: "source-a",
    name: "Source A",
    guild_code: "G2",
    source_defense_id: null,
  };
  const childG3 = {
    ...testSimiLocalWithoutLayout,
    id: "child-g3",
    name: "Copy G3",
    guild_code: "G3",
    source_defense_id: "source-a",
  };
  const childG4 = {
    ...testSimiLocalWithoutLayout,
    id: "child-g4",
    name: "Copy G4",
    guild_code: "G4",
    source_defense_id: "source-a",
  };
  const divergedChild = {
    ...testSimiLocalWithoutLayout,
    id: "child-diverged",
    name: "Copy diverged",
    guild_code: "G1",
    source_defense_id: "source-a",
    guild_defense_slots: [
      ...testSimiLocalWithoutLayout.guild_defense_slots.slice(0, 4),
      { slot_index: 5, champions: { name: "Volka" } },
    ],
  };
  const supabaseStub = createSimilaritySupabaseStub({
    localDefenseRows: [sourceDefense, childG3, childG4, divergedChild],
  });
  const result = await enrichEnemyDefenseCompatibleLineage(supabaseStub, {
    organizationId: "org-paladin",
    localDefenseId: "child-g3",
    enemyDefense: testSimiEnemy,
    sourcePortalGuild: { id: "guild-g3", guild_code: "G3" },
    reviewer: { memberId: "admin-1", name: "Admin" },
  });

  assert.deepEqual(
    new Set(result.updatedIds),
    new Set(["source-a", "child-g3", "child-g4"]),
    "human identical validation enriches source and compatible child copies in the same organization",
  );
  assert.equal(result.skipped.some((row) => row.id === "child-diverged" && row.reason === "diverged"), true, "diverged child is skipped");
  assert.equal(
    supabaseStub.upserts.filter((row) => row.status === "identical").length,
    3,
    "compatible lineage receives identical reviews so G4 will not ask for another validation",
  );
  assert.equal(
    supabaseStub.updates.some((update) => ["guild_defense_conditions", "guild_defense_blocks"].includes(update.table)),
    false,
    "lineage propagation never touches local conditions or info blocks",
  );
}

function getArchiveRpcCall(supabaseStub) {
  return supabaseStub.calls.find((call) => call.type === "rpc" && call.name === "archive_gvg_enemy_defense_bank");
}

function permanentImageRow(fingerprint) {
  const image_storage_path = `enemy-defense-bank/${fingerprint}.webp`;
  return {
    id: `row-${fingerprint.slice(0, 8)}`,
    defense_fingerprint: fingerprint,
    image_storage_path,
    image_url: getPermanentEnemyDefenseImageUrl(image_storage_path),
  };
}

{
  const supabaseStub = createArchiveSupabaseStub();
  const archiveCalls = [];
  const result = await archiveEnemyDefensesBeforeGvgReset(supabaseStub, {
    guild: "G3",
    defenses: fiveOccurrences,
    archiveImageOnVps: async (request) => {
      archiveCalls.push(request);
      return {
        copied: true,
        already_exists: false,
        image_storage_path: getPermanentEnemyDefenseImagePath(request.fingerprint, request.sourcePath),
        image_url: getPermanentEnemyDefenseImageUrl(getPermanentEnemyDefenseImagePath(request.fingerprint, request.sourcePath)),
      };
    },
  });

  const rpcCall = getArchiveRpcCall(supabaseStub);
  assert.equal(archiveCalls.length, 1, "five identical defenses trigger one VPS image copy");
  assert.equal(archiveCalls[0].sourcePath, "/public/jobs/g3/job_123/previews/def-1.webp", "VPS copy receives only a source path, not image bytes");
  assert.equal(archiveCalls[0].fingerprint, baseFingerprint, "VPS copy is keyed by the canonical fingerprint");
  assert.equal(rpcCall.args.p_portal_guild_id, "portal-g3", "archive uses the resolved Portal guild");
  assert.equal(rpcCall.args.p_defenses.length, 1, "RPC receives one canonical defense for repeated occurrences");
  assert.equal(rpcCall.args.p_defenses[0].encounters, 5, "RPC keeps all occurrence counts");
  assert.equal(rpcCall.args.p_defenses[0].image_url, getPermanentEnemyDefenseImageUrl(`enemy-defense-bank/${baseFingerprint}.webp`));
  assert.equal(result.images_archived, 1, "fresh VPS copies are counted");
}

{
  const supabaseStub = createArchiveSupabaseStub({ existingRows: [permanentImageRow(baseFingerprint)] });
  const archiveCalls = [];
  await archiveEnemyDefensesBeforeGvgReset(supabaseStub, {
    guild: "G3",
    defenses: [baseDefense],
    archiveImageOnVps: async (request) => {
      archiveCalls.push(request);
      throw new Error("should not copy known canonical image");
    },
  });

  assert.equal(archiveCalls.length, 0, "known canonical defenses with a VPS permanent image do not copy again");
  assert.equal(getArchiveRpcCall(supabaseStub).args.p_defenses[0].image_archived, false, "known images are reused without marking a new archive");
}

{
  const supabaseStub = createArchiveSupabaseStub();
  const result = await archiveEnemyDefensesBeforeGvgReset(supabaseStub, {
    guild: "MAD_G1",
    defenses: [baseDefense],
    archiveImageOnVps: async (request) => ({
      copied: false,
      already_exists: true,
      image_storage_path: getPermanentEnemyDefenseImagePath(request.fingerprint, request.sourcePath),
      image_url: getPermanentEnemyDefenseImageUrl(getPermanentEnemyDefenseImagePath(request.fingerprint, request.sourcePath)),
    }),
  });

  const rpcCall = getArchiveRpcCall(supabaseStub);
  assert.equal(rpcCall.args.p_portal_guild_id, "portal-mad-g1", "MAD_G1 resolves through the Portal guild mapping");
  assert.equal(result.images_archived, 0, "an already-existing destination is reused without counting a new copy");
}

{
  const supabaseStub = createArchiveSupabaseStub();
  await assert.rejects(
    () =>
      archiveEnemyDefensesBeforeGvgReset(supabaseStub, {
        guild: "G3",
        defenses: [baseDefense],
        archiveImageOnVps: async () => {
          throw new Error("copy failed");
        },
      }),
    /copy failed/,
    "VPS copy failures stop the archive",
  );
  assert.equal(getArchiveRpcCall(supabaseStub), undefined, "RPC is not called when a VPS copy fails");
}

{
  const supabaseStub = createArchiveSupabaseStub({ rpcError: { message: "RPC failed" } });
  await assert.rejects(
    () =>
      archiveEnemyDefensesBeforeGvgReset(supabaseStub, {
        guild: "G3",
        defenses: [baseDefense],
        archiveImageOnVps: async (request) => ({
          copied: true,
          image_storage_path: getPermanentEnemyDefenseImagePath(request.fingerprint, request.sourcePath),
          image_url: getPermanentEnemyDefenseImageUrl(getPermanentEnemyDefenseImagePath(request.fingerprint, request.sourcePath)),
        }),
      }),
    /RPC failed/,
    "RPC errors are surfaced to keep the reset blocked",
  );
}

{
  const requests = [];
  const archiveResponse = await archiveEnemyDefenseImageOnVps(
    {
      sourcePath: "/public/jobs/g3/job_123/previews/def-1.webp",
      fingerprint: baseFingerprint,
      extension: "webp",
    },
    async (pathname, options) => {
      requests.push({ pathname, options });
      return {
        copied: false,
        already_exists: true,
        image_storage_path: `enemy-defense-bank/${baseFingerprint}.webp`,
        image_url: `https://vps-aad12be0.vps.ovh.net/assets/enemy-defense-bank/${baseFingerprint}.webp`,
      };
    },
  );

  assert.equal(requests[0].pathname, GVG_ENEMY_DEFENSE_ARCHIVE_ENDPOINT, "Vercel calls the dedicated VPS archive endpoint");
  assert.deepEqual(
    requests[0].options.body,
    {
      source_path: "/public/jobs/g3/job_123/previews/def-1.webp",
      fingerprint: baseFingerprint,
      extension: "webp",
    },
    "Vercel sends only lightweight JSON metadata to the VPS",
  );
  assert.equal(archiveResponse.already_exists, true, "already-existing VPS files are reported as reusable");
}

const keyOnce = buildSourceGvgKey("MAD_G1", [
  { id: "b" },
  { id: "a" },
  { id: "ally", is_ally: true },
]);
const keyTwice = buildSourceGvgKey("MAD G1", [{ id: "a" }, { id: "b" }]);
assert.equal(keyOnce, keyTwice, "reset idempotency key is stable across MAD_G1/MAD G1 and ignores ally rows");

const [
  resetApi,
  importApi,
  bankApi,
  bankHelperApi,
  runApi,
  gvgDataApi,
  adminDefensesApi,
  stratSearchApi,
  migrationSql,
  preflightSql,
  verifySql,
  linksMigrationSql,
  linksPreflightSql,
  linksVerifySql,
  bankUi,
] = await Promise.all([
  readFile(new URL("../api/gvg-reset.js", import.meta.url), "utf8"),
  readFile(new URL("../api/gvg-import.js", import.meta.url), "utf8"),
  readFile(new URL("../api/gvg-enemy-defense-bank.js", import.meta.url), "utf8"),
  readFile(new URL("../api/_gvg-enemy-defense-bank.js", import.meta.url), "utf8"),
  readFile(new URL("../api/run.js", import.meta.url), "utf8"),
  readFile(new URL("../api/gvg-data.js", import.meta.url), "utf8"),
  readFile(new URL("../api/portal-admin-defenses.js", import.meta.url), "utf8"),
  readFile(new URL("../api/gvg-strat-search.js", import.meta.url), "utf8"),
  readFile(new URL("../scripts/gvg_enemy_defense_bank.sql", import.meta.url), "utf8"),
  readFile(new URL("../scripts/gvg_enemy_defense_bank_preflight.sql", import.meta.url), "utf8"),
  readFile(new URL("../scripts/gvg_enemy_defense_bank_verify.sql", import.meta.url), "utf8"),
  readFile(new URL("../scripts/gvg_enemy_defense_links.sql", import.meta.url), "utf8"),
  readFile(new URL("../scripts/gvg_enemy_defense_links_preflight.sql", import.meta.url), "utf8"),
  readFile(new URL("../scripts/gvg_enemy_defense_links_verify.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/components/GvgEnemyDefenseBankTab.jsx", import.meta.url), "utf8"),
]);

assert.match(resetApi, /archiveEnemyDefensesBeforeGvgReset/, "reset calls the enemy defense archive helper");
assert.ok(
  resetApi.indexOf("archiveEnemyDefensesBeforeGvgReset") < resetApi.indexOf(".remove(storagePaths)"),
  "archive happens before temporary image deletion",
);
assert.match(
  resetApi.slice(resetApi.indexOf("archiveEnemyDefensesBeforeGvgReset")),
  /\.from\("gvg_defense"\)[\s\S]*?\.delete\(\)[\s\S]*?\.eq\("guild", guild\)/,
  "archive happens before gvg_defense cleanup",
);
assert.match(resetApi, /refreshEnemyDefenseStratAvailabilityForGuild/, "reset refreshes enemy strat availability as non-critical post-processing");
assert.match(resetApi, /enemy_strat_availability_warning/, "reset reports non-critical enemy strat availability warnings");
assert.doesNotMatch(importApi, /archiveEnemyDefensesBeforeGvgReset|gvg_enemy_defense/i, "import path never feeds the bank");
assert.match(migrationSql, /gvg_enemy_defense_processed_resets_unique/, "migration creates a processed reset unique guard");
assert.match(migrationSql, /on conflict \(portal_guild_id, source_gvg_key\) do nothing/, "RPC is idempotent per guild/reset key");
assert.match(migrationSql, /'already_processed', true/, "RPC reports already processed resets without double-counting");
assert.match(migrationSql, /encounters = public\.gvg_enemy_defense_guild_stats\.encounters \+ excluded\.encounters/, "stats are incremented cumulatively");
assert.match(migrationSql, /opened = public\.gvg_enemy_defense_guild_stats\.opened \+ excluded\.opened/, "opened count is incremented cumulatively");
assert.match(migrationSql, /unique \(portal_guild_id, enemy_defense_id\)/, "stats are unique per guild and canonical defense");
assert.doesNotMatch(migrationSql, /insert into public\.gvg_enemy_defenses[\s\S]*guild_code/i, "canonical defense table is global and not tenant-scoped");
assert.match(bankApi, /\.eq\("organization_id", portalGuild\.organization_id\)/, "cross-guild comparison is restricted to the same organization");
assert.match(bankApi, /resolvePortalGuildForGvgGuild/, "bank API resolves technical GVG guilds through Portal guilds");
assert.match(bankHelperApi, /GVG_ENEMY_DEFENSE_ARCHIVE_ENDPOINT/, "enemy defense bank image archival uses the dedicated VPS endpoint");
assert.doesNotMatch(bankHelperApi, /supabase\.storage|GVG_ENEMY_DEFENSE_IMAGE_BUCKET|storage\.copy/, "enemy defense bank does not use Supabase Storage");
assert.match(bankApi, /searchDefenceStrict/, "bank strats reuse the existing strict strat search");
assert.match(stratSearchApi, /export async function searchDefenceStrict/, "existing Calcul Groupe strat logic is exported, not duplicated in UI");
assert.match(preflightSql, /vps_image_storage_policy/, "preflight documents that enemy defense images stay on the VPS");
assert.match(preflightSql, /union all/i, "preflight returns a consolidated multi-row diagnostic");
assert.match(verifySql, /check_name[\s\S]*expected_value[\s\S]*actual_value[\s\S]*status/i, "verify returns check_name/expected/actual/status rows");
assert.match(verifySql, /permanent_images_vps_url/, "verify checks permanent VPS image URLs");
assert.match(linksMigrationSql, /gvg_enemy_defense_similarity_reviews/, "links migration creates the similarity review table");
assert.match(linksMigrationSql, /gvg_enemy_defense_strat_availability/, "links migration creates the strat availability table");
assert.match(linksMigrationSql, /references public\.gvg_enemy_defenses\(id\) on delete set null/, "local enemy links are kept non-destructive on seasonal enemy purge");
assert.match(linksMigrationSql, /unique \(enemy_defense_id, local_defense_id\)/, "similarity reviews are unique per enemy/local pair");
assert.match(linksMigrationSql, /check \(status in \('pending', 'identical', 'different'\)\)/, "similarity reviews track pending/identical/different statuses");
assert.match(linksMigrationSql, /add column if not exists position text null/, "migration adds optional local slot positions");
assert.match(linksMigrationSql, /add column if not exists direction text null/, "migration adds optional local slot directions");
assert.doesNotMatch(linksMigrationSql, /supabase\.storage|storage bucket|create bucket/i, "links migration does not introduce Supabase Storage images");
assert.match(linksPreflightSql, /row_estimates/, "links preflight avoids direct table counts before migration");
assert.match(linksPreflightSql, /vps_only_no_supabase_storage/, "links preflight documents VPS-only image policy");
assert.match(linksVerifySql, /local_enemy_fk_on_delete/, "links verify checks non-destructive local enemy FK behavior");
assert.match(bankApi, /detectEnemyDefenseSimilaritiesForArchive/, "bank API refreshes similarity candidates in batch");
assert.match(bankApi, /action === "recalculate-similarities"/, "bank API exposes targeted similarity recalculation without reset");
assert.match(bankApi, /recalculateEnemyDefenseSimilarities/, "bank API delegates targeted recalculation to the shared helper");
assert.match(bankHelperApi, /applyAutoIdenticalLineage: false/, "targeted recalculation cannot update local defense lineage");
assert.match(bankApi, /available_strat_count/, "bank API returns cached/batch strat availability counts");
assert.match(bankApi, /refreshEnemyDefenseStratAvailabilityForGuild/, "bank API exposes a targeted strat availability refresh");
assert.match(bankApi, /getRunScopeForGvgGuild\(guild\)/, "bank strat lookup uses target-guild scope instead of broad admin read scope");
assert.match(runApi, /refreshEnemyDefenseStratAvailabilityForGuild/, "run mutations refresh enemy defense strat availability");
assert.match(gvgDataApi, /enemy defense bank availability refresh skipped/, "record push keeps availability refresh non-critical");
assert.match(bankApi, /requiresReview/, "bank import blocks while similar local candidates are pending");
assert.match(bankApi, /review-similarity/, "bank API exposes human similarity validation");
assert.match(bankApi, /remove-local/, "bank API exposes non-destructive local linked defense removal");
assert.match(adminDefensesApi, /action === "enemy-history"/, "admin defense API exposes linked enemy history");
assert.match(adminDefensesApi, /Taux de defaite|source_enemy_defense_id|getEnemyDefenseSuccessRate/, "admin defense API returns linked enemy defeat-rate stats without inverting the rate");
assert.match(bankUi, /0-20 %/, "UI exposes the 0-20% filter/legend");
assert.match(bankUi, /50-80 %/, "UI exposes the 50-80% filter/legend");
assert.match(bankUi, /SOLIDE/, "UI labels 0-20% as SOLIDE");
assert.match(bankUi, /À SURVEILLER/, "UI labels 20-50% as À SURVEILLER");
assert.match(bankUi, /FRAGILE/, "UI labels 50-80% as FRAGILE");
assert.match(bankUi, /FACILE/, "UI labels 80-100% as FACILE");
assert.match(bankUi, /Similarites detectees/, "UI exposes a clickable similarity badge");
assert.match(bankUi, /Voir la strat/, "UI exposes the active strat lookup entry point");
assert.match(bankUi, /Aucune strat/, "UI exposes the immediate no-strat state");
assert.match(bankUi, /Importer/, "UI exposes enemy defense import as a separate action");
assert.match(bankUi, /getYoutubeEmbedUrl/, "enemy strat modal embeds YouTube videos inside Portal");
assert.match(bankUi, /<iframe/, "enemy strat modal renders an embedded video player");
assert.match(bankUi, /imagePreview/, "enemy defense images can be opened in a large preview lightbox");
assert.match(bankUi, /onPointerMove=\{moveImagePan\}/, "image preview supports panning while zoomed");
assert.match(bankUi, /setPreviewZoom/, "image preview supports zoom controls");
assert.match(bankUi, /Deja presente en/, "UI marks enemy defenses already present in the active guild");
assert.match(bankUi, /Importer ailleurs/, "UI still allows importing a linked enemy defense to another guild");
assert.match(bankUi, /onDataChanged\?\.\(\)/, "enemy bank mutations notify the parent defense list for refresh without F5");

console.log("gvg enemy defense bank tests passed");
