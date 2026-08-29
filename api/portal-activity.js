/* global process */
import { createClient } from "@supabase/supabase-js";
import {
  applyPortalCorsHeaders,
  readJsonBody,
  requirePortalAdminSession,
  requirePortalSession,
  sendPortalJson,
  verifyPortalRequestOrigin,
} from "./_portal-auth.js";
import {
  loadPortalMemberActivityOverview,
  touchPortalMemberLastSeen,
} from "./_portal-member-activity.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const MAX_LIMIT = 200;

function sendJson(res, status, payload) {
  sendPortalJson(res, status, payload, res._portalReq || null);
}

function cleanText(value, fallback = "") {
  return String(value || fallback).trim();
}

function cleanMemberId(value) {
  const text = cleanText(value);
  return text || null;
}

function cleanMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

async function readBody(req) {
  return readJsonBody(req);
}

async function handleGet(req, res) {
  const sessionCheck = await requirePortalAdminSession(req, supabase);
  if (sessionCheck.error) {
    sendJson(res, sessionCheck.status, { error: sessionCheck.error });
    return;
  }

  const url = new URL(req.url, "http://localhost");
  const action = cleanText(url.searchParams.get("action"));
  if (action === "overview") {
    try {
      const overview = await loadPortalMemberActivityOverview(supabase, sessionCheck.member);
      sendJson(res, 200, { ok: true, mode: "overview", ...overview });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || "Impossible de charger le suivi des membres." });
    }
    return;
  }

  const memberId = cleanMemberId(url.searchParams.get("memberId"));
  const actionType = cleanText(url.searchParams.get("actionType"));
  const limit = Math.min(Number(url.searchParams.get("limit") || 80) || 80, MAX_LIMIT);

  let query = supabase
    .from("portal_activity_logs")
    .select("id, created_at, actor_member_id, actor_name, target_member_id, target_name, action_type, entity_type, entity_id, summary, metadata")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (memberId) {
    query = query.or(`actor_member_id.eq.${memberId},target_member_id.eq.${memberId}`);
  }

  if (actionType && actionType !== "all") {
    query = query.eq("action_type", actionType);
  }

  const { data, error } = await query;

  if (error) {
    sendJson(res, 500, { error: error.message || "Impossible de charger les logs." });
    return;
  }

  sendJson(res, 200, { logs: data || [] });
}

async function handlePost(req, res) {
  const sessionCheck = await requirePortalSession(req, supabase);
  if (sessionCheck.error) {
    sendJson(res, sessionCheck.status, { error: sessionCheck.error });
    return;
  }

  const body = await readBody(req);
  const action = cleanText(body.action);
  if (action === "heartbeat") {
    const touchResult = await touchPortalMemberLastSeen(supabase, sessionCheck.member.id);
    sendJson(res, 200, { ok: true, activityStateReady: !touchResult.missing, ...touchResult });
    return;
  }

  const actionType = cleanText(body.actionType || body.action_type);
  const summary = cleanText(body.summary);

  if (!actionType || !summary) {
    sendJson(res, 400, { error: "actionType et summary sont obligatoires." });
    return;
  }

  const row = {
    actor_member_id: cleanMemberId(sessionCheck.member.id),
    actor_name: cleanText(sessionCheck.member.watcher_name || sessionCheck.member.discord_id, "Systeme"),
    target_member_id: cleanMemberId(body.targetMemberId || body.target_member_id),
    target_name: cleanText(body.targetName || body.target_name),
    action_type: actionType,
    entity_type: cleanText(body.entityType || body.entity_type) || null,
    entity_id: cleanText(body.entityId || body.entity_id) || null,
    summary,
    metadata: cleanMetadata(body.metadata),
  };

  const { data, error } = await supabase
    .from("portal_activity_logs")
    .insert(row)
    .select("id, created_at")
    .single();

  if (error) {
    sendJson(res, 500, { error: error.message || "Impossible d'ecrire le log." });
    return;
  }

  sendJson(res, 201, { log: data });
}

export default async function handler(req, res) {
  try {
    res._portalReq = req;
    applyPortalCorsHeaders(req, res);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (!verifyPortalRequestOrigin(req)) {
      sendJson(res, 403, { error: "Origine de la requete refusee." });
      return;
    }

    if (req.method === "GET") {
      await handleGet(req, res);
      return;
    }

    if (req.method === "POST") {
      await handlePost(req, res);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(res, 500, { error: error?.message || "Erreur portal activity." });
  }
}
