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
  isValidIntersaisonAssignmentRole,
  normalizeIntersaisonAssignmentRole,
  normalizeIntersaisonCode,
} from "./_portal-intersaison-core.js";
import {
  buildLinkedAccountSearchText,
  getLinkedGuildCode,
  getLinkedWatcherName,
  getPrimaryMemberId,
} from "../src/lib/linkedAccounts.js";
import { getGuildDisplayName } from "../src/lib/guildDisplay.js";
import {
  GUILD_DM_CAMPAIGNS_TABLE,
  GUILD_DM_RECIPIENTS_TABLE,
  buildGuildDmTestMessage,
  buildGuildDmRecipientPlan,
  cleanDiscordUserId,
  isMissingGuildDmTestColumn,
  validateGuildDmMessage,
} from "./_guild-dm-campaigns.js";
import {
  INTERSAISON_SURVEY_CAMPAIGNS_TABLE,
  INTERSAISON_SURVEY_DM_INTERACTION_OBJECTIVES,
  INTERSAISON_SURVEY_GUILD_OBJECTIVES_TABLE,
  INTERSAISON_SURVEY_ONE_DEFAULT_MESSAGE,
  INTERSAISON_SURVEY_RECIPIENTS_TABLE,
  INTERSAISON_SURVEY_RESPONSES_TABLE,
  INTERSAISON_SURVEY_SEASONS_TABLE,
  buildSurveyResponsesWorkbook,
  buildSurveyGuildCards,
  getSurveyPollLabel,
  isMissingIntersaisonSurveySchema,
} from "./_intersaison-surveys.js";

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
  wished_guild_codes,
  intersaison_role
`;
const ASSIGNMENT_SELECT_FALLBACK = `
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
  "id, watcher_name, guild_code, role, community_access_type, community_status, roster_status, primary_member_id";
const MEMBER_VALIDATION_SELECT_FALLBACK =
  "id, watcher_name, guild_code, role, community_access_type, community_status, roster_status";
const GUILD_SELECT = "id, organization_id, guild_code, display_name, is_active";
const SURVEY_MEMBER_SELECT =
  "id, watcher_name, discord_id, guild_code, role, roster_status, community_access_type, community_status, primary_member_id";
const SURVEY_MEMBER_SELECT_FALLBACK =
  "id, watcher_name, discord_id, guild_code, role, roster_status, community_access_type, community_status";
const SURVEY_CAMPAIGN_SELECT =
  "id, season_id, organization_id, poll_number, guild_dm_campaign_id, status, title, message, target_guild_codes, launched_by_member_id, launched_by_name, launched_at, closed_at, created_at, updated_at, is_test";
const SURVEY_CAMPAIGN_SELECT_FALLBACK =
  "id, season_id, organization_id, poll_number, guild_dm_campaign_id, status, title, message, target_guild_codes, launched_by_member_id, launched_by_name, launched_at, closed_at, created_at, updated_at";
const SURVEY_RECIPIENT_SELECT =
  "id, survey_campaign_id, organization_id, member_id, guild_code_snapshot, member_name_snapshot, discord_user_id, guild_dm_recipient_id, delivery_status, response_status, last_error, reminder_count, last_reminder_at, responded_at, created_at, updated_at";
const SURVEY_RESPONSE_SELECT =
  "id, survey_campaign_id, survey_recipient_id, organization_id, member_id, discord_user_id, poll_number, guild_code_snapshot, member_name_snapshot, objective_text, first_choice_guild_code, second_choice_guild_code, comment_text, response_version, is_current, responded_at, created_at";
const SURVEY_DM_CAMPAIGN_SELECT =
  "id, status, total_recipients, sent_count, confirmed_count, failed_count, missing_discord_count, created_at, updated_at";
const SURVEY_DM_RECIPIENT_SELECT =
  "id, campaign_id, status, sent_at, last_sent_at, confirmed_at, send_attempts, last_attempt_at, last_error, reminder_count, discord_message_id, updated_at";

function sendJson(res, status, payload, req = null) {
  sendPortalJson(res, status, payload, req);
}

function cleanText(value) {
  return cleanIntersaisonText(value);
}

function isMissingColumn(error, columnName) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return (
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    message.includes(String(columnName || "").toLowerCase())
  );
}

function normalizeGuildCode(value) {
  return normalizeIntersaisonCode(value);
}

function normalizeAssignmentForState(assignment) {
  return {
    ...assignment,
    intersaison_role: normalizeIntersaisonAssignmentRole(assignment?.intersaison_role),
  };
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

async function loadAssignmentsForCampaign(campaignId, organizationId) {
  const query = () =>
    supabase
      .from("intersaison_assignments")
      .select(ASSIGNMENT_SELECT)
      .eq("campaign_id", campaignId)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: true });

  let { data, error } = await query();
  if (error && isMissingColumn(error, "intersaison_role")) {
    ({ data, error } = await supabase
      .from("intersaison_assignments")
      .select(ASSIGNMENT_SELECT_FALLBACK)
      .eq("campaign_id", campaignId)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: true }));
  }
  if (error) throw error;
  return (data || []).map(normalizeAssignmentForState);
}

async function loadAssignmentRow(campaignId, organizationId, assignmentId) {
  let { data, error } = await supabase
    .from("intersaison_assignments")
    .select(ASSIGNMENT_SELECT)
    .eq("campaign_id", campaignId)
    .eq("organization_id", organizationId)
    .eq("id", assignmentId)
    .maybeSingle();

  if (error && isMissingColumn(error, "intersaison_role")) {
    ({ data, error } = await supabase
      .from("intersaison_assignments")
      .select(ASSIGNMENT_SELECT_FALLBACK)
      .eq("campaign_id", campaignId)
      .eq("organization_id", organizationId)
      .eq("id", assignmentId)
      .maybeSingle());
  }
  if (error) throw error;
  return data ? normalizeAssignmentForState(data) : null;
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

  const [{ data: dashboards, error: dashboardsError }, assignments] =
    await Promise.all([
      supabase
        .from("intersaison_dashboards")
        .select("*")
        .eq("campaign_id", campaign.id)
        .eq("organization_id", organization.id)
        .order("sort_order", { ascending: true }),
      loadAssignmentsForCampaign(campaign.id, organization.id),
    ]);
  if (dashboardsError) throw dashboardsError;

  const enrichedAssignments = await enrichAssignmentsWithLinkedAccounts(assignments || []);
  const assignmentIds = enrichedAssignments.map((assignment) => assignment.id).filter(Boolean);
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
    assignments: enrichedAssignments,
    notes,
  };
}

async function loadAssignmentForActiveCampaign(assignmentId, organization) {
  const campaign = await loadActiveCampaign(organization.id);
  if (!campaign) return { error: "Aucune campagne intersaison active.", status: 404 };

  const id = validatePortalInput(assignmentId, 80);
  if (!id) return { error: "Assignation invalide.", status: 400 };

  const data = await loadAssignmentRow(campaign.id, organization.id, id);
  if (!data) return { error: "Assignation introuvable.", status: 404 };

  return { campaign, assignment: data };
}

