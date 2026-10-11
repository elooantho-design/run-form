export const INTERSAISON_SURVEY_SEASONS_TABLE = "intersaison_survey_seasons";
export const INTERSAISON_SURVEY_CAMPAIGNS_TABLE = "intersaison_survey_campaigns";
export const INTERSAISON_SURVEY_RECIPIENTS_TABLE = "intersaison_survey_recipients";
export const INTERSAISON_SURVEY_RESPONSES_TABLE = "intersaison_survey_responses";
export const INTERSAISON_SURVEY_GUILD_OBJECTIVES_TABLE = "intersaison_survey_guild_objectives";

export const INTERSAISON_SURVEY_ONE_DEFAULT_MESSAGE = `⚔️ Cluster Paladin — Préparation de la prochaine saison

Bonjour !

Nous commençons à préparer la prochaine saison et, avant de définir les objectifs des différentes guildes du cluster, nous souhaitons recueillir ton avis.

Attention : ce message n'est pas encore le sondage d'inter-saison qui déterminera ta future guilde.

Le sondage d'affectation viendra dans un second temps.

Pour préparer celui-ci, nous souhaitons comprendre tes ambitions, tes attentes et l'environnement dans lequel tu aimerais évoluer la saison prochaine.

L'objectif est de construire les futurs objectifs de nos guildes à partir des envies des joueurs, plutôt que de vous imposer des orientations décidées à l'avance.

Quel objectif aimerais-tu que ta guilde poursuive la saison prochaine, et dans quel environnement souhaiterais-tu évoluer pour prendre plaisir à jouer ?

Tu peux répondre librement, en quelques mots ou en développant ta réflexion.

Merci pour ta participation !`;

export const INTERSAISON_SURVEY_STATES = Object.freeze([
  "inactive",
  "survey1_preparing",
  "survey1_open",
  "survey1_closed",
  "survey2_preparing",
  "survey2_open",
  "survey2_closed",
  "finished",
]);

export const INTERSAISON_SURVEY_CAMPAIGN_STATUSES = Object.freeze([
  "preparing",
  "open",
  "closed",
  "cancelled",
]);

export const INTERSAISON_SURVEY_DM_INTERACTION_OBJECTIVES = "intersaison_objectives";

export function cleanSurveyText(value) {
  return String(value || "").trim();
}

export function normalizeSurveyGuildCode(value) {
  return cleanSurveyText(value).replace(/\s+/g, " ");
}

export function normalizeSurveyPollNumber(value) {
  const number = Number(value);
  return number === 2 ? 2 : 1;
}

export function getSurveyPollLabel(pollNumber) {
  return normalizeSurveyPollNumber(pollNumber) === 2
    ? "Sondage 2 — Choix de guilde"
    : "Sondage 1 — Consultation des objectifs";
}

export function getSurveyStateLabel(state, pollNumber = 1) {
  const cleanState = cleanSurveyText(state);
  if (!cleanState || cleanState === "inactive") return "Aucune inter-saison active";
  if (cleanState === "finished") return "Inter-saison terminée";
  if (cleanState === `survey${pollNumber}_preparing`) return `${getSurveyPollLabel(pollNumber)} — En préparation`;
  if (cleanState === `survey${pollNumber}_open`) return `${getSurveyPollLabel(pollNumber)} — En cours`;
  if (cleanState === `survey${pollNumber}_closed`) return `${getSurveyPollLabel(pollNumber)} — Clôturé`;
  return cleanState.replace(/_/g, " ");
}

