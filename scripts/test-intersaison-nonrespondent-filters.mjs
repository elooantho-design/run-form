import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PALADIN_GUILD_DISPLAY_NAMES } from "../src/lib/guildDisplay.js";
import { buildSurveyChoiceForecast } from "../src/lib/intersaisonSurveyChoices.js";
import { getSurveyTwoNonRespondents } from "../src/lib/intersaisonForecast.js";

globalThis.fetch = () => { throw Error("Real network forbidden in nonrespondent tests"); };
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const guilds = Object.keys(PALADIN_GUILD_DISPLAY_NAMES);
const campaignId = "11111111-1111-4111-8111-111111111111";
const members = guilds.map((code, index) => ({
  id: code, watcher_name: `Nonrespondent ${code}`, guild_code: code,
  discord_id: index === 0 ? "111111111111111111" : index === 1 ? "" : "invalid",
  ...(index === 1 ? { primary_member_id: "G1" } : {}),
}));
members.push({ id: "answered", watcher_name: "Answered", guild_code: "G1" },
  { id: "answered-unassigned", watcher_name: "Answered unassigned", guild_code: "G4" });
const recipients = members.filter((member) => member.id !== "G7").map((member, index) => ({
  id: `r-${member.id}`, member_key: member.id, member_id: member.id, guild_code_snapshot: "G7",
  response_status: member.id === "G1" ? "responded" : "pending",
  delivery_status: ["sent", "queued", "missing_invalid", "excluded", "failed", "confirmed"][index % 6],
  excluded_reason: member.id === "G4" ? "Ambiguous shared account" : null,
}));
recipients.push({ id: "r-inactive", member_key: "inactive", member_name_snapshot: "Inactive", guild_code_snapshot: "G2" });
const forecastInput = {
  members, recipients,
  responses: [
    { id: "answer", survey_recipient_id: "r-answered", poll_number: 2, is_current: true, first_choice_guild_code: "G2" },
    { id: "answer-no-choice", survey_recipient_id: "r-answered-unassigned", poll_number: 2, is_current: true, comment_text: "Historical answer" },
  ],
  placements: [
    { member_key: "G1", revision: 1, action: "set", guild_code: "G7" },
    { member_key: "manual-only", member_name_snapshot: "Manual only", revision: 1, action: "set", guild_code: "G3" },
  ],
};
const forecast = buildSurveyChoiceForecast(forecastInput);
const baseline = structuredClone(forecast);
function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
freeze(forecast);
const duplicatedPlayers = Object.freeze([...forecast.players, forecast.players.find((player) => player.memberKey === "G1")]);
const all = getSurveyTwoNonRespondents(duplicatedPlayers);
assert.equal(all.length, 9);
assert.equal(new Set(all.map((player) => player.memberKey)).size, all.length, "deduplicate by memberKey, not Discord identity");
assert.equal(all.filter((player) => player.discordUserId === "111111111111111111").length, 2, "linked accounts stay separate");
for (const code of ["", ...guilds]) {
  const filtered = getSurveyTwoNonRespondents(duplicatedPlayers, code);
  assert.deepEqual(filtered, all.filter((player) => !code || player.currentGuild === code), `filter ${code || "all"}`);
  assert.equal(new Set(filtered.map((player) => player.memberKey)).size, filtered.length);
}
for (const code of guilds) assert.equal(getSurveyTwoNonRespondents(forecast.players, code).length, 1);
assert.equal(getSurveyTwoNonRespondents(forecast.players, "G8").length, 0);
assert.deepEqual(getSurveyTwoNonRespondents(), []);
assert.equal(getSurveyTwoNonRespondents([{ memberKey: "false-answer", answer: false }]).length, 1);
assert.equal(getSurveyTwoNonRespondents([{ memberKey: "answer-object", answer: {} }]).length, 0);
assert.ok(all.some((player) => player.manual && player.currentGuild === "G1" && player.targetGuild === "G7"));
assert.ok(all.some((player) => player.recipient?.response_status === "responded" && !player.answer));
assert.ok(all.some((player) => player.recipient?.excluded_reason));
assert.ok(all.some((player) => !player.recipient && player.activeNow), "not included in campaign is still visible");
assert.ok(all.some((player) => player.memberKey === "manual-only"));
assert.ok(all.some((player) => player.memberKey === "inactive"));
assert.ok(!getSurveyTwoNonRespondents(forecast.players, "G2").some((player) => player.memberKey === "inactive"), "no snapshot fallback for missing current guild");
assert.ok(!all.some((player) => player.answer));
assert.deepEqual(forecast, baseline, "projection, guild cards, placements and counters are unchanged");
assert.equal(forecast.guilds.reduce((sum, guild) => sum + guild.count, 0) + forecast.unassigned.length, forecast.players.length);

