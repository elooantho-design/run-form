const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { buildChoicePayload, handleChoiceInteraction } = require("./intersaisonChoice.cjs");

const CAMPAIGNS_TABLE = "guild_dm_campaigns";
const RECIPIENTS_TABLE = "guild_dm_recipients";
const ACK_PREFIX = "gdmack:";
const INTERSAISON_SURVEY_RECIPIENTS_TABLE = "intersaison_survey_recipients";
const INTERSAISON_SURVEY_RESPONSES_TABLE = "intersaison_survey_responses";
const INTERSAISON_SURVEY_CAMPAIGNS_TABLE = "intersaison_survey_campaigns";
const INTERSAISON_OBJECTIVES_PREFIX = "interobj:";
const INTERSAISON_OBJECTIVES_SUBMIT_PREFIX = "interobj_submit:";
const DEFAULT_POLL_MS = 15000;
const DEFAULT_BATCH_SIZE = 3;
const MAX_DISCORD_CONTENT_LENGTH = 2000;
const CANCELLED_STATUS = "cancelled";
const DELIVERABLE_CAMPAIGN_STATUSES = new Set(["queued", "sending", "partial"]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanText(value) {
  return String(value || "").trim();
}

function sanitizeDiscordError(error) {
  const status = error?.status || error?.httpStatus || error?.rawError?.status;
  const code = error?.code || error?.rawError?.code;
  const message = cleanText(error?.rawError?.message || error?.message || "Erreur Discord");
  const reason = [status ? `HTTP ${status}` : "", code ? `code ${code}` : "", message]
    .filter(Boolean)
    .join(" - ");
  return reason.slice(0, 300);
}

function getRetryAfterMs(error) {
  const retryAfter =
    error?.rawError?.retry_after ??
    error?.retry_after ??
    error?.retryAfter ??
    error?.response?.headers?.["retry-after"];
  const seconds = Number(retryAfter);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 30000) : 0;
}

function isRateLimitError(error) {
  return Number(error?.status || error?.httpStatus) === 429 || Number(error?.rawError?.status) === 429 || getRetryAfterMs(error) > 0;
}

function isMissingCampaignSchema(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes(CAMPAIGNS_TABLE) ||
    message.includes(RECIPIENTS_TABLE)
  );
}

function buildAckCustomId(recipientId) {
  return `${ACK_PREFIX}${recipientId}`;
}

function buildIntersaisonObjectivesCustomId(recipientId) {
  return `${INTERSAISON_OBJECTIVES_PREFIX}${recipientId}`;
}

function buildIntersaisonObjectivesSubmitCustomId(recipientId) {
  return `${INTERSAISON_OBJECTIVES_SUBMIT_PREFIX}${recipientId}`;
}

function isGuildDmAckCustomId(customId) {
  return cleanText(customId).startsWith(ACK_PREFIX);
}

function isIntersaisonObjectivesCustomId(customId) {
  return cleanText(customId).startsWith(INTERSAISON_OBJECTIVES_PREFIX);
}

function isIntersaisonObjectivesSubmitCustomId(customId) {
  return cleanText(customId).startsWith(INTERSAISON_OBJECTIVES_SUBMIT_PREFIX);
}

function parseAckRecipientId(customId) {
  return cleanText(customId).slice(ACK_PREFIX.length);
}

function parseIntersaisonObjectivesRecipientId(customId) {
  return cleanText(customId).slice(INTERSAISON_OBJECTIVES_PREFIX.length);
}

function parseIntersaisonObjectivesSubmitRecipientId(customId) {
  return cleanText(customId).slice(INTERSAISON_OBJECTIVES_SUBMIT_PREFIX.length);
}

function buildAckRow(recipientId, { disabled = false } = {}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(buildAckCustomId(recipientId))
      .setLabel(disabled ? "Lu et confirme" : "J'ai lu")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success)
      .setDisabled(Boolean(disabled)),
  );
}

function buildIntersaisonObjectivesRow(recipientId, { disabled = false } = {}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(buildIntersaisonObjectivesCustomId(recipientId))
      .setLabel(disabled ? "Avis enregistré" : "Donner mon avis")
      .setEmoji("📝")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(Boolean(disabled)),
  );
}

function buildGuildDmInteractionRow(campaign, recipientId, options = {}) {
  const interactionType = cleanText(campaign?.interaction_type || campaign?.interactionType || "ack");
  if (interactionType === "intersaison_objectives") {
    return buildIntersaisonObjectivesRow(recipientId, options);
  }
  if (interactionType === "none") return null;
  return buildAckRow(recipientId, options);
}

