import { PALADIN_GUILD_DISPLAY_NAMES } from "./guildDisplay.js";
import { SURVEY_OBJECTIVE_GUILDS } from "./intersaisonSurveyObjectives.js";

export const FORECAST_ROLES = { member: "Membre", officer: "Officier", leader: "Leader" };

export function getForecastDiscordId(member, membersById) {
  const root = member?.primary_member_id ? membersById.get(member.primary_member_id) : member;
  if (!root || root.primary_member_id) return "";
  const id = String(root.discord_id || "").trim();
  const own = String(member?.discord_id || "").trim();
  if (!/^\d{15,22}$/.test(id) || (member?.primary_member_id && own && own !== id)) return "";
  return id;
}

export const SURVEY_CHOICE_PREFIX = "interchoice:";
export const SURVEY_CHOICE_SUBMIT_PREFIX = "interchoice_submit:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseSurveyChoiceId(customId, prefix = SURVEY_CHOICE_PREFIX) {
  if (!String(customId || "").startsWith(prefix)) throw new Error("Formulaire introuvable.");
  const [recipientId, ownerId, extra] = customId.slice(prefix.length).split(":");
  if (!UUID.test(recipientId) || !/^\d{15,22}$/.test(ownerId || "") || extra !== undefined) {
    throw new Error("Formulaire invalide.");
  }
  return { recipientId, ownerId };
}

export function getSurveyChoiceGuildsFromMessage(message) {
  const fields = (message?.embeds || []).flatMap((embed) => embed.fields || []);
  if (!fields.length) return null;
  const guilds = fields.map((field) => {
    const match = String(field.name || "").match(/^(G(?:[1-9]|1[0-9]|2[0-5])) — (.+)$/);
    if (!match) throw new Error("Objectifs du message illisibles. Aucun choix envoyé.");
    return { code: match[1], name: match[2] };
  });
  if (guilds.length > 25 || new Set(guilds.map((g) => g.code)).size !== guilds.length) throw new Error("Périmètre du message invalide.");
  return guilds;
}

export function buildSurveyChoiceModal(customId, userId, guilds = null) {
  const { recipientId, ownerId } = parseSurveyChoiceId(customId);
  if (String(userId) !== ownerId) throw new Error("Ce sondage est réservé au destinataire du message.");
  const options = (guilds || SURVEY_OBJECTIVE_GUILDS.map((code) => ({ code, name: PALADIN_GUILD_DISPLAY_NAMES[code] })))
    .map(({ code, name }) => ({ label: `${code} — ${name}`.slice(0, 100), value: code }));
  if (!options.length || options.length > 25 || new Set(options.map((o) => o.value)).size !== options.length
    || options.some((o) => !/^G([1-9]|1[0-9]|2[0-5])$/.test(o.value))) throw new Error("Périmètre du message invalide.");
  return {
    type: 9,
    data: {
      custom_id: `${SURVEY_CHOICE_SUBMIT_PREFIX}${recipientId}:${ownerId}`,
      title: "Choix de ta future guilde",
      components: [
        { type: 18, label: "Premier choix (obligatoire)", component: {
          type: 3, custom_id: "first_choice", options, required: true, min_values: 1, max_values: 1,
        } },
        { type: 18, label: "Deuxième choix (facultatif)", component: {
          type: 3, custom_id: "second_choice", options: options.length < 25 ? [{ label: "Pas de deuxième choix", value: "none" }, ...options] : options,
          required: false, min_values: 0, max_values: 1,
        } },
        { type: 18, label: "Commentaire (facultatif)", component: {
          type: 4, custom_id: "comment_text", style: 2, max_length: 1900, required: false,
        } },
      ],
    },
  };
}

export function readSurveyChoiceFields(components = [], guildCodes = SURVEY_OBJECTIVE_GUILDS) {
  const values = {};
  function visit(component) {
    const id = component?.custom_id || component?.customId;
    if (id) {
      if (Object.hasOwn(values, id)) throw new Error("Champ de réponse dupliqué.");
      if (Array.isArray(component.values) && component.values.length > 1) throw new Error("Un seul choix par champ.");
      values[id] = component.values?.[0] ?? component.value ?? "";
    }
    if (component?.component) visit(component.component);
    for (const child of component?.components || []) visit(child);
  }
  for (const component of components) visit(component);
  return validateSurveyChoice(values.first_choice, values.second_choice, values.comment_text, guildCodes);
}

