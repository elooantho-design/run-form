import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  aggregateEnemyDefenseOccurrences,
  buildEnemyDefenseCanonicalDefinition,
  buildSourceGvgKey,
  createEnemyDefenseFingerprint,
  extractGvgStoragePathFromPublicUrl,
  getEnemyDefenseRateTone,
  getEnemyDefenseSuccessRate,
  getPermanentEnemyDefenseImagePath,
  normalizeGvgDirection,
  normalizeGvgPosition,
  sortEnemyDefenseBankRows,
  stableStringify,
} from "../api/_gvg-enemy-defense-bank.js";

const baseDefense = {
  id: "def-1",
  guild: "G3",
  type: "tower",
  is_ally: false,
  image_url: "https://example.supabase.co/storage/v1/object/public/gvg-images/G3/def-1.webp",
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
  extractGvgStoragePathFromPublicUrl(baseDefense.image_url),
  "G3/def-1.webp",
  "temporary Supabase Storage path is extracted from the current Portal image URL",
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

const keyOnce = buildSourceGvgKey("MAD_G1", [
  { id: "b" },
  { id: "a" },
  { id: "ally", is_ally: true },
]);
const keyTwice = buildSourceGvgKey("MAD G1", [{ id: "a" }, { id: "b" }]);
assert.equal(keyOnce, keyTwice, "reset idempotency key is stable across MAD_G1/MAD G1 and ignores ally rows");

const [resetApi, importApi, bankApi, stratSearchApi, migrationSql, preflightSql, verifySql, bankUi] = await Promise.all([
  readFile(new URL("../api/gvg-reset.js", import.meta.url), "utf8"),
  readFile(new URL("../api/gvg-import.js", import.meta.url), "utf8"),
  readFile(new URL("../api/gvg-enemy-defense-bank.js", import.meta.url), "utf8"),
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
assert.match(bankApi, /searchDefenceStrict/, "bank strats reuse the existing strict strat search");
assert.match(stratSearchApi, /export async function searchDefenceStrict/, "existing Calcul Groupe strat logic is exported, not duplicated in UI");
assert.match(preflightSql, /union all/i, "preflight returns a consolidated multi-row diagnostic");
assert.match(verifySql, /check_name[\s\S]*expected_value[\s\S]*actual_value[\s\S]*status/i, "verify returns check_name/expected/actual/status rows");
assert.match(bankUi, /0-20 %/, "UI exposes the 0-20% filter/legend");
assert.match(bankUi, /50-80 %/, "UI exposes the 50-80% filter/legend");
assert.match(bankUi, /Voir les strats/, "UI exposes the existing strats lookup entry point");
assert.match(bankUi, /Aucune strat/, "UI handles empty strat results");

console.log("gvg enemy defense bank tests passed");
