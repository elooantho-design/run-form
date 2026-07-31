import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  GUILD_BOSS_CALIBRATION_STORAGE_KEY,
  buildGuildBossGridCenterPoints,
  GUILD_BOSS_ABYSSE_BLOCKED_CELLS,
  GUILD_BOSS_ABYSSE_DEFAULT_CELL_POINTS,
  GUILD_BOSS_APOCALYPSE_BLOCKED_CELLS,
  GUILD_BOSS_APOCALYPSE_DEFAULT_CELL_POINTS,
  GUILD_BOSS_DIRECTIONS,
  GUILD_BOSS_MAPS,
  GUILD_BOSS_POINT_CALIBRATION_MAP_IDS,
  GUILD_BOSS_MATRIX_BLOCKED_CELLS,
  GUILD_BOSS_MATRIX_DEFAULT_CELL_POINTS,
  getGuildBossCalibrationProgress,
  getGuildBossCellLabel,
  getGuildBossCellGeometry,
  getGuildBossPointLabel,
  isGuildBossCellPlayable,
  makeGuildBossCellKey,
  moveGuildBossHero,
  normalizeGuildBossCellPoints,
  normalizeGuildBossDirection,
  normalizeGuildBossDrafts,
  placeGuildBossHero,
  removeGuildBossHero,
  resolveGuildBossCellGeometry,
  rotateGuildBossHero,
  validateGuildBossMapConfigs,
} from "../src/lib/guildBossPlacement.js";
import { getHeroDirectionOverlayBox, getHeroDirectionOverlayConfig } from "../src/lib/heroDirectionOverlay.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

assert.equal(GUILD_BOSS_MAPS.length, 4, "four guild boss maps are configured");
assert.deepEqual(
  GUILD_BOSS_DIRECTIONS.map((direction) => direction.value),
  ["N", "E", "S", "W"],
  "four cardinal directions are available",
);

const expectedMaps = {
  matrice: { columns: 7, rows: 5, file: "matrice-7x5.png" },
  apocalypse: { columns: 9, rows: 4, file: "apocalypse-9x4.png" },
  abysse: { columns: 9, rows: 4, file: "abysse-9x4.png" },
  cauchemar: { columns: 7, rows: 4, file: "cauchemar-7x4.png" },
};

