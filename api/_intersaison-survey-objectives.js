import { isPortalAdminRole } from "./_portal-auth.js";
import { normalizeSurveyObjectives, SURVEY_OBJECTIVE_GUILDS } from "../src/lib/intersaisonSurveyObjectives.js";

const VERSIONS_TABLE = "intersaison_survey_objective_versions";
const VERSION_SELECT = "id, organization_id, season_id, purpose, version_number, status, created_at, created_by_member_id, validated_at, official_at, intersaison_survey_objective_items(guild_code, objective_text)";

function failure(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function supportsSurveyObjectives(organization) {
  return ["paladin", "paladin_cluster"].includes(String(organization?.organization_key || organization?.organizationKey || "").toLowerCase());
}

export async function authorizeObjectives(supabase, actor, organization) {
  if (!isPortalAdminRole(actor?.role) || !supportsSurveyObjectives(organization) || !SURVEY_OBJECTIVE_GUILDS.includes(actor?.guild_code)) {
    throw failure("Préparation réservée aux admins Paladin autorisés.", 403);
  }
  const { data, error } = await supabase.from("portal_guilds").select("id")
    .eq("organization_id", organization.id).eq("guild_code", actor.guild_code).eq("is_active", true).maybeSingle();
  if (error) throw error;
  if (!data) throw failure("Guilde hors organisation.", 403);
}

function missingSchema(error) {
  return ["42P01", "PGRST205", "PGRST202"].includes(error?.code);
}

function rpcError(error) {
  if (missingSchema(error)) return failure("Migration intersaison_survey_objectives requise.", 428);
  return failure(error?.message || "Enregistrement des objectifs impossible.", error?.code === "42501" ? 403 : 409);
}

function serializeVersion(row) {
  if (!row) return null;
  return {
    id: row.id, versionNumber: row.version_number, status: row.status,
    createdAt: row.created_at, validatedAt: row.validated_at, officialAt: row.official_at,
    objectives: Object.fromEntries((row.intersaison_survey_objective_items || []).map((item) => [item.guild_code, item.objective_text])),
  };
}

export async function loadSurveyReferenceObjectives(supabase, organizationId, seasonId) {
  const { data, error } = await supabase.from(VERSIONS_TABLE)
    .select("id, created_at, intersaison_survey_objective_items(guild_code, objective_text)")
    .eq("organization_id", organizationId).eq("season_id", seasonId).eq("purpose", "reference")
    .order("version_number", { ascending: false }).limit(1);
  if (error) { if (missingSchema(error)) return null; throw error; }
  const reference = data?.[0];
  return reference ? (reference.intersaison_survey_objective_items || []).map((item) => ({ ...item,
    organization_id: organizationId, season_id: seasonId, created_at: reference.created_at })) : null;
}

export async function loadSurveyObjectivesPreparation(supabase, actor, organization, season) {
  if (!supportsSurveyObjectives(organization)) return { supported: false };
  await authorizeObjectives(supabase, actor, organization);
  if (!season) return { supported: true, schemaReady: true, seasonId: null, version: null, history: [] };
  const { data, error } = await supabase.from(VERSIONS_TABLE).select(VERSION_SELECT)
    .eq("organization_id", organization.id).eq("season_id", season.id).eq("purpose", "next")
    .order("version_number", { ascending: false }).limit(100);
  if (error) {
    if (missingSchema(error)) return { supported: true, schemaReady: false, seasonId: season.id, version: null, history: [] };
    throw error;
  }
  const versions = (data || []).map(serializeVersion);
  return { supported: true, schemaReady: true, seasonId: season.id, version: versions[0] || null, history: versions };
}

export async function saveSurveyObjectivesDraft(supabase, actor, organization, season, body) {
  await authorizeObjectives(supabase, actor, organization);
  if (!season || season.status === "finished") throw failure("Aucune inter-saison active.", 409);
  const preparation = await loadSurveyObjectivesPreparation(supabase, actor, organization, season);
  if (!preparation.schemaReady) throw failure("Migration intersaison_survey_objectives requise.", 428);
  if (!Number.isInteger(body.expectedVersion) || body.expectedVersion < 0) throw failure("Version du brouillon manquante.");
  let objectives;
  try {
    objectives = normalizeSurveyObjectives(body.objectives, preparation.version?.objectives);
  } catch (error) {
    throw failure(error.message);
  }
  const { error } = await supabase.rpc("save_intersaison_survey_objectives_draft", {
    p_organization_id: organization.id, p_season_id: season.id, p_actor_member_id: actor.id,
    p_objectives: objectives, p_expected_version: body.expectedVersion,
  });
  if (error) throw rpcError(error);
  return loadSurveyObjectivesPreparation(supabase, actor, organization, season);
}

export async function validateSurveyObjectivesDraft(supabase, actor, organization, season, body) {
  await authorizeObjectives(supabase, actor, organization);
  if (!season || season.status === "finished") throw failure("Aucune inter-saison active.", 409);
  if (typeof body.versionId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.versionId)) throw failure("Version invalide.");
  const { error } = await supabase.rpc("validate_intersaison_survey_objectives_draft", {
    p_organization_id: organization.id, p_season_id: season.id, p_actor_member_id: actor.id, p_version_id: body.versionId,
  });
  if (error) throw rpcError(error);
  return loadSurveyObjectivesPreparation(supabase, actor, organization, season);
}