export function validateSurveyChoice(firstChoice, secondChoice = "", comment = "", guildCodes = SURVEY_OBJECTIVE_GUILDS) {
  const first = String(firstChoice || "");
  const second = secondChoice === "none" ? "" : String(secondChoice || "");
  if (!guildCodes.includes(first)) throw new Error("Sélectionne un premier choix dans les guildes Paladin proposées.");
  if (second && !guildCodes.includes(second)) throw new Error("Deuxième choix hors du cluster Paladin.");
  if (first === second) throw new Error("Le deuxième choix doit être différent du premier.");
  if (typeof comment !== "string" || comment.length > 1900) throw new Error("Commentaire limité à 1900 caractères.");
  return { firstChoice: first, secondChoice: second, comment };
}

export async function saveSurveyChoiceResponse(supabase, { customId, userId, interactionId, components }) {
  const { recipientId, ownerId } = parseSurveyChoiceId(customId, SURVEY_CHOICE_SUBMIT_PREFIX);
  if (String(userId) !== ownerId) throw new Error("Ce sondage est réservé au destinataire du message.");
  // The SQL RPC checks the frozen campaign scope, owner, status and identity atomically.
  const answer = readSurveyChoiceFields(components, Array.from({ length: 25 }, (_, i) => `G${i + 1}`));
  const { data, error } = await supabase.rpc("submit_intersaison_survey_choice", {
    p_dm_recipient_id: recipientId, p_discord_user_id: String(userId), p_interaction_id: String(interactionId || ""),
    p_first_choice: answer.firstChoice, p_second_choice: answer.secondChoice, p_comment: answer.comment,
  });
  if (error) throw new Error(error.code === "P0002" ? "Ce sondage n’est plus disponible. Aucun nouveau choix n’a été enregistré."
    : error.message || "Enregistrement impossible. Ta réponse n'a pas été confirmée, réessaie.");
  return data;
}

// The forecast is a projection only: a manual decision never becomes a survey answer.
export function buildSurveyChoiceForecast({ members = [], recipients = [], responses = [], placements = [], roles = [], objectives = {}, guilds = null } = {}) {
  const membersById = new Map(members.map((m) => [m.id, m]));
  const people = new Map(members.map((m) => [m.id, {
    memberKey: m.id, memberId: m.id, name: m.watcher_name, currentGuild: m.guild_code, activeNow: true,
    discordUserId: getForecastDiscordId(m, membersById),
    avatarUrl: m.discord_avatar_url || "",
  }]));
  const answers = new Map(responses.filter((r) => r.poll_number === 2 && r.is_current).map((r) => [r.survey_recipient_id, r]));
  for (const recipient of recipients) {
    const key = recipient.member_key || recipient.member_id || recipient.id;
    const person = people.get(key) || { memberKey: key, memberId: recipient.member_id, name: recipient.member_name_snapshot, activeNow: false };
    person.recipient = recipient;
    person.originGuild = recipient.guild_code_snapshot;
    person.answer = answers.get(recipient.id) || null;
    people.set(key, person);
  }
  const events = [...placements].sort((a, b) => a.revision - b.revision);
  for (const event of events) {
    const key = event.member_key;
    const person = people.get(key) || { memberKey: key, memberId: event.member_id, name: event.member_name_snapshot, activeNow: false };
    person.manualHistory = [...(person.manualHistory || []), event];
    person.manual = event.action === "set" ? event : null;
    person.placementRevision = event.revision;
    people.set(key, person);
  }
  for (const event of [...roles].sort((a, b) => a.revision - b.revision)) {
    const person = people.get(event.member_key);
    if (!person || !Object.hasOwn(FORECAST_ROLES, event.forecast_role)) continue;
    person.forecastRoleEvent = event;
    person.forecastRoleHistory = [...(person.forecastRoleHistory || []), event];
  }
  const rows = [...people.values()].map((person) => {
    const firstChoice = person.answer?.first_choice_guild_code || "";
    const targetGuild = person.manual?.guild_code || firstChoice;
    return { ...person, firstChoice, targetGuild, originGuild: person.originGuild || person.currentGuild || "",
      hasDifference: Boolean(person.manual && firstChoice && person.manual.guild_code !== firstChoice),
      placementRevision: person.placementRevision || 0,
      forecastRole: person.forecastRoleEvent?.forecast_role || "member",
      roleRevision: person.forecastRoleEvent?.revision || 0,
    };
  }).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "fr"));
  return {
    guilds: (guilds || SURVEY_OBJECTIVE_GUILDS.map((code) => ({ code, name: PALADIN_GUILD_DISPLAY_NAMES[code], objective: objectives[code] || "" }))).map((guild) => {
      const { code } = guild;
      const players = rows.filter((p) => p.targetGuild === code);
      return { code, name: guild.name, objective: guild.objective || "", players,
        count: players.length, referenceCapacity: 30, overCapacity: players.length > 30 };
    }),
    unassigned: rows.filter((p) => !p.targetGuild),
    players: rows,
  };
}
