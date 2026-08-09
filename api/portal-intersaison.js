/* global process */
import { createClient } from "@supabase/supabase-js";
import {
  applyPortalCorsHeaders,
  isPortalCommunityRole,
  normalizePortalText,
  readJsonBody,
  requirePortalAdminSession,
  sendPortalJson,
  validatePortalInput,
  verifyPortalRequestOrigin,
} from "./_portal-auth.js";
import {
  buildIntersaisonValidationPreview,
  cleanIntersaisonText,
  normalizeIntersaisonCode,
} from "./_portal-intersaison-core.js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const ASSIGNMENT_SELECT = `
  id,
  campaign_id,
  organization_id,
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
const MEMBER_VALIDATION_SELECT =
  "id, watcher_name, guild_code, role, community_access_type, community_status, roster_status";
const GUILD_SELECT = "id, organization_id, guild_code, display_name, is_active";

function sendJson(res, status, payload, req = null) {
  sendPortalJson(res, status, payload, req);
}

function cleanText(value) {
  return cleanIntersaisonText(value);
}

function normalizeGuildCode(value) {
  return normalizeIntersaisonCode(value);
}

function isCommunityAccount(member) {
  return normalizePortalText(member?.community_access_type) === "community" || isPortalCommunityRole(member?.role);
}

