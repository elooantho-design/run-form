import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { getRunGridSpec } from "../src/run-config/gridConfig.js";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("ops/gvg-reco/map-calibration-20261025.json", root), "utf8"));

for (const map of manifest.maps) {
  test(`${map.mode}: exact playable crop with no second offset`, async () => {
    const spec = getRunGridSpec(map.mode);
    const bytes = await readFile(new URL(map.asset, root));
    const metadata = await sharp(bytes).metadata();
    assert.equal(spec.rows, map.rows);
    assert.equal(spec.cols, map.cols);
    assert.equal(spec.bgUrl, `/${map.asset.replace(/^public\//, "")}`);
    assert.equal(spec.gridBounds, undefined);
    assert.equal(metadata.width, map.crop.width);
    assert.equal(metadata.height, map.crop.height);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), map.assetSha256);
    const [width, height] = spec.cellAspectRatio.split("/").map(Number);
    assert.ok(Math.abs((width / height) * spec.cols / spec.rows - metadata.width / metadata.height) < 1e-12);
  });

  test(`${map.mode}: every cell round-trips at varied resolutions`, () => {
    const spec = getRunGridSpec(map.mode);
    for (const boardWidth of [250, 320, 390, 768, 1440, 2559, 3840]) {
      const boardHeight = boardWidth * map.crop.height / map.crop.width;
      const cellWidth = boardWidth / spec.cols;
      const cellHeight = boardHeight / spec.rows;
      for (let row = 0; row < spec.rows; row += 1) {
        for (let col = 0; col < spec.cols; col += 1) {
          const x = (col + 0.5) * cellWidth;
          const y = (row + 0.5) * cellHeight;
          const label = `${String.fromCharCode(65 + spec.rows - 1 - row)}${col + 1}`;
          const fromPixels = `${String.fromCharCode(65 + spec.rows - 1 - Math.floor(y / cellHeight))}${Math.floor(x / cellWidth) + 1}`;
          assert.equal(fromPixels, label);
          assert.ok(x > 0 && x < boardWidth && y > 0 && y < boardHeight);
        }
      }
    }
  });
}

test("add, edit and search share the calibrated configuration and cell ratio", async () => {
  for (const name of ["RunAddTab", "RunEditTab", "RunSearchGrid"]) {
    const source = await readFile(fileURLToPath(new URL(`src/components/${name}.jsx`, root)), "utf8");
    assert.match(source, /getRunGridSpec\(mode\)/);
    assert.match(source, /makeRows\(gridSpec.rows\)\.reverse\(\)/);
    assert.match(source, /aspectRatio: gridSpec.cellAspectRatio/);
    assert.match(source, /src=\{gridSpec.bgUrl\}/);
  }
  assert.equal(getRunGridSpec("unknown"), getRunGridSpec("tour"));
});
