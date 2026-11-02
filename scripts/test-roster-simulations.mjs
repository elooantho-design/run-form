import assert from "node:assert/strict";
import { createRosterSimulationHandler } from "../api/portal-roster-simulations.js";
import { createPortalSessionToken } from "../api/_portal-auth.js";
import { projectRosterSimulation, rosterSimulationText } from "../src/lib/rosterSimulation.js";

globalThis.fetch = () => { throw Error("Real network forbidden in simulation unit tests"); };
process.env.PORTAL_SESSION_SECRET = "local-roster-simulator-tests-only";
const member = { id: "71000000-0000-4000-8000-000000000001", role: "leader", guild_code: "G2" };
const token = createPortalSessionToken(member);
let failure = null;
const calls = [];
const db = { from() { return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: member }; } }; },
  async rpc(name, args) { calls.push({ name, args }); return failure ? { error: failure } : { data: { simulations: [] } }; } };
const handler = createRosterSimulationHandler(db);
async function req(method, action, body = {}, headers = {}) {
  const request = { method, url: `/api/portal-roster-simulations?action=${action}&query=Lu`, headers: { host: "run-form-tau.vercel.app", origin: "https://run-form-tau.vercel.app", cookie: `portal_session=${token}`, ...headers }, body: { action, ...body } };
  const response = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(v) { this.body = v ? JSON.parse(v) : null; } };
  await handler(request, response); return response;
}
assert.equal((await req("GET", "list")).statusCode, 200);
assert.equal((await req("GET", "search")).statusCode, 200);
assert.deepEqual(calls.at(-1).args.p_payload, { query: "Lu" });
const id = "71000000-0000-4000-8000-000000000950";
assert.equal((await req("POST", "create", { simulationId: id, actor: "forged", organizationId: "foreign", payload: { name: "Fusion", guilds: ["foreign"], actor: "forged" } })).statusCode, 200);
assert.deepEqual(calls.at(-1), { name: "roster_simulation_request", args: { p_actor: member.id, p_action: "create", p_simulation: id, p_expected: null, p_payload: { name: "Fusion" } } });
const previous = calls.length;
for (const [method, action, body, headers, status] of [
  ["GET", "move", {}, {}, 400], ["POST", "list", {}, {}, 400], ["POST", "apply", { simulationId: id }, {}, 400],
  ["POST", "publish", {}, {}, 400], ["POST", "move", { simulationId: "invalid" }, {}, 400],
  ["POST", "create", { simulationId: id }, { origin: "https://other.example" }, 403],
  ["GET", "list", {}, { cookie: "" }, 401], ["DELETE", "archive", {}, {}, 405],
]) assert.equal((await req(method, action, body, headers)).statusCode, status);
assert.equal(calls.length, previous);
for (const [code, status] of [["42501", 403], ["P0002", 404], ["40001", 409], ["55P03", 409], ["23505", 409], ["22023", 400], ["22P02", 400], ["PGRST202", 428], ["XX000", 500]]) {
  failure = { code, message: "PRIVATE_DATABASE_DETAIL" };
  const res = await req("GET", "list");
  assert.equal(res.statusCode, status);
  if (status === 500) assert.doesNotMatch(JSON.stringify(res.body), /PRIVATE/);
  assert.match(res.headers["Cache-Control"] || res.headers["cache-control"], /no-store/);
}
const guilds = [{ id: "g2", code: "G2", name: "Imperatores", capacity: 30 }, { id: "g8", code: "G8", name: "DEUS", capacity: 30 }, { id: "g10", code: "G10", name: "Future", capacity: 32 }];
const entries = Array.from({ length: 29 }, (_, i) => ({ memberId: `m${i}`, initialGuildId: "g2", targetGuildId: i < 5 ? "g8" : "g2", origin: { name: `Joueur ${i}` } }));
entries.push({ memberId: "community", initialGuildId: null, targetGuildId: null, origin: { name: "Community" } });
const data = { simulation: { name: "Fusion", status: "draft", guilds }, activeGuilds: guilds, entries };
let view = projectRosterSimulation(data);
assert.equal(view.guilds.find(g => g.code === "G2").count, 24);
assert.equal(view.guilds.find(g => g.code === "G8").count, 5);
assert.equal(view.guilds.find(g => g.code === "G2").remaining, 6);
assert.equal(view.external.length, 1);
assert.equal(view.movements.length, 5);
assert.match(rosterSimulationText(data), /SIMULATION - NON APPLIQUEE/);
assert.match(rosterSimulationText(data), /G2 -> G8/);
assert.match(rosterSimulationText(data), /Community/);
assert.throws(() => projectRosterSimulation({ ...data, entries: [...entries, entries[0]] }), /duplique/);
view = projectRosterSimulation({ ...data, entries: Array.from({ length: 31 }, (_, i) => ({ memberId: String(i), targetGuildId: "g8", origin: { name: String(i) } })) });
assert.equal(view.overCapacity[0].code, "G8"); assert.equal(view.overCapacity[0].remaining, -1);
assert.equal(projectRosterSimulation({ ...data, simulation: { ...data.simulation, visible_guilds: [] } }).entries.length, entries.length, "Visibility is never a data filter");
console.log("Roster simulation API, session identity, safe methods, schema errors, capacities and exports: passed (no network).");
