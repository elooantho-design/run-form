/* global process */
import { createClient } from "@supabase/supabase-js";
import {
  applyPortalCorsHeaders,
  readJsonBody,
  requirePortalAdminSession,
  sendPortalJson,
  verifyPortalRequestOrigin,
} from "./_portal-auth.js";
import {
  GUILD_DM_CAMPAIGNS_TABLE,
  GUILD_DM_RECIPIENTS_TABLE,
  buildGuildDmRecipientPlan,
  isMissingGuildDmCampaignSchema,
  normalizeGuildCompareKey,
  normalizePortalGuildValue,
  resolveManageableGuildRowsForActorFromRows,
  resolveRequestedGuildCodes,
  serializeGuildDmCampaign,
  serializeGuildDmRecipient,
  summarizeGuildReachability,
  validateGuildDmMessage,
} from "./_guild-dm-campaigns.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const MAX_HISTORY_ROWS = 80;

function sendJson(res, status, payload) {
  sendPortalJson(res, status, payload, res._portalReq || null);
}

function cleanText(value) {
  return String(value || "").trim();
}

function getActorName(actor) {
  return cleanText(actor?.watcher_name || actor?.discord_id || "Admin");
}

async function loadActivePortalGuildRows() {
  const { data, error } = await supabase
    .from("portal_guilds")
    .select("id, organization_id, guild_code, is_active")
    .eq("is_active", true)
    .order("guild_code", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function resolveGuildDmScope(actor) {
  const portalGuilds = await loadActivePortalGuildRows();
  const manageableGuilds = resolveManageableGuildRowsForActorFromRows(actor, portalGuilds);
  const actorGuildKey = normalizeGuildCompareKey(actor?.guild_code);
  const actorGuild =
    manageableGuilds.find((row) => normalizeGuildCompareKey(row.guild_code) === actorGuildKey) ||
    portalGuilds.find((row) => normalizeGuildCompareKey(row.guild_code) === actorGuildKey) ||
    manageableGuilds[0] ||
    null;
  const organizationId = actorGuild?.organization_id || manageableGuilds[0]?.organization_id || "";

  if (!manageableGuilds.length || !organizationId) {
    const error = new Error("Aucune guilde gerable trouvee pour ce compte.");
    error.statusCode = 403;
    throw error;
  }

  return {
    organizationId,
    manageableGuilds,
    manageableGuildCodes: manageableGuilds.map((row) => normalizePortalGuildValue(row.guild_code)).filter(Boolean),
  };
}

async function loadMembersForGuilds(guildCodes) {
  if (!guildCodes.length) return [];

  const { data, error } = await supabase
    .from("guild_members")
    .select("id, watcher_name, discord_id, guild_code, role, roster_status, community_access_type, community_status, primary_member_id")
    .in("guild_code", guildCodes)
    .limit(1200);

  if (error) throw error;
  return data || [];
}

async function loadCampaignRows(organizationId) {
  const { data: campaigns, error: campaignError } = await supabase
    .from(GUILD_DM_CAMPAIGNS_TABLE)
    .select("id, organization_id, created_by_member_id, created_by_name, message, target_guild_codes, status, total_recipients, sent_count, confirmed_count, failed_count, missing_discord_count, sent_at, created_at, updated_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(MAX_HISTORY_ROWS);

  if (campaignError) {
    if (isMissingGuildDmCampaignSchema(campaignError)) {
      return { schemaReady: false, campaigns: [] };
    }
    throw campaignError;
  }

  const campaignIds = (campaigns || []).map((campaign) => campaign.id).filter(Boolean);
  if (!campaignIds.length) return { schemaReady: true, campaigns: [] };

  const { data: recipients, error: recipientError } = await supabase
    .from(GUILD_DM_RECIPIENTS_TABLE)
    .select("id, campaign_id, status, sent_at, confirmed_at")
    .in("campaign_id", campaignIds);

  if (recipientError) {
    if (isMissingGuildDmCampaignSchema(recipientError)) {
      return { schemaReady: false, campaigns: [] };
    }
    throw recipientError;
  }

  const recipientsByCampaignId = new Map(campaignIds.map((id) => [id, []]));
  (recipients || []).forEach((recipient) => {
    if (!recipientsByCampaignId.has(recipient.campaign_id)) return;
    recipientsByCampaignId.get(recipient.campaign_id).push(recipient);
  });

  return {
    schemaReady: true,
    campaigns: (campaigns || []).map((campaign) =>
      serializeGuildDmCampaign(campaign, recipientsByCampaignId.get(campaign.id) || []),
    ),
  };
}

async function loadCampaignDetail(organizationId, campaignId) {
  const cleanCampaignId = cleanText(campaignId);
  if (!cleanCampaignId) {
    const error = new Error("Campagne introuvable.");
    error.statusCode = 400;
    throw error;
  }

  const { data: campaign, error: campaignError } = await supabase
    .from(GUILD_DM_CAMPAIGNS_TABLE)
    .select("id, organization_id, created_by_member_id, created_by_name, message, target_guild_codes, status, total_recipients, sent_count, confirmed_count, failed_count, missing_discord_count, sent_at, created_at, updated_at")
    .eq("organization_id", organizationId)
    .eq("id", cleanCampaignId)
    .maybeSingle();

  if (campaignError) {
    if (isMissingGuildDmCampaignSchema(campaignError)) {
      const error = new Error("Migration guild_dm_campaigns non executee.");
      error.statusCode = 428;
      throw error;
    }
    throw campaignError;
  }

  if (!campaign) {
    const error = new Error("Campagne introuvable dans ce perimetre.");
    error.statusCode = 404;
    throw error;
  }

  const { data: recipients, error: recipientError } = await supabase
    .from(GUILD_DM_RECIPIENTS_TABLE)
    .select("id, campaign_id, member_id, guild_code, member_name_snapshot, discord_user_id, status, sent_at, last_sent_at, confirmed_at, send_attempts, last_attempt_at, last_error, reminder_count, created_at")
    .eq("campaign_id", campaign.id)
    .order("guild_code", { ascending: true })
    .order("member_name_snapshot", { ascending: true });

  if (recipientError) {
    if (isMissingGuildDmCampaignSchema(recipientError)) {
      const error = new Error("Migration guild_dm_recipients non executee.");
      error.statusCode = 428;
      throw error;
    }
    throw recipientError;
  }

  const serializedRecipients = (recipients || []).map(serializeGuildDmRecipient);
  return {
    campaign: serializeGuildDmCampaign(campaign, recipients || []),
    recipients: serializedRecipients,
  };
}

async function refreshCampaignCounters(campaignId) {
  const { data: recipients, error } = await supabase
    .from(GUILD_DM_RECIPIENTS_TABLE)
    .select("id, status, sent_at, confirmed_at")
    .eq("campaign_id", campaignId);

  if (error) throw error;

  const rows = recipients || [];
  const sentCount = rows.filter((row) => ["sent", "confirmed"].includes(row.status) || row.sent_at).length;
  const confirmedCount = rows.filter((row) => row.status === "confirmed" || row.confirmed_at).length;
  const failedCount = rows.filter((row) => row.status === "failed").length;
  const queuedCount = rows.filter((row) => ["queued", "sending"].includes(row.status)).length;
  const status = queuedCount > 0 ? "queued" : failedCount > 0 ? "partial" : "completed";

  const { error: updateError } = await supabase
    .from(GUILD_DM_CAMPAIGNS_TABLE)
    .update({
      status,
      sent_count: sentCount,
      confirmed_count: confirmedCount,
      failed_count: failedCount,
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaignId);

  if (updateError) throw updateError;
}

async function handleSummary(req, res, actor) {
  try {
    const scope = await resolveGuildDmScope(actor);
    const members = await loadMembersForGuilds(scope.manageableGuildCodes);
    const campaigns = await loadCampaignRows(scope.organizationId);

    sendJson(res, 200, {
      ok: true,
      mode: "summary",
      schemaReady: campaigns.schemaReady,
      organizationId: scope.organizationId,
      manageableGuilds: summarizeGuildReachability(members, scope.manageableGuilds),
      campaigns: campaigns.campaigns,
    });
  } catch (error) {
    if (isMissingGuildDmCampaignSchema(error)) {
      sendJson(res, 200, {
        ok: true,
        mode: "summary",
        schemaReady: false,
        organizationId: "",
        manageableGuilds: [],
        campaigns: [],
      });
      return;
    }
    sendJson(res, error?.statusCode || 500, {
      ok: false,
      error: error?.message || "Chargement campagnes MP impossible.",
    });
  }
}

async function handleCampaignDetail(res, actor, campaignId) {
  try {
    const scope = await resolveGuildDmScope(actor);
    const detail = await loadCampaignDetail(scope.organizationId, campaignId);
    sendJson(res, 200, { ok: true, mode: "campaign", schemaReady: true, ...detail });
  } catch (error) {
    sendJson(res, error?.statusCode || 500, {
      ok: false,
      error: error?.message || "Detail campagne MP impossible.",
    });
  }
}

async function handleCreateCampaign(res, actor, body) {
  try {
    const scope = await resolveGuildDmScope(actor);
    const message = validateGuildDmMessage(body?.message);
    const { selected, denied } = resolveRequestedGuildCodes(body?.guildCodes, scope.manageableGuilds);

    if (denied.length) {
      const error = new Error(`Guilde hors perimetre : ${denied.join(", ")}.`);
      error.statusCode = 403;
      throw error;
    }
    if (!selected.length) {
      const error = new Error("Selectionne au moins une guilde.");
      error.statusCode = 400;
      throw error;
    }

    const members = await loadMembersForGuilds(selected);
    const plan = buildGuildDmRecipientPlan(members, selected);
    if (!plan.recipients.length) {
      const error = new Error("Aucun membre joignable avec un ID Discord valide.");
      error.statusCode = 400;
      throw error;
    }

    const now = new Date().toISOString();
    const { data: campaign, error: campaignError } = await supabase
      .from(GUILD_DM_CAMPAIGNS_TABLE)
      .insert({
        organization_id: scope.organizationId,
        created_by_member_id: actor.id,
        created_by_name: getActorName(actor),
        message,
        target_guild_codes: selected,
        status: "queued",
        total_recipients: plan.recipients.length,
        missing_discord_count: plan.missingDiscordCount,
        created_at: now,
        updated_at: now,
      })
      .select("id, organization_id, created_by_member_id, created_by_name, message, target_guild_codes, status, total_recipients, sent_count, confirmed_count, failed_count, missing_discord_count, sent_at, created_at, updated_at")
      .single();

    if (campaignError) {
      if (isMissingGuildDmCampaignSchema(campaignError)) {
        const error = new Error("Migration guild_dm_campaigns non executee.");
        error.statusCode = 428;
        throw error;
      }
      throw campaignError;
    }

    const recipientRows = plan.recipients.map((recipient) => ({
      campaign_id: campaign.id,
      organization_id: scope.organizationId,
      member_id: recipient.memberId,
      guild_code: recipient.guildCode,
      member_name_snapshot: recipient.memberName,
      discord_user_id: recipient.discordUserId,
      status: "queued",
      created_at: now,
      updated_at: now,
    }));

    const { error: recipientError } = await supabase.from(GUILD_DM_RECIPIENTS_TABLE).insert(recipientRows);
    if (recipientError) {
      await supabase
        .from(GUILD_DM_CAMPAIGNS_TABLE)
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", campaign.id);

      if (isMissingGuildDmCampaignSchema(recipientError)) {
        const error = new Error("Migration guild_dm_recipients non executee.");
        error.statusCode = 428;
        throw error;
      }
      throw recipientError;
    }

    const detail = await loadCampaignDetail(scope.organizationId, campaign.id);
    sendJson(res, 201, {
      ok: true,
      mode: "created",
      schemaReady: true,
      missingDiscordCount: plan.missingDiscordCount,
      duplicateCount: plan.duplicateCount,
      ...detail,
    });
  } catch (error) {
    sendJson(res, error?.statusCode || 500, {
      ok: false,
      error: error?.message || "Creation campagne MP impossible.",
    });
  }
}

async function handleRetryPending(res, actor, body) {
  try {
    const scope = await resolveGuildDmScope(actor);
    const detail = await loadCampaignDetail(scope.organizationId, body?.campaignId);
    const retryRecipients = detail.recipients.filter(
      (recipient) => recipient.status === "sent" && !recipient.confirmedAt,
    );

    if (!retryRecipients.length) {
      sendJson(res, 200, {
        ok: true,
        mode: "retry-pending",
        queuedCount: 0,
        ...detail,
      });
      return;
    }

    const now = new Date().toISOString();
    for (const recipient of retryRecipients) {
      const { error } = await supabase
        .from(GUILD_DM_RECIPIENTS_TABLE)
        .update({
          status: "queued",
          reminder_count: Number(recipient.reminderCount || 0) + 1,
          last_attempt_at: now,
          last_error: null,
          updated_at: now,
        })
        .eq("id", recipient.id)
        .eq("campaign_id", detail.campaign.id);
      if (error) throw error;
    }

    await supabase
      .from(GUILD_DM_CAMPAIGNS_TABLE)
      .update({ status: "queued", updated_at: now })
      .eq("id", detail.campaign.id);
    await refreshCampaignCounters(detail.campaign.id);

    const refreshed = await loadCampaignDetail(scope.organizationId, detail.campaign.id);
    sendJson(res, 200, {
      ok: true,
      mode: "retry-pending",
      queuedCount: retryRecipients.length,
      ...refreshed,
    });
  } catch (error) {
    sendJson(res, error?.statusCode || 500, {
      ok: false,
      error: error?.message || "Relance des non-confirmes impossible.",
    });
  }
}

export default async function handler(req, res) {
  res._portalReq = req;
  applyPortalCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const sessionCheck = await requirePortalAdminSession(req, supabase);
  if (sessionCheck.error) {
    sendJson(res, sessionCheck.status, { ok: false, error: sessionCheck.error });
    return;
  }

  if (req.method === "GET") {
    const url = new URL(req.url, "http://localhost");
    const action = cleanText(url.searchParams.get("action")) || "summary";
    if (action === "summary") {
      await handleSummary(req, res, sessionCheck.member);
      return;
    }
    if (action === "campaign") {
      await handleCampaignDetail(res, sessionCheck.member, url.searchParams.get("campaignId"));
      return;
    }
    sendJson(res, 400, { ok: false, error: "Action MP inconnue." });
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Methode non autorisee." });
    return;
  }

  if (!verifyPortalRequestOrigin(req)) {
    sendJson(res, 403, { ok: false, error: "Origine Portal refusee." });
    return;
  }

  const body = await readJsonBody(req);
  const action = cleanText(body?.action);

  if (action === "create-campaign") {
    await handleCreateCampaign(res, sessionCheck.member, body);
    return;
  }
  if (action === "retry-pending") {
    await handleRetryPending(res, sessionCheck.member, body);
    return;
  }

  sendJson(res, 400, { ok: false, error: "Action MP inconnue." });
}
