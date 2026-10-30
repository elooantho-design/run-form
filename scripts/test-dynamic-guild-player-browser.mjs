import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";

if (!process.env.PLAYWRIGHT_MODULE_PATH) throw new Error("PLAYWRIGHT_MODULE_PATH required");
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href);
const output = resolve(process.env.IDENTITY_TEST_OUTPUT || ".identity-browser-test");
await mkdir(output, { recursive: true });
const moduleId = "virtual:identity-test";
const fixture = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { HeroBoxView } from '/src/SaasPortal.jsx';
  import PB from '/src/components/PersonalBestTab.jsx';
  import Demons from '/src/components/DemonMonstersTab.jsx';
  import Stones from '/src/components/SoulStonesTab.jsx';
  import { PortalLanguageProvider } from '/src/lib/portalLanguage.jsx';
  import '/src/index.css';
  const root=createRoot(document.getElementById('root'));
  window.showIdentityTest=(session,view)=>root.render(
    React.createElement(PortalLanguageProvider,null,
      React.createElement({box:HeroBoxView,pb:PB,demons:Demons,stones:Stones}[view],{session,key:view+session.memberId})))
`;
const id = n => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const roster = [
  { id: id(1), watcher_name: "2G4X", guild_code: "G1" },
  { id: id(2), watcher_name: "Alice G8", guild_code: "G8" },
  { id: id(3), watcher_name: "Bob G8", guild_code: "G8" },
  { id: id(4), watcher_name: "Chloe G9", guild_code: "G9" },
  { id: id(5), watcher_name: "Dana G10", guild_code: "G10" },
];
const champion = { id: 101, name: "Elowyn", portal_name: "Elowyn", english_name: "Elowyn", rarity: "legendary", lord: "non-lord" };
const server = await createServer({
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://no-network.invalid"),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify("isolated-test-key"),
    "import.meta.env.VITE_API_BASE_URL": JSON.stringify(""),
  },
  server: { host: "127.0.0.1", port: 0 },
  plugins: [{
    name: "isolated-player-identity",
    resolveId(value) { return value === moduleId ? `\0${moduleId}` : null; },
    load(value) { return value === `\0${moduleId}` ? fixture : null; },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (req.url !== "/identity-test") return next();
        res.setHeader("content-type", "text/html;charset=utf-8");
        res.end(await vite.transformIndexHtml(req.url, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:12px;background:#09090b;color:white"><div id="root"></div><script type="module" src="/@id/__x00__${moduleId}"></script></body></html>`));
      });
    },
  }],
});
let browser;
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], calls = [], blocked = [];
  let actor = roster[1], broken = "", delay = 0;
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const url = route.request().url();
    if (url.includes("/api/portal-player-data")) {
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", "access-control-allow-headers": "content-type" } });
      const body = route.request().postDataJSON();
      const current = actor, currentBroken = broken;
      calls.push({ actor: current.id, ...body });
      const members = roster.filter(m => currentBroken !== "missing" || m.id !== current.id)
        .filter(m => body.action !== "personalBest" || m.guild_code === body.guildCode)
        .map(m => ({ ...m, permissions: { canEdit: m.id === current.id } }));
      const selectedId = body.memberId || current.id;
      const data = { ok: true, actorMemberId: currentBroken === "wrongActor" ? roster[0].id : current.id, members };
      if (body.action === "heroBoxBase") Object.assign(data, { champions: [champion] });
      else if (body.action === "heroAwakenings") Object.assign(data, { memberId: selectedId, awakenings: [{ champion_id: 101, awakening_level: Number(selectedId.slice(-1)) - 1 }] });
      else if (body.action === "personalBest") Object.assign(data, { champions: [champion], entries: members.map(m => ({ id: "pb-" + m.id, member_id: m.id, slot_index: 1, pb_raw: Number(m.id.slice(-1)) * 10000, champion_id: 101, champions: champion })) });
      else if (body.action === "demonicMonsters") Object.assign(data, { selectedMemberId: selectedId, monsters: [{ id: "monster", name: "Test demon", slug: "test", rarity: "rare" }], entries: [{ member_id: selectedId, monster_id: "monster", level: Number(selectedId.slice(-1)) + 10 }] });
      else if (body.action === "soulStones") Object.assign(data, { selectedMemberId: selectedId, stones: [], rankingRows: [] });
      else assert.fail("Unexpected player operation: " + body.action);
      if (delay) await new Promise(r => setTimeout(r, delay));
      return route.fulfill({ status: 200, json: data, headers: { "access-control-allow-origin": origin, "access-control-allow-credentials": "true" } });
    }
    if (url.includes("/api/")) return route.fulfill({ status: 200, json: { ok: true } });
    if (url.startsWith(origin)) return route.continue();
    blocked.push(url); return route.abort();
  });
  await page.goto(origin + "/identity-test");
  await page.waitForFunction(() => typeof window.showIdentityTest === "function");
  const show = async (member, view) => {
    actor = member;
    await page.evaluate(({ member, view }) => window.showIdentityTest({ memberId: member.id, guildCode: member.guild_code, watcherName: member.watcher_name, role: "membre", organizationKey: "paladin" }, view), { member, view });
  };
  for (const member of roster.slice(1)) {
    await show(member, "box");
    await page.locator(".hero-box-player-current strong", { hasText: member.watcher_name }).waitFor();
    await page.waitForFunction(n => document.querySelectorAll(".hero-layer-stars .is-active").length === n, Number(member.id.slice(-1)) - 1);
    assert.equal(await page.locator(".hero-box-readonly-note.can-edit").count(), 1);
    for (const view of ["pb", "demons", "stones"]) {
      const from = calls.length;
      await show(member, view);
      await page.getByText(member.watcher_name, { exact: true }).first().waitFor();
      const action = { pb: "personalBest", demons: "demonicMonsters", stones: "soulStones" }[view];
      await page.waitForFunction(() => !document.body.innerText.includes("Chargement"));
      const request = calls.slice(from).find(c => c.action === action);
      assert.ok(request, view + " request made");
      assert.equal(view === "pb" ? request.guildCode : request.memberId, view === "pb" ? member.guild_code : member.id);
    }
  }
  assert.ok(!calls.some(c => c.action === "heroAwakenings" && c.memberId === roster[0].id), "never defaults to 2G4X");
  // Explicit browsing is still supported, but never grants edit access to another account.
  await show(roster[1], "box");
  await page.locator(".hero-box-player-current strong", { hasText: "Alice G8" }).waitFor();
  await page.locator(".hero-box-player-results button", { hasText: "Bob G8" }).click();
  await page.locator(".hero-box-player-current strong", { hasText: "Bob G8" }).waitFor();
  assert.equal(await page.locator(".hero-box-readonly-note.is-readonly").count(), 1);
  for (const problem of ["missing", "wrongActor"]) {
    broken = problem;
    for (const view of ["box", "pb", "demons", "stones"]) {
      await show(roster[4], view);
      await page.getByText(/Compte joueur introuvable/).waitFor();
      assert.equal(await page.locator(".hero-box-player-current strong", { hasText: "2G4X" }).count(), 0);
    }
  }
  broken = "";
  delay = 250;
  await show(roster[1], "box");
  await show(roster[2], "box");
  await page.locator(".hero-box-player-current strong", { hasText: "Bob G8" }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".hero-layer-stars .is-active").length === 2);
  delay = 0;
  for (const [width, height] of [[1440, 1000], [390, 844]]) {
    await page.setViewportSize({ width, height });
    for (const view of ["box", "pb", "demons", "stones"]) {
      await show(roster[4], view);
      await page.getByText("Dana G10", { exact: true }).first().waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${view}: no page overflow at ${width}`);
      await page.screenshot({ path: resolve(output, `${view}-${width}.png`), fullPage: true });
    }
  }
  assert.deepEqual(errors, []);
  assert.ok(blocked.every(url => !url.includes("/rest/v1/")), "no direct database request");
  console.log(`Dynamic guild browser tests OK: 4 real screens, G8/G9/G10, 2 G8 accounts, explicit read-only browsing, unresolved identity, delayed response, desktop/mobile; ${calls.length} mocked API calls.`);
} finally {
  await browser?.close();
  await server.close();
}
