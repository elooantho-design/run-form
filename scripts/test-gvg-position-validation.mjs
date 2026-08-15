import assert from "node:assert/strict";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

const { normalizeGvgPosition } = await import("../api/gvg-strat-search.js");

const cases = [
  ["tower", "A1", "A1"],
  ["tower", "G10", "G10"],
  ["tower", "H1", null],
  ["tower", "A11", null],
  ["tower", "G11", null],
  ["tower", "A12", null],
  ["fortress", "A1", "A1"],
  ["fortress", "H11", "H11"],
  ["fortress", "G10", "G10"],
  ["fortress", "I1", null],
  ["fortress", "A12", null],
  ["fortress", "H12", null],
];

for (const [mapType, position, expected] of cases) {
  assert.equal(
    normalizeGvgPosition(position, mapType),
    expected,
    `${mapType} ${position} should ${expected ? `normalize to ${expected}` : "be rejected"}`
  );
}

console.log("GvG position validation tests passed.");