const unassigned = getSurveyTwoNonRespondents(forecast.unassigned);
assert.equal(unassigned.length, 7);
assert.ok(unassigned.every((player) => !player.answer && !player.manual && !player.targetGuild));
assert.ok(!unassigned.some((player) => ["G1", "manual-only", "answered", "answered-unassigned"].includes(player.memberKey)));
assert.ok(unassigned.some((player) => player.memberKey === "G2"), "an unplaced secondary remains visible even when its owner is placed");
assert.ok(forecast.guilds.find((guild) => guild.code === "G7").players.some((player) => player.memberKey === "G1"));
assert.ok(forecast.guilds.find((guild) => guild.code === "G2").players.some((player) => player.memberKey === "answered"));
assert.equal(getSurveyTwoNonRespondents([...forecast.unassigned, ...forecast.unassigned]).length, unassigned.length);
for (const code of ["", ...guilds]) {
  assert.deepEqual(getSurveyTwoNonRespondents(forecast.unassigned, code), unassigned.filter((player) => !code || player.currentGuild === code));
}
const afterRemoval = buildSurveyChoiceForecast({ ...forecastInput, placements: [
  ...forecastInput.placements, { member_key: "G1", revision: 2, action: "remove", guild_code: null },
] });
assert.equal(getSurveyTwoNonRespondents(afterRemoval.unassigned).length, 8);
assert.equal(getSurveyTwoNonRespondents(afterRemoval.unassigned, "G1").length, 1);
assert.equal(getSurveyTwoNonRespondents(afterRemoval.unassigned).filter((player) => player.discordUserId === "111111111111111111").length, 2,
  "removing an owner's placement restores both game accounts independently, not one Discord row");
assert.equal(afterRemoval.players.find((player) => player.memberKey === "G1").manualHistory.length, 2);
assert.deepEqual(getSurveyTwoNonRespondents(afterRemoval.players).map((player) => player.memberKey), all.map((player) => player.memberKey),
  "a placement change affects the display, never the set of survey nonrespondents");
for (const code of guilds) {
  const input = { members: [
    { id: "waiting", watcher_name: "Waiting", guild_code: code },
    { id: "manual", watcher_name: "Manual", guild_code: code },
    { id: "responded", watcher_name: "Responded", guild_code: code },
  ], recipients: [{ id: "response-recipient", member_id: "responded" }],
  responses: [{ survey_recipient_id: "response-recipient", poll_number: 2, is_current: true, first_choice_guild_code: code }],
  placements: [{ member_key: "manual", revision: 1, action: "set", guild_code: code }] };
  const projected = buildSurveyChoiceForecast(input);
  const pending = getSurveyTwoNonRespondents(projected.unassigned, code);
  assert.deepEqual(pending.map((player) => player.memberKey), ["waiting"], `${code}: only the truly unassigned nonrespondent is listed`);
  assert.equal(projected.guilds.find((guild) => guild.code === code).count, 2);
  const removed = buildSurveyChoiceForecast({ ...input, placements: [...input.placements,
    { member_key: "manual", revision: 2, action: "remove" },
    { member_key: "responded", revision: 1, action: "set", guild_code: "G7" },
    { member_key: "responded", revision: 2, action: "remove" },
  ] });
  assert.equal(getSurveyTwoNonRespondents(removed.unassigned, code).length, 2, `${code}: removing a placement restores the nonrespondent`);
  assert.equal(removed.players.find((player) => player.memberKey === "responded").targetGuild, code,
    "removing an answered player's placement falls back to their answer, not the unassigned list");
}
assert.deepEqual(forecast, baseline, "display filtering and removal simulations leave the original projection intact");

