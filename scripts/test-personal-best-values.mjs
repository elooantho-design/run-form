import assert from "node:assert/strict";

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

console.log("personal best value tests ok");