for (const map of GUILD_BOSS_MAPS) {
  const expected = expectedMaps[map.id];
  assert.ok(expected, `unexpected map id ${map.id}`);
  assert.equal(map.columns, expected.columns, `${map.id} columns match asset name`);
  assert.equal(map.rows, expected.rows, `${map.id} rows match asset name`);
  assert.equal(path.basename(map.imageUrl), expected.file, `${map.id} image file matches`);

  const assetPath = path.join(projectRoot, "public", map.imageUrl.replace(/^\//, ""));
  assert.ok(fs.existsSync(assetPath), `${map.id} asset exists`);
}

assert.deepEqual(
  validateGuildBossMapConfigs().map((result) => result.ok),
  [true, true, true, true],
  "all map configs validate",
);

assert.equal(getGuildBossCellLabel(makeGuildBossCellKey(0, 0)), "A1", "cell labels start at A1");
assert.equal(getGuildBossCellLabel(makeGuildBossCellKey(6, 4)), "E7", "cell labels use rows then columns");
assert.equal(getGuildBossPointLabel({ row: 1, col: 1 }), "L1-C1", "calibration point labels use line-column order");
assert.equal(GUILD_BOSS_CALIBRATION_STORAGE_KEY.endsWith(":v2"), true, "calibration storage starts from the reset v2 namespace");
assert.equal(normalizeGuildBossDirection("O"), "W", "French west alias is normalized");
assert.equal(normalizeGuildBossDirection("bad"), "E", "invalid directions default to east");

const matrixMap = GUILD_BOSS_MAPS.find((map) => map.id === "matrice");
const apocalypseMap = GUILD_BOSS_MAPS.find((map) => map.id === "apocalypse");
const abysseMap = GUILD_BOSS_MAPS.find((map) => map.id === "abysse");
assert.equal(GUILD_BOSS_POINT_CALIBRATION_MAP_IDS.has("matrice"), true, "matrix can be calibrated by points");
assert.equal(GUILD_BOSS_POINT_CALIBRATION_MAP_IDS.has("apocalypse"), true, "apocalypse can be calibrated by points");
assert.equal(GUILD_BOSS_POINT_CALIBRATION_MAP_IDS.has("abysse"), true, "abysse can be calibrated by points");
assert.deepEqual(
  GUILD_BOSS_MATRIX_BLOCKED_CELLS.map(getGuildBossCellLabel),
  ["A1", "B1", "C1", "A7", "B7", "C7"],
  "matrix blocked cells match the non-playable portals",
);
assert.equal(isGuildBossCellPlayable(matrixMap, "0:0"), false, "A1 is not playable");
assert.equal(isGuildBossCellPlayable(matrixMap, "3:1"), true, "B4 remains playable");
assert.equal(getHeroDirectionOverlayConfig("W").src, "/ui/hero-dir-o.png", "west reuses the shared run-search overlay");
assert.equal(getHeroDirectionOverlayBox("O", { x: 100, y: 100, size: 40 }).src, "/ui/hero-dir-o.png", "canvas export uses the shared overlay box");
assert.deepEqual(
  {
    width: getHeroDirectionOverlayBox("E", { x: 100, y: 100, width: 100, height: 50 }).width,
    height: getHeroDirectionOverlayBox("E", { x: 100, y: 100, width: 100, height: 50 }).height,
  },
  { width: 160, height: 80 },
  "canvas export can match rectangular cell overlays",
);
const fallbackPoints = buildGuildBossGridCenterPoints(matrixMap);
assert.equal(fallbackPoints.length, 35, "matrix fallback has one point per cell");
assert.equal(GUILD_BOSS_MATRIX_DEFAULT_CELL_POINTS.length, 35, "matrix has one bundled point per cell");
assert.deepEqual(GUILD_BOSS_MATRIX_DEFAULT_CELL_POINTS[0], { row: 1, col: 1, x: 0.296332, y: 0.253466 }, "matrix first bundled point matches calibration");
assert.deepEqual(GUILD_BOSS_MATRIX_DEFAULT_CELL_POINTS.at(-1), { row: 5, col: 7, x: 0.73236, y: 0.752524 }, "matrix last bundled point matches calibration");
assert.deepEqual(getGuildBossCalibrationProgress(matrixMap, []).nextPoint, { row: 1, col: 1 }, "calibration starts at L1-C1");
assert.equal(getGuildBossCalibrationProgress(matrixMap, fallbackPoints.slice(0, 34)).count, 34, "partial calibration counts saved points");
assert.deepEqual(
  getGuildBossCalibrationProgress(matrixMap, fallbackPoints.slice(0, 34)).nextPoint,
  { row: 5, col: 7 },
  "calibration proceeds row by row",
);
assert.equal(getGuildBossCalibrationProgress(matrixMap, fallbackPoints).complete, true, "35 matrix points complete calibration");

const apocalypseFallbackPoints = buildGuildBossGridCenterPoints(apocalypseMap);
assert.equal(apocalypseFallbackPoints.length, 36, "apocalypse fallback has one point per 9x4 cell");
assert.equal(GUILD_BOSS_APOCALYPSE_DEFAULT_CELL_POINTS.length, 36, "apocalypse has one bundled point per cell");
assert.deepEqual(
  GUILD_BOSS_APOCALYPSE_BLOCKED_CELLS.map(getGuildBossCellLabel),
  ["A4", "A5", "A6", "C1", "C9", "D1", "D2", "D8", "D9"],
  "apocalypse blocked cells match the non-playable tiles",
);
assert.deepEqual(
  GUILD_BOSS_APOCALYPSE_DEFAULT_CELL_POINTS[0],
  { row: 1, col: 1, x: 0.246902, y: 0.37178 },
  "apocalypse first bundled point matches calibration",
);
assert.deepEqual(
  GUILD_BOSS_APOCALYPSE_DEFAULT_CELL_POINTS.at(-1),
  { row: 4, col: 9, x: 0.774547, y: 0.698115 },
  "apocalypse last bundled point matches calibration",
);
assert.equal(isGuildBossCellPlayable(apocalypseMap, "3:0"), false, "apocalypse L1C4 is not playable");
assert.equal(isGuildBossCellPlayable(apocalypseMap, "4:1"), true, "apocalypse L2C5 remains playable");
assert.deepEqual(getGuildBossCalibrationProgress(apocalypseMap, []).nextPoint, { row: 1, col: 1 }, "apocalypse calibration starts at L1-C1");
assert.deepEqual(
  getGuildBossCalibrationProgress(apocalypseMap, apocalypseFallbackPoints.slice(0, 35)).nextPoint,
  { row: 4, col: 9 },
  "apocalypse calibration asks for 36 points row by row",
);
assert.equal(getGuildBossCalibrationProgress(apocalypseMap, apocalypseFallbackPoints).complete, true, "36 apocalypse points complete calibration");
const apocalypseWithoutDefaultPoints = { ...apocalypseMap, defaultCellPoints: [] };
assert.equal(
  resolveGuildBossCellGeometry(apocalypseWithoutDefaultPoints, apocalypseFallbackPoints.slice(0, 35)).usesCalibratedPoints,
  false,
  "apocalypse keeps grid fallback until all custom points are present without bundled points",
);
assert.equal(
  resolveGuildBossCellGeometry(apocalypseMap, apocalypseFallbackPoints).usesCalibratedPoints,
  true,
  "apocalypse uses point calibration when all 36 cells are present",
);
assert.equal(resolveGuildBossCellGeometry(apocalypseMap, []).usesCalibratedPoints, true, "apocalypse uses bundled calibration by default");

const abysseFallbackPoints = buildGuildBossGridCenterPoints(abysseMap);
assert.equal(abysseFallbackPoints.length, 36, "abysse fallback has one point per 9x4 cell");
assert.equal(GUILD_BOSS_ABYSSE_DEFAULT_CELL_POINTS.length, 36, "abysse has one bundled point per cell");
assert.deepEqual(
  GUILD_BOSS_ABYSSE_BLOCKED_CELLS.map(getGuildBossCellLabel),
  ["C1", "C9", "D1", "D2", "D4", "D6", "D8", "D9"],
  "abysse blocked cells match the non-playable tiles",
);
assert.deepEqual(
  GUILD_BOSS_ABYSSE_DEFAULT_CELL_POINTS[0],
  { row: 1, col: 1, x: 0.262989, y: 0.325978 },
  "abysse first bundled point matches calibration",
);
assert.deepEqual(
  GUILD_BOSS_ABYSSE_DEFAULT_CELL_POINTS.at(-1),
  { row: 4, col: 9, x: 0.81101, y: 0.679031 },
  "abysse last bundled point matches calibration",
);
assert.equal(isGuildBossCellPlayable(abysseMap, "0:2"), false, "abysse L3C1 is not playable");
assert.equal(isGuildBossCellPlayable(abysseMap, "4:1"), true, "abysse L2C5 remains playable");
assert.deepEqual(getGuildBossCalibrationProgress(abysseMap, []).nextPoint, { row: 1, col: 1 }, "abysse calibration starts at L1-C1");
assert.deepEqual(
  getGuildBossCalibrationProgress(abysseMap, abysseFallbackPoints.slice(0, 35)).nextPoint,
  { row: 4, col: 9 },
  "abysse calibration asks for 36 points row by row",
);
assert.equal(getGuildBossCalibrationProgress(abysseMap, abysseFallbackPoints).complete, true, "36 abysse points complete calibration");
const abysseWithoutDefaultPoints = { ...abysseMap, defaultCellPoints: [] };
assert.equal(
  resolveGuildBossCellGeometry(abysseWithoutDefaultPoints, abysseFallbackPoints.slice(0, 35)).usesCalibratedPoints,
  false,
  "abysse keeps grid fallback until all custom points are present without bundled points",
);
assert.equal(
  resolveGuildBossCellGeometry(abysseMap, abysseFallbackPoints).usesCalibratedPoints,
  true,
  "abysse uses point calibration when all 36 cells are present",
);
assert.equal(resolveGuildBossCellGeometry(abysseMap, []).usesCalibratedPoints, true, "abysse uses bundled calibration by default");

const messyPoints = normalizeGuildBossCellPoints(matrixMap, [
  { row: 1, col: 1, x: 0.25, y: 0.2 },
  { row: 1, col: 1, x: 0.3, y: 0.22 },
  { row: 9, col: 9, x: 0.5, y: 0.5 },
  { row: 1, col: 2, x: "bad", y: 0.2 },
]);
assert.deepEqual(messyPoints, [{ row: 1, col: 1, x: 0.3, y: 0.22 }], "cell point normalization keeps valid latest point");

const defaultLayout = resolveGuildBossCellGeometry(matrixMap, []);
assert.equal(defaultLayout.usesCalibratedPoints, true, "matrix uses bundled calibration by default");
assert.ok(
  Math.abs(getGuildBossCellGeometry(matrixMap, [], 0, 0).centerX - GUILD_BOSS_MATRIX_DEFAULT_CELL_POINTS[0].x) < 0.000001,
  "cell geometry can read bundled matrix centers",
);
const matrixWithoutDefaultPoints = { ...matrixMap, defaultCellPoints: [] };
const fallbackLayout = resolveGuildBossCellGeometry(matrixWithoutDefaultPoints, fallbackPoints.slice(0, 34));
assert.equal(fallbackLayout.usesCalibratedPoints, false, "matrix keeps grid fallback until all custom points are present without bundled points");
const calibratedLayout = resolveGuildBossCellGeometry(matrixMap, fallbackPoints);
assert.equal(calibratedLayout.usesCalibratedPoints, true, "matrix uses calibrated points when all cells are present");
assert.ok(
  Math.abs(getGuildBossCellGeometry(matrixMap, fallbackPoints, 6, 4).centerX - fallbackPoints.find((point) => point.row === 5 && point.col === 7).x) <
    0.000001,
  "cell geometry can read calibrated matrix centers",
);

let placements = {};
placements = placeGuildBossHero(placements, { cellKey: "0:0", championId: "hero-blocked", direction: "N", map: matrixMap });
assert.deepEqual(placements, {}, "blocked cells reject placements");

placements = placeGuildBossHero(placements, { cellKey: "1:1", championId: "hero-a", direction: "N", map: matrixMap });
assert.deepEqual(placements["1:1"], { championId: "hero-a", direction: "N" }, "hero is placed");

placements = placeGuildBossHero(placements, { cellKey: "2:1", championId: "hero-b", direction: "S", map: matrixMap });
placements = placeGuildBossHero(placements, { cellKey: "3:1", championId: "hero-a", direction: "E", map: matrixMap });
assert.equal(placements["1:1"], undefined, "placing the same hero removes its previous cell");
assert.deepEqual(placements["3:1"], { championId: "hero-a", direction: "E" }, "same hero moved to new cell");
assert.deepEqual(placements["2:1"], { championId: "hero-b", direction: "S" }, "other heroes are preserved");

placements = placeGuildBossHero(placements, { cellKey: "6:0", championId: "hero-c", direction: "N", map: matrixMap });
assert.equal(placements["6:0"], undefined, "blocked destination remains empty");

placements = moveGuildBossHero(placements, { fromCellKey: "3:1", toCellKey: "0:1", map: matrixMap });
assert.deepEqual(placements["3:1"], { championId: "hero-a", direction: "E" }, "move to blocked cell is ignored");

placements = moveGuildBossHero(placements, { fromCellKey: "3:1", toCellKey: "4:1", map: matrixMap });
assert.equal(placements["3:1"], undefined, "move clears previous cell");
assert.deepEqual(placements["4:1"], { championId: "hero-a", direction: "E" }, "move keeps hero direction");

placements = rotateGuildBossHero(placements, "4:1");
assert.equal(placements["4:1"].direction, "S", "rotation advances direction");
placements = rotateGuildBossHero(placements, "4:1", "W");
assert.equal(placements["4:1"].direction, "W", "explicit direction is applied");

placements = removeGuildBossHero(placements, "4:1");
assert.equal(placements["4:1"], undefined, "hero is removed");
assert.ok(placements["2:1"], "removing one hero preserves other cells");

const drafts = normalizeGuildBossDrafts({
  matrice: { placements: { ...placements, "0:0": { championId: "hero-blocked", direction: "N" } } },
  apocalypse: { "1:1": { champion_id: "hero-c", direction: "O" } },
});
assert.ok(drafts.matrice, "drafts include matrix");
assert.ok(drafts.abysse, "drafts include empty maps");
assert.equal(drafts.matrice["0:0"], undefined, "draft normalization removes blocked matrix cells");
assert.equal(drafts.apocalypse["1:1"].direction, "W", "draft normalization handles legacy keys");

console.log("Guild boss placement tests passed.");
