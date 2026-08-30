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
  MEMBER_ACTIVITY_REMINDER_COOLDOWN_MS,
  MEMBER_ACTIVITY_REMINDER_TYPE_KEYS,
  PORTAL_MEMBER_REMINDERS_TABLE,
  isMissingPortalMemberRemindersTable,
  isRecentSuccessfulMemberReminder,
  loadPortalMemberActivityOverview,
  normalizeMemberActivityReminderType,
  serializeMemberReminder,
  touchPortalMemberLastSeen,
} from "./_portal-member-activity.js";
import {
  DISCORD_LOG_REMINDERS_CAPABILITY,
  hasDiscordCapability,
  loadDiscordCapabilitiesForOrganization,
} from "./_portal-discord-capabilities.js";
import { sendDiscordDm } from "../src/lib/discordReproServer.js";

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

function isValidDiscordUserId(value) {
  return /^\d{15,25}$/.test(cleanText(value));
}

function findOverviewMember(overview, memberId) {
  const cleanId = cleanMemberId(memberId);
  if (!cleanId) return null;

  for (const guild of overview?.guilds || []) {
    const member = (guild.members || []).find((row) => String(row.memberId || row.id) === String(cleanId));
    if (member) return member;
  }
  return null;
}

function cleanMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

async function readBody(req) {
  return readJsonBody(req);
}

async function loadReminderHistory({ organizationId, memberId, reminderType, limit = 20 }) {
  const { data, error } = await supabase
    .from(PORTAL_MEMBER_REMINDERS_TABLE)
    .select(
      "id, organization_id, guild_code, member_id, reminder_type, sent_by_member_id, sent_by_name, discord_user_id, message, status, error_message, created_at, updated_at",
    )
    .eq("organization_id", organizationId)
    .eq("member_id", memberId)
    .eq("reminder_type", reminderType)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (isMissingPortalMemberRemindersTable(error)) {
      return { schemaReady: false, reminders: [] };
    }
    throw error;
  }

  return { schemaReady: true, reminders: (data || []).map(serializeMemberReminder) };
}

async function loadScopedReminderTarget(actor, memberId, reminderType) {
  const overview = await loadPortalMemberActivityOverview(supabase, actor);
  const member = findOverviewMember(overview, memberId);
  if (!member) {
    const error = new Error("Joueur hors perimetre.");
    error.statusCode = 403;
    throw error;
  }

  if (!MEMBER_ACTIVITY_REMINDER_TYPE_KEYS.includes(reminderType)) {
    const error = new Error("Type de relance invalide.");
    error.statusCode = 400;
    throw error;
  }

  return { overview, member };
}

async function insertReminderAttempt({ organizationId, member, reminderType, actor, discordUserId, message }) {
  const { data, error } = await supabase
    .from(PORTAL_MEMBER_REMINDERS_TABLE)
    .insert({
      organization_id: organizationId,
      guild_code: member.guildCode,
      member_id: member.memberId,
      reminder_type: reminderType,
      sent_by_member_id: actor.id,
      sent_by_name: cleanText(actor.watcher_name || actor.discord_id, "Admin"),
      discord_user_id: discordUserId,
      message,
      status: "pending",
    })
    .select(
      "id, organization_id, guild_code, member_id, reminder_type, sent_by_member_id, sent_by_name, discord_user_id, message, status, error_message, created_at, updated_at",
    )
    .single();

  if (error) {
    if (isMissingPortalMemberRemindersTable(error)) {
      const missing = new Error("Migration portal_member_reminders non executee.");
      missing.statusCode = 428;
      throw missing;
    }
    throw error;
  }

  return data;
}

async function finishReminderAttempt(reminderId, patch) {
  if (!reminderId) return null;

  const { data, error } = await supabase
    .from(PORTAL_MEMBER_REMINDERS_TABLE)
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq("id", reminderId)
    .select(
      "id, organization_id, guild_code, member_id, reminder_type, sent_by_member_id, sent_by_name, discord_user_id, message, status, error_message, created_at, updated_at",
    )
    .single();

  if (error) throw error;
  return data;
}

