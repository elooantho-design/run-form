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
  /isOpenedPreview \|\|[\s\S]*?defense\.has_visible_run/,
  "opened preview cards must keep the eye consultation action available",
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

console.log("gvg current opened toggle guards passed");
