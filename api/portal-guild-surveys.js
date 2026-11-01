/* global process */
import { createClient } from "@supabase/supabase-js";
import { applyPortalCorsHeaders, readJsonBody, requirePortalSession, sendPortalJson, verifyPortalRequestOrigin } from "./_portal-auth.js";

const GET_ACTIONS = new Set(["list", "detail", "preview", "reminder-preview", "mine", "answer-form"]);
const POST_ACTIONS = new Set(["save", "publish", "remind", "close", "answer"]);

export function guildSurveyHttpStatus(error) {
  if (error?.code === "42501") return 403;
  if (error?.code === "P0002") return 404;
  if (["40001", "55P03", "23505"].includes(error?.code)) return 409;
  if (["42P01", "42883", "PGRST202", "PGRST205"].includes(error?.code)) return 428;
  if (["22023", "22007", "22008", "23502", "23514", "22P02"].includes(error?.code)) return 400;
  return 500;
}

export function createGuildSurveyHandler(db) {
  return async function handler(req, res) {
    applyPortalCorsHeaders(req, res);
    const send = (status, data) => sendPortalJson(res, status, data, req);
    if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }
    if (!["GET", "POST"].includes(req.method)) { send(405, { ok: false, error: "Methode non autorisee." }); return; }
    if (req.method === "POST" && !verifyPortalRequestOrigin(req)) { send(403, { ok: false, error: "Origine refusee." }); return; }
    try {
      const session = await requirePortalSession(req, db);
      if (session.error) { send(session.status, { ok: false, error: session.error }); return; }
      const body = req.method === "POST" ? await readJsonBody(req) : Object.fromEntries(new URL(req.url, "http://localhost").searchParams);
      const action = String(body?.action || "list");
      if (!(req.method === "GET" ? GET_ACTIONS : POST_ACTIONS).has(action)) { send(400, { ok: false, error: "Action inconnue." }); return; }
      const { data, error } = await db.rpc("guild_survey_request", {
        p_actor: session.member.id, p_action: action, p_survey: body.surveyId || null,
        p_expected: Number.isInteger(body.expectedRevision) ? body.expectedRevision : null,
        p_payload: req.method === "POST" ? body.payload || {} : {},
      });
      if (error) {
        const status = guildSurveyHttpStatus(error);
        send(status, { ok: false, schemaReady: status !== 428,
          error: status === 428 ? "Migration des sondages de guilde non installee." : status === 500 ? "Le sondage est temporairement indisponible." : error.message });
        return;
      }
      send(200, { ok: true, schemaReady: true, ...data });
    } catch {
      send(400, { ok: false, error: "Requete de sondage invalide." });
    }
  };
}

let handler;
export default async function endpoint(req, res) {
  handler ||= createGuildSurveyHandler(createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }));
  return handler(req, res);
}
