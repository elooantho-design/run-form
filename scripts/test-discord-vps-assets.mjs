import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildPublicCalqueUrl,
  resolvePublicAssetProxyUrl,
  resolveVpsAssetUrlForRuntime,
} from "../src/lib/vpsAssets.js";
import { isDiscordActivityRuntime } from "../src/lib/discordActivity.js";

const discordClientId = "1552374112159277217";
const discordLocation = `https://${discordClientId}.discordsays.com/portal?frame_id=f1&instance_id=i1&platform=desktop`;
const discordAndroidLocation = `https://${discordClientId}.discordsays.com/portal?frame_id=f1&instance_id=i1&platform=android`;
const discordIosLocation = `https://${discordClientId}.discordsays.com/portal?frame_id=f1&instance_id=i1&platform=ios`;
const normalLocation = "https://run-form-tau.vercel.app/portal";
const supabasePublicUrl = "https://axxvzhsbagtksbhngrbe.supabase.co";
const supabaseDefenseImageUrl = `${supabasePublicUrl}/storage/v1/object/public/defense-images/test.webp`;

assert.equal(
  isDiscordActivityRuntime(discordLocation, { clientId: discordClientId }),
  true,
  "exact discordsays Activity host is detected",
);

assert.equal(
  isDiscordActivityRuntime(discordAndroidLocation, { clientId: discordClientId }),
  true,
  "Android Discord Activity uses the same runtime detection as desktop",
);

assert.equal(
  isDiscordActivityRuntime(discordIosLocation, { clientId: discordClientId }),
  true,
  "iOS Discord Activity uses the same runtime detection as desktop",
);

assert.equal(
  isDiscordActivityRuntime(normalLocation, { clientId: discordClientId }),
  false,
  "normal browser host is not treated as Discord Activity",
);

assert.equal(
  resolveVpsAssetUrlForRuntime("https://vps-aad12be0.vps.ovh.net/assets/foo.png", {
    location: normalLocation,
    discordClientId,
  }),
  "https://vps-aad12be0.vps.ovh.net/assets/foo.png",
  "normal browser keeps absolute VPS URLs",
);

assert.equal(
  resolveVpsAssetUrlForRuntime("https://vps-aad12be0.vps.ovh.net/assets/foo.png", {
    location: discordLocation,
    discordClientId,
  }),
  "/vps-assets/assets/foo.png",
  "Discord Activity maps known VPS assets to the configured URL mapping prefix",
);

assert.equal(
  resolveVpsAssetUrlForRuntime("https://vps-aad12be0.vps.ovh.net/assets/foo.png?v=123#sprite", {
    location: discordLocation,
    discordClientId,
  }),
  "/vps-assets/assets/foo.png?v=123#sprite",
  "Discord Activity mapping preserves query strings and hashes",
);

assert.equal(
  resolveVpsAssetUrlForRuntime("https://example.com/foo.png", {
    location: discordLocation,
    discordClientId,
  }),
  "https://example.com/foo.png",
  "external domains are not rewritten",
);

assert.equal(
  resolveVpsAssetUrlForRuntime("https://vps-aad12be0.vps.ovh.net.evil.com/foo.png", {
    location: discordLocation,
    discordClientId,
  }),
  "https://vps-aad12be0.vps.ovh.net.evil.com/foo.png",
  "spoofed VPS-like domains are not rewritten",
);

assert.equal(
  resolveVpsAssetUrlForRuntime("/heroes/eivor.png", {
    location: discordLocation,
    discordClientId,
  }),
  "/heroes/eivor.png",
  "relative URLs are not rewritten",
);

assert.equal(
  resolveVpsAssetUrlForRuntime(
    "https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/avatar.png",
    { location: discordLocation, discordClientId },
  ),
  "/vps-assets/assets/profile-cosmetics/avatars/avatar.png",
  "Supabase cosmetic avatar URLs are mapped in Discord Activity",
);

assert.equal(
  resolveVpsAssetUrlForRuntime(
    "https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/frame.png",
    { location: discordLocation, discordClientId },
  ),
  "/vps-assets/assets/profile-cosmetics/frames/frame.png",
  "Supabase cosmetic frame URLs are mapped in Discord Activity",
);

assert.equal(
  resolvePublicAssetProxyUrl("https://vps-aad12be0.vps.ovh.net/assets/test.png", {
    location: normalLocation,
    discordClientId,
  }),
  "https://vps-aad12be0.vps.ovh.net/assets/test.png",
  "normal browser keeps direct VPS defense asset URLs unchanged through the public proxy resolver",
);

assert.equal(
  resolvePublicAssetProxyUrl("https://vps-aad12be0.vps.ovh.net/assets/test.png", {
    location: discordLocation,
    discordClientId,
  }),
  "/vps-assets/assets/test.png",
  "Discord Activity maps direct VPS defense asset URLs through the public proxy resolver",
);

assert.equal(
  resolvePublicAssetProxyUrl("/api/gvg-server?action=preview&guild=G1&jobId=job123&file=defense.png", {
    location: normalLocation,
    discordClientId,
  }),
  "https://vps-aad12be0.vps.ovh.net/public/jobs/g1/job123/previews/defense.png",
  "normal browser maps defense preview API URLs to public VPS preview URLs",
);

assert.equal(
  resolvePublicAssetProxyUrl("/api/gvg-server?action=preview&guild=G1&jobId=job123&file=defense.png", {
    location: discordLocation,
    discordClientId,
  }),
  "/vps-assets/public/jobs/g1/job123/previews/defense.png",
  "Discord Activity maps defense preview API URLs to the configured VPS assets prefix",
);

