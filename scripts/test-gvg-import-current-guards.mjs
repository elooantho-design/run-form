import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const importSource = await readFile(new URL("../api/gvg-import.js", import.meta.url), "utf8");

assert.match(
  importSource,
  /async function ensureGvgImportSideIsEmpty\(guild, isAlly\)/,
  "gvg import must check the current guild and side before inserting",
);
assert.match(
  importSource,
  /\.select\("id", \{ count: "exact", head: true \}\)/,
  "duplicate guard must use a count-only Supabase read",
);
assert.match(importSource, /\.eq\("guild", guild\)/, "duplicate guard must be scoped to the target guild");
assert.match(importSource, /query = query\.eq\("is_ally", true\)/, "ally imports must only block existing ally rows");
assert.match(
  importSource,
  /query = query\.or\("is_ally\.is\.false,is_ally\.is\.null"\)/,
  "enemy imports must block existing enemy rows, including legacy null values",
);
assert.match(importSource, /conflict\.statusCode = 409/, "duplicate imports must return a conflict");
assert.equal(
  [...importSource.matchAll(/await ensureGvgImportSideIsEmpty\(normalizedGuild, isAlly\)/g)].length,
  2,
  "duplicate guard must protect both direct gvg-import and gvg-server helper imports",
);

const currentSource = await readFile(new URL("../src/components/GvgCurrentTab.jsx", import.meta.url), "utf8");

assert.match(
  currentSource,
  /const defense = selectedBastion\.defenses\.find/,
  "GVG current desktop slots must prefer active defenses",
);
assert.match(
  currentSource,
  /const slotDefense = defense \|\| selectedBastionAllDefenses\.find/,
  "opened ally rows can only be used as placeholder context after active rows",
);
assert.match(
  currentSource,
  /slotDefense && hasOpenRecordStatus\(slotDefense\)/,
  "opened placeholders must not hide a later active enemy defense in the same slot",
);

console.log("gvg import/current guards passed");