async function loadGuildMembersByIds(memberIds, { includeLinkedAccounts = true } = {}) {
  const ids = [...new Set((memberIds || []).map(cleanText).filter(Boolean))];
  if (ids.length === 0) return [];

  const select = includeLinkedAccounts ? MEMBER_VALIDATION_SELECT : MEMBER_VALIDATION_SELECT_FALLBACK;
  const { data, error } = await supabase
    .from("guild_members")
    .select(select)
    .in("id", ids);

  if (error) {
    if (includeLinkedAccounts && isMissingColumn(error, "primary_member_id")) {
      return loadGuildMembersByIds(ids, { includeLinkedAccounts: false });
    }
    throw error;
  }

  return data || [];
}

async function loadSecondaryRowsForPrincipals(primaryMemberIds) {
  const ids = [...new Set((primaryMemberIds || []).map(cleanText).filter(Boolean))];
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from("guild_members")
    .select(MEMBER_VALIDATION_SELECT)
    .in("primary_member_id", ids)
    .order("watcher_name", { ascending: true });

  if (error) {
    if (isMissingColumn(error, "primary_member_id")) return [];
    throw error;
  }

  return data || [];
}

async function enrichAssignmentsWithLinkedAccounts(assignments) {
  const rows = assignments || [];
  const memberIds = [...new Set(rows.map((assignment) => assignment.member_id).filter(Boolean))];
  if (memberIds.length === 0) {
    return rows.map((assignment) => ({
      ...assignment,
      accountLink: null,
      accountLinkSearchText: "",
    }));
  }

  const members = await loadGuildMembersByIds(memberIds);
  const memberById = new Map(members.map((member) => [String(member.id), member]));
  const primaryIds = [
    ...new Set(members.map((member) => getPrimaryMemberId(member)).filter(Boolean)),
  ];
  const missingPrimaryIds = primaryIds.filter((primaryId) => !memberById.has(String(primaryId)));
  const primaryRows = await loadGuildMembersByIds(missingPrimaryIds);
  const primaryById = new Map(primaryRows.map((member) => [String(member.id), member]));

  const principalIdsToInspect = [
    ...new Set([...memberIds, ...primaryIds].map(cleanText).filter(Boolean)),
  ];
  const secondaryRows = await loadSecondaryRowsForPrincipals(principalIdsToInspect);
  const secondariesByPrimaryId = secondaryRows.reduce((grouped, secondary) => {
    const primaryId = getPrimaryMemberId(secondary);
    if (!primaryId) return grouped;
    const list = grouped.get(primaryId) || [];
    list.push(secondary);
    grouped.set(primaryId, list);
    return grouped;
  }, new Map());

  return rows.map((assignment) => {
    const member = memberById.get(String(assignment.member_id));
    let accountLink = null;

    if (member) {
      const primaryMemberId = getPrimaryMemberId(member);
      if (primaryMemberId) {
        const primary = memberById.get(String(primaryMemberId)) || primaryById.get(String(primaryMemberId)) || null;
        accountLink = {
          type: "secondary",
          isSecondary: true,
          isPrimary: false,
          primaryMemberId,
          primaryWatcherName: primary ? getLinkedWatcherName(primary) : "",
          primaryGuildCode: primary ? getLinkedGuildCode(primary) : "",
        };
      } else {
        const secondaryCount = (secondariesByPrimaryId.get(String(member.id)) || []).length;
        if (secondaryCount > 0) {
          accountLink = {
            type: "primary",
            isSecondary: false,
            isPrimary: true,
            secondaryCount,
          };
        }
      }
    }

    return {
      ...assignment,
      accountLink,
      accountLinkSearchText: buildLinkedAccountSearchText({ ...assignment, accountLink }),
    };
  });
}

