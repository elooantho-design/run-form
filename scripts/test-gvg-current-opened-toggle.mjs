import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../src/components/GvgCurrentTab.jsx", import.meta.url),
  "utf8",
);

assert.match(
  source,
  /function hasOpenRecordStatus\(defense\)[\s\S]*?const value = defense\?\.record_status/,
  "opened defenses must keep record_status as the source of truth",
);

assert.match(
  source,
  /const items = defenses\.filter\([\s\S]*?isActiveGvgDefense\(defense\)/,
  "default bastion counters and grids must keep excluding opened defenses",
);

assert.match(
  source,
  /const \[showOpenedDefenses, setShowOpenedDefenses\] = useState\(false\)/,
  "opened-defense display must default to off and stay local to GvG current",
);

assert.doesNotMatch(
  source,
  /(?:localStorage|sessionStorage)\.(?:getItem|setItem)\("showOpenedDefenses"/,
  "opened-defense toggle must not be persisted",
);

assert.match(
  source,
  /const sourceDefenses = showOpenedDefenses\s*\?\s*selectedBastionAllDefenses\s*:\s*selectedBastion\.defenses/,
  "mobile/list rendering must use all defenses only when the toggle is on",
);

assert.match(
  source,
  /showOpenedDefenses &&[\s\S]*?shouldShowOpenedDefenseForCurrentFilter\(slotDefense, selectedFilter\)[\s\S]*?renderDefenseCard\(slotDefense, key, \{ isOpenedPreview: true \}\)/,
  "desktop slots must re-render opened defenses in their original slot only when the toggle is on",
);

assert.match(
  source,
  /pointer-events-none[\s\S]*?gvgCurrent\.openedStamp/,
  "opened stamp must be visual-only and must not block card interactions",
);

assert.match(
  source,
  /isOpenedPreview \|\|[\s\S]*?hasAvailableStrategy\(defense\)/,
  "opened preview cards must keep the eye consultation action available",
);

assert.match(
  source,
  /function getOpenedPreviewStatusClasses\(defense\)[\s\S]*?hasAvailableStrategy\(defense\)[\s\S]*?border-emerald-500\/40 bg-emerald-500\/10[\s\S]*?border-orange-500\/40 bg-orange-500\/10/,
  "opened preview cards must render green when a strategy is available and orange otherwise",
);

assert.doesNotMatch(
  source.match(/function getOpenedPreviewStatusClasses\(defense\)[\s\S]*?\n}\n/)?.[0] || "",
  /blue-500/,
  "opened preview cards must never reuse the blue repro color",
);

assert.match(
  source,
  /!\s*isOpenedPreview \|\| openedPreviewHasStrategy[\s\S]*?isOpenedPreview[\s\S]*?gvgCurrent\.statusStrat[\s\S]*?getStatusLabel\(defense\.status, defense\.repro_by, t\)/,
  "opened preview cards must hide stale action/repro labels while keeping strat available visible",
);

assert.match(
  source,
  /onClick=\{\(\) => openStrategySearch\(defense\)\}/,
  "opened preview cards must keep the existing flexible strategy search action",
);

assert.match(
  source,
  /!\s*isOpenedPreview \? \([\s\S]*?markDefenseAsOpened\(defense\.id\)/,
  "mark-as-open must only be rendered outside opened-preview mode",
);

assert.match(
  source,
  /!\s*isOpenedPreview \? \([\s\S]*?openReproCandidates\(defense\)/,
  "Discord repro candidate action must only be rendered outside opened-preview mode",
);

const toggleHandler = source.match(
  /onClick=\{\(\) => setShowOpenedDefenses\(\(value\) => !value\)\}/,
);
assert.ok(toggleHandler, "toggle handler must be a local state flip only");

assert.doesNotMatch(
  source,
  /gvgCurrent\.viewAllDefenses/,
  "the redundant view-all-defenses button must be removed from GvG current",
);

console.log("gvg current opened toggle guards passed");
