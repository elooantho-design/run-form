import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";
import { getInitialPortalTab } from "../src/lib/gvgLauncher.js";

assert.equal(getInitialPortalTab("?gvgLauncher=manual"), "launcher");
assert.equal(getInitialPortalTab("?gvgLauncher=other"), "home");
assert.equal(getInitialPortalTab(""), "home");
const source = await readFile(new URL("../src/SaasPortal.jsx", import.meta.url), "utf8");
assert.match(source, /getInitialPortalTab\(window.location.search\)/);
assert.match(source, /\(isAdminTab && !isVisibleAdminTab\)/, "deep linking does not bypass existing navigation permissions");
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href);
const output = resolve(process.env.LAUNCHER_TEST_OUTPUT || ".launcher-browser-test");
await mkdir(output, { recursive: true });
const moduleId = "virtual:dynamic-launcher-test";
const fixture = `
  import React from 'react';
  import {createRoot} from 'react-dom/client';
  import {LauncherView} from '/src/SaasPortal.jsx';
  import {PortalLanguageProvider} from '/src/lib/portalLanguage.jsx';
  import '/src/index.css';
  const root=createRoot(document.getElementById('root'));
  window.renderLauncher=(guildCode,id='actor')=>root.render(React.createElement(PortalLanguageProvider,null,React.createElement(LauncherView,{key:id,session:{memberId:id,role:'admin',guildCode}})));
`;
const server = await createServer({
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://no-network.invalid"),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify("isolated-key"),
    "import.meta.env.VITE_API_BASE_URL": JSON.stringify(""),
  },
  server: { host: "127.0.0.1", port: 0 }, plugins: [{
    name: "isolated-launcher", resolveId: id => id === moduleId ? `\0${id}` : null,
    load: id => id === `\0${moduleId}` ? fixture : null,
    configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
      if (req.url !== "/isolated-launcher") return next();
      res.setHeader("content-type", "text/html;charset=utf-8");
      res.end(await vite.transformIndexHtml(req.url, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#09090b;color:white;margin:0;padding:12px"><div id="root"></div><script type="module" src="/@id/__x00__${moduleId}"></script></body></html>`));
    }); },
  }],
});
let browser;
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let guilds = Array.from({ length: 10 }, (_, i) => ({ code: "G" + (i + 1), name: "Guild " + (i + 1) }));
  let status = 200;
  const calls = [], errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const req = route.request(), url = req.url();
    if (url.includes("/api/gvg-server")) {
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", "access-control-allow-headers": "content-type" } });
      const body = req.method() === "POST" ? req.postDataJSON() : null;
      calls.push({ url, body });
      // Deliberately reject before opening any native protocol: browser QA must not start a capture.
      return route.fulfill({ status: body ? 403 : status, json: body || status !== 200 ? { error: "Guilde non autorisee pour cette session." } : { ok: true, guilds },
        headers: { "access-control-allow-origin": origin, "access-control-allow-credentials": "true" } });
    }
    if (url.startsWith(origin)) return route.continue();
    return route.abort();
  });
  await page.goto(origin + "/isolated-launcher");
  await page.waitForFunction(() => typeof window.renderLauncher === "function");
  const render = async (guild, id) => page.evaluate(({ guild, id }) => window.renderLauncher(guild, id), { guild, id });
  const start = page.getByRole("button", { name: "Lancer la capture GVG", exact: true });
  for (const guild of ["G1", "G7", "G8", "G9", "G10"]) {
    await render(guild, "actor-" + guild);
    await page.getByRole("button", { name: `${guild} — Guild ${guild.slice(1)}`, exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: `${guild} — Guild ${guild.slice(1)}`, exact: true }).getAttribute("aria-pressed"), "true");
    assert.equal(await start.isEnabled(), true);
  }
  assert.equal(calls.filter(c => c.body).length, 0, "render/deep link/catalog never creates a session");
  for (const [width, height] of [[1440, 1000], [390, 844]]) {
    await page.setViewportSize({ width, height });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: resolve(output, "launcher-" + width + ".png"), fullPage: true });
  }
  await page.getByRole("button", { name: "G8 — Guild 8", exact: true }).click();
  await start.click();
  await page.getByText("Guilde non autorisee pour cette session.", { exact: true }).waitFor();
  assert.equal(calls.filter(c => c.body).length, 1);
  assert.equal(calls.find(c => c.body).body.guild, "G8");
  assert.equal(calls.find(c => c.body).body.mode, "g8");
  assert.ok(!calls.some(c => c.url.includes("launcher-status")), "a refused launch starts no polling or native protocol");
  guilds = [{ code: "MAD_G1", name: "MAD" }];
  await render("MAD G1", "mad-admin");
  await page.getByRole("button", { name: /MAD G1/ }).waitFor();
  assert.equal(await page.getByRole("button", { name: /G8/ }).count(), 0);
  for (const denied of [401, 403, 503]) {
    status = denied;
    await render("G8", "denied-" + denied);
    await page.getByText("Guilde non autorisee pour cette session.", { exact: true }).waitFor();
    assert.equal(await start.isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "G1", exact: true }).count(), 0, "no fixed-list fallback");
  }
  assert.deepEqual(errors, []);
  console.log("Dynamic launcher browser OK: manual deep link, G1/G7/G8/G9/G10 selection, foreign-only catalog, loading/401/403/503 fail closed, desktop/mobile, no auto-session or native launch.");
} finally { await browser?.close(); await server.close(); }
