/* global process */
import { createClient } from "@supabase/supabase-js";
import { applyPortalCorsHeaders, readJsonBody, requirePortalSession, sendPortalJson, verifyPortalRequestOrigin } from "./_portal-auth.js";

const READ = new Set(["list", "detail", "search"]);
const WRITE = new Set(["create", "sync", "move", "restore", "undo", "reset", "add", "rename", "visibility", "archive"]);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const KEYS = { create: ["name"], move: ["members", "destination"], restore: ["members"], reset: ["confirmed"],
  add: ["memberId"], rename: ["name"], visibility: ["guilds"], archive: ["confirmed"], search: ["query"] };

export function createRosterSimulationHandler(db) {
  return async (req, res) => {
    applyPortalCorsHeaders(req, res);
    const send = (status, data) => sendPortalJson(res, status, data, req);
    if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }
    if (!["GET", "POST"].includes(req.method)) { send(405, { ok: false, error: "Methode non autorisee." }); return; }
    if (req.method === "POST" && !verifyPortalRequestOrigin(req)) { send(403, { ok: false, error: "Origine refusee." }); return; }
    try {
      const session = await requirePortalSession(req, db);
      if (session.error) { send(session.status, { ok: false, error: session.error }); return; }
      const body = req.method === "GET" ? Object.fromEntries(new URL(req.url, "http://localhost").searchParams) : await readJsonBody(req);
      const action = body?.action || "list";
      if (!(req.method === "GET" ? READ : WRITE).has(action)) { send(400, { ok: false, error: "Action de simulation inconnue." }); return; }
      if (!["list", "search"].includes(action) && !UUID.test(body.simulationId || "")) { send(400, { ok: false, error: "Simulation invalide." }); return; }
      const source = req.method === "GET" ? body : body.payload || {};
      const payload = Object.fromEntries((KEYS[action] || []).filter(key => source[key] !== undefined).map(key => [key, source[key]]));
      const { data, error } = await db.rpc("roster_simulation_request", { p_actor: session.member.id, p_action: action,
        p_simulation: body.simulationId || null, p_expected: Number.isInteger(body.expectedRevision) ? body.expectedRevision : null, p_payload: payload });
      if (error) {
        const schema = ["42P01", "42883", "PGRST202", "PGRST205"].includes(error.code);
        const status = schema ? 428 : error.code === "42501" ? 403 : error.code === "P0002" ? 404
          : ["40001", "55P03", "23505"].includes(error.code) ? 409 : ["22023", "22P02", "23514", "23502"].includes(error.code) ? 400 : 500;
        send(status, { ok: false, schemaReady: !schema, error: schema ? "Installation SQL du simulateur requise."
          : status === 500 ? "Simulation temporairement indisponible." : error.message }); return;
      }
      send(200, { ok: true, schemaReady: true, ...data });
    } catch { send(400, { ok: false, error: "Requete de simulation invalide." }); }
  };
}
let handler;
export default function endpoint(req, res) {
  handler ||= createRosterSimulationHandler(createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }));
  return handler(req, res);
}