const componentPath = join(root, "src/components/IntersaisonSurveyTwoWorkspace.jsx");
const source = await readFile(componentPath, "utf8");
assert.match(source, /getSurveyTwoNonRespondents\(workspace\?\.forecast\?\.unassigned, currentGuildFilter\)/);
assert.match(source, /workspace\.forecast\.guilds\.map/);
assert.match(source, /Sans affectation prévisionnelle \(\{unassignedPlayers\.length\}\)/);
assert.doesNotMatch(source, /unassignedRespondents|filteredNonRespondents|forecast\?\.players, currentGuildFilter/);
assert.equal(source.match(/Relancer tous les sans réponse/g)?.length, 1);
assert.match(source, /aria-label="Guilde actuelle des joueurs sans affectation"/);
assert.match(source, /aria-label="Joueurs sans affectation prévisionnelle"/);
assert.match(source, /<option value="">Toutes les guildes<\/option>/);
assert.match(source, /<DialogTitle>Relance globale du sondage n° 2<\/DialogTitle>/);
assert.match(source, /actionLock\.current \|\| busy \|\| reminderOpen/);
assert.match(source, /requestId: crypto\.randomUUID\(\)/);
assert.doesNotMatch(source, /action: "queue-survey-reminders"|action: "queue-survey-recipient"/);
console.log("Pure projection/source passed: all + G1-G7, assigned nonrespondents excluded only from display, removal/fallback, separate game accounts, intact counters and global reminder scope.");

if (process.argv.includes("--browser")) await testBrowser();

