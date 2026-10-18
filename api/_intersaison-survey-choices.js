import { authorizeObjectives, supportsSurveyObjectives } from "./_intersaison-survey-objectives.js";
import { buildSurveyResponsesWorkbook } from "./_intersaison-surveys.js";
import { buildSurveyChoiceForecast } from "../src/lib/intersaisonSurveyChoices.js";
import { SURVEY_OBJECTIVE_GUILDS } from "../src/lib/intersaisonSurveyObjectives.js";
import { PALADIN_GUILD_DISPLAY_NAMES } from "../src/lib/guildDisplay.js";

const MEMBER_SELECT = "id,watcher_name,guild_code,discord_id,roster_status,community_access_type";
const CAMPAIGN_SELECT = "id,season_id,organization_id,poll_number,is_test,status,objective_snapshot,objective_version_id,guild_dm_campaign_id,launched_at,closed_at";
function failure(message, statusCode = 409) { return Object.assign(new Error(message), { statusCode }); }
function isMissingSchema(error) { return ["42P01", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(error?.code); }
async function read(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}
async function all(query) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await read(query().range(offset, offset + 999));
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}
export async function loadSurveyChoiceRoster(db, organization) {
  const guilds = await read(db.from("portal_guilds").select("organization_id,guild_code").eq("is_active", true).in("guild_code", SURVEY_OBJECTIVE_GUILDS));
  if (guilds.length !== 7 || guilds.some((g) => g.organization_id !== organization.id)) throw failure("Périmètre des sept guildes ambigu.", 403);
  return all(() => db.from("guild_members").select(MEMBER_SELECT).in("guild_code", SURVEY_OBJECTIVE_GUILDS)
    .or("roster_status.eq.active,roster_status.is.null").order("id"))
    .then((members) => members.filter((m) => String(m.community_access_type || "").toLowerCase() !== "community"));
}

export async function loadSurveyChoiceWorkspace(db, actor, organization, season) {
  if (!supportsSurveyObjectives(organization)) return { supported: false };
  await authorizeObjectives(db, actor, organization);
  if (!season) return { supported: true, schemaReady: true, seasonId: null, members: [], candidates: {}, forecast: null };
  try {
    const members = await loadSurveyChoiceRoster(db, organization);
    const campaigns = await read(db.from("intersaison_survey_campaigns").select(CAMPAIGN_SELECT)
      .eq("organization_id", organization.id).eq("season_id", season.id).eq("is_test", false).neq("status", "cancelled"));
    const ids = campaigns.map((c) => c.id);
    const recipients = ids.length ? await all(() => db.from("intersaison_survey_recipients").select("*")
      .eq("organization_id", organization.id).in("survey_campaign_id", ids).order("id")) : [];
    const choiceCampaign = campaigns.find((c) => c.poll_number === 2) || null;
    const responses = choiceCampaign ? await all(() => db.from("intersaison_survey_responses").select("*")
      .eq("organization_id", organization.id).eq("survey_campaign_id", choiceCampaign.id).eq("poll_number", 2).eq("is_current", true).order("id")) : [];
    const placements = await all(() => db.from("intersaison_survey_placements").select("*")
      .eq("organization_id", organization.id).eq("season_id", season.id).order("id"));
    const candidates = Object.fromEntries(campaigns.map((campaign) => {
      const included = new Set(recipients.filter((r) => r.survey_campaign_id === campaign.id).map((r) => r.member_key || r.member_id));
      return [campaign.poll_number, members.filter((m) => !included.has(m.id))];
    }));
    return {
      supported: true, schemaReady: true, seasonId: season.id, members, candidates,
      campaigns, choiceCampaign,
      preview: await callChoiceRpc(db, "preview_intersaison_survey_two", { p_org: organization.id, p_season: season.id, p_actor: actor.id }),
      forecast: buildSurveyChoiceForecast({ members, recipients: recipients.filter((r) => r.survey_campaign_id === choiceCampaign?.id),
        responses, placements, objectives: choiceCampaign?.objective_snapshot || {} }),
    };
  } catch (error) {
    if (isMissingSchema(error) || error.statusCode === 428) return { supported: true, schemaReady: false, seasonId: season.id };
    throw error;
  }
}

