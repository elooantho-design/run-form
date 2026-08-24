/* global Buffer, process */
import { createClient } from "@supabase/supabase-js";
import {
  applyPortalCorsHeaders,
  requirePortalAdminSession,
  requirePortalSession,
  sendPortalJson,
  verifyPortalRequestOrigin,
} from "./_portal-auth.js";
import {
  isMissingProfileCosmeticsSchema,
  loadProfileCosmeticsState,
  saveProfileCosmeticFrameMetadata,
  saveProfileCosmeticsSelection,
} from "./_portal-cosmetics.js";
import { publishProfileCosmeticAsset } from "./_portal-cosmetics-publish.js";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "4mb",
    },
  },
};

const MAX_PROFILE_COSMETICS_BODY_BYTES = 4_000_000;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function cleanText(value, maxLength = 120) {
  return String(value || "").trim().slice(0, maxLength);
}

function createPayloadTooLargeError() {
  const error = new Error("Payload cosmetique trop volumineux. Publie un PNG normalise plus leger.");
  error.status = 413;
  return error;
}

function readContentLength(req) {
  const raw = req.headers?.["content-length"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

async function readProfileCosmeticsBody(req) {
  const contentLength = readContentLength(req);
  if (contentLength > MAX_PROFILE_COSMETICS_BODY_BYTES) {
    throw createPayloadTooLargeError();
  }

  if (req.body && typeof req.body === "object") {
    const estimatedBytes = Buffer.byteLength(JSON.stringify(req.body), "utf8");
    if (estimatedBytes > MAX_PROFILE_COSMETICS_BODY_BYTES) {
      throw createPayloadTooLargeError();
    }
    return req.body;
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_PROFILE_COSMETICS_BODY_BYTES) {
      throw createPayloadTooLargeError();
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
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

async function saveFrameMetadata(req, res, body) {
  const adminSession = await requirePortalAdminSession(req, supabase);
  if (adminSession.error) {
    sendPortalJson(res, adminSession.status || 403, { error: adminSession.error }, req);
    return;
  }

  try {
    const state = await saveProfileCosmeticFrameMetadata(supabase, adminSession.member, body);
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
      error: error?.message || "Sauvegarde du cadre impossible.",
    }, req);
  }
}

async function publishCosmeticAsset(req, res, body) {
  const adminSession = await requirePortalAdminSession(req, supabase);
  if (adminSession.error) {
    sendPortalJson(res, adminSession.status || 403, { error: adminSession.error }, req);
    return;
  }

  try {
    const state = await publishProfileCosmeticAsset(supabase, adminSession.member, body);
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
      error: error?.message || "Publication du cosmetique impossible.",
      step: error?.step || "publication",
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

    const body = await readProfileCosmeticsBody(req);
    const action = cleanText(body.action || req.query?.action).toLowerCase();

    if (action === "save" || action === "save-selection") {
      await saveProfileCosmetics(req, res, sessionResult.member, body);
      return;
    }

    if (action === "save-frame-render-metadata" || action === "save-frame-metadata") {
      await saveFrameMetadata(req, res, body);
      return;
    }

    if (action === "publish-cosmetic-asset") {
      await publishCosmeticAsset(req, res, body);
      return;
    }

    sendPortalJson(res, 400, { error: "Action cosmetiques profil inconnue." }, req);
  } catch (error) {
    sendPortalJson(res, error.status || 500, {
      error: error?.message || "Erreur cosmetiques profil.",
    }, req);
  }
}
