import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  GUILD_BOSS_DIRECTIONS,
  GUILD_BOSS_MAPS,
  getGuildBossCellLabel,
  makeGuildBossCellKey,
  moveGuildBossHero,
  normalizeGuildBossDirection,
  normalizeGuildBossDrafts,
  placeGuildBossHero,
  removeGuildBossHero,
  rotateGuildBossHero,
  validateGuildBossMapConfigs,
} from "../src/lib/guildBossPlacement.js";

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
assert.equal(normalizeGuildBossDirection("O"), "W", "French west alias is normalized");
assert.equal(normalizeGuildBossDirection("bad"), "E", "invalid directions default to east");

let placements = {};
placements = placeGuildBossHero(placements, { cellKey: "0:0", championId: "hero-a", direction: "N" });
assert.deepEqual(placements["0:0"], { championId: "hero-a", direction: "N" }, "hero is placed");

placements = placeGuildBossHero(placements, { cellKey: "1:0", championId: "hero-b", direction: "S" });
placements = placeGuildBossHero(placements, { cellKey: "2:0", championId: "hero-a", direction: "E" });
assert.equal(placements["0:0"], undefined, "placing the same hero removes its previous cell");
assert.deepEqual(placements["2:0"], { championId: "hero-a", direction: "E" }, "same hero moved to new cell");
assert.deepEqual(placements["1:0"], { championId: "hero-b", direction: "S" }, "other heroes are preserved");

placements = moveGuildBossHero(placements, { fromCellKey: "2:0", toCellKey: "3:1" });
assert.equal(placements["2:0"], undefined, "move clears previous cell");
assert.deepEqual(placements["3:1"], { championId: "hero-a", direction: "E" }, "move keeps hero direction");

placements = rotateGuildBossHero(placements, "3:1");
assert.equal(placements["3:1"].direction, "S", "rotation advances direction");
placements = rotateGuildBossHero(placements, "3:1", "W");
assert.equal(placements["3:1"].direction, "W", "explicit direction is applied");

placements = removeGuildBossHero(placements, "3:1");
assert.equal(placements["3:1"], undefined, "hero is removed");
assert.ok(placements["1:0"], "removing one hero preserves other cells");

const drafts = normalizeGuildBossDrafts({
  matrice: { placements },
  apocalypse: { "1:1": { champion_id: "hero-c", direction: "O" } },
});
assert.ok(drafts.matrice, "drafts include matrix");
assert.ok(drafts.abysse, "drafts include empty maps");
assert.equal(drafts.apocalypse["1:1"].direction, "W", "draft normalization handles legacy keys");

console.log("Guild boss placement tests passed.");
