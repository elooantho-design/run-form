/* global Buffer, process */
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const MAX_LIMIT = 200;

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
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
  if (req.body && typeof req.body === "object") return req.body;

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function handleGet(req, res) {
  const url = new URL(req.url, "http://localhost");
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
  const body = await readBody(req);
  const actionType = cleanText(body.actionType || body.action_type);
  const summary = cleanText(body.summary);

  if (!actionType || !summary) {
    sendJson(res, 400, { error: "actionType et summary sont obligatoires." });
    return;
  }

  const row = {
    actor_member_id: cleanMemberId(body.actorMemberId || body.actor_member_id),
    actor_name: cleanText(body.actorName || body.actor_name, "Systeme"),
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
