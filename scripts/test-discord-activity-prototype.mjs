import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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

console.log("discord activity prototype guards passed");