function canManageIntersaison(actor) {
  return Boolean(actor && !isCommunityAccount(actor));
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

function serializeOrganization(row) {
  if (!row) return null;
  return {
    id: row.id,
    organization_key: row.organization_key,
    organizationKey: row.organization_key,
    display_name: row.display_name,
    displayName: row.display_name,
    organization_type: row.organization_type,
    organizationType: row.organization_type,
    is_active: row.is_active,
    isActive: row.is_active,
  };
}

async function loadOrganizationById(organizationId) {
  const { data, error } = await supabase
    .from("portal_organizations")
    .select("id, organization_key, display_name, organization_type, is_active")
    .eq("id", organizationId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function resolveActorOrganization(actor) {
  const actorGuildCode = cleanText(actor?.guild_code);
  if (!actorGuildCode || isCommunityAccount(actor)) {
    const error = new Error("Compte hors organisation.");
    error.statusCode = 403;
    throw error;
  }

  const { data: guild, error: guildError } = await supabase
    .from("portal_guilds")
    .select(GUILD_SELECT)
    .eq("guild_code", normalizeGuildCode(actorGuildCode))
    .eq("is_active", true)
    .maybeSingle();
  if (guildError) throw guildError;
  if (!guild?.organization_id) {
    const error = new Error("Organisation introuvable pour cette session.");
    error.statusCode = 403;
    throw error;
  }

  const organization = await loadOrganizationById(guild.organization_id);
  if (!organization) {
    const error = new Error("Organisation inactive ou introuvable.");
    error.statusCode = 403;
    throw error;
  }

  return { organization: serializeOrganization(organization), actorGuild: guild };
}

async function loadActiveGuilds(organizationId) {
  const { data, error } = await supabase
    .from("portal_guilds")
    .select(GUILD_SELECT)
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("guild_code", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function loadActiveCampaign(organizationId) {
  const { data, error } = await supabase
    .from("intersaison_campaigns")
    .select("*")
    .eq("status", "active")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadState(organization) {
  const guilds = await loadActiveGuilds(organization.id);
  const campaign = await loadActiveCampaign(organization.id);
  if (!campaign) {
    return {
      organization,
      guilds,
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
        .eq("organization_id", organization.id)
        .order("sort_order", { ascending: true }),
      supabase
        .from("intersaison_assignments")
        .select(ASSIGNMENT_SELECT)
        .eq("campaign_id", campaign.id)
        .eq("organization_id", organization.id)
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
    organization,
    guilds,
    campaign,
    dashboards: dashboards || [],
    assignments: assignments || [],
    notes,
  };
}

async function loadAssignmentForActiveCampaign(assignmentId, organization) {
  const campaign = await loadActiveCampaign(organization.id);
  if (!campaign) return { error: "Aucune campagne intersaison active.", status: 404 };

  const id = validatePortalInput(assignmentId, 80);
  if (!id) return { error: "Assignation invalide.", status: 400 };

  const { data, error } = await supabase
    .from("intersaison_assignments")
    .select(ASSIGNMENT_SELECT)
    .eq("campaign_id", campaign.id)
    .eq("organization_id", organization.id)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { error: "Assignation introuvable.", status: 404 };

  return { campaign, assignment: data };
}

async function loadMembersForAssignments(assignments) {
  const memberIds = [...new Set((assignments || []).map((assignment) => assignment.member_id).filter(Boolean))];
  if (memberIds.length === 0) return [];

  const { data, error } = await supabase
    .from("guild_members")
    .select(MEMBER_VALIDATION_SELECT)
    .in("id", memberIds);
  if (error) throw error;
  return data || [];
}

async function loadGuildsForMemberValidation({ members, activeGuilds }) {
  const guildCodes = [
    ...new Set(
      [...(members || []), ...(activeGuilds || [])]
        .map((row) => cleanText(row.guild_code))
        .filter(Boolean),
    ),
  ];
  if (guildCodes.length === 0) return [];

  const { data, error } = await supabase.from("portal_guilds").select(GUILD_SELECT).in("guild_code", guildCodes);
  if (error) throw error;
  return data || [];
}

async function buildValidationPreviewForOrganization(organization) {
  const state = await loadState(organization);
  if (!state.campaign) {
    const error = new Error("Campagne active introuvable.");
    error.statusCode = 404;
    throw error;
  }

  const members = await loadMembersForAssignments(state.assignments);
  const memberGuilds = await loadGuildsForMemberValidation({ members, activeGuilds: state.guilds });
  const preview = buildIntersaisonValidationPreview({
    campaign: state.campaign,
    dashboards: state.dashboards,
    assignments: state.assignments,
    members,
    memberGuilds,
    activeGuilds: state.guilds,
  });

  return { state, preview };
}

async function handleCreateCampaign(actor, organization) {
  const { data: campaignId, error } = await supabase.rpc("create_intersaison_campaign_for_organization", {
    p_organization_id: organization.id,
    p_poll_channel_id: null,
  });
  if (error) throw error;

  await logPortalActivity(actor, {
    actionType: "intersaison_campaign_create",
    entityType: "intersaison_campaign",
    entityId: campaignId || null,
    summary: `${actor.watcher_name || "Admin"} a lance une intersaison pour ${organization.display_name}`,
    metadata: { organizationId: organization.id, organizationKey: organization.organization_key },
  });

  return { status: 200, payload: { ok: true, state: await loadState(organization) } };
}

async function handleSaveNote(body, actor, organization) {
  const loaded = await loadAssignmentForActiveCampaign(body.assignmentId, organization);
  if (loaded.error) return { status: loaded.status, payload: { ok: false, error: loaded.error } };

  const note = validatePortalInput(body.note, 4000);
  const { error } = await supabase.rpc("save_intersaison_assignment_note_for_organization", {
    p_campaign_id: loaded.campaign.id,
    p_organization_id: organization.id,
    p_assignment_id: loaded.assignment.id,
    p_note: note,
    p_actor_member_id: actor.id,
  });
  if (error) throw error;

  return { status: 200, payload: { ok: true, state: await loadState(organization) } };
}

async function handleToggleConfirmation(body, organization) {
  const loaded = await loadAssignmentForActiveCampaign(body.assignmentId, organization);
  if (loaded.error) return { status: loaded.status, payload: { ok: false, error: loaded.error } };

  const { error } = await supabase.rpc("toggle_intersaison_assignment_confirmation_for_organization", {
    p_campaign_id: loaded.campaign.id,
    p_organization_id: organization.id,
    p_assignment_id: loaded.assignment.id,
  });
  if (error) throw error;

  return { status: 200, payload: { ok: true, state: await loadState(organization) } };
}

async function handleMoveAssignment(body, organization) {
  const loaded = await loadAssignmentForActiveCampaign(body.assignmentId, organization);
  if (loaded.error) return { status: loaded.status, payload: { ok: false, error: loaded.error } };

  const dashboardId = validatePortalInput(body.dashboardId, 80);
  if (!dashboardId) return { status: 400, payload: { ok: false, error: "Dashboard cible invalide." } };

  const { error } = await supabase.rpc("move_intersaison_assignment_for_organization", {
    p_campaign_id: loaded.campaign.id,
    p_organization_id: organization.id,
    p_assignment_id: loaded.assignment.id,
    p_dashboard_id: dashboardId,
  });
  if (error) throw error;

  return { status: 200, payload: { ok: true, state: await loadState(organization) } };
}

async function handleSaveWish(body, organization) {
  const loaded = await loadAssignmentForActiveCampaign(body.assignmentId, organization);
  if (loaded.error) return { status: loaded.status, payload: { ok: false, error: loaded.error } };

  const wishedGuildCodes = Array.isArray(body.wishedGuildCodes)
    ? [
        ...new Set(
          body.wishedGuildCodes
            .map((code) => cleanText(code).replace(/\s+/g, " "))
            .filter(Boolean),
        ),
      ]
    : [];

  const { error } = await supabase.rpc("save_intersaison_assignment_wishes_for_organization", {
    p_campaign_id: loaded.campaign.id,
    p_organization_id: organization.id,
    p_assignment_id: loaded.assignment.id,
    p_wished_guild_codes: wishedGuildCodes,
  });
  if (error) throw error;

  return { status: 200, payload: { ok: true, state: await loadState(organization) } };
}

async function handleRetireCampaign(body, actor, organization) {
  const campaign = await loadActiveCampaign(organization.id);
  const campaignId = validatePortalInput(body.campaignId, 80);
  if (!campaign || String(campaign.id) !== String(campaignId)) {
    return { status: 404, payload: { ok: false, error: "Campagne active introuvable." } };
  }

  const { error } = await supabase
    .from("intersaison_campaigns")
    .update({ status: "archived" })
    .eq("id", campaign.id)
    .eq("organization_id", organization.id)
    .eq("status", "active");
  if (error) throw error;

  await logPortalActivity(actor, {
    actionType: "intersaison_campaign_cancel",
    entityType: "intersaison_campaign",
    entityId: campaign.id,
    summary: `${actor.watcher_name || "Admin"} a mis hors service la campagne intersaison`,
    metadata: { organizationId: organization.id },
  });

  return { status: 200, payload: { ok: true, state: await loadState(organization) } };
}

async function handlePreviewValidation(organization) {
  const { preview } = await buildValidationPreviewForOrganization(organization);
  return { status: 200, payload: { ok: true, preview } };
}

async function handleLaunchTransfers(body, actor, organization) {
  const campaignId = validatePortalInput(body.campaignId, 80);
  const { state, preview } = await buildValidationPreviewForOrganization(organization);
  if (!state.campaign || String(state.campaign.id) !== String(campaignId)) {
    return { status: 404, payload: { ok: false, error: "Campagne active introuvable." } };
  }

  if (preview.blockedAssignments.length > 0) {
    return {
      status: 409,
      payload: {
        ok: false,
        error: `${preview.blockedAssignments.length} assignation(s) hors perimetre ou invalide(s). Validation bloquee.`,
        preview,
      },
    };
  }

  const { error } = await supabase.rpc("finalize_intersaison_campaign_for_organization", {
    p_campaign_id: state.campaign.id,
    p_organization_id: organization.id,
  });
  if (error) throw error;

  await logPortalActivity(actor, {
    actionType: "intersaison_transfers_apply",
    entityType: "intersaison_campaign",
    entityId: state.campaign.id,
    summary: `${actor.watcher_name || "Admin"} a valide l'intersaison de ${organization.display_name}`,
    metadata: {
      organizationId: organization.id,
      guildTransferCount: preview.guildTransfers.length,
      communityConversionCount: preview.communityConversions.length,
      unchangedGuildPlacementCount: preview.unchangedGuildPlacements.length,
    },
  });

  return { status: 200, payload: { ok: true, preview, state: await loadState(organization) } };
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
      return sendJson(res, 403, { ok: false, error: "Intersaison reservee aux admins d'une organisation." }, req);
    }

    const { organization } = await resolveActorOrganization(sessionCheck.member);
    const body = await readJsonBody(req);
    const action = cleanText(body.action);
    let result;

    if (action === "load") result = { status: 200, payload: { ok: true, state: await loadState(organization) } };
    else if (action === "create-campaign") result = await handleCreateCampaign(sessionCheck.member, organization);
    else if (action === "save-note") result = await handleSaveNote(body, sessionCheck.member, organization);
    else if (action === "toggle-confirmation") result = await handleToggleConfirmation(body, organization);
    else if (action === "move-assignment") result = await handleMoveAssignment(body, organization);
    else if (action === "save-wish") result = await handleSaveWish(body, organization);
    else if (action === "cancel-campaign") result = await handleRetireCampaign(body, sessionCheck.member, organization);
    else if (action === "preview-validation") result = await handlePreviewValidation(organization);
    else if (action === "launch-transfers") result = await handleLaunchTransfers(body, sessionCheck.member, organization);
    else result = { status: 400, payload: { ok: false, error: "Action inconnue." } };

    return sendJson(res, result.status, result.payload, req);
  } catch (error) {
    console.error("[portal-intersaison]", error);
    return sendJson(res, error.statusCode || 500, { ok: false, error: error.message || "Erreur serveur." }, req);
  }
}
