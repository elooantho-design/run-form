import assert from "node:assert/strict";
import fs from "node:fs";

import {
  SUMMON_FAMILY_FILTERS,
  getChampionSummonFamily,
  heroMatchesSummonFamilyFilter,
  isNascentSummonHero,
  normalizeSummonFamily,
} from "../src/lib/portalChampions.js";

const unowned = { owned: false, awakening: -1 };
const ownedA0 = { owned: true, awakening: 0 };
const ownedA5 = { owned: true, awakening: 5 };

const blueLegendary = { id: "blue-legendary", rarity: "legendary", summonFamily: "blue", roles: ["mage"], factions: ["sentinelle"] };
const blueEpic = { id: "blue-epic", rarity: "epic", summonFamily: "blue", roles: ["mage"], factions: ["sentinelle"] };
const ancientLegendary = { id: "ancient", rarity: "legendary", summonFamily: "ancient", roles: ["mage"], factions: ["sentinelle"] };
const eventLegendary = { id: "event", rarity: "legendary", summonFamily: "event", roles: ["tank"], factions: ["infernal"] };

assert.equal(normalizeSummonFamily("blue"), "blue");
assert.equal(normalizeSummonFamily("Bleu"), "blue");
assert.equal(normalizeSummonFamily("Événement"), "event");
assert.equal(normalizeSummonFamily("unknown"), "");
assert.equal(getChampionSummonFamily({ summon_family: "exclusive" }), "exclusive");
assert.equal(getChampionSummonFamily({ summonFamily: "collab" }), "collab");

assert.deepEqual(
  SUMMON_FAMILY_FILTERS,
  ["nascent", "ancient", "exclusive", "collab", "event"],
  "public family filters expose Naissante but no raw Bleu button",
);

assert.equal(isNascentSummonHero(blueLegendary, unowned), true, "Naissante includes unowned legendary blue heroes");
assert.equal(isNascentSummonHero(blueLegendary, ownedA0), false, "A0 means owned and excludes from Naissante");
assert.equal(isNascentSummonHero(blueLegendary, ownedA5), false, "owned A5 excludes from Naissante");
assert.equal(isNascentSummonHero(blueEpic, unowned), false, "Naissante is legendary-only");
assert.equal(isNascentSummonHero(ancientLegendary, unowned), false, "Naissante does not include non-blue families");

assert.equal(heroMatchesSummonFamilyFilter(blueLegendary, unowned, "nascent"), true);
assert.equal(heroMatchesSummonFamilyFilter(blueLegendary, ownedA0, "nascent"), false);
assert.equal(heroMatchesSummonFamilyFilter(ancientLegendary, unowned, "ancient"), true);
assert.equal(heroMatchesSummonFamilyFilter(ancientLegendary, ownedA5, "ancient"), true, "Ancien ignores ownership");
assert.equal(heroMatchesSummonFamilyFilter(eventLegendary, unowned, "event"), true, "Evenement ignores ownership");
assert.equal(heroMatchesSummonFamilyFilter(eventLegendary, ownedA5, "event"), true, "Evenement keeps owned heroes visible");

function matchesCombinedFilters(hero, state, filters) {
  return (
    (filters.rarity === "all" || hero.rarity === filters.rarity) &&
    (filters.role === "all" || hero.roles.includes(filters.role)) &&
    (filters.faction === "all" || hero.factions.includes(filters.faction)) &&
    heroMatchesSummonFamilyFilter(hero, state, filters.summonFamily)
  );
}

assert.equal(
  matchesCombinedFilters(eventLegendary, ownedA5, {
    rarity: "legendary",
    role: "tank",
    faction: "infernal",
    summonFamily: "event",
  }),
  true,
  "summon family filter remains cumulative with rarity, role and faction",
);
assert.equal(
  matchesCombinedFilters(eventLegendary, ownedA5, {
    rarity: "legendary",
    role: "mage",
    faction: "infernal",
    summonFamily: "event",
  }),
  false,
  "role filter still narrows family results",
);

const saasPortalSource = fs.readFileSync(new URL("../src/SaasPortal.jsx", import.meta.url), "utf8");
assert.match(saasPortalSource, /summonFamily:\s*getChampionSummonFamily\(champion\)/, "Hero Box card model carries summon_family");
assert.match(saasPortalSource, /family\) => family !== "blue"/, "Hero Box hides the raw Bleu family button");
assert.match(saasPortalSource, /heroMatchesSummonFamilyFilter\(hero, state, summonFamilyFilter\)/, "Hero Box uses the shared family filter helper");
assert.match(saasPortalSource, /function resetHeroFilters\(\)[\s\S]*setSummonFamilyFilter\("all"\)/, "Hero Box reset clears the summon family filter");
assert.match(saasPortalSource, /adminChampions\.summonFamilyBlue/, "admin form keeps Bleu selectable for champion metadata");

const portalChampionsApiSource = fs.readFileSync(new URL("../api/portal-champions.js", import.meta.url), "utf8");
assert.match(portalChampionsApiSource, /ALLOWED_SUMMON_FAMILIES/, "champion API validates summon family values");
assert.match(portalChampionsApiSource, /summon_family:\s*summonFamily \|\| null/, "champion API stores canonical summon_family or NULL");

const portalPlayerDataSource = fs.readFileSync(new URL("../api/portal-player-data.js", import.meta.url), "utf8");
assert.match(portalPlayerDataSource, /from\("champions"\)\.select\("\*"\)/, "Hero Box base data loads champion metadata without N+1");

console.log("hero box summon family tests ok");