assert.equal(
  resolvePublicAssetProxyUrl(supabaseDefenseImageUrl, {
    location: normalLocation,
    discordClientId,
    supabasePublicUrl,
  }),
  supabaseDefenseImageUrl,
  "normal browser keeps Supabase defense image URLs unchanged",
);

assert.equal(
  resolvePublicAssetProxyUrl(supabaseDefenseImageUrl, {
    location: discordLocation,
    discordClientId,
    supabasePublicUrl,
  }),
  "/supabase-storage/storage/v1/object/public/defense-images/test.webp",
  "Discord Activity maps Supabase defense image URLs to the configured storage prefix",
);

assert.equal(
  resolvePublicAssetProxyUrl(`${supabaseDefenseImageUrl}?t=123#x`, {
    location: discordLocation,
    discordClientId,
    supabasePublicUrl,
  }),
  "/supabase-storage/storage/v1/object/public/defense-images/test.webp?t=123#x",
  "Discord Activity Supabase mapping preserves query strings and hashes",
);

assert.equal(
  resolvePublicAssetProxyUrl(`${supabasePublicUrl}/storage/v1/object/public/other-bucket/test.webp`, {
    location: discordLocation,
    discordClientId,
    supabasePublicUrl,
  }),
  `${supabasePublicUrl}/storage/v1/object/public/other-bucket/test.webp`,
  "Discord Activity does not map other Supabase buckets",
);

assert.equal(
  resolvePublicAssetProxyUrl("https://axxvzhsbagtksbhngrbe.supabase.co.evil.com/storage/v1/object/public/defense-images/test.webp", {
    location: discordLocation,
    discordClientId,
    supabasePublicUrl,
  }),
  "https://axxvzhsbagtksbhngrbe.supabase.co.evil.com/storage/v1/object/public/defense-images/test.webp",
  "spoofed Supabase-like domains are not rewritten",
);

assert.equal(
  buildPublicCalqueUrl("hero", "Bayek.png"),
  "https://vps-aad12be0.vps.ovh.net/assets/calques/hero-calques/Bayek.png",
  "server/no-window context still builds absolute VPS calque URLs",
);

const rendererSource = await readFile(
  new URL("../src/components/ProfileCosmeticRenderer.jsx", import.meta.url),
  "utf8",
);
assert.match(
  rendererSource,
  /resolveVpsAssetUrlForRuntime\(asset\?\.url \|\| asset\?\.assetUrl \|\| asset\?\.asset_url \|\| ""\)/,
  "profile cosmetic renderer maps Supabase asset URLs at display time",
);
assert.match(
  rendererSource,
  /const layerUrl = resolveVpsAssetUrlForRuntime\(layer\.url\)/,
  "profile cosmetic animation layers also use the VPS runtime resolver",
);

const myDefensesSource = await readFile(
  new URL("../src/components/MyDefensesTab.jsx", import.meta.url),
  "utf8",
);
assert.match(
  myDefensesSource,
  /import \{ resolvePublicAssetProxyUrl \} from "@\/lib\/vpsAssets";/,
  "My defenses imports the public asset proxy resolver",
);
assert.match(
  myDefensesSource,
  /const imageSrc = resolvePublicAssetProxyUrl\(\s*defense\?\.image \|\| defense\?\.image_url \|\| defense\?\.imageUrl \|\| ""\s*\);/,
  "My defenses maps defense images through the public asset proxy resolver",
);
assert.match(
  myDefensesSource,
  /src=\{resolvePublicAssetProxyUrl\(block\.content\)\}/,
  "My defenses info image blocks also use the public asset proxy resolver",
);

const adminDefensesSource = await readFile(
  new URL("../src/components/AdminDefensesTab.jsx", import.meta.url),
  "utf8",
);
assert.match(
  adminDefensesSource,
  /import \{ resolvePublicAssetProxyUrl \} from "@\/lib\/vpsAssets";/,
  "Admin defenses imports the public asset proxy resolver",
);
assert.doesNotMatch(
  adminDefensesSource,
  /resolveVpsAssetUrlForRuntime/,
  "Admin defenses no longer uses the direct-only VPS resolver for defense images",
);
assert.doesNotMatch(
  adminDefensesSource,
  /src=\{block\.content\}/,
  "Admin defenses image blocks do not render raw defense image URLs",
);

const vpsAssetsSource = await readFile(
  new URL("../src/lib/vpsAssets.js", import.meta.url),
  "utf8",
);
assert.match(
  vpsAssetsSource,
  /const SUPABASE_PUBLIC_URL = String\(import\.meta\.env\?\.VITE_SUPABASE_URL \|\| ""\)\.replace\(\/\\\/\+\$\/, ""\);/,
  "VPS asset resolver derives the Supabase origin from VITE_SUPABASE_URL",
);
assert.match(
  vpsAssetsSource,
  /const SUPABASE_DEFENSE_IMAGES_PUBLIC_PATH_PREFIX = "\/storage\/v1\/object\/public\/defense-images\/";/,
  "Supabase mapping is restricted to the defense-images public bucket path",
);
assert.match(
  vpsAssetsSource,
  /const DISCORD_SUPABASE_STORAGE_PREFIX = "\/supabase-storage";/,
  "Supabase defense images use the configured Discord storage mapping prefix",
);

console.log("discord vps asset mapping guards passed");
