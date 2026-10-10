import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import {
  HERO_BOX_PRIORITY_IMAGE_COUNT,
  HERO_CALQUE_THUMBNAIL_QUALITY,
  HERO_CALQUE_THUMBNAIL_WIDTH,
  buildPublicHeroCalqueThumbnailUrl,
  getHeroCalqueThumbnailFileName,
} from "../src/lib/vpsAssets.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const saasPortalSource = fs.readFileSync(path.join(repoRoot, "src", "SaasPortal.jsx"), "utf8");
const thumbnailPath = path.join(repoRoot, "public", "HeroCalc", "thumbs", "Gonkba.webp");
const newHeroFiles = ["Galloway.png", "Garroq.png", "Amelia.png"];

assert.equal(HERO_CALQUE_THUMBNAIL_WIDTH, 320, "hero thumbnails use the expected 320px width");
assert.equal(HERO_CALQUE_THUMBNAIL_QUALITY, 82, "hero thumbnails use the documented WebP quality");
assert.equal(HERO_BOX_PRIORITY_IMAGE_COUNT, 8, "Hero Box keeps only the first 8 images high-priority");
assert.equal(getHeroCalqueThumbnailFileName("Gonkba.png"), "Gonkba.webp");

for (const fileName of newHeroFiles) {
  const thumbnailFileName = getHeroCalqueThumbnailFileName(fileName);
  assert.equal(thumbnailFileName, fileName.replace(/\.png$/u, ".webp"), `${fileName} maps to its WebP thumbnail`);
  assert.equal(
    buildPublicHeroCalqueThumbnailUrl(fileName),
    `https://vps-aad12be0.vps.ovh.net/assets/calques/hero-calques/thumbs/${thumbnailFileName}`,
    `${fileName} thumbnail uses the public VPS thumbs path`,
  );
}

assert.equal(
  buildPublicHeroCalqueThumbnailUrl("Gonkba.png"),
  "https://vps-aad12be0.vps.ovh.net/assets/calques/hero-calques/thumbs/Gonkba.webp",
  "normal runtime points Hero Box thumbnails at the VPS thumbs folder",
);

assert.equal(
  buildPublicHeroCalqueThumbnailUrl("Gonkba.png", {
    location: "https://1552374112159277217.discordsays.com/portal?frame_id=f1&instance_id=i1&platform=desktop",
    discordClientId: "1552374112159277217",
  }),
  "/vps-assets/assets/calques/hero-calques/thumbs/Gonkba.webp",
  "Discord Activity maps Hero Box thumbnails through /vps-assets",
);

assert.match(
  saasPortalSource,
  /const thumbnailImage = imageFile \? heroCalqueThumbnailUrl\(imageFile\) : "";/,
  "Hero Box computes a thumbnail URL for each active champion",
);
assert.match(
  saasPortalSource,
  /const originalImage = imageFile \? calqueUrl\("hero", imageFile\) : "";/,
  "Hero Box keeps the original PNG URL available",
);
assert.match(
  saasPortalSource,
  /image: thumbnailImage \|\| originalImage,/,
  "Hero Box prefers the WebP thumbnail and falls back to the original image",
);
assert.match(
  saasPortalSource,
  /fallbackImages: \[\.\.\.new Set\(fallbackImages\.filter\(\(url\) => url && url !== \(thumbnailImage \|\| originalImage\)\)\)\]/,
  "Hero Box stores original PNG fallback URLs without duplicates",
);
assert.match(
  saasPortalSource,
  /visibleHeroes\.slice\(0, HERO_BOX_PRIORITY_IMAGE_COUNT\)/,
  "Hero Box priority list uses the shared priority constant",
);
assert.match(
  saasPortalSource,
  /priority=\{index < HERO_BOX_PRIORITY_IMAGE_COUNT\}/,
  "only the first configured heroes are eager/high-priority",
);
assert.doesNotMatch(
  saasPortalSource,
  /preloadingHeroImagesRef|setLoadedHeroImages|new Image\(\);\s*image\.decoding = "async";/,
  "Hero Box no longer keeps the previous double-preload path",
);
assert.match(
  saasPortalSource,
  /const HeroLayerCard = memo\(function HeroLayerCard/,
  "HeroLayerCard is memoized to reduce rerenders from sibling image loads",
);
assert.match(
  saasPortalSource,
  /const localImageReady = readyImageSrc === imageSrc;/,
  "each card derives image readiness from its own current image URL",
);
assert.match(
  saasPortalSource,
  /heroMatchesSummonFamilyFilter\(hero, state, summonFamilyFilter\)/,
  "summon family filtering still uses the shared helper",
);
assert.match(
  saasPortalSource,
  /async function saveHeroAwakening\(heroId, nextLevel\)/,
  "ownership and awakening save flow remains present",
);
assert.match(saasPortalSource, /"lame-grise": \{ label: "Lame grise", imageFile: "Lame-grise\.png" \}/, "Lame grise faction has a central metadata entry");
assert.match(saasPortalSource, /"lame-grise",\s*"cauchemar"/, "Lame grise appears in the Hero Box faction filter order");
assert.match(saasPortalSource, /image: itemMeta\.imageFile \? calqueUrl\(kind, itemMeta\.imageFile\) : null,/, "faction logos still use the central calque resolver");

assert.equal(fs.existsSync(thumbnailPath), true, "Gonkba thumbnail exists locally");
const thumbnailMetadata = await sharp(thumbnailPath).metadata();
assert.equal(thumbnailMetadata.format, "webp", "generated thumbnails are WebP");
assert.equal(thumbnailMetadata.width, 320, "generated thumbnail has 320px width");
assert.equal(thumbnailMetadata.hasAlpha, true, "generated thumbnail keeps alpha transparency");

for (const fileName of newHeroFiles) {
  const sourcePath = path.join(repoRoot, "public", "hero-calques", fileName);
  const thumbPath = path.join(repoRoot, "public", "HeroCalc", "thumbs", getHeroCalqueThumbnailFileName(fileName));
  assert.equal(fs.existsSync(sourcePath), true, `${fileName} source PNG exists locally`);
  assert.equal(fs.existsSync(thumbPath), true, `${fileName} thumbnail exists locally`);

  const metadata = await sharp(thumbPath).metadata();
  assert.equal(metadata.format, "webp", `${fileName} thumbnail is WebP`);
  assert.equal(metadata.width, 320, `${fileName} thumbnail has 320px width`);
  assert.equal(metadata.hasAlpha, true, `${fileName} thumbnail keeps alpha transparency`);
}

console.log("hero box thumbnail tests ok");