function buildGuildDmContent(campaign) {
  const userMessage = cleanText(campaign?.message);
  const footer = "Message transmis via le dashboard Paladin.";
  const content = `${userMessage}\n\n_${footer}_`;
  return content.slice(0, MAX_DISCORD_CONTENT_LENGTH);
}

function buildGuildDmPayload(campaign, recipient) {
  const interactionRow = buildGuildDmInteractionRow(campaign, recipient.id);
  return {
    content: buildGuildDmContent(campaign),
    components: interactionRow ? [interactionRow] : [],
    allowedMentions: { parse: [] },
  };
}

function buildIntersaisonObjectivesModal(recipientId) {
  return new ModalBuilder()
    .setCustomId(buildIntersaisonObjectivesSubmitCustomId(recipientId))
    .setTitle("Sondage inter-saison")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("objective_text")
          .setLabel("Ton avis")
          .setStyle(TextInputStyle.Paragraph)
          .setMinLength(2)
          .setMaxLength(1900)
          .setRequired(true)
          .setPlaceholder("Explique librement tes attentes pour la prochaine saison."),
      ),
    );
}

async function refreshCampaignCounters(supabase, campaignId) {
  const { data: campaign, error: campaignError } = await supabase
    .from(CAMPAIGNS_TABLE)
    .select("id, status")
    .eq("id", campaignId)
    .maybeSingle();

  if (campaignError) throw campaignError;

  const { data, error } = await supabase
    .from(RECIPIENTS_TABLE)
    .select("id, status, sent_at, confirmed_at")
    .eq("campaign_id", campaignId);

  if (error) throw error;

  const recipients = data || [];
  const sentCount = recipients.filter((row) => ["sent", "confirmed"].includes(row.status) || row.sent_at).length;
  const confirmedCount = recipients.filter((row) => row.status === "confirmed" || row.confirmed_at).length;
  const failedCount = recipients.filter((row) => row.status === "failed").length;
  const queuedCount = recipients.filter((row) => ["queued", "sending"].includes(row.status)).length;
  const status = campaign?.status === CANCELLED_STATUS
    ? CANCELLED_STATUS
    : queuedCount > 0 ? "sending" : failedCount > 0 ? "partial" : "completed";
  const now = new Date().toISOString();

  const { error: updateError } = await supabase
    .from(CAMPAIGNS_TABLE)
    .update({
      status,
      sent_count: sentCount,
      confirmed_count: confirmedCount,
      failed_count: failedCount,
      sent_at: sentCount > 0 ? now : null,
      updated_at: now,
    })
    .eq("id", campaignId);

  if (updateError) throw updateError;
}

async function fetchQueuedRecipients(supabase, limit = DEFAULT_BATCH_SIZE) {
  const { data, error } = await supabase
    .from(RECIPIENTS_TABLE)
    .select(`
      id,
      campaign_id,
      discord_user_id,
      status,
      sent_at,
      send_attempts,
      reminder_count,
      guild_dm_campaigns!inner (
        id,
        message,
        status,
        interaction_type,
        interaction_payload
      )
    `)
    .eq("status", "queued")
    .order("last_attempt_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    if (isMissingCampaignSchema(error)) return [];
    throw error;
  }

  return (data || []).filter(
    (row) =>
      row?.guild_dm_campaigns?.message &&
      DELIVERABLE_CAMPAIGN_STATUSES.has(row.guild_dm_campaigns.status),
  );
}

async function markRecipientSending(supabase, recipient) {
  const attempts = Number(recipient?.send_attempts || 0) + 1;
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from(RECIPIENTS_TABLE)
    .update({
      status: "sending",
      send_attempts: attempts,
      last_attempt_at: now,
      updated_at: now,
    })
    .eq("id", recipient.id)
    .eq("status", "queued")
    .select("id, campaign_id, discord_user_id, status, sent_at, send_attempts")
    .maybeSingle();

  if (error) throw error;
  return data ? { ...recipient, ...data, send_attempts: attempts } : null;
}

