// Opt-in adapter: no Inter-saison table or interaction is read or changed here.
function isGuildSurveyCampaign(campaign) {
  return campaign?.interaction_payload?.kind === "guild_survey_v1";
}

async function authorizeGuildSurveyDelivery(supabase, recipient) {
  const { data, error } = await supabase.rpc("authorize_guild_survey_delivery", {
    p_dm_recipient: recipient.id, p_discord_user_id: recipient.discord_user_id,
  });
  if (error || data?.authorized !== true) throw new Error(error?.message || "Livraison du sondage non autorisee.");
  return data;
}

function buildGuildSurveyPayload(campaign, recipient) {
  const id = campaign?.interaction_payload?.surveyId;
  if (campaign.interaction_type !== "none" || !/^[0-9a-f-]{36}$/i.test(id || "") || !campaign.message?.includes(`?guildSurvey=${id}`)) {
    throw new Error("Invitation de sondage invalide.");
  }
  const name = String(recipient.member_name_snapshot || "Joueur").slice(0, 80);
  const guild = String(recipient.guild_code || "").slice(0, 24);
  const content = `Bonjour ${name}${guild ? ` (${guild})` : ""},\n\n${campaign.message}\n\n_Message transmis via le dashboard Paladin._`;
  if (content.length > 2000) throw new Error("Invitation trop longue pour Discord.");
  return { content, components: [], allowedMentions: { parse: [] } };
}

module.exports = { isGuildSurveyCampaign, authorizeGuildSurveyDelivery, buildGuildSurveyPayload };