export function getSurveyMemberDeliveryStatus({ surveyRecipient = null, dmRecipient = null, response = null } = {}) {
  if (response?.responded_at || response?.respondedAt || surveyRecipient?.responded_at) {
    return {
      color: "green",
      status: "responded",
      label: "Réponse enregistrée",
      detail: "Réponse enregistrée",
    };
  }

  const explicitStatus = cleanSurveyText(surveyRecipient?.delivery_status || surveyRecipient?.deliveryStatus);
  const dmStatus = cleanSurveyText(dmRecipient?.status);
  const status = dmStatus || explicitStatus || "not_included";

  if (!surveyRecipient || status === "not_included") {
    return {
      color: "neutral",
      status: "not_included",
      label: "Non inclus",
      detail: "Aucune campagne lancée ou joueur non inclus",
    };
  }

  if (status === "sent") {
    return {
      color: "orange",
      status: "sent",
      label: "Envoyé",
      detail: "MP envoyé, réponse non reçue",
    };
  }

  if (status === "confirmed") {
    return {
      color: "green",
      status: "confirmed",
      label: "Confirmé",
      detail: "Réponse enregistrée ou confirmation reçue",
    };
  }

  if (["queued", "sending"].includes(status)) {
    return {
      color: "red",
      status,
      label: status === "sending" ? "Envoi en cours" : "En file",
      detail: status === "sending" ? "Message en cours d'envoi" : "Message en attente d'envoi",
    };
  }

  if (["failed", "missing_invalid", "excluded_duplicate"].includes(status)) {
    return {
      color: "red",
      status,
      label:
        status === "missing_invalid"
          ? "ID Discord manquant"
          : status === "excluded_duplicate"
            ? "Doublon Discord"
            : "Échec d'envoi",
      detail:
        surveyRecipient?.last_error ||
        surveyRecipient?.lastError ||
        dmRecipient?.last_error ||
        dmRecipient?.lastError ||
        "Message non remis",
    };
  }

  return {
    color: "neutral",
    status,
    label: "Non inclus",
    detail: "Statut non déterminé",
  };
}

export function buildSurveyGuildCards({
  guilds = [],
  members = [],
  surveyRecipients = [],
  dmRecipients = [],
  responses = [],
} = {}) {
  const recipientsByMemberId = new Map(
    (surveyRecipients || []).filter((row) => row?.member_id).map((row) => [String(row.member_id), row]),
  );
  const dmRecipientsById = new Map(
    (dmRecipients || []).filter((row) => row?.id).map((row) => [String(row.id), row]),
  );
  const responsesByRecipientId = new Map(
    (responses || [])
      .filter((row) => row?.survey_recipient_id || row?.surveyRecipientId)
      .map((row) => [String(row.survey_recipient_id || row.surveyRecipientId), row]),
  );

  return (guilds || []).map((guild) => {
    const guildCode = normalizeSurveyGuildCode(guild?.guild_code || guild?.guildCode);
    const guildMembers = (members || [])
      .filter((member) => normalizeSurveyGuildCode(member?.guild_code || member?.guildCode) === guildCode)
      .sort((left, right) =>
        String(left?.watcher_name || "").localeCompare(String(right?.watcher_name || ""), "fr", {
          sensitivity: "base",
        }),
      )
      .map((member) => {
        const surveyRecipient = recipientsByMemberId.get(String(member.id)) || null;
        const dmRecipient = surveyRecipient?.guild_dm_recipient_id
          ? dmRecipientsById.get(String(surveyRecipient.guild_dm_recipient_id)) || null
          : null;
        const response = surveyRecipient?.id ? responsesByRecipientId.get(String(surveyRecipient.id)) || null : null;
        const delivery = getSurveyMemberDeliveryStatus({ surveyRecipient, dmRecipient, response });
        return {
          id: member.id,
          watcherName: member.watcher_name || "",
          discordId: member.discord_id || "",
          guildCode,
          surveyRecipient,
          dmRecipient,
          response,
          delivery,
        };
      });

    const targeted = guildMembers.filter((member) => member.surveyRecipient).length;
    const responded = guildMembers.filter((member) => member.delivery.color === "green").length;

    return {
      guild,
      guildCode,
      displayName: guild?.display_name || guild?.displayName || guildCode,
      totalMembers: guildMembers.length,
      targeted,
      responded,
      members: guildMembers,
    };
  });
}

export function isMissingIntersaisonSurveySchema(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes(INTERSAISON_SURVEY_SEASONS_TABLE) ||
    message.includes(INTERSAISON_SURVEY_CAMPAIGNS_TABLE) ||
    message.includes(INTERSAISON_SURVEY_RECIPIENTS_TABLE) ||
    message.includes(INTERSAISON_SURVEY_RESPONSES_TABLE) ||
    message.includes("could not find the table")
  );
}
