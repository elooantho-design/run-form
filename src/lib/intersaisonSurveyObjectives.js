import { PALADIN_GUILD_DISPLAY_NAMES } from "./guildDisplay.js";

export const SURVEY_OBJECTIVE_GUILDS = Object.freeze(Object.keys(PALADIN_GUILD_DISPLAY_NAMES));
export const SURVEY_OBJECTIVE_MAX_LENGTH = 600;
export const SURVEY_TWO_INTRODUCTION = "Cluster Paladin — Choix de ta future guilde\n\nVoici le sondage officiel d'affectation pour la prochaine saison et les objectifs proposés pour les sept guildes.";
export const SURVEY_TWO_INSTRUCTIONS = "Indique ton premier choix de guilde (obligatoire), puis un deuxième choix différent si tu le souhaites. Tu peux aussi laisser un commentaire facultatif. Pour rester dans ta guilde actuelle, choisis simplement cette guilde.";

export function normalizeSurveyObjectives(value = {}, previous = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Objectifs invalides.");
  if (Object.keys(value).some((key) => !SURVEY_OBJECTIVE_GUILDS.includes(key))) {
    throw new Error("Guilde hors du périmètre G1 à G7.");
  }
  return Object.fromEntries(SURVEY_OBJECTIVE_GUILDS.map((guildCode) => {
    const text = value[guildCode] ?? previous[guildCode] ?? "";
    if (typeof text !== "string") throw new Error(`Objectif ${guildCode} invalide.`);
    const normalized = text.replace(/\r\n?/g, "\n");
    if (normalized.length > SURVEY_OBJECTIVE_MAX_LENGTH) {
      throw new Error(`${guildCode} : ${SURVEY_OBJECTIVE_MAX_LENGTH} caractères maximum.`);
    }
    return [guildCode, normalized];
  }));
}

export function getSurveyObjectivesState(version, objectives, { dirty = false } = {}) {
  const complete = SURVEY_OBJECTIVE_GUILDS.every((code) => String(objectives?.[code] || "").trim());
  if (!dirty && version?.status === "official") return "official";
  if (!dirty && version?.status === "validated" && complete) return "validated";
  return complete ? "complete" : "incomplete";
}

export function buildSurveyTwoDiscordPayload(value, { recipientId = "", discordUserId = "", isTest = false, account = null } = {}) {
  const objectives = normalizeSurveyObjectives(value);
  const embed = {
    title: "Objectifs de la prochaine saison",
    color: 0x0ea5e9,
    fields: SURVEY_OBJECTIVE_GUILDS.map((code) => ({
      name: `${code} — ${PALADIN_GUILD_DISPLAY_NAMES[code]}`,
      value: objectives[code].trim() || "Objectif à renseigner",
      inline: false,
    })),
    footer: { text: "Message transmis via le dashboard Paladin." },
  };
  const escapeName = (name) => Array.from(String(name).replace(/[\r\n]+/g, " "))
    .map((character) => "\\*_`~[]<>|".includes(character) ? `\\${character}` : character).join("");
  if (account && (!String(account.name || "").trim() || !SURVEY_OBJECTIVE_GUILDS.includes(account.guildCode))) {
    throw new Error("Compte de jeu du destinataire incomplet.");
  }
  const accountText = account ? `Ce sondage concerne ton compte Watcher of Realms :\n\n**${escapeName(account.name)} — ${PALADIN_GUILD_DISPLAY_NAMES[account.guildCode]} (${account.guildCode})**\n\nMerci d’indiquer tes préférences pour ce compte précis.\n\n` : "";
  const content = `${isTest ? "Message de test personnel\n\n" : ""}${SURVEY_TWO_INTRODUCTION}\n\n${accountText}${SURVEY_TWO_INSTRUCTIONS}`;
  const embedCharacters = embed.title.length + embed.footer.text.length
    + embed.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);
  if (content.length > 2000 || embedCharacters > 6000 || embed.fields.some((field) => field.value.length > 1024)) {
    throw new Error("Le message dépasse les limites Discord.");
  }
  return {
    content,
    embeds: [embed],
    allowedMentions: { parse: [] },
    components: [{ type: 1, components: [{ type: 2, style: 1, label: "Choisir ma guilde",
      custom_id: recipientId ? `interchoice:${recipientId}:${discordUserId}` : "interchoice:preview", disabled: !recipientId }] }],
  };
}
