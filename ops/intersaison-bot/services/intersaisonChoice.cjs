// The release preparation script copies the Portal's shared ESM helpers next to this service.
let shared;
function helpers() { return shared ||= import("../shared/intersaisonSurveyChoices.js"); }

async function buildChoicePayload(campaign, recipient) {
  const { buildSurveyTwoDiscordPayload } = await import("../shared/intersaisonSurveyObjectives.js");
  const { parseSurveyChoiceId } = await helpers();
  const objectives = campaign?.interaction_payload?.objectives;
  if (!objectives || !Object.keys(objectives).length || Object.keys(objectives).length > 25 || Object.values(objectives).some((v) => typeof v !== "string" || !v.trim())) {
    throw new Error("Snapshot des objectifs incomplet. Aucun message envoyé.");
  }
  parseSurveyChoiceId(`interchoice:${recipient.id}:${recipient.discord_user_id}`);
  if (!recipient.member_name_snapshot || !recipient.guild_code) throw new Error("Compte de jeu du destinataire manquant. Aucun message envoyé.");
  return buildSurveyTwoDiscordPayload(objectives, { recipientId: recipient.id, discordUserId: recipient.discord_user_id,
    guildCodes: Object.keys(objectives), guildNames: campaign.interaction_payload.guildNames,
    isTest: Boolean(campaign.interaction_payload.isTest), account: { name: recipient.member_name_snapshot, guildCode: recipient.guild_code } });
}

async function authorizeChoiceDelivery(supabase, recipient) {
  const { data, error } = await supabase.rpc("check_intersaison_choice_delivery", { p_dm_recipient: recipient.id });
  if (error) throw new Error(error.message || "Vérification du compte de jeu impossible.");
  if (data !== true) throw new Error("Compte de jeu non autorisé pour cet envoi.");
}

async function handleChoiceInteraction(interaction, { supabase } = {}) {
  const customId = String(interaction?.customId || "");
  const isButton = interaction?.isButton?.() && customId.startsWith("interchoice:");
  const isSubmit = interaction?.isModalSubmit?.() && customId.startsWith("interchoice_submit:");
  if (!isButton && !isSubmit) return false;
  const { buildSurveyChoiceModal, saveSurveyChoiceResponse, getSurveyChoiceGuildsFromMessage } = await helpers();
  if (isButton) {
    // No database/network work before the type 9 modal response.
    try { await interaction.showModal(buildSurveyChoiceModal(customId, interaction.user?.id, getSurveyChoiceGuildsFromMessage(interaction.message)).data); }
    catch (error) {
      if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: error.message, ephemeral: true, allowedMentions: { parse: [] } });
    }
    return true;
  }
  await interaction.deferReply({ ephemeral: true });
  try {
    await saveSurveyChoiceResponse(supabase, { customId, userId: interaction.user?.id, interactionId: interaction.id,
      components: interaction.components || [] });
    // Keep the original button usable so a player can revise their choices while open.
    await interaction.editReply({ content: "Tes choix ont été enregistrés. Tu peux les modifier avec le même bouton tant que le sondage reste ouvert.", allowedMentions: { parse: [] } });
  } catch (error) {
    await interaction.editReply({ content: error.message || "Enregistrement impossible. Ta réponse n’a pas été confirmée, réessaie.", allowedMentions: { parse: [] } });
  }
  return true;
}

module.exports = { buildChoicePayload, handleChoiceInteraction, authorizeChoiceDelivery };
