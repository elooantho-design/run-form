import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { once } from "node:events";
import sharp from "sharp";
import { prepareDiscordAvatarVps } from "./prepare-discord-avatar-vps.mjs";
import { buildPublicDiscordAvatarUrl } from "../src/lib/vpsAssets.js";

const key = "a".repeat(64), version = "0123456789abcdef";
assert.equal(buildPublicDiscordAvatarUrl(key, version), `https://vps-aad12be0.vps.ovh.net/assets/discord-avatars/${key}.webp?v=${version}`);
assert.equal(buildPublicDiscordAvatarUrl(key, version, { discordActivity: true }), `/vps-assets/assets/discord-avatars/${key}.webp?v=${version}`);
assert.equal(buildPublicDiscordAvatarUrl("../x", version), "");
const root = await mkdtemp(join(tmpdir(), "avatar-package-test-"));
const source = join(root, "source"), output = join(root, "release");
await mkdir(join(source, "app"), { recursive: true });
const main = 'from fastapi import FastAPI\napp = FastAPI()\ndef require_token():\n    return True\n@app.get("/health")\ndef health():\n    return {"ok": True}\n';
await writeFile(join(source, "app/main.py"), main);
await writeFile(join(source, "requirements.txt"), "fastapi==0.124.0\n");
await writeFile(join(source, "runtime-constraints.txt"), "fastapi==0.124.0\n");
const imageId = `sha256:${"b".repeat(64)}`;
await writeFile(join(source, "runtime-api-image-id.txt"), imageId + "\n");
const dockerfile = "FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY app ./app\n";
await writeFile(join(source, "Dockerfile"), dockerfile);
const prepared = await prepareDiscordAvatarVps(source, output);
assert.equal(prepared.sourceMainSha256, createHash("sha256").update(main).digest("hex"));
assert.equal(await readFile(join(source, "app/main.py"), "utf8"), main, "preparation never modifies its source checkout");
assert.ok((await readFile(join(output, "app/main.py"), "utf8")).startsWith(main));
assert.match(await readFile(join(output, "requirements.txt"), "utf8"), /Pillow==12\.3\.0/);
assert.match(await readFile(join(output, "requirements.txt"), "utf8"), /-c avatar-runtime-constraints\.txt/);
assert.equal(await readFile(join(source, "Dockerfile"), "utf8"), dockerfile);
const preparedDockerfile = await readFile(join(output, "Dockerfile"), "utf8");
assert.ok(preparedDockerfile.startsWith(`FROM gvg-paladin-api:pre-discord-avatars-${"b".repeat(64)}\n`));
assert.match(preparedDockerfile, /COPY requirements\.txt avatar-runtime-constraints\.txt \.\//);
assert.doesNotMatch(preparedDockerfile, /apt-get|FROM python:/);
assert.equal(prepared.requiredBaseImageId, imageId);
await assert.rejects(prepareDiscordAvatarVps(source, join(source, "overwrite")), /outside/);
await assert.rejects(prepareDiscordAvatarVps(source, output), /EEXIST/);
const caddy = await readFile(new URL("../ops/discord-avatars/Caddyfile.fragment", import.meta.url), "utf8");
assert.match(caddy, /max-age=60, must-revalidate/);
assert.match(caddy, /handle \/assets\/discord-avatars\/manifest\.json/);
assert.match(caddy, /handle_path \/assets\/discord-avatars\/\*/);
assert.equal((caddy.match(/Cache-Control "no-store"/g) || []).length, 2, "missing manifest and missing images must not inherit the year-long cache");
const avatarPathPattern = new RegExp(caddy.match(/path_regexp cachedDiscordAvatar ([^\r\n]+)/)[1]);
assert.ok(avatarPathPattern.test(`/${key}.webp`));
for (const pathname of [`/${key}.webp.pending.tmp`, "/manifest.json", "/../index.sqlite3", "/123.webp", `/${key}.webp/extra`]) {
  assert.equal(avatarPathPattern.test(pathname), false, `non-avatar file rejected: ${pathname}`);
}
const api = await readFile(new URL("../api/_intersaison-forecast-avatars.js", import.meta.url), "utf8");
assert.doesNotMatch(api, /discord\.com\/api|DISCORD_BOT_TOKEN|DISCORD_DEFENSE_BOT_TOKEN|\.rpc\(|\.from\(/);
const compose = await readFile(new URL("../ops/discord-avatars/compose.avatar-environment.yml", import.meta.url), "utf8");
for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DISCORD_AVATAR_BOT_TOKEN"]) {
  assert.ok(compose.includes(`${name}: \${${name}:?`), `required API environment injected: ${name}`);
}
assert.ok(compose.includes("DISCORD_AVATAR_WORKER_ENABLED: ${DISCORD_AVATAR_WORKER_ENABLED:-0}"));
assert.doesNotMatch(compose, /intersaison-bot|ports:|volumes:|depends_on:/);

if (process.env.PLAYWRIGHT_MODULE_PATH) {
  const require = createRequire(process.env.PLAYWRIGHT_MODULE_PATH);
  const { chromium } = require("playwright");
  const image = await sharp({ create: { width: 64, height: 64, channels: 4, background: "#185a9d" } }).webp().toBuffer();
  let requests = 0, bodies = 0;
  const server = createServer((req, res) => {
    if (req.url.startsWith("/avatar.webp")) {
      requests++;
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.setHeader("ETag", '"avatar-1"');
      res.setHeader("Content-Type", "image/webp");
      if (req.headers["if-none-match"] === '"avatar-1"') { res.writeHead(304); res.end(); return; }
      bodies++;
      if (req.url.includes("v=slow")) setTimeout(() => res.end(image), 1000);
      else res.end(image);
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/html");
    const v = req.url.includes("changed") ? "2" : req.url.includes("slow") ? "slow" : "1";
    res.end(`<html><body><img src="/avatar.webp?v=${v}" width="28" height="28" loading="lazy"><div style="height:6000px"></div><img src="/avatar.webp?v=offscreen" width="28" height="28" loading="lazy"></body></html>`);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
    const base = `http://127.0.0.1:${server.address().port}`;
    const remoteRequests = [];
    page.on("request", (request) => { if (!request.url().startsWith(base)) remoteRequests.push(request.url()); });
    await page.goto(base + "/first");
    await page.locator("img").first().evaluate((el) => el.decode());
    assert.equal(bodies, 1, "offscreen avatar is not transferred");
    await page.goto(base + "/return");
    await page.locator("img").first().evaluate((el) => el.decode());
    assert.equal(bodies, 1, "page return reuses the browser cache");
    await page.reload(); await page.locator("img").first().evaluate((el) => el.decode());
    assert.equal(bodies, 1, "refresh transfers no repeated full image");
    await page.goto(base + "/changed"); await page.locator("img").first().evaluate((el) => el.decode());
    assert.equal(bodies, 2, "a changed version gets a new cache entry");
    await page.goto(base + "/slow", { waitUntil: "domcontentloaded" });
    assert.equal(await page.locator("img").first().isVisible(), true, "layout renders while a slow image is pending");
    assert.equal(await page.locator("img").first().evaluate((el) => el.naturalWidth), 0);
    await page.locator("img").first().evaluate((el) => el.decode());
    assert.equal(bodies, 3);
    assert.deepEqual(remoteRequests, []);
    console.log(JSON.stringify({ browserCache: true, lazyOffscreen: true, immutableHeaders: true, versionRefresh: true, slowImageDoesNotBlockLayout: true, requests, imageTransfers: bodies, noExternalRequests: true }));
  } finally { await browser.close(); server.close(); }
}
console.log("Discord avatar asset and deployment preparation tests passed. No production action.");