async function markCampaignSending(supabase, campaignId) {
  const { error } = await supabase
    .from(CAMPAIGNS_TABLE)
    .update({
      status: "sending",
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaignId)
    .in("status", [...DELIVERABLE_CAMPAIGN_STATUSES]);

  if (error) throw error;
}

async function loadRecipientDeliveryState(supabase, recipientId) {
  const { data, error } = await supabase
    .from(RECIPIENTS_TABLE)
    .select(`
      id,
      campaign_id,
      status,
      guild_dm_campaigns!inner (
        id,
        status
      )
    `)
    .eq("id", recipientId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function markRecipientSent(supabase, recipient, sentMessage) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from(RECIPIENTS_TABLE)
    .update({
      status: "sent",
      sent_at: recipient.sent_at || now,
      last_sent_at: now,
      discord_message_id: sentMessage?.id || null,
      last_error: null,
      updated_at: now,
    })
    .eq("id", recipient.id);

  if (error) throw error;
}

async function markRecipientQueuedAfterRateLimit(supabase, recipient, error) {
  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from(RECIPIENTS_TABLE)
    .update({
      status: "queued",
      last_error: sanitizeDiscordError(error),
      updated_at: now,
    })
    .eq("id", recipient.id);

  if (updateError) throw updateError;
}

async function markRecipientFailed(supabase, recipient, error) {
  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from(RECIPIENTS_TABLE)
    .update({
      status: "failed",
      last_error: sanitizeDiscordError(error),
      updated_at: now,
    })
    .eq("id", recipient.id);

  if (updateError) throw updateError;
}

async function loadIntersaisonSurveyRecipientForDmRecipient(supabase, dmRecipientId) {
  const cleanRecipientId = cleanText(dmRecipientId);
  if (!cleanRecipientId) return null;

  const { data, error } = await supabase
    .from(INTERSAISON_SURVEY_RECIPIENTS_TABLE)
    .select(`
      id,
      survey_campaign_id,
      organization_id,
      member_id,
      guild_code_snapshot,
      member_name_snapshot,
      discord_user_id,
      guild_dm_recipient_id,
      response_status,
      responded_at,
      survey_campaign:${INTERSAISON_SURVEY_CAMPAIGNS_TABLE}(
        id,
        organization_id,
        poll_number,
        status
      )
    `)
    .eq("guild_dm_recipient_id", cleanRecipientId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function saveIntersaisonObjectivesResponse(supabase, interaction, dmRecipientId, text) {
  const cleanResponse = cleanText(text);
  if (!cleanResponse) throw new Error("Réponse vide.");
  if (cleanResponse.length > 1900) throw new Error("Réponse trop longue.");

  const surveyRecipient = await loadIntersaisonSurveyRecipientForDmRecipient(supabase, dmRecipientId);
  if (!surveyRecipient) throw new Error("Destinataire du sondage introuvable.");

  const interactionUserId = String(interaction?.user?.id || "");
  if (interactionUserId !== String(surveyRecipient.discord_user_id || "")) {
    throw new Error("Ce sondage est réservé au destinataire du message.");
  }

  const campaign = surveyRecipient.survey_campaign || null;
  if (!campaign || campaign.status !== "open") {
    throw new Error("Ce sondage n'est plus ouvert.");
  }
  if (Number(campaign.poll_number || 1) !== 1) {
    throw new Error("Ce formulaire ne correspond pas au sondage objectifs.");
  }

  const now = new Date().toISOString();
  const { data: previousResponses, error: previousError } = await supabase
    .from(INTERSAISON_SURVEY_RESPONSES_TABLE)
    .select("id, response_version")
    .eq("survey_recipient_id", surveyRecipient.id)
    .eq("is_current", true)
    .order("response_version", { ascending: false })
    .limit(1);
  if (previousError) throw previousError;

  const previous = previousResponses?.[0] || null;
  if (previous) {
    const { error: archiveError } = await supabase
      .from(INTERSAISON_SURVEY_RESPONSES_TABLE)
      .update({ is_current: false })
      .eq("id", previous.id);
    if (archiveError) throw archiveError;
  }

  const responseVersion = Number(previous?.response_version || 0) + 1;
  const { error: insertError } = await supabase.from(INTERSAISON_SURVEY_RESPONSES_TABLE).insert({
    survey_campaign_id: surveyRecipient.survey_campaign_id,
    survey_recipient_id: surveyRecipient.id,
    organization_id: surveyRecipient.organization_id,
    member_id: surveyRecipient.member_id,
    discord_user_id: surveyRecipient.discord_user_id,
    poll_number: 1,
    guild_code_snapshot: surveyRecipient.guild_code_snapshot,
    member_name_snapshot: surveyRecipient.member_name_snapshot,
    objective_text: cleanResponse,
    response_version: responseVersion,
    is_current: true,
    responded_at: now,
    created_at: now,
  });
  if (insertError) throw insertError;

  const { error: recipientUpdateError } = await supabase
    .from(INTERSAISON_SURVEY_RECIPIENTS_TABLE)
    .update({
      response_status: "responded",
      delivery_status: "confirmed",
      responded_at: now,
      last_error: null,
      updated_at: now,
    })
    .eq("id", surveyRecipient.id);
  if (recipientUpdateError) throw recipientUpdateError;

  const dmRecipient = await loadRecipientForAck(supabase, dmRecipientId);
  if (dmRecipient) {
    await confirmGuildDmRecipient(supabase, dmRecipient);
  }

  return { surveyRecipient, responseVersion };
}

async function deliverGuildDmRecipient({ client, supabase, recipient }) {
  const sendingRecipient = await markRecipientSending(supabase, recipient);
  if (!sendingRecipient) return;
  await markCampaignSending(supabase, sendingRecipient.campaign_id);

  try {
    const deliveryState = await loadRecipientDeliveryState(supabase, sendingRecipient.id);
    if (
      deliveryState?.status !== "sending" ||
      !DELIVERABLE_CAMPAIGN_STATUSES.has(deliveryState?.guild_dm_campaigns?.status)
    ) {
      return;
    }

    const user = await client.users.fetch(sendingRecipient.discord_user_id);
    const payload = sendingRecipient.guild_dm_campaigns.interaction_type === "intersaison_choice"
      ? await buildChoicePayload(sendingRecipient.guild_dm_campaigns, sendingRecipient)
      : buildGuildDmPayload(sendingRecipient.guild_dm_campaigns, sendingRecipient);
    const sentMessage = await user.send(payload);
    await markRecipientSent(supabase, sendingRecipient, sentMessage);
    console.log("[guild-dm] sent", {
      campaignId: sendingRecipient.campaign_id,
      recipientId: sendingRecipient.id,
      discordUserId: sendingRecipient.discord_user_id,
    });
  } catch (error) {
    if (isRateLimitError(error)) {
      const retryAfterMs = getRetryAfterMs(error) || 5000;
      await markRecipientQueuedAfterRateLimit(supabase, sendingRecipient, error);
      console.warn("[guild-dm] rate limited", {
        campaignId: sendingRecipient.campaign_id,
        recipientId: sendingRecipient.id,
        retryAfterMs,
      });
      await sleep(retryAfterMs);
      return;
    }

    await markRecipientFailed(supabase, sendingRecipient, error);
    console.warn("[guild-dm] failed", {
      campaignId: sendingRecipient.campaign_id,
      recipientId: sendingRecipient.id,
      error: sanitizeDiscordError(error),
    });
  } finally {
    await refreshCampaignCounters(supabase, sendingRecipient.campaign_id).catch((error) => {
      console.warn("[guild-dm] campaign counter refresh failed", error?.message || error);
    });
  }
}

async function processGuildDmBatch({ client, supabase, batchSize = DEFAULT_BATCH_SIZE }) {
  const recipients = await fetchQueuedRecipients(supabase, batchSize);
  for (const recipient of recipients) {
    await deliverGuildDmRecipient({ client, supabase, recipient });
  }
  return recipients.length;
}

function startGuildDmCampaignWorker({ client, supabase, pollMs = DEFAULT_POLL_MS, batchSize = DEFAULT_BATCH_SIZE } = {}) {
  if (!client || !supabase) throw new Error("client et supabase obligatoires pour guild DM worker");

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await processGuildDmBatch({ client, supabase, batchSize });
    } catch (error) {
      if (isMissingCampaignSchema(error)) {
        console.warn("[guild-dm] schema not installed yet");
      } else {
        console.error("[guild-dm] worker error", error);
      }
    } finally {
      running = false;
    }
  };

  const interval = setInterval(tick, pollMs);
  void tick();
  return () => clearInterval(interval);
}

async function loadRecipientForAck(supabase, recipientId) {
  const { data, error } = await supabase
    .from(RECIPIENTS_TABLE)
    .select("id, campaign_id, discord_user_id, status, confirmed_at")
    .eq("id", recipientId)
    .maybeSingle();

  if (error) {
    if (isMissingCampaignSchema(error)) return null;
    throw error;
  }
  return data || null;
}

async function confirmGuildDmRecipient(supabase, recipient) {
  if (!recipient?.id) return null;
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from(RECIPIENTS_TABLE)
    .update({
      status: "confirmed",
      confirmed_at: recipient.confirmed_at || now,
      updated_at: now,
    })
    .eq("id", recipient.id)
    .select("id, campaign_id, discord_user_id, status, confirmed_at")
    .single();

  if (error) throw error;
  await refreshCampaignCounters(supabase, data.campaign_id);
  return data;
}

async function handleGuildDmAckInteraction(interaction, { supabase } = {}) {
  if (!interaction?.isButton?.()) return false;
  if (!isGuildDmAckCustomId(interaction.customId)) return false;

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
  }

  const respond = async (content) => {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content }).catch(() => {});
      return;
    }
    await interaction.reply({ content, ephemeral: true }).catch(() => {});
  };

  const recipientId = parseAckRecipientId(interaction.customId);
  if (!recipientId) {
    await respond("Confirmation introuvable.");
    return true;
  }

  const recipient = await loadRecipientForAck(supabase, recipientId);
  if (!recipient) {
    await respond("Cette confirmation n'existe plus.");
    return true;
  }

  if (String(interaction.user?.id || "") !== String(recipient.discord_user_id || "")) {
    await respond("Ce bouton est reserve au destinataire du message.");
    return true;
  }

  if (recipient.status !== "confirmed" || !recipient.confirmed_at) {
    await confirmGuildDmRecipient(supabase, recipient);
  }

  await interaction.message?.edit({
    components: [buildAckRow(recipient.id, { disabled: true })],
  }).catch(() => {});
  await respond("Lu et confirme.");

  console.log("[guild-dm] confirmed", {
    campaignId: recipient.campaign_id,
    recipientId: recipient.id,
    discordUserId: recipient.discord_user_id,
  });
  return true;
}