async function loadMembersForAssignments(assignments) {
  const memberIds = [...new Set((assignments || []).map((assignment) => assignment.member_id).filter(Boolean))];
  return loadGuildMembersByIds(memberIds);
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

function isMissingGuildDmInteractionColumn(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return error?.code === "PGRST204" && (message.includes("interaction_type") || message.includes("interaction_payload"));
}

function isMissingSurveyCampaignTestColumn(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return error?.code === "PGRST204" && message.includes("is_test");
}

function throwSurveyMigrationError(message = "Migration intersaison_surveys non executee.") {
  const error = new Error(message);
  error.statusCode = 428;
  throw error;
}

function throwSurveyScopeError(message = "Perimetre inter-saison incoherent.") {
  const error = new Error(message);
  error.statusCode = 409;
  throw error;
}

async function assertSurveyGuildScopeSafe(organizationId, guildCodes) {
  const codes = [...new Set((guildCodes || []).map((code) => cleanText(code)).filter(Boolean))];
  if (!codes.length) return;

  const { data, error } = await supabase
    .from("portal_guilds")
    .select(GUILD_SELECT)
    .in("guild_code", codes)
    .eq("is_active", true);
  if (error) throw error;

  const foreignGuilds = (data || []).filter((guild) => String(guild.organization_id || "") !== String(organizationId || ""));
  if (foreignGuilds.length > 0) {
    throwSurveyScopeError("Un code de guilde actif existe dans une autre organisation. Sondage bloque par securite.");
  }
}

async function loadCurrentSurveyMembers(organizationId, guildCodes) {
  if (!guildCodes.length) return [];
  await assertSurveyGuildScopeSafe(organizationId, guildCodes);

  const { data, error } = await supabase
    .from("guild_members")
    .select(SURVEY_MEMBER_SELECT)
    .in("guild_code", guildCodes)
    .limit(1500);

  if (error) throw error;
  return (data || [])
    .filter((member) => String(member?.roster_status || "active").trim().toLowerCase() === "active")
    .sort((left, right) =>
      String(left?.watcher_name || "").localeCompare(String(right?.watcher_name || ""), "fr", {
        sensitivity: "base",
      }),
    );
}

async function loadSurveyActorMember(actor) {
  const actorId = validatePortalInput(actor?.id, 80);
  if (!actorId) {
    const error = new Error("Session admin invalide.");
    error.statusCode = 401;
    throw error;
  }

  const { data, error } = await supabase
    .from("guild_members")
    .select(SURVEY_MEMBER_SELECT)
    .eq("id", actorId)
    .maybeSingle();
  if (error) {
    if (isMissingColumn(error, "primary_member_id")) {
      const fallback = await supabase
        .from("guild_members")
        .select(SURVEY_MEMBER_SELECT_FALLBACK)
        .eq("id", actorId)
        .maybeSingle();
      if (fallback.error) throw fallback.error;
      return fallback.data || null;
    }
    throw error;
  }
  return data || null;
}

async function loadActiveSurveySeason(organizationId) {
  const { data, error } = await supabase
    .from(INTERSAISON_SURVEY_SEASONS_TABLE)
    .select("*")
    .eq("organization_id", organizationId)
    .neq("status", "finished")
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return data?.[0] || null;
}

async function loadSurveyCampaignsForSeason(season, organization) {
  const query = (selectColumns) =>
    supabase
      .from(INTERSAISON_SURVEY_CAMPAIGNS_TABLE)
      .select(selectColumns)
      .eq("season_id", season.id)
      .eq("organization_id", organization.id)
      .order("poll_number", { ascending: true });

  let { data, error } = await query(SURVEY_CAMPAIGN_SELECT);
  if (error && isMissingSurveyCampaignTestColumn(error)) {
    ({ data, error } = await query(SURVEY_CAMPAIGN_SELECT_FALLBACK));
    if (!error) data = (data || []).map((campaign) => ({ ...campaign, is_test: false }));
  }
  if (error) throw error;
  return data || [];
}

async function loadExistingOfficialSurveyCampaign(season, organization, pollNumber) {
  const baseQuery = () =>
    supabase
      .from(INTERSAISON_SURVEY_CAMPAIGNS_TABLE)
      .select("id, status")
      .eq("season_id", season.id)
      .eq("organization_id", organization.id)
      .eq("poll_number", pollNumber)
      .neq("status", "cancelled");

  let { data, error } = await baseQuery().eq("is_test", false).maybeSingle();
  if (error && isMissingSurveyCampaignTestColumn(error)) {
    ({ data, error } = await baseQuery().maybeSingle());
  }
  if (error) throw error;
  return data || null;
}

function serializeSurveyCampaign(campaign, dmCampaign = null) {
  if (!campaign) return null;
  return {
    id: campaign.id,
    seasonId: campaign.season_id,
    organizationId: campaign.organization_id,
    pollNumber: Number(campaign.poll_number || 1),
    guildDmCampaignId: campaign.guild_dm_campaign_id || null,
    status: campaign.status || "preparing",
    title: campaign.title || getSurveyPollLabel(campaign.poll_number),
    message: campaign.message || "",
    isTest: Boolean(campaign.is_test),
    targetGuildCodes: Array.isArray(campaign.target_guild_codes) ? campaign.target_guild_codes : [],
    launchedByMemberId: campaign.launched_by_member_id || null,
    launchedByName: campaign.launched_by_name || "",
    launchedAt: campaign.launched_at || null,
    closedAt: campaign.closed_at || null,
    createdAt: campaign.created_at || null,
    updatedAt: campaign.updated_at || null,
    dmCampaign: dmCampaign
      ? {
          id: dmCampaign.id,
          status: dmCampaign.status,
          totalRecipients: Number(dmCampaign.total_recipients || 0),
          sentCount: Number(dmCampaign.sent_count || 0),
          confirmedCount: Number(dmCampaign.confirmed_count || 0),
          failedCount: Number(dmCampaign.failed_count || 0),
          missingDiscordCount: Number(dmCampaign.missing_discord_count || 0),
        }
      : null,
  };
}

function serializeSurveyRecipient(row, dmRecipient = null, response = null) {
  if (!row) return null;
  return {
    id: row.id,
    surveyCampaignId: row.survey_campaign_id,
    memberId: row.member_id,
    guildCode: row.guild_code_snapshot || "",
    memberName: row.member_name_snapshot || "",
    discordUserId: row.discord_user_id || "",
    guildDmRecipientId: row.guild_dm_recipient_id || null,
    deliveryStatus: dmRecipient?.status || row.delivery_status || "not_included",
    responseStatus: response?.responded_at || row.responded_at ? "responded" : row.response_status || "none",
    lastError: dmRecipient?.last_error || row.last_error || "",
    reminderCount: Number(dmRecipient?.reminder_count ?? row.reminder_count ?? 0),
    lastReminderAt: row.last_reminder_at || null,
    sentAt: dmRecipient?.sent_at || null,
    lastSentAt: dmRecipient?.last_sent_at || null,
    respondedAt: response?.responded_at || row.responded_at || null,
    response: response
      ? {
          id: response.id,
          objectiveText: response.objective_text || "",
          firstChoiceGuildCode: response.first_choice_guild_code || "",
          secondChoiceGuildCode: response.second_choice_guild_code || "",
          commentText: response.comment_text || "",
          respondedAt: response.responded_at || null,
        }
      : null,
  };
}

function getSurveyGuildDisplayName(guildCode, guilds, organization) {
  return getGuildDisplayName({
    guildCode,
    guilds,
    organizationId: organization?.id,
    organizationKey: organization?.organization_key || organization?.organizationKey,
    emptyFallback: guildCode || "",
  });
}

async function loadSurveyObjectivesForSeason(season, organization) {
  if (!season?.id) return [];
  const { data, error } = await supabase
    .from(INTERSAISON_SURVEY_GUILD_OBJECTIVES_TABLE)
    .select("id, season_id, organization_id, guild_code, objective_text, created_at, updated_at")
    .eq("season_id", season.id)
    .eq("organization_id", organization.id);
  if (error) {
    if (isMissingIntersaisonSurveySchema(error)) return [];
    throw error;
  }
  return data || [];
}

function buildSurveyExportRows({ center, campaign, guilds, organization, objectives }) {
  const objectivesByGuild = new Map(
    (objectives || []).map((objective) => [normalizeGuildCode(objective.guild_code), objective]),
  );
  return (center.recipients || [])
    .filter((recipient) => !campaign || String(recipient.surveyCampaignId) === String(campaign.id))
    .map((recipient) => {
      const guildCode = normalizeGuildCode(recipient.guildCode);
      const guildName = getSurveyGuildDisplayName(guildCode, guilds, organization);
      const objective = objectivesByGuild.get(guildCode) || null;
      return {
        memberId: recipient.memberId,
        memberName: recipient.memberName,
        guildCode,
        guildName,
        discordUserId: recipient.discordUserId,
        deliveryStatus: recipient.deliveryStatus,
        responseStatus: recipient.responseStatus,
        respondedAt: recipient.respondedAt,
        responseText: recipient.response?.objectiveText || "",
        guildReferenceObjectives: objective?.objective_text || "",
      };
    });
}

function escapeCsvCell(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function buildSurveyResponsesCsv(exportRows) {
  const headers = [
    "member_id",
    "pseudo",
    "guild_code",
    "guild_name",
    "discord_id",
    "delivery_status",
    "response_status",
    "responded_at",
    "response_text",
    "guild_reference_objectives",
  ];
  const rows = [headers.map(escapeCsvCell).join(",")];
  for (const row of exportRows) {
    rows.push(
      [
        row.memberId,
        row.memberName,
        row.guildCode,
        row.guildName,
        row.discordUserId,
        row.deliveryStatus,
        row.responseStatus,
        row.respondedAt,
        row.responseText,
        row.guildReferenceObjectives,
      ]
        .map(escapeCsvCell)
        .join(","),
    );
  }
  return rows.join("\n");
}

function buildSurveyResponsesWorkbookPayload({ center, campaign, guilds, organization, objectives, exportRows }) {
  const generatedAt = new Date().toISOString();
  const responseCount = exportRows.filter((row) => row.responseStatus === "responded").length;
  const targetCount = exportRows.length;
  const participationRate = targetCount > 0 ? `${((responseCount / targetCount) * 100).toFixed(1)}%` : "0.0%";
  const objectivesByGuild = new Map(
    (objectives || []).map((objective) => [normalizeGuildCode(objective.guild_code), objective]),
  );

  const responseSheet = [
    [
      "member_id",
      "pseudo",
      "guild_code",
      "guild_name",
      "discord_id",
      "delivery_status",
      "response_status",
      "responded_at",
      "response_text",
      "guild_reference_objectives",
    ],
    ...exportRows.map((row) => [
      row.memberId,
      row.memberName,
      row.guildCode,
      row.guildName,
      row.discordUserId,
      row.deliveryStatus,
      row.responseStatus,
      row.respondedAt,
      row.responseText,
      row.guildReferenceObjectives,
    ]),
  ];
  const objectivesSheet = [
    ["guild_code", "guild_name", "reference_objectives", "season_id", "updated_at"],
    ...(guilds || []).map((guild) => {
      const guildCode = normalizeGuildCode(guild.guild_code);
      const objective = objectivesByGuild.get(guildCode) || null;
      return [
        guildCode,
        getSurveyGuildDisplayName(guildCode, guilds, organization),
        objective?.objective_text || "",
        center.season?.id || "",
        objective?.updated_at || objective?.created_at || "",
      ];
    }),
  ];
  const campaignSheet = [
    ["field", "value"],
    ["season_id", center.season?.id || ""],
    ["season_label", center.season?.label || ""],
    ["season_status", center.season?.status || ""],
    ["campaign_id", campaign?.id || ""],
    ["poll_number", campaign?.pollNumber || 1],
    ["campaign_title", campaign?.title || getSurveyPollLabel(1)],
    ["campaign_status", campaign?.status || ""],
    ["launched_at", campaign?.launchedAt || ""],
    ["closed_at", campaign?.closedAt || ""],
    ["target_count", targetCount],
    ["response_count", responseCount],
    ["participation_rate", participationRate],
    ["generated_at", generatedAt],
    ["test_campaigns_excluded", "true"],
  ];

  return buildSurveyResponsesWorkbook([
    { name: "Réponses joueurs", rows: responseSheet },
    { name: "Objectifs guildes", rows: objectivesSheet },
    { name: "Campagne", rows: campaignSheet },
  ]);
}

async function loadSurveyCenterState(organization, actor = null) {
  const guilds = await loadActiveGuilds(organization.id);
  const guildCodes = guilds.map((guild) => guild.guild_code).filter(Boolean);
  const members = await loadCurrentSurveyMembers(organization.id, guildCodes);

  try {
    const season = await loadActiveSurveySeason(organization.id);
    if (!season) {
      return {
        organization,
        guilds,
        members,
        surveySchemaReady: true,
        defaultSurveyOneMessage: INTERSAISON_SURVEY_ONE_DEFAULT_MESSAGE,
        season: null,
        campaigns: [],
        testCampaigns: [],
        recipients: [],
        guildCards: buildSurveyGuildCards({ guilds, members }),
      };
    }

    const campaigns = await loadSurveyCampaignsForSeason(season, organization);
    const officialCampaigns = (campaigns || []).filter((campaign) => !campaign.is_test);
    const actorMemberId = cleanText(actor?.id);
    const testCampaigns = (campaigns || [])
      .filter((campaign) => campaign.is_test)
      .filter((campaign) => !actorMemberId || String(campaign.launched_by_member_id || "") === String(actorMemberId));

    const campaignIds = officialCampaigns.map((campaign) => campaign.id).filter(Boolean);
    const testCampaignIds = testCampaigns.map((campaign) => campaign.id).filter(Boolean);
    const dmCampaignIds = [...officialCampaigns, ...testCampaigns]
      .map((campaign) => campaign.guild_dm_campaign_id)
      .filter(Boolean);

    const [{ data: surveyRecipients, error: recipientsError }, { data: responses, error: responsesError }] =
      campaignIds.length > 0
        ? await Promise.all([
            supabase
              .from(INTERSAISON_SURVEY_RECIPIENTS_TABLE)
              .select(SURVEY_RECIPIENT_SELECT)
              .in("survey_campaign_id", campaignIds)
              .eq("organization_id", organization.id),
            supabase
              .from(INTERSAISON_SURVEY_RESPONSES_TABLE)
              .select(SURVEY_RESPONSE_SELECT)
              .in("survey_campaign_id", campaignIds)
              .eq("organization_id", organization.id)
              .eq("is_current", true),
          ])
        : [{ data: [], error: null }, { data: [], error: null }];
    if (recipientsError) throw recipientsError;
    if (responsesError) throw responsesError;

    const [{ data: testSurveyRecipients, error: testRecipientsError }, { data: testResponses, error: testResponsesError }] =
      testCampaignIds.length > 0
        ? await Promise.all([
            supabase
              .from(INTERSAISON_SURVEY_RECIPIENTS_TABLE)
              .select(SURVEY_RECIPIENT_SELECT)
              .in("survey_campaign_id", testCampaignIds)
              .eq("organization_id", organization.id),
            supabase
              .from(INTERSAISON_SURVEY_RESPONSES_TABLE)
              .select(SURVEY_RESPONSE_SELECT)
              .in("survey_campaign_id", testCampaignIds)
              .eq("organization_id", organization.id)
              .eq("is_current", true),
          ])
        : [{ data: [], error: null }, { data: [], error: null }];
    if (testRecipientsError) throw testRecipientsError;
    if (testResponsesError) throw testResponsesError;

    const dmRecipientIds = [...(surveyRecipients || []), ...(testSurveyRecipients || [])]
      .map((recipient) => recipient.guild_dm_recipient_id)
      .filter(Boolean);

    const [{ data: dmCampaigns, error: dmCampaignsError }, { data: dmRecipients, error: dmRecipientsError }] =
      await Promise.all([
        dmCampaignIds.length > 0
          ? supabase
              .from(GUILD_DM_CAMPAIGNS_TABLE)
              .select(SURVEY_DM_CAMPAIGN_SELECT)
              .in("id", dmCampaignIds)
              .eq("organization_id", organization.id)
          : Promise.resolve({ data: [], error: null }),
        dmRecipientIds.length > 0
          ? supabase
              .from(GUILD_DM_RECIPIENTS_TABLE)
              .select(SURVEY_DM_RECIPIENT_SELECT)
              .in("id", dmRecipientIds)
              .eq("organization_id", organization.id)
          : Promise.resolve({ data: [], error: null }),
      ]);
    if (dmCampaignsError) throw dmCampaignsError;
    if (dmRecipientsError) throw dmRecipientsError;

    const dmCampaignById = new Map((dmCampaigns || []).map((row) => [String(row.id), row]));
    const dmRecipientById = new Map((dmRecipients || []).map((row) => [String(row.id), row]));
    const responseByRecipientId = new Map(
      (responses || []).map((row) => [String(row.survey_recipient_id), row]),
    );
    const testResponseByRecipientId = new Map(
      (testResponses || []).map((row) => [String(row.survey_recipient_id), row]),
    );
    const testRecipientsByCampaignId = new Map();
    for (const recipient of testSurveyRecipients || []) {
      const key = String(recipient.survey_campaign_id);
      const list = testRecipientsByCampaignId.get(key) || [];
      list.push(
        serializeSurveyRecipient(
          recipient,
          recipient.guild_dm_recipient_id ? dmRecipientById.get(String(recipient.guild_dm_recipient_id)) || null : null,
          testResponseByRecipientId.get(String(recipient.id)) || null,
        ),
      );
      testRecipientsByCampaignId.set(key, list);
    }
    const selectedPollRecipients = (surveyRecipients || []).filter((recipient) => {
      const campaign = officialCampaigns.find((row) => String(row.id) === String(recipient.survey_campaign_id));
      return Number(campaign?.poll_number || 1) === 1;
    });
    const selectedPollResponses = (responses || []).filter((response) => Number(response.poll_number || 1) === 1);

    return {
      organization,
      guilds,
      members,
      surveySchemaReady: true,
      defaultSurveyOneMessage: INTERSAISON_SURVEY_ONE_DEFAULT_MESSAGE,
      season: {
        id: season.id,
        status: season.status || "inactive",
        label: season.label || "Inter-saison",
        createdAt: season.created_at || null,
        updatedAt: season.updated_at || null,
      },
      campaigns: officialCampaigns.map((campaign) =>
        serializeSurveyCampaign(campaign, dmCampaignById.get(String(campaign.guild_dm_campaign_id)) || null),
      ),
      testCampaigns: testCampaigns
        .slice()
        .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")))
        .map((campaign) => ({
          ...serializeSurveyCampaign(campaign, dmCampaignById.get(String(campaign.guild_dm_campaign_id)) || null),
          recipients: testRecipientsByCampaignId.get(String(campaign.id)) || [],
        })),
      recipients: (surveyRecipients || []).map((recipient) =>
        serializeSurveyRecipient(
          recipient,
          recipient.guild_dm_recipient_id ? dmRecipientById.get(String(recipient.guild_dm_recipient_id)) || null : null,
          responseByRecipientId.get(String(recipient.id)) || null,
        ),
      ),
      guildCards: buildSurveyGuildCards({
        guilds,
        members,
        surveyRecipients: selectedPollRecipients,
        dmRecipients: dmRecipients || [],
        responses: selectedPollResponses,
      }),
    };
  } catch (error) {
    if (!isMissingIntersaisonSurveySchema(error)) throw error;
    return {
      organization,
      guilds,
      members,
      surveySchemaReady: false,
      defaultSurveyOneMessage: INTERSAISON_SURVEY_ONE_DEFAULT_MESSAGE,
      season: null,
      campaigns: [],
      testCampaigns: [],
      recipients: [],
      guildCards: buildSurveyGuildCards({ guilds, members }),
    };
  }
}

async function ensureSurveySeason(actor, organization) {
  const existing = await loadActiveSurveySeason(organization.id);
  if (existing) return existing;

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from(INTERSAISON_SURVEY_SEASONS_TABLE)
    .insert({
      organization_id: organization.id,
      label: `Inter-saison ${new Date().getFullYear()}`,
      status: "survey1_preparing",
      created_by_member_id: actor.id,
      created_by_name: actor.watcher_name || "Admin",
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();

  if (error) {
    if (isMissingIntersaisonSurveySchema(error)) throwSurveyMigrationError();
    throw error;
  }
  return data;
}

async function handleLoadSurveyCenter(organization, actor) {
  return { status: 200, payload: { ok: true, surveyCenter: await loadSurveyCenterState(organization, actor) } };
}

async function handleLaunchSurveyOne(body, actor, organization) {
  const guilds = await loadActiveGuilds(organization.id);
  const guildCodes = guilds.map((guild) => guild.guild_code).filter(Boolean);
  if (!guildCodes.length) return { status: 400, payload: { ok: false, error: "Aucune guilde active." } };

  const season = await ensureSurveySeason(actor, organization);
  let existingCampaign;
  try {
    existingCampaign = await loadExistingOfficialSurveyCampaign(season, organization, 1);
  } catch (existingError) {
    if (isMissingIntersaisonSurveySchema(existingError)) throwSurveyMigrationError();
    throw existingError;
  }
  if (existingCampaign) {
    return { status: 409, payload: { ok: false, error: "Le sondage 1 existe deja pour cette inter-saison." } };
  }

  const members = await loadCurrentSurveyMembers(organization.id, guildCodes);
  const message = validateGuildDmMessage(body?.message || INTERSAISON_SURVEY_ONE_DEFAULT_MESSAGE);
  const plan = buildGuildDmRecipientPlan(members, guildCodes);
  if (!plan.recipients.length) {
    return { status: 400, payload: { ok: false, error: "Aucun joueur joignable avec un ID Discord valide." } };
  }

  const now = new Date().toISOString();
  const { data: dmCampaign, error: dmCampaignError } = await supabase
    .from(GUILD_DM_CAMPAIGNS_TABLE)
    .insert({
      organization_id: organization.id,
      created_by_member_id: actor.id,
      created_by_name: actor.watcher_name || "Admin",
      message,
      target_guild_codes: guildCodes,
      interaction_type: INTERSAISON_SURVEY_DM_INTERACTION_OBJECTIVES,
      interaction_payload: { pollNumber: 1, source: "intersaison" },
      status: "queued",
      total_recipients: plan.recipients.length,
      missing_discord_count: plan.missingDiscordCount + plan.duplicateCount,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();
  if (dmCampaignError) {
    if (isMissingGuildDmInteractionColumn(dmCampaignError)) {
      throwSurveyMigrationError("Migration intersaison_surveys non executee sur guild_dm_campaigns.interaction_type.");
    }
    if (isMissingGuildDmTestColumn(dmCampaignError)) {
      throwSurveyMigrationError("Migration guild_dm_campaigns_test_mode non executee.");
    }
    throw dmCampaignError;
  }

  const { data: surveyCampaign, error: surveyCampaignError } = await supabase
    .from(INTERSAISON_SURVEY_CAMPAIGNS_TABLE)
    .insert({
      season_id: season.id,
      organization_id: organization.id,
      poll_number: 1,
      guild_dm_campaign_id: dmCampaign.id,
      status: "open",
      title: getSurveyPollLabel(1),
      message,
      target_guild_codes: guildCodes,
      launched_by_member_id: actor.id,
      launched_by_name: actor.watcher_name || "Admin",
      launched_at: now,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();
  if (surveyCampaignError) {
    if (isMissingIntersaisonSurveySchema(surveyCampaignError)) throwSurveyMigrationError();
    throw surveyCampaignError;
  }

  const dmRecipientRows = plan.recipients.map((recipient) => ({
    campaign_id: dmCampaign.id,
    organization_id: organization.id,
    member_id: recipient.memberId,
    guild_code: recipient.guildCode,
    member_name_snapshot: recipient.memberName,
    discord_user_id: recipient.discordUserId,
    status: "queued",
    created_at: now,
    updated_at: now,
  }));
  const { data: insertedDmRecipients, error: dmRecipientError } = await supabase
    .from(GUILD_DM_RECIPIENTS_TABLE)
    .insert(dmRecipientRows)
    .select("id, member_id, discord_user_id");
  if (dmRecipientError) throw dmRecipientError;

  const dmByMemberId = new Map(
    (insertedDmRecipients || []).filter((row) => row.member_id).map((row) => [String(row.member_id), row]),
  );
  const reachableDiscordByMemberId = new Map(plan.recipients.map((recipient) => [String(recipient.memberId), recipient.discordUserId]));
  const surveyRecipientRows = members.map((member) => {
    const discordUserId = cleanDiscordUserId(member.discord_id);
    const dmRecipient = dmByMemberId.get(String(member.id)) || null;
    const hasReachableDiscord = reachableDiscordByMemberId.has(String(member.id));
    const deliveryStatus = dmRecipient
      ? "queued"
      : discordUserId
        ? "excluded_duplicate"
        : "missing_invalid";
    return {
      survey_campaign_id: surveyCampaign.id,
      organization_id: organization.id,
      member_id: member.id,
      guild_code_snapshot: member.guild_code,
      member_name_snapshot: member.watcher_name || "Joueur",
      discord_user_id: discordUserId || member.discord_id || "",
      guild_dm_recipient_id: dmRecipient?.id || null,
      delivery_status: deliveryStatus,
      response_status: "none",
      last_error: hasReachableDiscord || dmRecipient ? null : (discordUserId ? "ID Discord en doublon dans la campagne." : "ID Discord manquant ou invalide."),
      created_at: now,
      updated_at: now,
    };
  });
  const { error: surveyRecipientError } = await supabase
    .from(INTERSAISON_SURVEY_RECIPIENTS_TABLE)
    .insert(surveyRecipientRows);
  if (surveyRecipientError) throw surveyRecipientError;

  await supabase
    .from(INTERSAISON_SURVEY_SEASONS_TABLE)
    .update({ status: "survey1_open", updated_at: now })
    .eq("id", season.id)
    .eq("organization_id", organization.id);

  await logPortalActivity(actor, {
    actionType: "intersaison_survey1_launch",
    entityType: "intersaison_survey_campaign",
    entityId: surveyCampaign.id,
    summary: `${actor.watcher_name || "Admin"} a lance le sondage 1 inter-saison`,
    metadata: {
      organizationId: organization.id,
      dmCampaignId: dmCampaign.id,
      totalRecipients: plan.recipients.length,
      missingDiscordCount: plan.missingDiscordCount,
      duplicateCount: plan.duplicateCount,
    },
  });

  return { status: 200, payload: { ok: true, surveyCenter: await loadSurveyCenterState(organization, actor) } };
}

async function handleLaunchSurveyOneTest(body, actor, organization) {
  const actorMember = await loadSurveyActorMember(actor);
  if (!actorMember || !canManageIntersaison(actorMember)) {
    return { status: 403, payload: { ok: false, error: "Test reserve aux admins de l'organisation." } };
  }

  const guilds = await loadActiveGuilds(organization.id);
  const actorGuildCode = cleanText(actorMember.guild_code || actor?.guild_code);
  const actorGuild = guilds.find((guild) => normalizeGuildCode(guild.guild_code) === normalizeGuildCode(actorGuildCode));
  if (!actorGuild) {
    return { status: 403, payload: { ok: false, error: "Ta guilde n'est pas disponible dans cette organisation." } };
  }

  const discordUserId = cleanDiscordUserId(actorMember.discord_id);
  if (!discordUserId) {
    return { status: 400, payload: { ok: false, error: "Ton compte n'a pas d'ID Discord valide." } };
  }

  const guildCode = actorGuild.guild_code;
  await assertSurveyGuildScopeSafe(organization.id, [guildCode]);

  const season = await ensureSurveySeason(actorMember, organization);
  const message = buildGuildDmTestMessage(body?.message || INTERSAISON_SURVEY_ONE_DEFAULT_MESSAGE);
  const now = new Date().toISOString();

  const { data: dmCampaign, error: dmCampaignError } = await supabase
    .from(GUILD_DM_CAMPAIGNS_TABLE)
    .insert({
      organization_id: organization.id,
      created_by_member_id: actorMember.id,
      created_by_name: actorMember.watcher_name || "Admin",
      message,
      target_guild_codes: [guildCode],
      interaction_type: INTERSAISON_SURVEY_DM_INTERACTION_OBJECTIVES,
      interaction_payload: { pollNumber: 1, source: "intersaison", mode: "test" },
      is_test: true,
      status: "queued",
      total_recipients: 1,
      missing_discord_count: 0,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();
  if (dmCampaignError) {
    if (isMissingGuildDmInteractionColumn(dmCampaignError)) {
      throwSurveyMigrationError("Migration intersaison_surveys non executee sur guild_dm_campaigns.interaction_type.");
    }
    if (isMissingGuildDmTestColumn(dmCampaignError)) {
      throwSurveyMigrationError("Migration guild_dm_campaigns_test_mode non executee.");
    }
    throw dmCampaignError;
  }

  const failDmCampaign = async () => {
    await supabase
      .from(GUILD_DM_CAMPAIGNS_TABLE)
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", dmCampaign.id)
      .eq("organization_id", organization.id);
  };

  const { data: surveyCampaign, error: surveyCampaignError } = await supabase
    .from(INTERSAISON_SURVEY_CAMPAIGNS_TABLE)
    .insert({
      season_id: season.id,
      organization_id: organization.id,
      poll_number: 1,
      guild_dm_campaign_id: dmCampaign.id,
      status: "open",
      title: `${getSurveyPollLabel(1)} — Test`,
      message,
      target_guild_codes: [guildCode],
      launched_by_member_id: actorMember.id,
      launched_by_name: actorMember.watcher_name || "Admin",
      launched_at: now,
      created_at: now,
      updated_at: now,
      is_test: true,
    })
    .select("id")
    .single();
  if (surveyCampaignError) {
    await failDmCampaign();
    if (isMissingSurveyCampaignTestColumn(surveyCampaignError)) {
      throwSurveyMigrationError("Migration intersaison_surveys_test_mode non executee.");
    }
    if (isMissingIntersaisonSurveySchema(surveyCampaignError)) throwSurveyMigrationError();
    throw surveyCampaignError;
  }

  const { data: dmRecipient, error: dmRecipientError } = await supabase
    .from(GUILD_DM_RECIPIENTS_TABLE)
    .insert({
      campaign_id: dmCampaign.id,
      organization_id: organization.id,
      member_id: actorMember.id,
      guild_code: guildCode,
      member_name_snapshot: actorMember.watcher_name || "Admin",
      discord_user_id: discordUserId,
      status: "queued",
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();
  if (dmRecipientError) {
    await failDmCampaign();
    throw dmRecipientError;
  }

  const { error: surveyRecipientError } = await supabase.from(INTERSAISON_SURVEY_RECIPIENTS_TABLE).insert({
    survey_campaign_id: surveyCampaign.id,
    organization_id: organization.id,
    member_id: actorMember.id,
    guild_code_snapshot: guildCode,
    member_name_snapshot: actorMember.watcher_name || "Admin",
    discord_user_id: discordUserId,
    guild_dm_recipient_id: dmRecipient.id,
    delivery_status: "queued",
    response_status: "none",
    created_at: now,
    updated_at: now,
  });
  if (surveyRecipientError) {
    await failDmCampaign();
    throw surveyRecipientError;
  }

  await logPortalActivity(actorMember, {
    actionType: "intersaison_survey1_test",
    entityType: "intersaison_survey_campaign",
    entityId: surveyCampaign.id,
    summary: `${actorMember.watcher_name || "Admin"} a lance un test personnel du sondage 1`,
    metadata: {
      organizationId: organization.id,
      dmCampaignId: dmCampaign.id,
      surveyCampaignId: surveyCampaign.id,
      guildCode,
      isTest: true,
    },
  });

  return { status: 200, payload: { ok: true, surveyCenter: await loadSurveyCenterState(organization, actorMember) } };
}

async function handleQueueSurveyRecipient(body, actor, organization) {
  const surveyRecipientId = validatePortalInput(body?.surveyRecipientId, 80);
  if (!surveyRecipientId) return { status: 400, payload: { ok: false, error: "Destinataire invalide." } };

  const { data: recipient, error } = await supabase
    .from(INTERSAISON_SURVEY_RECIPIENTS_TABLE)
    .select(SURVEY_RECIPIENT_SELECT)
    .eq("id", surveyRecipientId)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (error) {
    if (isMissingIntersaisonSurveySchema(error)) throwSurveyMigrationError();
    throw error;
  }
  if (!recipient) return { status: 404, payload: { ok: false, error: "Destinataire introuvable." } };
  if (recipient.responded_at || recipient.response_status === "responded") {
    return { status: 409, payload: { ok: false, error: "Ce joueur a deja repondu." } };
  }
  if (!recipient.guild_dm_recipient_id) {
    return { status: 409, payload: { ok: false, error: recipient.last_error || "Aucun MP Discord reutilisable pour ce joueur." } };
  }

  const { data: campaign, error: campaignError } = await supabase
    .from(INTERSAISON_SURVEY_CAMPAIGNS_TABLE)
    .select("id, guild_dm_campaign_id, status")
    .eq("id", recipient.survey_campaign_id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (campaignError) throw campaignError;
  if (!campaign) return { status: 404, payload: { ok: false, error: "Campagne introuvable." } };

  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from(GUILD_DM_RECIPIENTS_TABLE)
    .update({
      status: "queued",
      reminder_count: Number(recipient.reminder_count || 0) + 1,
      last_attempt_at: now,
      last_error: null,
      updated_at: now,
    })
    .eq("id", recipient.guild_dm_recipient_id)
    .eq("organization_id", organization.id);
  if (updateError) throw updateError;

  await supabase
    .from(INTERSAISON_SURVEY_RECIPIENTS_TABLE)
    .update({
      delivery_status: "queued",
      reminder_count: Number(recipient.reminder_count || 0) + 1,
      last_reminder_at: now,
      last_error: null,
      updated_at: now,
    })
    .eq("id", recipient.id)
    .eq("organization_id", organization.id);

  if (campaign.guild_dm_campaign_id) {
    await supabase
      .from(GUILD_DM_CAMPAIGNS_TABLE)
      .update({ status: "queued", updated_at: now })
      .eq("id", campaign.guild_dm_campaign_id)
      .eq("organization_id", organization.id);
  }

  await logPortalActivity(actor, {
    actionType: "intersaison_survey_reminder",
    entityType: "intersaison_survey_recipient",
    entityId: recipient.id,
    summary: `${actor.watcher_name || "Admin"} a remis un MP inter-saison dans la file`,
    metadata: { organizationId: organization.id },
  });

  return { status: 200, payload: { ok: true, surveyCenter: await loadSurveyCenterState(organization, actor) } };
}

async function handleQueueCollectiveSurveyReminders(body, actor, organization) {
  const surveyCampaignId = validatePortalInput(body?.surveyCampaignId, 80);
  if (!surveyCampaignId) return { status: 400, payload: { ok: false, error: "Campagne invalide." } };

  const { data: campaign, error: campaignError } = await supabase
    .from(INTERSAISON_SURVEY_CAMPAIGNS_TABLE)
    .select("id, guild_dm_campaign_id, organization_id, status")
    .eq("id", surveyCampaignId)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (campaignError) {
    if (isMissingIntersaisonSurveySchema(campaignError)) throwSurveyMigrationError();
    throw campaignError;
  }
  if (!campaign) return { status: 404, payload: { ok: false, error: "Campagne introuvable." } };

  const { data: recipients, error: recipientsError } = await supabase
    .from(INTERSAISON_SURVEY_RECIPIENTS_TABLE)
    .select("id, guild_dm_recipient_id, response_status, responded_at, reminder_count")
    .eq("survey_campaign_id", campaign.id)
    .eq("organization_id", organization.id)
    .not("guild_dm_recipient_id", "is", null)
    .is("responded_at", null);
  if (recipientsError) throw recipientsError;

  const dmIds = (recipients || []).map((recipient) => recipient.guild_dm_recipient_id).filter(Boolean);
  if (!dmIds.length) {
    return { status: 200, payload: { ok: true, queuedCount: 0, surveyCenter: await loadSurveyCenterState(organization, actor) } };
  }

  const now = new Date().toISOString();
  const { data: queuedRows, error: updateError } = await supabase
    .from(GUILD_DM_RECIPIENTS_TABLE)
    .update({
      status: "queued",
      last_attempt_at: now,
      last_error: null,
      updated_at: now,
    })
    .in("id", dmIds)
    .eq("organization_id", organization.id)
    .in("status", ["sent", "failed"])
    .select("id");
  if (updateError) throw updateError;

  const queuedIds = new Set((queuedRows || []).map((row) => String(row.id)));
  const surveyIdsToUpdate = (recipients || [])
    .filter((recipient) => queuedIds.has(String(recipient.guild_dm_recipient_id)))
    .map((recipient) => recipient.id);
  if (surveyIdsToUpdate.length) {
    await supabase
      .from(INTERSAISON_SURVEY_RECIPIENTS_TABLE)
      .update({
        delivery_status: "queued",
        last_reminder_at: now,
        last_error: null,
        updated_at: now,
      })
      .in("id", surveyIdsToUpdate)
      .eq("organization_id", organization.id);
  }

  if (campaign.guild_dm_campaign_id) {
    await supabase
      .from(GUILD_DM_CAMPAIGNS_TABLE)
      .update({ status: "queued", updated_at: now })
      .eq("id", campaign.guild_dm_campaign_id)
      .eq("organization_id", organization.id);
  }

  await logPortalActivity(actor, {
    actionType: "intersaison_survey_collective_reminder",
    entityType: "intersaison_survey_campaign",
    entityId: campaign.id,
    summary: `${actor.watcher_name || "Admin"} a lance une relance collective inter-saison`,
    metadata: { organizationId: organization.id, queuedCount: queuedRows?.length || 0 },
  });

  return {
    status: 200,
    payload: {
      ok: true,
      queuedCount: queuedRows?.length || 0,
      surveyCenter: await loadSurveyCenterState(organization, actor),
    },
  };
}

async function handleFinishSurveySeason(body, actor, organization) {
  const season = await loadActiveSurveySeason(organization.id);
  const requestedSeasonId = validatePortalInput(body?.seasonId, 80);
  if (!season || (requestedSeasonId && String(season.id) !== String(requestedSeasonId))) {
    return { status: 404, payload: { ok: false, error: "Inter-saison active introuvable." } };
  }

  const { data: campaigns, error: campaignsError } = await supabase
    .from(INTERSAISON_SURVEY_CAMPAIGNS_TABLE)
    .select("id, guild_dm_campaign_id, status")
    .eq("season_id", season.id)
    .eq("organization_id", organization.id);
  if (campaignsError) {
    if (isMissingIntersaisonSurveySchema(campaignsError)) throwSurveyMigrationError();
    throw campaignsError;
  }

  const now = new Date().toISOString();
  const dmCampaignIds = (campaigns || []).map((campaign) => campaign.guild_dm_campaign_id).filter(Boolean);

  await supabase
    .from(INTERSAISON_SURVEY_CAMPAIGNS_TABLE)
    .update({ status: "closed", closed_at: now, updated_at: now })
    .eq("season_id", season.id)
    .eq("organization_id", organization.id)
    .in("status", ["preparing", "open"]);

  if (dmCampaignIds.length) {
    await supabase
      .from(GUILD_DM_CAMPAIGNS_TABLE)
      .update({ status: "cancelled", updated_at: now })
      .in("id", dmCampaignIds)
      .eq("organization_id", organization.id)
      .in("status", ["queued", "sending", "failed", "partial"]);

    await supabase
      .from(GUILD_DM_RECIPIENTS_TABLE)
      .update({ status: "cancelled", updated_at: now })
      .in("campaign_id", dmCampaignIds)
      .eq("organization_id", organization.id)
      .in("status", ["queued", "sending", "failed"]);
  }

  const { error: seasonError } = await supabase
    .from(INTERSAISON_SURVEY_SEASONS_TABLE)
    .update({ status: "finished", updated_at: now })
    .eq("id", season.id)
    .eq("organization_id", organization.id);
  if (seasonError) throw seasonError;

  await logPortalActivity(actor, {
    actionType: "intersaison_survey_season_finish",
    entityType: "intersaison_survey_season",
    entityId: season.id,
    summary: `${actor.watcher_name || "Admin"} a cloture l'inter-saison`,
    metadata: {
      organizationId: organization.id,
      closedCampaignCount: (campaigns || []).filter((campaign) => ["preparing", "open"].includes(campaign.status)).length,
    },
  });

  return { status: 200, payload: { ok: true, surveyCenter: await loadSurveyCenterState(organization, actor) } };
}

async function handleExportSurveyOne(body, organization) {
  const center = await loadSurveyCenterState(organization);
  const campaign = (center.campaigns || []).find((row) => Number(row.pollNumber) === 1);
  const format = cleanText(body?.format || "csv").toLowerCase();
  const objectives = center.season ? await loadSurveyObjectivesForSeason(center.season, organization) : [];
  const exportRows = buildSurveyExportRows({
    center,
    campaign,
    guilds: center.guilds || [],
    organization,
    objectives,
  });

  if (format === "xlsx") {
    const workbook = buildSurveyResponsesWorkbookPayload({
      center,
      campaign,
      guilds: center.guilds || [],
      organization,
      objectives,
      exportRows,
    });
    return {
      status: 200,
      payload: {
        ok: true,
        fileName: `intersaison-sondage-1-${new Date().toISOString().slice(0, 10)}.xlsx`,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        encoding: "base64",
        content: workbook.toString("base64"),
      },
    };
  }

  return {
    status: 200,
    payload: {
      ok: true,
      fileName: `intersaison-sondage-1-${new Date().toISOString().slice(0, 10)}.csv`,
      contentType: "text/csv;charset=utf-8",
      content: buildSurveyResponsesCsv(exportRows),
    },
  };
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

async function handleSaveRole(body, organization) {
  const loaded = await loadAssignmentForActiveCampaign(body.assignmentId, organization);
  if (loaded.error) return { status: loaded.status, payload: { ok: false, error: loaded.error } };

  const rawRole = cleanText(body.intersaisonRole ?? body.role);
  if (!isValidIntersaisonAssignmentRole(rawRole)) {
    return { status: 400, payload: { ok: false, error: "Role intersaison invalide." } };
  }

  const role = normalizeIntersaisonAssignmentRole(rawRole);
  const { error } = await supabase.rpc("save_intersaison_assignment_role_for_organization", {
    p_campaign_id: loaded.campaign.id,
    p_organization_id: organization.id,
    p_assignment_id: loaded.assignment.id,
    p_intersaison_role: role,
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
    else if (action === "load-survey-center") result = await handleLoadSurveyCenter(organization, sessionCheck.member);
    else if (action === "launch-survey-one") result = await handleLaunchSurveyOne(body, sessionCheck.member, organization);
    else if (action === "launch-survey-one-test") result = await handleLaunchSurveyOneTest(body, sessionCheck.member, organization);
    else if (action === "queue-survey-recipient") result = await handleQueueSurveyRecipient(body, sessionCheck.member, organization);
    else if (action === "queue-survey-reminders") result = await handleQueueCollectiveSurveyReminders(body, sessionCheck.member, organization);
    else if (action === "export-survey-one") result = await handleExportSurveyOne(body, organization);
    else if (action === "finish-survey-season") result = await handleFinishSurveySeason(body, sessionCheck.member, organization);
    else if (action === "create-campaign") result = await handleCreateCampaign(sessionCheck.member, organization);
    else if (action === "save-note") result = await handleSaveNote(body, sessionCheck.member, organization);
    else if (action === "save-role") result = await handleSaveRole(body, organization);
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
