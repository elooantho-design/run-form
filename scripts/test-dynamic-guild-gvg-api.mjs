import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import https from "node:https";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { createPortalSessionToken } from "../api/_portal-auth.js";
import { resolvePortalGuildScope, defenseMatchesGuildScope } from "../api/_portal-guild-access.js";

process.env.SUPABASE_URL = "https://gvg-db-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "isolated-key";
process.env.PORTAL_SESSION_SECRET = "isolated-gvg-test-secret-not-production";
process.env.GVG_SERVER_URL = "https://gvg-vps-test.invalid";
process.env.GVG_API_TOKEN = "isolated-token";
process.env.GVG_SEASON_MAINTENANCE = "0";
const uuid = n => `60000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const org = uuid(100), otherOrg = uuid(101);
const guilds = Array.from({ length: 10 }, (_, i) => ({ id: uuid(200 + i), organization_id: org, guild_code: "G" + (i + 1), display_name: "Guild " + (i + 1), is_active: true }));
guilds.push({ id: uuid(220), organization_id: otherOrg, guild_code: "MAD G1", display_name: "MAD", is_active: true });
const members = guilds.map((g, i) => ({ id: uuid(i + 1), guild_code: g.guild_code, role: "admin", watcher_name: "Admin " + g.guild_code }));
members.push({ id: uuid(90), guild_code: "G8", role: "member" });
const champion = { id: 101, name: "Elowyn", portal_name: "Elowyn" };
const defenses = guilds.map((g, i) => ({ id: uuid(300 + i), guild_code: g.guild_code, organization_id: g.organization_id, name: "Defense " + g.guild_code, type: "Tour", is_hidden: false,
  guild_defense_slots: [{ slot_index: 1, champion_id: 101, champions: champion }], guild_defense_conditions: [] }));
defenses.push({ ...defenses[7], id: uuid(999), organization_id: otherOrg, name: "Wrong organization" });
const tables = { guild_members: members, portal_guilds: guilds,
  portal_organizations: [{ id: org, organization_key: "paladin", is_active: true }, { id: otherOrg, organization_key: "mad", is_active: true }],
  guild_defenses: defenses, champions: [champion], guild_defense_blocks: [], guild_defense_conditions: [],
  guild_defense_library_similarity_reviews: [], guild_defense_library_merges: [] };
const dbCalls = [], vpsCalls = [], writes = [];
let failCatalog = false, statusGuild = "G8";
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  assert.equal(url.origin, process.env.SUPABASE_URL, "real network forbidden");
  const table = url.pathname.split("/").at(-1), method = options.method || "GET";
  dbCalls.push({ table, method });
  if (failCatalog && table === "portal_guilds") return new Response(JSON.stringify({ message: "Catalog unavailable" }), { status: 503, headers: { "content-type": "application/json" } });
  assert.ok(Object.hasOwn(tables, table), "Unexpected table " + table);
  if (method !== "GET") {
    assert.equal(method, "POST");
    assert.equal(table, "guild_defense_conditions", "no other business write is allowed in tests");
    writes.push(JSON.parse(options.body));
    return new Response("[]", { status: 201, headers: { "content-type": "application/json" } });
  }
  let rows = tables[table].filter(row => [...url.searchParams].every(([key, value]) => {
    if (["select", "order", "limit", "offset"].includes(key)) return true;
    if (value.startsWith("eq.")) return String(row[key]) === value.slice(3);
    if (value.startsWith("in.(")) return value.slice(4, -1).split(",").map(v => v.replaceAll('"', "")).includes(String(row[key]));
    if (value === "is.null") return row[key] == null;
    throw new Error("Unsupported filter " + key + "=" + value);
  }));
  rows = rows.slice(Number(url.searchParams.get("offset") || 0), Number(url.searchParams.get("offset") || 0) + Number(url.searchParams.get("limit") || 1000));
  const single = new Headers(options.headers).get("accept")?.includes("application/vnd.pgrst.object+json");
  return new Response(JSON.stringify(single ? rows[0] || null : rows), { headers: { "content-type": "application/json" } });
};
const originalRequest = https.request;
https.request = (url, options, callback) => {
  assert.equal(url.origin, process.env.GVG_SERVER_URL, "no production VPS request");
  const request = new EventEmitter();
  let body = "";
  request.setTimeout = () => {};
  request.write = value => { body += value; };
  request.end = value => {
    if (value) body += value;
    vpsCalls.push({ path: url.pathname, method: options.method, body: body ? JSON.parse(body) : null });
    const session = body ? JSON.parse(body) : { guild: statusGuild };
    const response = Readable.from([Buffer.from(JSON.stringify({ ok: true, session }))]);
    response.statusCode = 200;
    response.headers = {};
    queueMicrotask(() => callback(response));
  };
  return request;
};
const { default: server } = await import("../api/gvg-server.js");
const { default: admin } = await import("../api/portal-admin-defenses.js");
async function call(handler, actor, action, data = {}, { signed = true, origin = "http://localhost:3010", method = "POST" } = {}) {
  const req = { method, url: "/api/" + (handler === server ? "gvg-server" : "portal-admin-defenses"),
    headers: { host: "localhost:3010", origin, ...(signed ? { cookie: "portal_session=" + encodeURIComponent(createPortalSessionToken(actor)) } : {}) },
    query: method === "GET" ? { action, ...data } : {}, body: { action, ...data } };
  const res = { statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; }, end(value) { if (value) this.payload = JSON.parse(value); } };
  await handler(req, res);
  return { status: res.statusCode, headers: res.headers, ...res.payload };
}
try {
  const baseline = structuredClone(tables);
  for (const actor of members.slice(0, 11)) {
    const list = await call(server, actor, "launcher-guilds", {}, { method: "GET" });
    assert.equal(list.status, 200);
    assert.equal(list.headers["Cache-Control"], "no-store");
    assert.ok(list.guilds.some(g => g.code === actor.guild_code.replaceAll(" ", "_")));
    assert.equal(list.guilds.length, actor.guild_code === "MAD G1" ? 1 : 10);
    const read = await call(admin, actor, "load", { guildCode: actor.guild_code });
    assert.equal(read.status, 200, JSON.stringify(read));
    assert.equal(read.defenses.length, 1);
    assert.equal(read.defenses[0].guild_code, actor.guild_code);
    assert.ok(!read.libraryDefenses.some(d => d.name === "Wrong organization"));
    assert.ok(read.libraryDefenses.every(d => d.organization_id === (actor.guild_code === "MAD G1" ? otherOrg : org)));
  }
  assert.equal(vpsCalls.length, 0, "opening the selector or the dashboard creates no capture/session/job");
  for (const actor of [members[0], members[7], members[8], members[9]]) {
    for (const target of ["G1", "G8", "G9", "G10"]) {
      const read = await call(admin, actor, "load", { guildCode: target });
      assert.equal(read.status, 200);
      assert.ok(read.defenses.every(d => d.guild_code === target));
    }
  }
  for (const [actor, target] of [[members[7], "MAD G1"], [members[10], "G8"], [members[0], "G11"]]) {
    assert.equal((await call(admin, actor, "load", { guildCode: target })).status, 403);
    assert.equal((await call(server, actor, "launcher-create", { guild: target, sessionId: "a".repeat(32) })).status, 403);
  }
  for (const handler of [server, admin]) {
    const action = handler === server ? "launcher-guilds" : "load";
    const method = handler === server ? "GET" : "POST";
    for (const [actor, extra] of [[members[7], { signed: false }], [members.at(-1), {}], [{ id: uuid(900) }, {}]]) {
      assert.ok([401, 403].includes((await call(handler, actor, action, {}, { method, ...extra })).status));
    }
    assert.equal((await call(handler, members[7], handler === server ? "launcher-create" : action,
      { guild: "G8", sessionId: "a".repeat(32) }, { method: "POST", origin: "https://foreign.invalid" })).status, 403);
  }
  guilds[7].is_active = false;
  assert.equal((await call(server, members[0], "launcher-create", { guild: "G8", sessionId: "a".repeat(32) })).status, 403);
  assert.equal((await call(admin, members[0], "load", { guildCode: "G8" })).status, 403);
  guilds[7].is_active = true;
  tables.portal_organizations[0].is_active = false;
  assert.equal((await call(server, members[7], "launcher-guilds", {}, { method: "GET" })).status, 403);
  assert.equal((await call(admin, members[7], "load", { guildCode: "G8" })).status, 403);
  tables.portal_organizations[0].is_active = true;
  guilds.push({ id: uuid(250), guild_code: "G11", display_name: "New dynamic guild", organization_id: org, is_active: true });
  assert.ok((await call(server, members[7], "launcher-guilds", {}, { method: "GET" })).guilds.some(g => g.code === "G11"));
  assert.equal((await call(admin, members[7], "load", { guildCode: "G11" })).status, 200);
  guilds.pop();
  guilds.push({ ...guilds[7], id: uuid(251), guild_code: "G8 " });
  assert.equal((await call(server, members[7], "launcher-guilds", {}, { method: "GET" })).status, 403, "ambiguous normalized codes fail closed");
  guilds.pop();
  failCatalog = true;
  assert.notEqual((await call(admin, members[7], "load", { guildCode: "G8" })).status, 200);
  assert.notEqual((await call(server, members[7], "launcher-guilds", {}, { method: "GET" })).status, 200);
  failCatalog = false;
  assert.equal(vpsCalls.length, 0);
  assert.deepEqual(tables, baseline, "all reads/refusals preserve every account, guild, defense and setting");
  for (const guild of ["G1", "G8", "G9", "G10"]) {
    const response = await call(server, members[7], "launcher-create", { guild, sessionId: "a".repeat(32), side: "enemy" });
    assert.equal(response.status, 200);
    assert.equal(vpsCalls.at(-1).body.guild, guild);
    assert.equal(vpsCalls.at(-1).body.mode, guild.toLowerCase());
  }
  statusGuild = "MAD G1";
  assert.equal((await call(server, members[7], "launcher-status", { session: "a".repeat(32) }, { method: "GET" })).status, 403);
  statusGuild = "G9";
  assert.equal((await call(server, members[7], "launcher-status", { session: "a".repeat(32) }, { method: "GET" })).status, 200);
  for (const [guild, index] of [["G1", 0], ["G8", 7], ["G9", 8], ["G10", 9]]) {
    const result = await call(admin, members[7], "condition-add", { guildCode: guild, defenseId: defenses[index].id, championId: "101", minAwakening: 2 });
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.equal(writes.at(-1).defense_id, defenses[index].id);
  }
  const beforeWrites = writes.length;
  for (const [guild, defense] of [["G8", defenses[8]], ["G8", defenses.at(-1)], ["MAD G1", defenses[10]]]) {
    assert.notEqual((await call(admin, members[7], "condition-add", { guildCode: guild, defenseId: defense.id, championId: "101", minAwakening: 2 })).status, 200);
  }
  assert.equal(writes.length, beforeWrites, "wrong guild/organization cannot mutate a defense");
  await assert.rejects(resolvePortalGuildScope({ from() { throw new Error("No catalog"); } }, {}, "G8"), /non autorisee/);
  assert.equal(defenseMatchesGuildScope(defenses.at(-1), { organizationId: org, activeGuildCode: "G8", allowedGuildCodes: ["G8"] }), false);
  console.log(`Dynamic GvG API OK: G1-G10, exact guild defenses, shared organization library only, signed admin sessions, inactive/unknown/foreign denials, no first-load side effects, scoped writes; ${dbCalls.length} mocked DB requests and ${vpsCalls.length} mocked VPS requests. No production access.`);
} finally { https.request = originalRequest; }
