/* global process */
import { createClient } from "@supabase/supabase-js";
import {
  applyPortalCorsHeaders,
  readJsonBody,
  requirePortalSession,
  sendPortalJson,
  verifyPortalRequestOrigin,
} from "./_portal-auth.js";
import {
  isMissingProfileCosmeticsSchema,
  loadProfileCosmeticsState,
  saveProfileCosmeticsSelection,
} from "./_portal-cosmetics.js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function cleanText(value, maxLength = 120) {
  return String(value || "").trim().slice(0, maxLength);
}

async function readProfileCosmetics(req, res, member) {
  const state = await loadProfileCosmeticsState(supabase, member);
  sendPortalJson(res, 200, state, req);
}

async function saveProfileCosmetics(req, res, member, body) {
  try {
    const state = await saveProfileCosmeticsSelection(supabase, member, body);
    sendPortalJson(res, 200, state, req);
  } catch (error) {
    if (isMissingProfileCosmeticsSchema(error)) {
      sendPortalJson(res, 409, {
        error: "Tables des cosmetiques de profil manquantes. Execute scripts/profile_cosmetics.sql.",
        schemaReady: false,
      }, req);
      return;
    }

    sendPortalJson(res, error.statusCode || error.status || 500, {
      error: error?.message || "Sauvegarde du profil impossible.",
    }, req);
  }
}

export default async function handler(req, res) {
  try {
    applyPortalCorsHeaders(req, res);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (!["GET", "POST"].includes(req.method)) {
      sendPortalJson(res, 405, { error: "Method not allowed" }, req);
      return;
    }

    if (!verifyPortalRequestOrigin(req)) {
      sendPortalJson(res, 403, { error: "Origine de la requete refusee." }, req);
      return;
    }

    const sessionResult = await requirePortalSession(req, supabase);
    if (sessionResult.error) {
      sendPortalJson(res, sessionResult.status || 401, { error: sessionResult.error }, req);
      return;
    }

    if (req.method === "GET") {
      await readProfileCosmetics(req, res, sessionResult.member);
      return;
    }

    const body = await readJsonBody(req);
    const action = cleanText(body.action || req.query?.action).toLowerCase();

    if (action === "save" || action === "save-selection") {
      await saveProfileCosmetics(req, res, sessionResult.member, body);
      return;
    }

    sendPortalJson(res, 400, { error: "Action cosmetiques profil inconnue." }, req);
  } catch (error) {
    sendPortalJson(res, error.status || 500, {
      error: error?.message || "Erreur cosmetiques profil.",
    }, req);
  }
}
