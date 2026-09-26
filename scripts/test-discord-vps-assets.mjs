import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildPublicCalqueUrl,
  resolveVpsAssetUrlForRuntime,
} from "../src/lib/vpsAssets.js";
import { isDiscordActivityRuntime } from "../src/lib/discordActivity.js";

const discordClientId = "1552374112159277217";
const discordLocation = `https://${discordClientId}.discordsays.com/portal?frame_id=f1&instance_id=i1&platform=desktop`;
const normalLocation = "https://run-form-tau.vercel.app/portal";

assert.equal(
  isDiscordActivityRuntime(discordLocation, { clientId: discordClientId }),
  true,
  "exact discordsays Activity host is detected",
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
  /import \{ resolveVpsAssetUrlForRuntime \} from "@\/lib\/vpsAssets";/,
  "My defenses imports the VPS runtime resolver",
);
assert.match(
  myDefensesSource,
  /const imageSrc = resolveVpsAssetUrlForRuntime\(\s*defense\?\.image \|\| defense\?\.image_url \|\| defense\?\.imageUrl \|\| ""\s*\);/,
  "My defenses maps defense images through the VPS runtime resolver",
);
assert.match(
  myDefensesSource,
  /src=\{resolveVpsAssetUrlForRuntime\(block\.content\)\}/,
  "My defenses info image blocks also use the VPS runtime resolver",
);

console.log("discord vps asset mapping guards passed");
