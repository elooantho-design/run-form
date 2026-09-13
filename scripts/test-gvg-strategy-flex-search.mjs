import assert from "node:assert/strict";
import {
  buildGvgStrategyCriteriaFromHeroes,
  compareGvgStrategySearchResults,
  gvgStrategyHasBijectiveMatch,
  inferGvgStrategyMapType,
} from "../src/lib/gvgStrategySearch.js";

const sourceHeroes = [
  { champion: "A", position: "A1", direction: "E" },
  { champion: "B", position: "A2", direction: "S" },
  { champion: "C", position: "A3", direction: "N" },
  { champion: "D", position: "A4", direction: "O" },
  { champion: "E", position: "A5", direction: "E" },
];

const exactCandidate = [
  { champion: "E", position: "A5", direction: "E" },
  { champion: "C", position: "A3", direction: "N" },
  { champion: "A", position: "A1", direction: "E" },
  { champion: "D", position: "A4", direction: "O" },
  { champion: "B", position: "A2", direction: "S" },
];

assert.equal(
  gvgStrategyHasBijectiveMatch(buildGvgStrategyCriteriaFromHeroes(sourceHeroes), exactCandidate),
  true,
  "all criteria checked match the exact same 5 hero/position/direction slots regardless of row order",
);

assert.equal(
  gvgStrategyHasBijectiveMatch(
    buildGvgStrategyCriteriaFromHeroes(sourceHeroes, "tower", [{ matchChampion: false }]),
    [
      { champion: "Corneline", position: "A1", direction: "E" },
      ...exactCandidate.filter((slot) => slot.champion !== "A"),
    ],
  ),
  true,
  "unchecked hero accepts any champion while keeping position and direction",
);

assert.equal(
  gvgStrategyHasBijectiveMatch(
    buildGvgStrategyCriteriaFromHeroes(sourceHeroes, "tower", [null, { matchPosition: false }]),
    [
      exactCandidate[0],
      exactCandidate[1],
      exactCandidate[2],
      exactCandidate[3],
      { champion: "B", position: "B4", direction: "S" },
    ],
  ),
  true,
  "unchecked position keeps hero and direction but allows any position",
);

assert.equal(
  gvgStrategyHasBijectiveMatch(
    buildGvgStrategyCriteriaFromHeroes(sourceHeroes, "tower", [null, null, { matchDirection: false }]),
    [
      exactCandidate[0],
      exactCandidate[2],
      exactCandidate[3],
      exactCandidate[4],
      { champion: "C", position: "A3", direction: "S" },
    ],
  ),
  true,
  "unchecked direction keeps hero and position but allows any direction",
);

assert.equal(
  gvgStrategyHasBijectiveMatch(
    buildGvgStrategyCriteriaFromHeroes(sourceHeroes, "tower", [
      null,
      null,
      null,
      { matchChampion: false, matchPosition: false, matchDirection: false },
    ]),
    [
      exactCandidate[0],
      exactCandidate[1],
      exactCandidate[2],
      exactCandidate[4],
      { champion: "Wildcard", position: "G10", direction: "N" },
    ],
  ),
  true,
  "three unchecked criteria make one source line fully wildcard",
);

const duplicateSource = [
  { champion: "Alpha", position: "A1", direction: "E" },
  { champion: "Beta", position: "A1", direction: "E" },
];
const duplicateCriteria = buildGvgStrategyCriteriaFromHeroes(duplicateSource, "tower", [
  { matchChampion: false },
  { matchChampion: false },
]);

assert.equal(
  gvgStrategyHasBijectiveMatch(duplicateCriteria, [
    { champion: "OnlyOne", position: "A1", direction: "E" },
    { champion: "Other", position: "A2", direction: "E" },
  ]),
  false,
  "one candidate slot cannot satisfy two source lines",
);

assert.equal(
  gvgStrategyHasBijectiveMatch(duplicateCriteria, [
    { champion: "First", position: "A1", direction: "E" },
    { champion: "Second", position: "A1", direction: "E" },
  ]),
  true,
  "two compatible candidate slots can satisfy two source lines bijectively",
);

assert.equal(inferGvgStrategyMapType({ def_key: "b2_fort_team1" }, []), "fortress");
assert.equal(inferGvgStrategyMapType({ def_key: "b2_t3_team1" }, []), "tower");
assert.equal(inferGvgStrategyMapType({}, [{ position: "H11" }]), "fortress");

const sorted = [
  { strat_id: 1, likes_count: 0, created_at: "2026-09-04T10:00:00.000Z" },
  { strat_id: 2, likes_count: 5, created_at: "2026-08-20T10:00:00.000Z" },
  { strat_id: 3, likes_count: 0, created_at: "2026-09-12T10:00:00.000Z" },
  { strat_id: 4, likes_count: 2, created_at: "2026-09-13T10:00:00.000Z" },
].sort(compareGvgStrategySearchResults);

assert.deepEqual(
  sorted.map((item) => item.strat_id),
  [2, 4, 3, 1],
  "results sort by likes desc, then date desc",
);

console.log("gvg flexible strategy search tests passed");
