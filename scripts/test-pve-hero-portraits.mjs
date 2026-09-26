import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildChampionDisplayMap } from "../src/lib/championDisplay.js";
import {
  getChampionPortraitFileNames,
  getChampionPortraitImageSources,
  getHeroPortraitFileNames,
  getHeroPortraitImageSources,
  normalizeHeroPortraitFileName,
} from "../src/lib/heroPortraits.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

function assertHeroFileExists(fileName) {
  assert.ok(
    fs.existsSync(path.join(projectRoot, "public", "heroes", fileName)),
    `${fileName} exists in public/heroes`,
  );
}

const champions = [
  { id: 282, name: "eivor", portal_name: "Eivor", english_name: "Eivor" },
  { id: 284, name: "ezio", portal_name: "Ezio", english_name: "Ezio" },
  { id: 286, name: "darkezio", portal_name: "Dark Ezio", english_name: "Dark Ezio" },
  { id: 287, name: "eviefrye", portal_name: "Evie Frye", english_name: "Evie Frye" },
  { id: 285, name: "bayek", portal_name: "Bayek", english_name: "Bayek" },
  { id: 135, name: "aeris", portal_name: "Aeris", english_name: "Aeris" },
  { id: 163, name: "gretchen", portal_name: "Gretchen", english_name: "Gretchen" },
  { id: 81, name: "talinne", portal_name: "Talinne", english_name: "Talin" },
  { id: 10, name: "brokkir", portal_name: "Brokkir", english_name: "Brokkir" },
  { id: 47, name: "capitainereve", portal_name: "Captain Rêve", english_name: "Captain Reve" },
];

const championDisplayMap = buildChampionDisplayMap(champions);
const eivorChampion = champions[0];

assert.equal(normalizeHeroPortraitFileName("Eivor"), "eivor.png");
assert.deepEqual(getChampionPortraitFileNames(eivorChampion), ["eivor.png"]);
assert.deepEqual(getHeroPortraitFileNames("eivor", championDisplayMap), ["eivor.png"]);
assert.deepEqual(
  getHeroPortraitImageSources("eivor", championDisplayMap),
  getChampionPortraitImageSources(eivorChampion),
  "Placement BDG and run editor resolve Eivor through the same portrait sources",
);
assert.equal(getHeroPortraitImageSources("eivor", championDisplayMap)[0], "/heroes/eivor.png");
assertHeroFileExists("eivor.png");

assert.deepEqual(
  getHeroPortraitFileNames("missing hero 2"),
  ["missinghero.png", "missinghero2.png"],
  "unknown heroes keep deterministic fallback filenames instead of aliasing another hero",
);

assert.equal(getHeroPortraitImageSources("brokkir", championDisplayMap)[0], "/heroes/brokkir.png");
assertHeroFileExists("brokkir.png");

assert.deepEqual(
  getHeroPortraitFileNames("capitainereve", championDisplayMap).slice(0, 2),
  ["capitainereve.png", "captainreve.png"],
  "technical names remain preferred before display-name variants",
);

const recentHeroFiles = [
  "ezio.png",
  "darkezio.png",
  "eviefrye.png",
  "bayek.png",
  "aeris.png",
  "gretchen.png",
  "talinne.png",
];

const missingRecentHeroFiles = [];
for (const fileName of recentHeroFiles) {
  const heroName = fileName.replace(/\.png$/, "");
  assert.ok(
    getHeroPortraitFileNames(heroName, championDisplayMap).includes(fileName),
    `${heroName} resolves toward ${fileName}`,
  );

  if (!fs.existsSync(path.join(projectRoot, "public", "heroes", fileName))) {
    missingRecentHeroFiles.push(fileName);
  }
}

console.log("pve hero portrait tests ok", { missingRecentHeroFiles });
