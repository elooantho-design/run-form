import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  getBootstrapRenderPath,
  hasDiscordActivityLaunchParams,
  openExternalUrlForRuntime,
  shouldRenderPortalForDiscordActivityRoot,
} from "../src/lib/discordActivity.js";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const helperSource = await readFile(
  new URL("../src/lib/discordActivity.js", import.meta.url),
  "utf8",
);
const portalSource = await readFile(
  new URL("../src/SaasPortal.jsx", import.meta.url),
  "utf8",
);
const mainSource = await readFile(
  new URL("../src/main.jsx", import.meta.url),
  "utf8",
);

assert.equal(
  packageJson.dependencies?.["@discord/embedded-app-sdk"],
  "^2.5.0",
  "Discord Embedded App SDK must be installed as a frontend dependency",
);

assert.match(
  helperSource,
  /VITE_DISCORD_ACTIVITY_ENABLED/,
  "Discord Activity support must be guarded by a Vite feature flag",
);

assert.match(
  helperSource,
  /VITE_DISCORD_CLIENT_ID/,
  "Discord Activity support must use the public Vite Discord Client ID",
);

assert.match(
  helperSource,
  /import\("@discord\/embedded-app-sdk"\)/,
  "Discord SDK must be dynamically imported only when the feature is enabled",
);

assert.match(
  helperSource,
  /new DiscordSDK\(clientId\)/,
  "Discord SDK must be initialized with the configured Client ID",
);

assert.match(
  helperSource,
  /discordSdk\.ready\(\)/,
  "Discord SDK ready() must be attempted in Activity mode",
);

assert.match(
  helperSource,
  /withTimeout\(/,
  "Discord SDK ready() must not be allowed to block Portal startup indefinitely",
);

assert.doesNotMatch(
  helperSource,
  /\.(?:commands\.)?(?:authorize|authenticate)\(/,
  "Discord OAuth/authentication must not be implemented in the MVP",
);

assert.doesNotMatch(
  helperSource,
  /CLIENT_SECRET|BOT_TOKEN|DISCORD_TOKEN|SECRET/i,
  "Discord Activity frontend helper must not reference Discord secrets",
);

assert.match(
  portalSource,
  /import \{ initDiscordActivity \} from "@\/lib\/discordActivity"/,
  "Portal must import the Discord Activity initializer",
);

assert.match(
  portalSource,
  /useEffect\(\(\) => \{\s*void initDiscordActivity\(\);\s*\}, \[\]\);/,
  "Portal must start Discord Activity initialization without blocking render/auth",
);

assert.doesNotMatch(
  portalSource,
  /VITE_DISCORD_CLIENT_ID|DiscordSDK|commands\.(?:authorize|authenticate)/,
  "Discord Activity details must stay isolated in the helper",
);

assert.equal(
  getBootstrapRenderPath("https://run-form-tau.vercel.app/"),
  "/",
  "Normal browser root must keep the historical root page render path",
);

assert.equal(
  getBootstrapRenderPath("https://run-form-tau.vercel.app/?frame_id=f1&instance_id=i1&platform=desktop"),
  "/portal",
  "Discord desktop Activity root must render Portal without a top-level redirect",
);

assert.equal(
  getBootstrapRenderPath("https://run-form-tau.vercel.app/?frame_id=f1&instance_id=i1&platform=android"),
  "/portal",
  "Discord Android Activity root uses the same Portal render path as desktop",
);

assert.equal(
  getBootstrapRenderPath("https://run-form-tau.vercel.app/?frame_id=f1&instance_id=i1&platform=ios"),
  "/portal",
  "Discord iOS Activity root uses the same Portal render path as desktop",
);

assert.equal(
  getBootstrapRenderPath("https://run-form-tau.vercel.app/portal?frame_id=f1&instance_id=i1&platform=desktop"),
  "/portal",
  "Portal route must render Portal directly without a redirect loop",
);

assert.equal(
  getBootstrapRenderPath("https://run-form-tau.vercel.app/dashboard/G1?frame_id=f1&instance_id=i1&platform=desktop"),
  "/dashboard/G1",
  "Dashboard routes remain internal routes in Discord Activity",
);

assert.equal(
  shouldRenderPortalForDiscordActivityRoot(
    "https://run-form-tau.vercel.app/?frame_id=f1&instance_id=i1&platform=desktop&channel_id=c1#ready",
  ),
  true,
  "Discord Activity root launch is detected while keeping SDK query params on the current URL",
);

assert.equal(
  hasDiscordActivityLaunchParams("frame_id=f1&instance_id=i1"),
  false,
  "Partial Discord query params must not trigger the Activity redirect",
);

assert.match(
  mainSource,
  /getBootstrapRenderPath\(window\.location\)/,
  "Main bootstrap must derive the render path before choosing Portal/dashboard/root",
);

assert.doesNotMatch(
  mainSource,
  /window\.location\.replace/,
  "Discord Activity root launch must not perform a top-level replace navigation",
);

assert.doesNotMatch(
  mainSource,
  /const finalPath = window\.location\.pathname/,
  "Main bootstrap must not depend only on the physical pathname for Discord Activity root launches",
);

const externalCalls = [];
const fakeDiscordSdk = {
  commands: {
    async openExternalLink(args) {
      externalCalls.push(args);
      return { opened: true };
    },
  },
};

assert.deepEqual(
  await openExternalUrlForRuntime("https://discord.com/channels/1/2/3", {
    discordActivity: true,
    discordSdk: fakeDiscordSdk,
    windowRef: {
      location: { href: "https://1552374112159277217.discordsays.com/portal?frame_id=f1&instance_id=i1&platform=android" },
    },
  }),
  { opened: true, mode: "discord", result: { opened: true } },
  "Discord Activity external links must use Discord openExternalLink",
);

assert.deepEqual(
  externalCalls,
  [{ url: "https://discord.com/channels/1/2/3" }],
  "Discord openExternalLink receives the normalized external URL",
);

const blockedDiscordWindowRef = {
  location: { href: "https://1552374112159277217.discordsays.com/portal?frame_id=f1&instance_id=i1&platform=ios" },
};
assert.deepEqual(
  await openExternalUrlForRuntime("https://example.com/outside", {
    discordActivity: true,
    initializeSdk: false,
    windowRef: blockedDiscordWindowRef,
  }),
  { opened: false, mode: "discord-sdk-unavailable" },
  "Discord Activity must not fall back to a direct top-level navigation when the SDK is unavailable",
);
assert.equal(
  blockedDiscordWindowRef.location.href,
  "https://1552374112159277217.discordsays.com/portal?frame_id=f1&instance_id=i1&platform=ios",
  "blocked Discord external links leave the Activity URL unchanged",
);

const browserOpenCalls = [];
await openExternalUrlForRuntime("https://example.com/docs", {
  discordActivity: false,
  newTab: true,
  windowRef: {
    location: { href: "https://run-form-tau.vercel.app/portal" },
    open: (...args) => browserOpenCalls.push(args),
  },
});
assert.deepEqual(
  browserOpenCalls,
  [["https://example.com/docs", "_blank", "noopener,noreferrer"]],
  "normal browsers keep the standard new-tab behavior for external links",
);

const browserWindowRef = { location: { href: "https://run-form-tau.vercel.app/portal" } };
await openExternalUrlForRuntime("https://checkout.stripe.com/test", {
  discordActivity: false,
  windowRef: browserWindowRef,
});
assert.equal(
  browserWindowRef.location.href,
  "https://checkout.stripe.com/test",
  "normal browsers keep same-tab external navigation when requested",
);

console.log("discord activity prototype guards passed");
