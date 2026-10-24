import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { parse } from "@babel/parser";
import { getForecastDiscordContact, requestDiscordNativeProfile } from "../src/lib/discordNativeContact.js";
import { requestDiscordNativeNavigation } from "../src/lib/discordNativeNavigation.js";

globalThis.fetch = () => { throw Error("No real network in native contact tests"); };
const root = { id: "root", discord_id: "111111111111111111" };
const alt = { id: "alt", primary_member_id: "root", discord_id: "" };
const members = [root, alt];
const baseline = structuredClone(members);
assert.deepEqual(getForecastDiscordContact(root, members), { status: "ready", userId: root.discord_id, error: "" });
assert.equal(getForecastDiscordContact(alt, members).userId, root.discord_id);
assert.equal(getForecastDiscordContact({ ...alt, discord_id: root.discord_id }, members).userId, root.discord_id);
assert.equal(getForecastDiscordContact({ ...alt, discord_id: "222222222222222222" }, members).status, "invalid");
assert.equal(getForecastDiscordContact(alt, [alt]).status, "invalid");
assert.equal(getForecastDiscordContact(alt, [{ ...root, primary_member_id: "other" }]).status, "invalid");
assert.equal(getForecastDiscordContact(null).status, "missing");
assert.equal(getForecastDiscordContact({ id: "missing" }).status, "missing");
assert.equal(getForecastDiscordContact({ ...root, discord_id: Number(root.discord_id) }).status, "invalid");
for (const id of ["x", "0".repeat(18), "011111111111111111", "1".repeat(21), "18446744073709551616", "111111111111111111/other", "https://discord.com", "discord://-/users/111111111111111111"]) {
  assert.equal(getForecastDiscordContact({ id: "invalid", discord_id: id }).status, "invalid");
  assert.throws(() => requestDiscordNativeProfile(id, { windowRef: { location: { set href(_url) { throw Error("Must not navigate"); } } } }), /Identifiant Discord invalide/);
}
const requests = [];
const windowRef = { location: { set href(url) { requests.push(url); } }, open() { throw Error("New window forbidden"); } };
for (const member of members) {
  const result = requestDiscordNativeProfile(getForecastDiscordContact(member, members).userId, { windowRef });
  assert.deepEqual(result, { requested: true, mode: "native-profile" });
}
assert.deepEqual(requests, [`discord://-/users/${root.discord_id}`, `discord://-/users/${root.discord_id}`]);
assert.throws(() => requestDiscordNativeProfile(root.discord_id, { windowRef: null }), /indisponible/);
assert.throws(() => requestDiscordNativeProfile(root.discord_id, { windowRef: { location: { set href(_url) { throw Error("No registered application"); } } } }), /installée.*discord:\/\//);
assert.throws(() => requestDiscordNativeProfile(Number(root.discord_id), { windowRef }), /invalide/, "never round a numeric Discord ID");
assert.deepEqual(members, baseline, "Discord associations remain untouched");
const source = await readFile(new URL("../src/lib/discordNativeContact.js", import.meta.url), "utf8");
assert.doesNotMatch(source, /https?:\/\/|window\.open|_blank|createDM|fetch\(/);
assert.match(source, /requestDiscordNativeNavigation\(`discord:\/\/-\/users\//);
assert.deepEqual(requestDiscordNativeNavigation("  discord://-/channels/111111111111111111/222222222222222222  ", { windowRef }), { requested: true });
assert.equal(requests.at(-1), "discord://-/channels/111111111111111111/222222222222222222");
const beforeInvalidNavigation = requests.length;
for (const uri of ["https://discord.com/channels/1/2", "javascript:alert(1)", "", null, "discord://-/users/1\nhttps://discord.com"]) {
  assert.throws(() => requestDiscordNativeNavigation(uri, { windowRef }), /Lien natif Discord invalide/);
}
assert.equal(requests.length, beforeInvalidNavigation);
assert.throws(() => requestDiscordNativeNavigation("discord://-/channels/@me", { windowRef: {} }), /indisponible/);
const navigationSource = await readFile(new URL("../src/lib/discordNativeNavigation.js", import.meta.url), "utf8");
assert.doesNotMatch(navigationSource, /https?:\/\/|window\.open|_blank|fetch\(|\.focus\(|setTimeout|iframe/);

// Exercise the existing functions from their AST, without rendering or contacting Discord.
const guildSource = await readFile(new URL("../src/components/PortalGuildManagementTab.jsx", import.meta.url), "utf8");
const ast = parse(guildSource, { sourceType: "module", plugins: ["jsx"] });
const guildFunctions = ["getDiscordAppUrl", "openDiscordTarget"].map((name) => {
  const declaration = ast.program.body.find((node) => node.type === "FunctionDeclaration" && node.id.name === name);
  assert.ok(declaration, `Guild Management still defines ${name}`);
  return guildSource.slice(declaration.start, declaration.end);
}).join("\n");
const guildRequests = [], webRequests = [], activityRequests = [];
let activity = false;
const guildWindow = { location: { set href(url) { guildRequests.push(url); } }, open: (...args) => webRequests.push(args) };
const context = vm.createContext({
  window: guildWindow,
  requestDiscordNativeNavigation: (uri) => requestDiscordNativeNavigation(uri, { windowRef: guildWindow }),
  isDiscordActivityRuntime: () => activity,
  openExternalUrlForRuntime: (...args) => { activityRequests.push(args); },
});
vm.runInContext(guildFunctions, context);
for (const host of ["discord.com", "discordapp.com"]) {
  context.openDiscordTarget(`https://${host}/channels/111111111111111111/222222222222222222/333333333333333333`);
  assert.equal(guildRequests.at(-1), "discord://-/channels/111111111111111111/222222222222222222/333333333333333333");
}
context.openDiscordTarget("discord://-/channels/@me/444444444444444444");
assert.equal(guildRequests.at(-1), "discord://-/channels/@me/444444444444444444");
assert.equal(webRequests.length, 0);
assert.equal(activityRequests.length, 0);
assert.equal(guildRequests.length, 3);
context.openDiscordTarget("");
assert.equal(guildRequests.length, 3);
activity = true;
context.openDiscordTarget("https://discord.com/channels/111111111111111111/222222222222222222");
assert.equal(activityRequests.length, 1, "the existing Activity SDK branch remains unchanged");
assert.equal(activityRequests[0][0], "https://discord.com/channels/111111111111111111/222222222222222222");
assert.equal(activityRequests[0][1].newTab, true);
assert.equal(guildRequests.length, 3);
activity = false;
context.openDiscordTarget("https://example.test/existing-legacy-link");
assert.equal(webRequests.length, 1, "legacy Guild Management fallback is unaffected, never used for MP");
assert.equal(webRequests[0][0], "https://example.test/existing-legacy-link");
assert.equal(webRequests[0][1], "_blank");
assert.match(guildSource, /onClick=\{\(\) => openDiscordTarget\(memberPanelForumUrl\)\}/);
console.log("Native contact tests passed: shared Guild Management handoff, unchanged channel/Activity routes, profile-only URI, missing/invalid/overflow IDs, linked identity, no DM channel substitution, no MP web fallback or message/data mutation. OS launch mocked, not confirmed.");
