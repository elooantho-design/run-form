import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  GVG_ENEMY_DEFENSE_ARCHIVE_ENDPOINT,
  archiveEnemyDefenseImageOnVps,
  archiveEnemyDefensesBeforeGvgReset,
  aggregateEnemyDefenseOccurrences,
  buildEnemyDefenseCanonicalDefinition,
  buildSourceGvgKey,
  createEnemyDefenseFingerprint,
  extractGvgVpsPreviewSourcePath,
  getEnemyDefenseRateTone,
  getEnemyDefenseSuccessRate,
  getPermanentEnemyDefenseImagePath,
  getPermanentEnemyDefenseImageUrl,
  isPermanentEnemyDefenseImagePath,
  isPermanentEnemyDefenseImageUrl,
  normalizeGvgDirection,
  normalizeGvgPosition,
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

const [resetApi, importApi, bankApi, bankHelperApi, stratSearchApi, migrationSql, preflightSql, verifySql, bankUi] = await Promise.all([
  readFile(new URL("../api/gvg-reset.js", import.meta.url), "utf8"),
  readFile(new URL("../api/gvg-import.js", import.meta.url), "utf8"),
  readFile(new URL("../api/gvg-enemy-defense-bank.js", import.meta.url), "utf8"),
  readFile(new URL("../api/_gvg-enemy-defense-bank.js", import.meta.url), "utf8"),
  readFile(new URL("../api/gvg-strat-search.js", import.meta.url), "utf8"),
  readFile(new URL("../scripts/gvg_enemy_defense_bank.sql", import.meta.url), "utf8"),
  readFile(new URL("../scripts/gvg_enemy_defense_bank_preflight.sql", import.meta.url), "utf8"),
  readFile(new URL("../scripts/gvg_enemy_defense_bank_verify.sql", import.meta.url), "utf8"),
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
assert.match(bankUi, /0-20 %/, "UI exposes the 0-20% filter/legend");
assert.match(bankUi, /50-80 %/, "UI exposes the 50-80% filter/legend");
assert.match(bankUi, /Voir les strats/, "UI exposes the existing strats lookup entry point");
assert.match(bankUi, /Aucune strat/, "UI handles empty strat results");

console.log("gvg enemy defense bank tests passed");
