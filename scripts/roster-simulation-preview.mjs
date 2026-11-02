import { createServer, transformWithEsbuild } from "vite";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createPortalSessionToken, readJsonBody } from "../api/_portal-auth.js";
import { createRosterSimulationHandler } from "../api/portal-roster-simulations.js";

const moduleId = "virtual:roster-simulation-preview.jsx";
export const fixtureId = n => `72000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const fixture = `import React from 'react';import{createRoot}from'react-dom/client';
import Workspace from '/src/components/RosterSimulationWorkspace.jsx';import'/src/index.css';
import Hub from '/src/components/PortalIntersaisonTab.jsx';
document.documentElement.classList.add('dark');
createRoot(document.getElementById('root')).render(<main className="min-h-screen bg-zinc-950 p-3 text-zinc-100 md:p-6">{new URLSearchParams(location.search).has('integrated')?<Hub session={{role:'leader',guild_code:'G2'}}/>:<Workspace/>}</main>);`;

export async function startRosterSimulationPreview(port = 0) {
  if (!process.env.PGLITE_MODULE_PATH) throw Error("Isolated PGLite runtime required");
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href);
  const db = new PGlite();
  process.env.PORTAL_SESSION_SECRET = "isolated-preview-never-a-production-session";
  const member = { id: fixtureId(1), watcher_name: "Responsable fictif", guild_code: "G2", role: "leader" };
  const token = createPortalSessionToken(member);
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create table portal_organizations(id uuid primary key,organization_key text,is_active boolean);
    create table portal_guilds(id uuid primary key,organization_id uuid,guild_code text,display_name text,is_active boolean);
    create table guild_members(id uuid primary key,watcher_name text,guild_code text,role text,roster_status text,
      community_access_type text,community_status text,primary_member_id uuid,discord_id text);
    create table intersaison_assignments(member_id uuid,organization_id uuid);
    create table intersaison_survey_recipients(member_id uuid,organization_id uuid);
    create table intersaison_plan_applications(members jsonb,organization_id uuid);
    create table guild_survey_recipients(member_key uuid,owner_member_ids uuid[],organization_id uuid);`);
  await db.query("insert into portal_organizations values($1,'paladin',true)", [fixtureId(900)]);
  for (let n = 1; n <= 10; n++) await db.query("insert into portal_guilds values($1,$2,$3,$4,true)", [fixtureId(500 + n), fixtureId(900), `G${n}`, n === 8 ? "DEUS" : n === 2 ? "Imperatores" : `Guilde ${n}`]);
  for (let n = 1; n <= 200; n++) await db.query("insert into guild_members values($1,$2,$3,$4,'active',null,'inactive',null,$5)",
    [fixtureId(n), n === 200 ? "UnPseudoTresLongSansEspacesPourVerifierLeMobileEtLeRetourALaLigne" : `Joueur ${n}`, n <= 29 ? "G2" : n <= 50 ? "G8" : ["G1", "G3", "G4", "G5", "G6", "G7", "G9", "G10"][(n - 51) % 8], n === 1 ? "leader" : "member", String(200000000000000000n + BigInt(n))]);
  await db.query("insert into guild_members values($1,'Communautaire exemple',null,'community_member','inactive','community','active',null,null)", [fixtureId(300)]);
  await db.exec(await readFile(new URL("intersaison_roster_simulations.sql", import.meta.url), "utf8"));
  const calls = [];
  const legacyCalls = [];
  const api = createRosterSimulationHandler({
    from(table) {
      if (table !== "guild_members") throw Error("Unexpected fixture table");
      return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: member }; } };
    },
    async rpc(name, args) {
      if (name !== "roster_simulation_request") throw Error("Unexpected fixture function");
      calls.push(structuredClone(args));
      try { return { data: (await db.query("select roster_simulation_request($1,$2,$3,$4,$5) v", [args.p_actor, args.p_action, args.p_simulation, args.p_expected, args.p_payload])).rows[0].v }; }
      catch (e) { return { error: { code: e.code, message: e.message } }; }
    },
  });
  const server = await createServer({ define: { "import.meta.env.VITE_API_BASE_URL": '""' }, server: { host: "127.0.0.1", port, strictPort: true }, plugins: [{
    name: "isolated-roster-simulation-preview",
    resolveId(id) { if (id === moduleId) return "\0" + moduleId; },
    load(id) { if (id === "\0" + moduleId) return transformWithEsbuild(fixture, "roster-simulation-preview.jsx", { loader: "jsx", jsx: "automatic" }); },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url.startsWith("/api/portal-roster-simulations")) { await api(req, res); return; }
        if (req.url === "/api/portal-intersaison" && req.method === "POST") {
          const body = await readJsonBody(req);
          if (!["load", "load-survey-center"].includes(body.action)) { res.statusCode = 403; res.end("Legacy mutations forbidden"); return; }
          legacyCalls.push(body.action);
          const organization = { id: fixtureId(900), organization_key: "paladin", display_name: "Paladin fictif" };
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true, state: { organization, guilds: [], dashboards: [], assignments: [], notes: [], campaign: null },
            surveyCenter: { organization, guilds: [], campaigns: [], members: [], surveySchemaReady: true } })); return;
        }
        if (req.url.startsWith("/api/")) { res.statusCode = 403; res.end("Real APIs forbidden in isolated preview"); return; }
        if (!req.url.startsWith("/__roster-simulation-preview")) { next(); return; }
        res.setHeader("Content-Type", "text/html;charset=utf-8");
        res.setHeader("Set-Cookie", `portal_session=${token}; Path=/; HttpOnly; SameSite=Strict`);
        res.end(await server.transformIndexHtml("/__roster-simulation-preview", `<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Simulation locale - comptes fictifs</title></head><body><div id="root"></div><script type="module" src="/@id/__x00__${moduleId}"></script></body></html>`));
      });
    },
  }] });
  await server.listen();
  return { server, db, calls, legacyCalls, url: `http://127.0.0.1:${server.httpServer.address().port}/__roster-simulation-preview`, async close() { await server.close(); await db.close(); } };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const preview = await startRosterSimulationPreview(Number(process.env.ROSTER_PREVIEW_PORT || 0));
  console.log(`ISOLATED_PREVIEW=${preview.url}`);
  console.log("Fictional accounts, isolated PostgreSQL, no production access. Changes persist only for this preview process.");
}