async function callChoiceRpc(db, name, args) {
  const { data, error } = await db.rpc(name, args);
  if (error) {
    if (isMissingSchema(error)) throw failure("Migration intersaison_survey_choices requise.", 428);
    throw failure(error.message || "Action inter-saison impossible.", error.code === "42501" ? 403 : 409);
  }
  return data;
}

export async function queueSurveyChoiceReminders(db, actor, organization, campaignId, recipientId = null) {
  await authorizeObjectives(db, actor, organization);
  return callChoiceRpc(db, "queue_intersaison_survey_reminders", { p_org: organization.id, p_actor: actor.id,
    p_campaign: campaignId, p_recipient: recipientId });
}

const CHOICE_ACTIONS = new Set(["load-survey-two-workspace", "preview-survey-two-launch", "launch-survey-two", "launch-survey-two-test",
  "close-survey", "add-survey-members", "save-survey-placement"]);
export function isSurveyChoiceAction(action) { return CHOICE_ACTIONS.has(action); }

export async function runSurveyChoiceAction(db, actor, organization, season, action, body) {
  await authorizeObjectives(db, actor, organization);
  if (action === "load-survey-two-workspace") return { workspace: await loadSurveyChoiceWorkspace(db, actor, organization, season) };
  if (!season) throw failure("Aucune inter-saison active.");
  const context = { p_org: organization.id, p_actor: actor.id };
  if (action === "preview-survey-two-launch") {
    return { preview: await callChoiceRpc(db, "preview_intersaison_survey_two", { ...context, p_season: season.id }) };
  }
  if (["launch-survey-two", "launch-survey-two-test", "close-survey", "add-survey-members"].includes(action) && body.confirmed !== true) {
    throw failure("Confirmation explicite requise.", 400);
  }
  let result;
  if (action === "launch-survey-two" || action === "launch-survey-two-test") {
    // IDs/targets supplied by the client are deliberately not forwarded. A test is self-only in SQL.
    result = await callChoiceRpc(db, "launch_intersaison_survey_two", { ...context, p_season: season.id,
      p_version: body.versionId, p_fingerprint: body.rosterFingerprint || "", p_is_test: action === "launch-survey-two-test" });
  } else if (action === "close-survey") {
    result = await callChoiceRpc(db, "close_intersaison_survey", { ...context, p_campaign: body.campaignId });
  } else if (action === "add-survey-members") {
    if (!Array.isArray(body.memberIds) || !body.memberIds.length || body.memberIds.length > 250) throw failure("Sélection de membres invalide.", 400);
    result = await callChoiceRpc(db, "add_intersaison_survey_members", { ...context, p_campaign: body.campaignId, p_members: body.memberIds });
  } else if (action === "save-survey-placement") {
    if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 0) throw failure("Version du placement requise.", 400);
    result = await callChoiceRpc(db, "save_intersaison_survey_placement", { ...context, p_season: season.id,
      p_member: body.memberId, p_guild: body.guildCode || null, p_expected_revision: body.expectedRevision });
  } else throw failure("Action inconnue.", 400);
  return { result, workspace: await loadSurveyChoiceWorkspace(db, actor, organization, season) };
}

