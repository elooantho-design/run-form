/* global process */
import { createClient } from "@supabase/supabase-js";
import {
  applyPortalCorsHeaders,
  isPortalCommunityRole,
  isPortalLeaderRole,
  normalizePortalText,
  readJsonBody,
  requirePortalAdminSession,
  sendPortalJson,
  validatePortalInput,
  verifyPortalRequestOrigin,
} from "./_portal-auth.js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const PALADIN_CLUSTER_GUILD_CODES = new Set(["G1", "G2", "G3", "G4", "G5", "G6", "G7"]);
const ASSIGNMENT_SELECT = `
  id,
  campaign_id,
  dashboard_id,
  member_id,
  watcher_name,
  discord_id_raw,
  source_guild_code,
  target_guild_code,
  poll_choice,
  assignment_source,
  has_note,
  created_at,
  updated_at,
  is_manually_confirmed,
  wished_guild_codes
`;

function sendJson(res, status, payload, req = null) {
  sendPortalJson(res, status, payload, req);
}

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeGuildCode(value) {
  return cleanText(value).toUpperCase().replace(/\s+/g, "_");
}

function isPaladinGuildCode(value) {
  return PALADIN_CLUSTER_GUILD_CODES.has(normalizeGuildCode(value));
}

function isCommunityAccount(member) {
  return normalizePortalText(member?.community_access_type) === "community" || isPortalCommunityRole(member?.role);
}

function canManageIntersaison(actor) {
  if (!actor || isCommunityAccount(actor)) return false;
  if (isPortalLeaderRole(actor.role)) return true;
  return isPaladinGuildCode(actor.guild_code);
}

async function logPortalActivity(actor, { actionType, entityType, entityId = null, summary, metadata = {} }) {
  try {
    await supabase.from("portal_activity_logs").insert({
      actor_member_id: actor.id,
      actor_name: actor.watcher_name || "Admin",
      target_member_id: actor.id,
      target_name: actor.watcher_name || "Admin",
      action_type: actionType,
      entity_type: entityType,
      entity_id: entityId,
      summary,
      metadata,
    });
  } catch (error) {
    console.warn("[portal-intersaison] activity log failed:", error?.message || error);
  }
}

