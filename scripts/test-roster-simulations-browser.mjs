import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { startRosterSimulationPreview, fixtureId as id } from "./roster-simulation-preview.mjs";

if (!process.env.PLAYWRIGHT_MODULE_PATH || !process.env.ROSTER_TEST_OUTPUT) throw Error("Playwright module and external output directory required");
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href);
const output = resolve(process.env.ROSTER_TEST_OUTPUT);
await mkdir(output, { recursive: true });
const preview = await startRosterSimulationPreview();
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const reports = [];
let activePage;
try {
  const hub = await browser.newPage();
  activePage = hub;
  await hub.route("**/*", r => new URL(r.request().url()).hostname === "127.0.0.1" ? r.continue() : r.abort());
  await hub.goto(preview.url + "?integrated=1");
  await hub.getByRole("tab", { name: "Simulation des effectifs", exact: true }).click();
  await hub.getByRole("button", { name: "Nouvelle simulation", exact: true }).waitFor();
  await hub.getByRole("tab", { name: "Sondages et plans", exact: true }).click();
  assert.equal(await hub.getByRole("tab", { name: "Sondages et plans", exact: true }).getAttribute("aria-selected"), "true");
  assert.equal(preview.legacyCalls.every(action => ["load", "load-survey-center"].includes(action)), true);
  reports.push({ actualIntersaisonTabIntegrated: true, previousSurveyTabPreserved: true, noLegacyMutation: true });
  await hub.close();
  for (const width of [1440, 768, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    activePage = page;
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.route("**/*", r => new URL(r.request().url()).hostname === "127.0.0.1" ? r.continue() : r.abort());
    await page.goto(preview.url);
    await page.getByRole("button", { name: "Nouvelle simulation" }).click();
    await page.getByLabel("Nom", { exact: true }).fill(`Fusion test ${width}`);
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await page.getByRole("heading", { name: `Fusion test ${width}` }).waitFor();
    const creation = preview.calls.filter(c => c.p_action === "create").at(-1);
    const simulation = creation.p_simulation;
    const detail = async () => (await preview.db.query("select roster_simulation_request($1,'detail',$2) v", [id(1), simulation])).rows[0].v;
    for (const g of [1, 3, 4, 5, 6, 7, 9, 10]) {
      const box = page.getByRole("checkbox", { name: `G${g}`, exact: true });
      await box.click();
      await page.waitForFunction(label => [...document.querySelectorAll("label")].find(el => el.textContent === label)?.querySelector("input")?.checked === false, `G${g}`);
    }
    await page.getByRole("checkbox", { name: "Selectionner Joueur 3", exact: true }).check();
    await page.getByRole("checkbox", { name: "Selectionner Joueur 4", exact: true }).check();
    await page.getByRole("button", { name: "Transferer la selection", exact: true }).click();
    await page.getByLabel("Destination", { exact: true }).selectOption(id(508));
    const movesBefore = preview.calls.filter(c => c.p_action === "move").length;
    await page.getByRole("button", { name: "Confirmer le transfert virtuel" }).dblclick();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(preview.calls.filter(c => c.p_action === "move").length - movesBefore, 1);
    assert.equal((await detail()).entries.find(e => e.memberId === id(3)).targetGuildId, id(508));
    const membersBefore = (await preview.db.query("select to_jsonb(m) v from guild_members m order by id")).rows;
    await page.getByRole("button", { name: "Annuler la derniere operation", exact: true }).click();
    await page.getByRole("region", { name: "Effectif G2", exact: true }).getByRole("checkbox", { name: "Selectionner Joueur 3", exact: true }).waitFor();
    await page.getByRole("button", { name: "Transferer la selection", exact: true }).click();
    await page.getByLabel("Destination", { exact: true }).selectOption(id(508));
    await page.getByRole("button", { name: "Confirmer le transfert virtuel" }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.reload();
    await page.getByRole("button", { name: new RegExp(`^Fusion test ${width}`) }).click();
    await page.getByRole("heading", { name: `Fusion test ${width}` }).waitFor();
    assert.equal((await detail()).entries.find(e => e.memberId === id(3)).targetGuildId, id(508));
    const newMember = id(1000 + width);
    await preview.db.query("insert into guild_members values($1,$2,'G2','member','active',null,'inactive',null,null)", [newMember, `Nouveau ${width}`]);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByText(`Nouveau ${width}`, { exact: true }).waitFor();
    assert.equal((await detail()).entries.filter(e => e.memberId === newMember).length, 1);
    assert.equal((await detail()).entries.find(e => e.memberId === id(3)).targetGuildId, id(508));
    await page.getByRole("combobox").fill("Commun");
    await page.getByRole("option", { name: /Communautaire exemple/ }).click();
    await page.getByRole("region", { name: "Joueurs externes / a integrer", exact: true }).getByText("Communautaire exemple", { exact: true }).waitFor();
    assert.equal((await detail()).entries.find(e => e.memberId === id(300)).targetGuildId, null);
    await page.getByRole("combobox").fill("Joueur 3");
    await page.getByRole("option", { name: /^Joueur 3 \/ / }).click();
    assert.equal((await detail()).entries.filter(e => e.memberId === id(3)).length, 1);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Exporter la repartition", exact: true }).click();
    assert.match((await download).suggestedFilename(), /^simulation-.*\.txt$/);
    assert.deepEqual((await preview.db.query("select to_jsonb(m) v from guild_members m where id<>$1 order by id", [newMember])).rows, membersBefore, "No real memberships changed");
    await page.screenshot({ path: resolve(output, `simulation-${width}.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, "No horizontal page overflow");
    await page.getByRole("button", { name: "Reinitialiser le scenario", exact: true }).click();
    assert.equal((await detail()).entries.find(e => e.memberId === id(3)).targetGuildId, id(508), "Opening confirmation changes nothing");
    await page.getByRole("button", { name: "Confirmer", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal((await detail()).entries.find(e => e.memberId === id(3)).targetGuildId, id(502));
    assert.deepEqual(errors, []);
    assert.equal(preview.calls.some(c => ["apply", "publish", "remind"].includes(c.p_action)), false);
    reports.push({ width, create: true, bulkMove: true, doubleClick: true, undo: true, persistedReload: true, incrementalSync: true, communitySearch: true, deduplicatedSearch: true, export: true, resetConfirmation: true, businessRowsUnchanged: true, noOverflow: true });
    await page.close();
    await preview.db.query("delete from guild_members where id=$1", [newMember]);
  }
  await writeFile(resolve(output, "browser-results.json"), JSON.stringify(reports, null, 2));
  console.log("Roster simulator browser + API + real isolated SQL: four desktop/mobile viewports passed.");
} catch (cause) {
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: resolve(output, "failure.png"), fullPage: true });
    console.error("Visible alerts:", await activePage.getByRole("alert").allTextContents());
  }
  throw cause;
} finally { await browser.close(); await preview.close(); }