export function buildSurveyChoiceExportSheets({ campaign, recipients, responses, placements = [] }) {
  if (!campaign || campaign.is_test || campaign.poll_number !== 2) throw failure("Export réservé à un sondage n° 2 officiel.", 403);
  const org = campaign.organization_id;
  const safeRecipients = recipients.filter((r) => r.organization_id === org && r.survey_campaign_id === campaign.id);
  const safeResponses = responses.filter((r) => r.organization_id === org && r.survey_campaign_id === campaign.id && r.poll_number === 2 && r.is_current);
  const forecast = buildSurveyChoiceForecast({ recipients: safeRecipients, responses: safeResponses,
    placements: placements.filter((p) => p.organization_id === org && p.season_id === campaign.season_id) });
  const label = (code) => PALADIN_GUILD_DISPLAY_NAMES[code] || "";
  return [
    { name: "Réponses joueurs", rows: [
      ["pseudo", "guild_code", "guild_name", "discord_id", "statut", "date", "premier_choix_code", "premier_choix_nom",
        "deuxieme_choix_code", "deuxieme_choix_nom", "commentaire_integral", "placement_admin_code", "placement_auteur", "placement_date", "divergence"],
      ...forecast.players.map((p) => [p.name, p.originGuild, label(p.originGuild), p.recipient?.discord_user_id || "",
        p.answer ? "responded" : p.recipient?.delivery_status || "not_included", p.answer?.responded_at || "",
        p.firstChoice, label(p.firstChoice), p.answer?.second_choice_guild_code || "", label(p.answer?.second_choice_guild_code),
        p.answer?.comment_text || "", p.manual?.guild_code || "", p.manual?.actor_name || "", p.manual?.created_at || "", p.hasDifference ? "oui" : "non"]),
    ] },
    { name: "Objectifs guildes", rows: [["guild_code", "guild_name", "objectifs_officiels", "version_id"],
      ...SURVEY_OBJECTIVE_GUILDS.map((code) => [code, label(code), campaign.objective_snapshot?.[code] || "", campaign.objective_version_id || ""])] },
    { name: "Campagne", rows: [["champ", "valeur"], ["campaign_id", campaign.id], ["season_id", campaign.season_id],
      ["statut", campaign.status], ["lancement", campaign.launched_at || ""], ["cloture", campaign.closed_at || ""],
      ["destinataires", safeRecipients.length], ["reponses", safeResponses.length], ["test_campaigns_excluded", "true"]] },
  ];
}

export async function exportSurveyChoices(db, actor, organization, body) {
  await authorizeObjectives(db, actor, organization);
  const campaign = await read(db.from("intersaison_survey_campaigns").select(CAMPAIGN_SELECT)
    .eq("id", body.campaignId).eq("organization_id", organization.id).eq("is_test", false).eq("poll_number", 2).maybeSingle());
  if (!campaign) throw failure("Campagne officielle introuvable.", 404);
  const recipients = await all(() => db.from("intersaison_survey_recipients").select("*")
    .eq("organization_id", organization.id).eq("survey_campaign_id", campaign.id).order("id"));
  const responses = await all(() => db.from("intersaison_survey_responses").select("*")
    .eq("organization_id", organization.id).eq("survey_campaign_id", campaign.id).eq("is_current", true).order("id"));
  const placements = await all(() => db.from("intersaison_survey_placements").select("*")
    .eq("organization_id", organization.id).eq("season_id", campaign.season_id).order("id"));
  const sheets = buildSurveyChoiceExportSheets({ campaign, recipients, responses, placements });
  const xlsx = body.format === "xlsx";
  const escape = (value) => {
    let text = String(value ?? "");
    if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return { fileName: `intersaison-sondage-2-${campaign.id}.${xlsx ? "xlsx" : "csv"}`,
    contentType: xlsx ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv;charset=utf-8",
    ...(xlsx ? { encoding: "base64", content: buildSurveyResponsesWorkbook(sheets).toString("base64") }
      : { content: sheets[0].rows.map((row, index) => [...row, ...SURVEY_OBJECTIVE_GUILDS.map((code) =>
        index === 0 ? `objectif_${code}` : campaign.objective_snapshot?.[code] || "")].map(escape).join(",")).join("\n") }),
  };
}