async function logReminderActivity({ actor, member, reminder, actionType, summary, errorMessage = "" }) {
  try {
    await supabase.from("portal_activity_logs").insert({
      actor_member_id: actor.id,
      actor_name: cleanText(actor.watcher_name || actor.discord_id, "Admin"),
      target_member_id: member.memberId,
      target_name: member.name || member.watcherName || "Joueur",
      action_type: actionType,
      entity_type: "portal_member_reminders",
      entity_id: reminder?.id || null,
      summary,
      metadata: {
        organizationId: reminder?.organization_id || reminder?.organizationId || "",
        guildCode: member.guildCode || "",
        reminderType: reminder?.reminder_type || reminder?.reminderType || "",
        discordUserId: reminder?.discord_user_id || reminder?.discordUserId || "",
        status: reminder?.status || "",
        errorMessage,
      },
    });
  } catch (error) {
    console.warn("[portal-activity] reminder audit log failed:", error?.message || error);
  }
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

  if (action === "reminder-history") {
    try {
      const reminderType = normalizeMemberActivityReminderType(url.searchParams.get("reminderType"));
      const memberId = cleanMemberId(url.searchParams.get("memberId"));
      const { overview, member } = await loadScopedReminderTarget(sessionCheck.member, memberId, reminderType);
      const organizationId = overview.organization?.id || "";
      const history = await loadReminderHistory({ organizationId, memberId: member.memberId, reminderType });
      sendJson(res, 200, {
        ok: true,
        mode: "reminder-history",
        organization: overview.organization,
        member,
        ...history,
      });
    } catch (error) {
      sendJson(res, error?.statusCode || 500, {
        ok: false,
        error: error.message || "Historique de relance impossible.",
      });
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

async function handleUpdateReminderDiscordId(req, res, body) {
  const adminCheck = await requirePortalAdminSession(req, supabase);
  if (adminCheck.error) {
    sendJson(res, adminCheck.status, { error: adminCheck.error });
    return;
  }

  const reminderType = normalizeMemberActivityReminderType(body.reminderType || body.reminder_type || MEMBER_ACTIVITY_REMINDER_TYPE_KEYS[0]);
  const memberId = cleanMemberId(body.memberId || body.member_id);
  const discordId = cleanText(body.discordId || body.discord_id);

  if (discordId && !isValidDiscordUserId(discordId)) {
    sendJson(res, 400, { error: "ID Discord invalide." });
    return;
  }

  try {
    const { member } = await loadScopedReminderTarget(adminCheck.member, memberId, reminderType);
    const { error } = await supabase
      .from("guild_members")
      .update({ discord_id: discordId || null })
      .eq("id", member.memberId);

    if (error) throw error;

    await supabase.from("portal_activity_logs").insert({
      actor_member_id: adminCheck.member.id,
      actor_name: cleanText(adminCheck.member.watcher_name || adminCheck.member.discord_id, "Admin"),
      target_member_id: member.memberId,
      target_name: member.name || member.watcherName || "Joueur",
      action_type: "member_reminder_discord_id_update",
      entity_type: "guild_members",
      entity_id: member.memberId,
      summary: `${member.name || "Joueur"} : ID Discord mis a jour depuis les relances`,
      metadata: { guildCode: member.guildCode || "", hasDiscordId: Boolean(discordId) },
    });

    sendJson(res, 200, { ok: true, memberId: member.memberId, discordId });
  } catch (error) {
    sendJson(res, error?.statusCode || 500, { error: error.message || "Mise a jour ID Discord impossible." });
  }
}

async function handleSendReminder(req, res, body) {
  const adminCheck = await requirePortalAdminSession(req, supabase);
  if (adminCheck.error) {
    sendJson(res, adminCheck.status, { error: adminCheck.error });
    return;
  }

  const reminderType = normalizeMemberActivityReminderType(body.reminderType || body.reminder_type);
  const memberId = cleanMemberId(body.memberId || body.member_id);
  const message = cleanText(body.message);
  const discordUserId = cleanText(body.discordId || body.discord_id || body.discordUserId || body.discord_user_id);

  if (!memberId || !reminderType) {
    sendJson(res, 400, { error: "Joueur ou type de relance manquant." });
    return;
  }

  if (!message || message.length > 1800) {
    sendJson(res, 400, { error: "Message de relance invalide." });
    return;
  }

  if (!isValidDiscordUserId(discordUserId)) {
    sendJson(res, 400, { error: "ID Discord invalide ou manquant." });
    return;
  }

  let reminderAttempt = null;
  let scopedMember = null;
  try {
    const { overview, member } = await loadScopedReminderTarget(adminCheck.member, memberId, reminderType);
    scopedMember = member;
    const organizationId = overview.organization?.id || "";
    const capabilityAccess = await loadDiscordCapabilitiesForOrganization(supabase, organizationId);
    if (!capabilityAccess.schemaReady) {
      sendJson(res, 428, { error: "Migration capabilities Discord non executee." });
      return;
    }
    if (!hasDiscordCapability(capabilityAccess.capabilities, DISCORD_LOG_REMINDERS_CAPABILITY)) {
      sendJson(res, 403, {
        error:
          "Cette fonctionnalite n'est pas activee pour votre organisation. Pour l'activer, contactez Darius.",
      });
      return;
    }

    const latestSuccess = member.lastReminders?.[reminderType];
    if (isRecentSuccessfulMemberReminder(latestSuccess)) {
      sendJson(res, 409, {
        error: "Ce joueur a deja ete relance recemment pour ce module.",
        cooldownMs: MEMBER_ACTIVITY_REMINDER_COOLDOWN_MS,
        lastReminder: latestSuccess,
      });
      return;
    }

    reminderAttempt = await insertReminderAttempt({
      organizationId,
      member,
      reminderType,
      actor: adminCheck.member,
      discordUserId,
      message,
    });

    const dmResult = await sendDiscordDm(discordUserId, message);
    if (!dmResult?.sent && !dmResult?.message_id) {
      const error = new Error("Impossible d'envoyer un MP Discord.");
      error.statusCode = 502;
      throw error;
    }

    const savedReminder = await finishReminderAttempt(reminderAttempt.id, {
      status: "success",
      error_message: null,
    });
    await logReminderActivity({
      actor: adminCheck.member,
      member,
      reminder: savedReminder,
      actionType: "member_activity_reminder_sent",
      summary: `${adminCheck.member.watcher_name || "Admin"} a relance ${member.name || "Joueur"} (${reminderType})`,
    });

    sendJson(res, 200, {
      ok: true,
      reminder: serializeMemberReminder(savedReminder),
      discord: dmResult,
    });
  } catch (error) {
    let failedReminder = reminderAttempt;
    if (reminderAttempt?.id) {
      try {
        failedReminder = await finishReminderAttempt(reminderAttempt.id, {
          status: "failed",
          error_message: error?.message || "Erreur Discord inconnue.",
        });
      } catch (saveError) {
        console.warn("[portal-activity] reminder failure save failed:", saveError?.message || saveError);
      }
    }

    if (failedReminder) {
      await logReminderActivity({
        actor: adminCheck.member,
        member: scopedMember || {
          memberId,
          guildCode: "",
          name: "",
        },
        reminder: failedReminder,
        actionType: "member_activity_reminder_failed",
        summary: "Echec d'envoi d'une relance Discord",
        errorMessage: error?.message || "Erreur Discord inconnue.",
      });
    }

    sendJson(res, error?.statusCode || 502, {
      ok: false,
      error: error?.message || "Envoi Discord impossible.",
      reminder: failedReminder ? serializeMemberReminder(failedReminder) : null,
    });
  }
}

async function handlePost(req, res) {
  const body = await readBody(req);
  const action = cleanText(body.action);

  if (action === "update-reminder-discord-id") {
    await handleUpdateReminderDiscordId(req, res, body);
    return;
  }

  if (action === "send-reminder") {
    await handleSendReminder(req, res, body);
    return;
  }

  const sessionCheck = await requirePortalSession(req, supabase);
  if (sessionCheck.error) {
    sendJson(res, sessionCheck.status, { error: sessionCheck.error });
    return;
  }

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