async function loadActiveCampaign() {
  const { data, error } = await supabase
    .from("intersaison_campaigns")
    .select("*")
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadState() {
  const campaign = await loadActiveCampaign();
  if (!campaign) {
    return {
      campaign: null,
      dashboards: [],
      assignments: [],
      notes: [],
    };
  }

  const [{ data: dashboards, error: dashboardsError }, { data: assignments, error: assignmentsError }] =
    await Promise.all([
      supabase
        .from("intersaison_dashboards")
        .select("*")
        .eq("campaign_id", campaign.id)
        .order("sort_order", { ascending: true }),
      supabase
        .from("intersaison_assignments")
        .select(ASSIGNMENT_SELECT)
        .eq("campaign_id", campaign.id)
        .order("created_at", { ascending: true }),
    ]);
  if (dashboardsError) throw dashboardsError;
  if (assignmentsError) throw assignmentsError;

  const assignmentIds = (assignments || []).map((assignment) => assignment.id).filter(Boolean);
  let notes = [];
  if (assignmentIds.length > 0) {
    const { data: loadedNotes, error: notesError } = await supabase
      .from("intersaison_notes")
      .select("*")
      .in("assignment_id", assignmentIds)
      .order("updated_at", { ascending: false });
    if (notesError) throw notesError;
    notes = loadedNotes || [];
  }

  return {
    campaign,
    dashboards: dashboards || [],
    assignments: assignments || [],
    notes,
  };
}

async function loadAssignmentForActiveCampaign(assignmentId) {
  const campaign = await loadActiveCampaign();
  if (!campaign) return { error: "Aucune campagne intersaison active.", status: 404 };

  const id = validatePortalInput(assignmentId, 80);
  if (!id) return { error: "Assignation invalide.", status: 400 };

  const { data, error } = await supabase
    .from("intersaison_assignments")
    .select(ASSIGNMENT_SELECT)
    .eq("campaign_id", campaign.id)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { error: "Assignation introuvable.", status: 404 };

  return { campaign, assignment: data };
}

async function deleteCampaignRows(campaignId) {
  const { data: assignmentRows, error: readAssignmentsError } = await supabase
    .from("intersaison_assignments")
    .select("id")
    .eq("campaign_id", campaignId);
  if (readAssignmentsError) throw readAssignmentsError;

  const assignmentIds = (assignmentRows || []).map((assignment) => assignment.id).filter(Boolean);
  if (assignmentIds.length > 0) {
    const { error: notesError } = await supabase
      .from("intersaison_notes")
      .delete()
      .in("assignment_id", assignmentIds);
    if (notesError) throw notesError;
  }

  const { error: assignmentsError } = await supabase
    .from("intersaison_assignments")
    .delete()
    .eq("campaign_id", campaignId);
  if (assignmentsError) throw assignmentsError;

  const { error: dashboardsError } = await supabase
    .from("intersaison_dashboards")
    .delete()
    .eq("campaign_id", campaignId);
  if (dashboardsError) throw dashboardsError;

  const { error: campaignError } = await supabase.from("intersaison_campaigns").delete().eq("id", campaignId);
  if (campaignError) throw campaignError;
}

async function handleCreateCampaign(body, actor) {
  const guildCount = Number.parseInt(body.guildCount, 10);
  if (!Number.isInteger(guildCount) || guildCount < 1 || guildCount > 20) {
    return { status: 400, payload: { ok: false, error: "Le nombre de guildes doit etre entre 1 et 20." } };
  }

  const { error } = await supabase.rpc("create_intersaison_campaign", {
    p_guild_count: guildCount,
    p_poll_channel_id: null,
  });
  if (error) throw error;

  await logPortalActivity(actor, {
    actionType: "intersaison_campaign_create",
    entityType: "intersaison_campaign",
    summary: `${actor.watcher_name || "Admin"} a lance une intersaison`,
    metadata: { guildCount },
  });

  return { status: 200, payload: { ok: true, state: await loadState() } };
}

async function handleSaveNote(body, actor) {
  const loaded = await loadAssignmentForActiveCampaign(body.assignmentId);
  if (loaded.error) return { status: loaded.status, payload: { ok: false, error: loaded.error } };

  const note = validatePortalInput(body.note, 4000);
  const { data: existingNote, error: existingError } = await supabase
    .from("intersaison_notes")
    .select("*")
    .eq("assignment_id", loaded.assignment.id)
    .maybeSingle();
  if (existingError) throw existingError;

  if (!note) {
    if (existingNote?.id) {
      const { error: deleteError } = await supabase.from("intersaison_notes").delete().eq("id", existingNote.id);
      if (deleteError) throw deleteError;
    }
    return { status: 200, payload: { ok: true, state: await loadState() } };
  }

  if (existingNote?.id) {
    const { error: updateError } = await supabase
      .from("intersaison_notes")
      .update({ note, updated_at: new Date().toISOString() })
      .eq("id", existingNote.id);
    if (updateError) throw updateError;
  } else {
    const { error: insertError } = await supabase.from("intersaison_notes").insert({
      assignment_id: loaded.assignment.id,
      note,
      created_by_member_id: actor.id,
    });
    if (insertError) throw insertError;
  }

  return { status: 200, payload: { ok: true, state: await loadState() } };
}

async function handleToggleConfirmation(body) {
  const loaded = await loadAssignmentForActiveCampaign(body.assignmentId);
  if (loaded.error) return { status: loaded.status, payload: { ok: false, error: loaded.error } };

  const nextConfirmedValue = !loaded.assignment.is_manually_confirmed;
  const { error } = await supabase
    .from("intersaison_assignments")
    .update({
      is_manually_confirmed: nextConfirmedValue,
      updated_at: new Date().toISOString(),
    })
    .eq("id", loaded.assignment.id);
  if (error) throw error;

  return { status: 200, payload: { ok: true, state: await loadState() } };
}

async function handleMoveAssignment(body) {
  const loaded = await loadAssignmentForActiveCampaign(body.assignmentId);
  if (loaded.error) return { status: loaded.status, payload: { ok: false, error: loaded.error } };

  const dashboardId = validatePortalInput(body.dashboardId, 80);
  if (!dashboardId) return { status: 400, payload: { ok: false, error: "Dashboard cible invalide." } };

  const { data: dashboard, error: dashboardError } = await supabase
    .from("intersaison_dashboards")
    .select("*")
    .eq("campaign_id", loaded.campaign.id)
    .eq("id", dashboardId)
    .maybeSingle();
  if (dashboardError) throw dashboardError;
  if (!dashboard) return { status: 404, payload: { ok: false, error: "Dashboard cible introuvable." } };

  const { error } = await supabase
    .from("intersaison_assignments")
    .update({
      dashboard_id: dashboard.id,
      target_guild_code: dashboard.is_draft ? null : dashboard.code,
      is_manually_confirmed: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", loaded.assignment.id);
  if (error) throw error;

  return { status: 200, payload: { ok: true, state: await loadState() } };
}

async function handleSaveWish(body) {
  const loaded = await loadAssignmentForActiveCampaign(body.assignmentId);
  if (loaded.error) return { status: loaded.status, payload: { ok: false, error: loaded.error } };

  const guildCodes = new Set(Array.from({ length: loaded.campaign.guild_count || 7 }, (_, index) => `G${index + 1}`));
  const wishedGuildCodes = Array.isArray(body.wishedGuildCodes)
    ? [...new Set(body.wishedGuildCodes.map(normalizeGuildCode).filter((code) => guildCodes.has(code)))].sort()
    : [];

  const { error } = await supabase
    .from("intersaison_assignments")
    .update({ wished_guild_codes: wishedGuildCodes, updated_at: new Date().toISOString() })
    .eq("id", loaded.assignment.id);
  if (error) throw error;

  return { status: 200, payload: { ok: true, state: await loadState() } };
}

async function handleCancelCampaign(body, actor) {
  const campaign = await loadActiveCampaign();
  const campaignId = validatePortalInput(body.campaignId, 80);
  if (!campaign || String(campaign.id) !== String(campaignId)) {
    return { status: 404, payload: { ok: false, error: "Campagne active introuvable." } };
  }

  const stateBeforeDelete = await loadState();
  await deleteCampaignRows(campaign.id);
  await logPortalActivity(actor, {
    actionType: "intersaison_campaign_cancel",
    entityType: "intersaison_campaign",
    entityId: campaign.id,
    summary: `${actor.watcher_name || "Admin"} a annule la campagne intersaison`,
    metadata: { assignmentCount: stateBeforeDelete.assignments.length },
  });

  return { status: 200, payload: { ok: true, state: await loadState() } };
}

async function handleLaunchTransfers(body, actor) {
  const campaign = await loadActiveCampaign();
  const campaignId = validatePortalInput(body.campaignId, 80);
  if (!campaign || String(campaign.id) !== String(campaignId)) {
    return { status: 404, payload: { ok: false, error: "Campagne active introuvable." } };
  }

  const state = await loadState();
  const unconfirmed = state.assignments.filter((assignment) => !assignment.is_manually_confirmed);
  if (unconfirmed.length > 0) {
    return {
      status: 409,
      payload: { ok: false, error: `${unconfirmed.length} joueur(s) non valides.` },
    };
  }

  const confirmedTransfers = state.assignments.filter(
    (assignment) => assignment.is_manually_confirmed && assignment.member_id && assignment.target_guild_code,
  );
  if (confirmedTransfers.length === 0) {
    return { status: 400, payload: { ok: false, error: "Aucun transfert reel a appliquer." } };
  }

  for (const assignment of confirmedTransfers) {
    const targetGuild = normalizeGuildCode(assignment.target_guild_code);
    if (!isPaladinGuildCode(targetGuild)) {
      return { status: 400, payload: { ok: false, error: "Guilde cible invalide pour l'intersaison." } };
    }

    const { error } = await supabase
      .from("guild_members")
      .update({ guild_code: targetGuild })
      .eq("id", assignment.member_id);
    if (error) throw error;
  }

  await deleteCampaignRows(campaign.id);
  await logPortalActivity(actor, {
    actionType: "intersaison_transfers_apply",
    entityType: "intersaison_campaign",
    entityId: campaign.id,
    summary: `${actor.watcher_name || "Admin"} a applique les transferts intersaison`,
    metadata: { transferCount: confirmedTransfers.length },
  });

  return { status: 200, payload: { ok: true, state: await loadState() } };
}

export default async function handler(req, res) {
  applyPortalCorsHeaders(req, res);
  if (req.method === "OPTIONS") return sendJson(res, 204, {}, req);
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed." }, req);
  if (!verifyPortalRequestOrigin(req)) {
    return sendJson(res, 403, { ok: false, error: "Origine de requete refusee." }, req);
  }

  try {
    const sessionCheck = await requirePortalAdminSession(req, supabase);
    if (sessionCheck.error) {
      return sendJson(res, sessionCheck.status || 401, { ok: false, error: sessionCheck.error }, req);
    }
    if (!canManageIntersaison(sessionCheck.member)) {
      return sendJson(res, 403, { ok: false, error: "Intersaison reservee au cluster Paladin." }, req);
    }

    const body = await readJsonBody(req);
    const action = cleanText(body.action);
    let result;

    if (action === "load") result = { status: 200, payload: { ok: true, state: await loadState() } };
    else if (action === "create-campaign") result = await handleCreateCampaign(body, sessionCheck.member);
    else if (action === "save-note") result = await handleSaveNote(body, sessionCheck.member);
    else if (action === "toggle-confirmation") result = await handleToggleConfirmation(body);
    else if (action === "move-assignment") result = await handleMoveAssignment(body);
    else if (action === "save-wish") result = await handleSaveWish(body);
    else if (action === "cancel-campaign") result = await handleCancelCampaign(body, sessionCheck.member);
    else if (action === "launch-transfers") result = await handleLaunchTransfers(body, sessionCheck.member);
    else result = { status: 400, payload: { ok: false, error: "Action inconnue." } };

    return sendJson(res, result.status, result.payload, req);
  } catch (error) {
    console.error("[portal-intersaison]", error);
    return sendJson(res, 500, { ok: false, error: error.message || "Erreur serveur." }, req);
  }
}