async function handleIntersaisonObjectivesInteraction(interaction, { supabase } = {}) {
  if (interaction?.isButton?.() && isIntersaisonObjectivesCustomId(interaction.customId)) {
    const recipientId = parseIntersaisonObjectivesRecipientId(interaction.customId);
    if (!recipientId) {
      await interaction.reply?.({ content: "Sondage introuvable.", ephemeral: true }).catch(() => {});
      return true;
    }
    await interaction.showModal(buildIntersaisonObjectivesModal(recipientId));
    return true;
  }

  if (!interaction?.isModalSubmit?.() || !isIntersaisonObjectivesSubmitCustomId(interaction.customId)) {
    return false;
  }

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
  }

  const respond = async (content) => {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content }).catch(() => {});
      return;
    }
    await interaction.reply({ content, ephemeral: true }).catch(() => {});
  };

  const recipientId = parseIntersaisonObjectivesSubmitRecipientId(interaction.customId);
  const objectiveText = interaction.fields?.getTextInputValue?.("objective_text") || "";
  try {
    await saveIntersaisonObjectivesResponse(supabase, interaction, recipientId, objectiveText);
    await interaction.message?.edit?.({
      components: [buildIntersaisonObjectivesRow(recipientId, { disabled: true })],
    }).catch(() => {});
    await respond("Merci, ta réponse a bien été enregistrée.");
  } catch (error) {
    await respond(error?.message || "Réponse inter-saison temporairement indisponible. Réessaie dans un instant.");
  }
  return true;
}

async function handleGuildDmInteraction(interaction, options = {}) {
  if (await handleChoiceInteraction(interaction, options)) return true;
  if (await handleGuildDmAckInteraction(interaction, options)) return true;
  if (await handleIntersaisonObjectivesInteraction(interaction, options)) return true;
  return false;
}

module.exports = {
  ACK_PREFIX,
  buildAckCustomId,
  buildGuildDmContent,
  buildGuildDmInteractionRow,
  buildGuildDmPayload,
  buildIntersaisonObjectivesCustomId,
  DELIVERABLE_CAMPAIGN_STATUSES,
  handleGuildDmAckInteraction,
  handleGuildDmInteraction,
  handleIntersaisonObjectivesInteraction,
  isGuildDmAckCustomId,
  isIntersaisonObjectivesCustomId,
  processGuildDmBatch,
  sanitizeDiscordError,
  saveIntersaisonObjectivesResponse,
  startGuildDmCampaignWorker,
};
