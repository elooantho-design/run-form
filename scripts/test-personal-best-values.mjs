import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

import { buildChampionDisplayMap } from "../src/lib/championDisplay.js";
import {
  getHeroPortraitFileNames,
  getHeroPortraitImageSources,
  normalizeHeroPortraitFileName,
} from "../src/lib/heroPortraits.js";
import { formatPbAverage, normalizePbRawInput } from "../src/lib/personalBestValues.js";

const validInputs = [
  ["92000", 92],
  ["92 000", 92],
  ["92,000", 92],
  ["92.000", 92],
  ["92,00", 92],
  ["138485", 138.485],
  ["138 485", 138.485],
  ["138,485", 138.485],
  ["138,48", 138.48],
  ["920000", 920],
  ["920", 920],
];

for (const [input, expected] of validInputs) {
  assert.equal(normalizePbRawInput(input), expected, `${input} should normalize to ${expected}`);
}

assert.equal(formatPbAverage(normalizePbRawInput("92000")), "92,000");
assert.equal(formatPbAverage(normalizePbRawInput("138485")), "138,485");
assert.ok(Number.isNaN(normalizePbRawInput("")));
assert.ok(Number.isNaN(normalizePbRawInput("abc")));

const heroFiles = new Set(await readdir(new URL("../public/heroes/", import.meta.url)));
const champions = [
  {
    id: 77,
    name: "iovar",
    portal_name: "Iovar",
    english_name: "Iovar",
  },
  {
    id: 33,
    name: "seigneurphineas",
    portal_name: "Phinéas",
    english_name: "Lord Phineas",
  },
  {
    id: 73,
    name: "damealexandra",
    portal_name: "Dame Alexendra",
    english_name: "Lady Alexandra",
  },
  {
    id: 285,
    name: "bayek",
    portal_name: "Bayek",
    english_name: "Bayek",
  },
  {
    id: 197,
    name: "eona",
    portal_name: "Eona",
    english_name: "Eona",
  },
];
const championDisplayMap = buildChampionDisplayMap(champions);

assert.deepEqual(
  getHeroPortraitFileNames("iovar", championDisplayMap),
  ["iovar.png"],
  "simple PB hero resolves to the expected portrait file",
);
assert.ok(heroFiles.has("iovar.png"), "simple PB hero has a local portrait");

assert.ok(
  getHeroPortraitFileNames("seigneurphineas", championDisplayMap).includes("phineas.png"),
  "composed/technical PB hero can fall back through the champion portal name",
);
assert.ok(heroFiles.has("phineas.png"), "portal-name fallback portrait exists locally for Seigneur Phineas");

assert.ok(
  getHeroPortraitFileNames("damealexandra", championDisplayMap).includes("damealexendra.png"),
  "PB portrait resolver includes normalized champion portal names from real data",
);
assert.ok(heroFiles.has("damealexendra.png"), "normalized portal-name portrait exists locally");

assert.equal(
  getHeroPortraitImageSources("bayek", championDisplayMap)[0],
  "/heroes/bayek.png",
  "local project portrait is tried before the VPS URL",
);
assert.ok(heroFiles.has("bayek.png"), "Bayek has a local portrait even if the current VPS URL is missing");

assert.equal(
  getHeroPortraitFileNames("eona", championDisplayMap).some((fileName) => heroFiles.has(fileName)),
  false,
  "heroes without a real portrait stay unresolved and rely on the UI fallback",
);

assert.notEqual(
  normalizeHeroPortraitFileName("valara"),
  normalizeHeroPortraitFileName("valeria"),
  "normalization keeps distinct heroes on distinct portrait keys",
);

const personalBestSource = await readFile(
  new URL("../src/components/PersonalBestTab.jsx", import.meta.url),
  "utf8",
);
assert.match(
  personalBestSource,
  /import HeroPortraitImage from "@\/components\/HeroPortraitImage";/,
  "Personal Best uses the shared hero portrait component",
);
assert.match(
  personalBestSource,
  /buildChampionDisplayMap\(allHeroesData\)/,
  "Personal Best builds the shared champion display map for portrait resolution",
);
assert.doesNotMatch(
  personalBestSource,
  /function getHeroImageUrl|normalizeHeroImageName|buildPublicHeroUrl/,
  "Personal Best no longer keeps a parallel hero portrait URL resolver",
);

console.log("personal best value tests ok");