async function testBrowser() {
  const { build } = await import("esbuild");
  const { compile } = await import("@tailwindcss/node");
  const { Scanner } = await import("@tailwindcss/oxide");
  let playwright;
  // PLAYWRIGHT_MODULE_PATH accepts the installed package directory or its entry file.
  if (process.env.PLAYWRIGHT_MODULE_PATH) playwright = createRequire(import.meta.url)(resolve(process.env.PLAYWRIGHT_MODULE_PATH));
  else {
    try { playwright = createRequire(import.meta.url)("playwright"); }
    catch {
      const packages = process.env.CODEX_NODE_MODULES || join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules");
      playwright = createRequire(join(packages, "package.json"))("playwright");
    }
  }
  const screenshotDirectory = process.env.SURVEY_TEST_SCREENSHOTS ? resolve(process.env.SURVEY_TEST_SCREENSHOTS) : null;
  if (screenshotDirectory) await mkdir(screenshotDirectory, { recursive: true });
  const workspace = { supported: true, schemaReady: true, seasonId: "season", forecastRolesReady: true,
    choiceCampaign: { id: campaignId, poll_number: 2, is_test: false, status: "open" },
    forecast, members, candidates: {}, preview: {} };
  const center = { surveySchemaReady: true, season: { id: "season" },
    campaigns: [{ id: campaignId, pollNumber: 2, isTest: false, status: "open" }] };
  const preview = { campaignId, fingerprint: "a".repeat(32), canQueue: true,
    counts: { total: 100, nonRespondents: 60, eligible: 37, responded: 40, pending: 5, excluded: 7, failed: 3, invalid: 4, inactive: 4 },
    scopeGuilds: guilds, blockers: [] };
  const success = { result: { queuedCount: 37, batchId: "mock-batch", alreadyQueued: false } };
  // Real workspace and contact validation; API calls and OS protocol handoff are mocked.
  const entry = `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import Workspace from './src/components/IntersaisonSurveyTwoWorkspace.jsx';
    const config = window.__config || {};
    let workspace = config.workspace || ${JSON.stringify(workspace)};
    const initialCenter = config.center || ${JSON.stringify(center)};
    window.__calls = []; window.__refreshes = 0; window.__nativeDiscordRequests = []; window.__windowOpenCalls = 0;
    window.open = () => { window.__windowOpenCalls++; throw Error('Web window forbidden'); };
    let previews = 0, queues = 0;
    async function request(payload) {
      window.__calls.push(structuredClone(payload));
      if (payload.action === 'load-survey-two-workspace') return { workspace };
      if (payload.action === 'load-survey-two-preparation') return { preparation: { supported: false } };
      if (payload.action === 'save-survey-placement' && config.placementResult) {
        workspace = config.placementResult;
        return { workspace };
      }
      let reply;
      if (payload.action === 'preview-survey-two-reminders') {
        reply = (config.previews || [{ preview: ${JSON.stringify(preview)} }])[previews++];
      } else if (payload.action === 'queue-survey-two-reminders') {
        if (config.deferQueue) await new Promise(resolve => { window.__releaseQueue = resolve; });
        reply = (config.queues || [${JSON.stringify(success)}])[queues++];
      } else throw new Error('Unexpected mock action: ' + payload.action);
      if (!reply) throw new Error('No mock reply');
      if (reply.error) {
        const error = reply.network ? new TypeError(reply.error) : new Error(reply.error);
        if (reply.status !== undefined) error.status = reply.status;
        if (reply.statusCode !== undefined) error.statusCode = reply.statusCode;
        throw error;
      }
      return reply;
    }
    function onRefresh() { window.__refreshes++; }
    function App() {
      const [center, setCenter] = useState(initialCenter);
      const [visible, setVisible] = useState(true);
      return <Workspace request={request} center={center} pollNumber={config.pollNumber ?? 2}
        onCenterChange={setCenter} onRefresh={onRefresh} forecastVisible={visible} onForecastVisibleChange={setVisible} />;
    }
    createRoot(document.getElementById('root')).render(<App />);
  `;
  const bundle = await build({ stdin: { contents: entry, resolveDir: root, loader: "jsx" }, bundle: true, write: false,
    format: "iife", platform: "browser", jsx: "automatic", alias: { "@": join(root, "src") },
    plugins: [{ name: "mock-native-handoff", setup(build) {
      const path = join(root, "src/lib/discordNativeContact.js");
      build.onResolve({ filter: /discordNativeContact(?:\.js)?$/ }, (args) => args.namespace === "native-contact-test"
        ? { path, namespace: "file" } : { path: "native-contact-test", namespace: "native-contact-test" });
      build.onLoad({ filter: /.*/, namespace: "native-contact-test" }, () => ({ loader: "js", contents: `
        import { getForecastDiscordContact, requestDiscordNativeProfile as realRequest } from ${JSON.stringify(path)};
        export { getForecastDiscordContact };
        export function requestDiscordNativeProfile(userId) {
          return realRequest(userId, { windowRef: { location: { set href(url) {
            window.__nativeDiscordRequests.push(url);
            if (window.__config?.nativeContactBlocked) throw Error('No protocol handler');
          } } } });
        }
      ` }));
    } }],
    define: { "process.env.NODE_ENV": '"test"', "import.meta.env": "{}" }, logLevel: "silent" });
  const javascript = bundle.outputFiles[0].text;
  const indexCss = (await readFile(join(root, "src/index.css"), "utf8")).replace('@import "@fontsource-variable/geist";', "");
  const compiler = await compile(indexCss, { base: join(root, "src"), onDependency() {} });
  const css = compiler.build(new Scanner({ sources: [] }).scanFiles([{ content: javascript, extension: "js" }]));
  const server = createServer((req, res) => {
    const assets = {
      "/": ["text/html; charset=utf-8", '<!doctype html><html class="dark"><head><link rel="stylesheet" href="/style.css"></head><body style="background:#09090b;color:#f4f4f5"><main id="root" style="padding:16px"></main><script src="/app.js"></script></body></html>'],
      "/app.js": ["text/javascript; charset=utf-8", javascript], "/style.css": ["text/css; charset=utf-8", css],
    };
    const asset = assets[req.url];
    res.writeHead(asset ? 200 : 404, { "Content-Type": asset?.[0] || "text/plain" });
    res.end(asset?.[1] || "Not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const externalRequests = [], pageErrors = [];
  try {
    browser = await playwright.chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
      args: ["--disable-background-networking", "--disable-component-update", "--no-first-run"] });
    async function open(config = {}, viewport = { width: 1440, height: 1000 }) {
      const page = await browser.newPage({ viewport });
      page.setDefaultTimeout(7000);
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.route("**/*", (route) => {
        if (new URL(route.request().url()).origin === origin) return route.continue();
        externalRequests.push(route.request().url());
        return route.abort();
      });
      await page.addInitScript((value) => { window.__config = value; }, config);
      await page.clock.install();
      await page.goto(origin);
      await page.getByRole("heading", { name: /^Sans affectation prévisionnelle/ }).waitFor();
      return page;
    }
    const section = (page) => page.getByRole("region", { name: "Joueurs sans affectation prévisionnelle", exact: true });
    const select = (page) => page.getByRole("combobox", { name: "Guilde actuelle des joueurs sans affectation", exact: true });
    const launchButton = (page) => page.getByRole("button", { name: "Relancer tous les sans réponse", exact: true });
    const modal = (page) => page.getByRole("dialog", { name: "Relance globale du sondage n° 2", exact: true });
    const confirm = (page) => modal(page).getByRole("button", { name: /^Confirmer \d+ relance/ });
    const calls = (page, action) => page.evaluate((name) => window.__calls.filter((call) => call.action === name), action);
    async function doubleClick(locator) {
      await locator.evaluate((button) => { button.click(); button.click(); });
    }
    async function noOverflow(page) {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no horizontal overflow");
      const bounds = await select(page).boundingBox();
      assert.ok(bounds.width > 0 && bounds.x >= 0 && bounds.x + bounds.width <= page.viewportSize().width);
    }

    const page = await open({ deferQueue: true });
    const initialReads = await page.evaluate(() => window.__calls.length);
    assert.equal(await launchButton(page).count(), 1);
    assert.equal(await section(page).getByRole("button", { name: /^Ouvrir / }).count(), unassigned.length);
    const unassignedArea = page.getByRole("heading", { name: /^Sans affectation prévisionnelle/ }).locator("..");
    assert.equal(await unassignedArea.getByRole("button", { name: "Ouvrir Nonrespondent G4", exact: true }).count(), 1, "no local duplicate grid");
    for (const name of ["Nonrespondent G1", "Manual only", "Answered", "Answered unassigned"]) {
      assert.equal(await unassignedArea.getByRole("button", { name: `Ouvrir ${name}`, exact: true }).count(), 0);
    }
    assert.equal(await page.getByRole("heading", { name: "Magistratus", exact: true }).locator("../../..").getByRole("button", { name: "Ouvrir Nonrespondent G1", exact: true }).count(), 1);
    assert.equal(await page.getByRole("heading", { name: "Imperatores", exact: true }).locator("../../..").getByRole("button", { name: "Ouvrir Answered", exact: true }).count(), 1);
    for (const code of ["", ...guilds]) {
      await select(page).selectOption(code);
      const expected = getSurveyTwoNonRespondents(forecast.unassigned, code).length;
      assert.equal(await section(page).getByRole("button", { name: /^Ouvrir / }).count(), expected);
      assert.match(await section(page).getByRole("status").innerText(), new RegExp(`^${expected} affiché\\(s\\) sur ${unassigned.length} sans affectation au total`));
      assert.equal(await page.getByRole("heading", { name: `Sans affectation prévisionnelle (${unassigned.length})`, exact: true }).count(), 1);
      for (const guild of forecast.guilds) {
        assert.equal(await page.getByRole("heading", { name: guild.name, exact: true }).locator("..").locator("span").textContent(), `${guild.count} / 30`);
      }
    }
    await select(page).selectOption("G1");
    assert.match(await section(page).innerText(), /Aucun joueur sans affectation pour cette guilde actuelle/);
    assert.equal(await page.evaluate(() => window.__calls.length), initialReads, "opening/filtering is read-only");
    await doubleClick(launchButton(page));
    await modal(page).waitFor();
    await confirm(page).waitFor();
    assert.deepEqual(await calls(page, "preview-survey-two-reminders"), [{ action: "preview-survey-two-reminders", campaignId }]);
    assert.match(await modal(page).innerText(), /37 relance\(s\) éligible\(s\) exactement/);
    assert.match(await modal(page).innerText(), /indépendamment du filtre/);
    assert.match(await modal(page).innerText(), /Destinataires de la campagne/);
    assert.match(await modal(page).innerText(), /Destinataires sans réponse/);
    for (const label of ["Comptes exclus", "Envois en échec", "IDs absents ou invalides", "Comptes inactifs", "En attente ou en cours"]) assert.ok((await modal(page).innerText()).includes(label));
    await page.clock.runFor(31000);
    assert.equal(await page.evaluate(() => window.__calls.length), initialReads + 1, "modal pauses polling");
    await doubleClick(confirm(page));
    await page.waitForFunction(() => Boolean(window.__releaseQueue));
    assert.equal((await calls(page, "queue-survey-two-reminders")).length, 1, "synchronous double-click lock");
    await page.keyboard.press("Escape");
    assert.equal(await modal(page).count(), 1, "cannot dismiss while queue is busy");
    await page.clock.runFor(31000);
    assert.equal(await page.evaluate(() => window.__calls.length), initialReads + 2, "busy pauses polling");
    await page.evaluate(() => window.__releaseQueue());
    await modal(page).waitFor({ state: "hidden" });
    const firstQueue = (await calls(page, "queue-survey-two-reminders"))[0];
    assert.deepEqual(Object.keys(firstQueue).sort(), ["action", "campaignId", "confirmed", "previewFingerprint", "requestId"].sort());
    assert.equal(firstQueue.confirmed, true);
    assert.equal(firstQueue.campaignId, campaignId);
    assert.equal(firstQueue.previewFingerprint, preview.fingerprint);
    assert.match(firstQueue.requestId, /^[a-f0-9-]{36}$/);
    assert.match(await page.locator("body").innerText(), /37 relance\(s\) ajoutée/);
    await page.clock.runFor(31000);
    assert.ok(await page.evaluate(() => window.__refreshes > 0), "polling resumes after modal");
    await page.close();

    const contactPage = await open();
    for (const [name, expected] of [["Nonrespondent G1", "ready"], ["Nonrespondent G2", "ready"], ["Nonrespondent G3", "invalid"], ["Answered", "missing"]]) {
      await contactPage.getByRole("button", { name: `Ouvrir ${name}`, exact: true }).click();
      const playerDialog = contactPage.getByRole("dialog", { name, exact: true });
      const contactButton = playerDialog.getByRole("button", { name: "MP le joueur", exact: true });
      await contactButton.waitFor();
      assert.equal(await contactButton.isEnabled(), expected === "ready");
      const siblings = await playerDialog.getByRole("button", { name: "Modifier le placement", exact: true }).locator("..").getByRole("button", { name: "MP le joueur", exact: true }).count();
      assert.equal(siblings, 1, "contact remains next to the placement action");
      if (expected === "ready") {
        const before = await contactPage.evaluate(() => window.__calls.length);
        await contactButton.click();
        await playerDialog.getByRole("status").filter({ hasText: "Ouverture du profil Discord demandée, non confirmée" }).waitFor();
        assert.equal(await contactPage.evaluate(() => window.__calls.length), before, "no API write or Discord API call when opening contact");
        assert.equal(contactPage.url(), origin + "/");
        assert.equal(contactPage.context().pages().length, 1);
        assert.equal(await contactPage.evaluate(() => window.__windowOpenCalls), 0);
      } else if (expected === "invalid") {
        assert.match(await playerDialog.getByRole("alert").innerText(), /Identifiant Discord invalide/);
      } else {
        assert.match(await contactButton.locator("..").getAttribute("title"), /Aucun identifiant Discord/);
      }
      await playerDialog.getByRole("button", { name: "Close", exact: true }).click();
      await playerDialog.waitFor({ state: "hidden" });
    }
    assert.deepEqual(await contactPage.evaluate(() => window.__nativeDiscordRequests), ["discord://-/users/111111111111111111", "discord://-/users/111111111111111111"],
      "both game accounts resolve the same associated user without mixing in a DM channel ID");
    await contactPage.getByRole("button", { name: "Ouvrir Nonrespondent G2", exact: true }).click();
    await contactPage.getByRole("dialog", { name: "Nonrespondent G2", exact: true }).getByRole("button", { name: "Modifier le placement", exact: true }).click();
    await contactPage.getByRole("combobox", { name: "Guilde prévisionnelle", exact: true }).waitFor();
    assert.equal((await calls(contactPage, "save-survey-placement")).length, 0, "opening the existing placement menu never saves");
    await contactPage.close();

    const noAppPage = await open({ nativeContactBlocked: true });
    await noAppPage.getByRole("button", { name: "Ouvrir Nonrespondent G2", exact: true }).click();
    const noAppDialog = noAppPage.getByRole("dialog", { name: "Nonrespondent G2", exact: true });
    await noAppDialog.getByRole("button", { name: "MP le joueur", exact: true }).click();
    await noAppDialog.getByRole("alert").filter({ hasText: "installée" }).waitFor();
    assert.equal(noAppPage.url(), origin + "/");
    assert.equal(noAppPage.context().pages().length, 1);
    assert.equal((await calls(noAppPage, "queue-survey-two-reminders")).length, 0);
    await noAppPage.close();

    const removalPage = await open({ placementResult: { ...workspace, forecast: afterRemoval } });
    await select(removalPage).selectOption("G1");
    assert.equal(await section(removalPage).getByRole("button", { name: "Ouvrir Nonrespondent G1", exact: true }).count(), 0);
    await removalPage.getByRole("button", { name: "Ouvrir Nonrespondent G1", exact: true }).click();
    const playerModal = removalPage.getByRole("dialog", { name: "Nonrespondent G1", exact: true });
    await playerModal.waitFor();
    removalPage.once("dialog", (dialog) => dialog.accept());
    await playerModal.getByRole("button", { name: "Retirer", exact: true }).click();
    await playerModal.waitFor({ state: "hidden" });
    await section(removalPage).getByRole("button", { name: "Ouvrir Nonrespondent G1", exact: true }).waitFor();
    assert.deepEqual(await calls(removalPage, "save-survey-placement"), [{ action: "save-survey-placement", memberId: "G1", guildCode: null, expectedRevision: 1 }]);
    assert.equal(await section(removalPage).getByRole("button", { name: "Ouvrir Nonrespondent G1", exact: true }).count(), 1);
    assert.match(await section(removalPage).getByRole("status").innerText(), /^1 affiché\(s\) sur 8 sans affectation au total/);
    await select(removalPage).selectOption("");
    assert.equal(await section(removalPage).getByRole("button", { name: /^Ouvrir / }).count(), 8);
    assert.equal(await section(removalPage).getByRole("button", { name: "Ouvrir Nonrespondent G2", exact: true }).count(), 1,
      "the secondary's independent row survives its owner's placement removal");
    assert.equal(await removalPage.getByRole("heading", { name: "Magistratus", exact: true }).locator("../../..").getByRole("button", { name: "Ouvrir Nonrespondent G1", exact: true }).count(), 0);
    assert.equal((await calls(removalPage, "queue-survey-two-reminders")).length, 0);
    await removalPage.close();

    for (const failure of [{ error: "Temporary failure", status: 503 }, { error: "Failed to fetch", network: true }]) {
      const retryPage = await open({ queues: [failure, { result: { ...success.result, alreadyQueued: true } }] });
      await launchButton(retryPage).click(); await confirm(retryPage).click();
      await modal(retryPage).getByRole("alert").filter({ hasText: failure.error }).waitFor();
      await confirm(retryPage).click();
      await modal(retryPage).waitFor({ state: "hidden" });
      const queued = await calls(retryPage, "queue-survey-two-reminders");
      assert.equal(queued.length, 2); assert.equal(queued[0].requestId, queued[1].requestId);
      assert.match(await retryPage.locator("body").innerText(), /Aucun doublon ajouté/);
      await retryPage.close();
    }

    for (const failure of [{ error: "Actualiser la prévisualisation...", status: 409 },
      { error: "Actualiser la prévisualisation...", statusCode: 409 }, { error: "Actualiser la prévisualisation..." }]) {
      const expiredPage = await open({ queues: [failure, success], previews: [{ preview }, { preview: { ...preview, fingerprint: "b".repeat(32) } }] });
      await launchButton(expiredPage).click(); await confirm(expiredPage).click();
      const refresh = modal(expiredPage).getByRole("button", { name: "Nouvelle prévisualisation", exact: true });
      await refresh.waitFor();
      assert.equal(await confirm(expiredPage).count(), 0);
      assert.equal((await calls(expiredPage, "preview-survey-two-reminders")).length, 1, "no automatic refresh or queue after 409");
      await refresh.click(); await confirm(expiredPage).click();
      await modal(expiredPage).waitFor({ state: "hidden" });
      const queued = await calls(expiredPage, "queue-survey-two-reminders");
      assert.notEqual(queued[0].requestId, queued[1].requestId);
      assert.equal(queued[1].previewFingerprint, "b".repeat(32));
      await expiredPage.close();
    }

    const wavesPage = await open({ previews: [{ preview }, { preview }], queues: [success, success] });
    for (let wave = 0; wave < 2; wave++) {
      await launchButton(wavesPage).click(); await confirm(wavesPage).click();
      await modal(wavesPage).waitFor({ state: "hidden" });
    }
    const waves = await calls(wavesPage, "queue-survey-two-reminders");
    assert.equal(waves.length, 2); assert.notEqual(waves[0].requestId, waves[1].requestId, "successive deliberate waves are allowed");
    await wavesPage.close();

    for (const blockedPreview of [{ ...preview, canQueue: false }, { ...preview, blockers: ["Campaign blocked"] },
      { ...preview, counts: { ...preview.counts, eligible: 0 } }]) {
      const blockedPage = await open({ previews: [{ preview: blockedPreview }] });
      await launchButton(blockedPage).click(); await confirm(blockedPage).waitFor();
      assert.equal(await confirm(blockedPage).isDisabled(), true);
      assert.equal((await calls(blockedPage, "queue-survey-two-reminders")).length, 0);
      await blockedPage.close();
    }
    for (const badPreview of [{ ...preview, campaignId: "wrong" }, { ...preview, scopeGuilds: ["G1"] },
      { ...preview, counts: { ...preview.counts, eligible: undefined } }]) {
      const badPage = await open({ previews: [{ preview: badPreview }] });
      await launchButton(badPage).click();
      await modal(badPage).getByRole("button", { name: "Nouvelle prévisualisation", exact: true }).waitFor();
      assert.equal(await confirm(badPage).count(), 0);
      assert.equal((await calls(badPage, "queue-survey-two-reminders")).length, 0);
      await badPage.close();
    }

    const unavailable = [
      { workspace: { ...workspace, schemaReady: false } }, { workspace: { ...workspace, seasonId: null } },
      { workspace: { ...workspace, choiceCampaign: null } },
      ...[{ is_test: true }, { poll_number: 1 }, { status: "closed" }].map((change) => ({ workspace: { ...workspace, choiceCampaign: { ...workspace.choiceCampaign, ...change } } })),
      { center: { ...center, surveySchemaReady: false } }, { center: { ...center, season: { id: "other" } } },
      ...[{ isTest: true }, { status: "closed" }, { id: "other" }].map((change) => ({ center: { ...center, campaigns: [{ ...center.campaigns[0], ...change }] } })),
    ];
    for (const config of unavailable) {
      const gatedPage = await open(config);
      assert.equal(await launchButton(gatedPage).isDisabled(), true, "official open ready campaign required");
      assert.equal((await calls(gatedPage, "preview-survey-two-reminders")).length, 0);
      assert.equal((await calls(gatedPage, "queue-survey-two-reminders")).length, 0);
      await gatedPage.close();
    }
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 375, height: 812 }, { width: 320, height: 700 }]) {
      const responsivePage = await open({}, viewport);
      await responsivePage.clock.resume();
      await noOverflow(responsivePage);
      const prefix = viewport.width === 1440 ? "desktop-1440" : `mobile-${viewport.width}`;
      await responsivePage.getByRole("button", { name: "Ouvrir Nonrespondent G2", exact: true }).click();
      const contactDialog = responsivePage.getByRole("dialog", { name: "Nonrespondent G2", exact: true });
      await contactDialog.getByRole("button", { name: "MP le joueur", exact: true }).click();
      await contactDialog.getByRole("status").waitFor();
      assert.equal(await responsivePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const contactBounds = await contactDialog.getByRole("button", { name: "MP le joueur", exact: true }).boundingBox();
      assert.ok(contactBounds.width > 0 && contactBounds.x >= 0 && contactBounds.x + contactBounds.width <= viewport.width);
      if (screenshotDirectory) await responsivePage.screenshot({ path: join(screenshotDirectory, `${prefix}-contact.png`), animations: "disabled" });
      await contactDialog.getByRole("button", { name: "Close", exact: true }).click();
      await contactDialog.waitFor({ state: "hidden" });
      if (screenshotDirectory) {
        await responsivePage.screenshot({ path: join(screenshotDirectory, `${prefix}-full.png`), fullPage: true, animations: "disabled" });
        await responsivePage.getByRole("heading", { name: /^Sans affectation prévisionnelle/ }).locator("..").screenshot({ path: join(screenshotDirectory, `${prefix}-list.png`), animations: "disabled" });
        await select(responsivePage).selectOption("G1");
        await responsivePage.getByRole("heading", { name: /^Sans affectation prévisionnelle/ }).locator("..").screenshot({ path: join(screenshotDirectory, `${prefix}-g1-list.png`), animations: "disabled" });
      }
      await launchButton(responsivePage).click(); await confirm(responsivePage).waitFor();
      await responsivePage.evaluate(async () => {
        await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
          .map((animation) => animation.finished.catch(() => {})));
      });
      await responsivePage.waitForFunction(() => {
        const dialog = document.querySelector('[role="dialog"]');
        return dialog && Number(getComputedStyle(dialog).opacity) === 1;
      });
      const bounds = await modal(responsivePage).boundingBox();
      assert.ok(bounds.width > 0 && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width);
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height + 1);
      assert.ok((await responsivePage.screenshot({ animations: "disabled", ...(screenshotDirectory ? { path: join(screenshotDirectory, `${prefix}-modal.png`) } : {}) })).length > 10000, "real styled UI screenshot rendered");
      await responsivePage.close();
    }
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(externalRequests, []);
    console.log("Headless real React UI passed: native contact/linked identity/missing-invalid IDs/blocked app, no web window/navigation/API write, existing placement actions, all/G1-G7, intact counters and global queue, races/retries, desktop/375/320px. No external network or DMs; OS handoff mocked.");
    if (screenshotDirectory) console.log(`Screenshots: ${screenshotDirectory}`);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
