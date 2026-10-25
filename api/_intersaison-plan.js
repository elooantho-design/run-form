import { buildSurveyChoiceForecast } from "../src/lib/intersaisonSurveyChoices.js";
import { readForecastAvatars } from "./_intersaison-forecast-avatars.js";

const ACTIONS = new Set(["save-forecast-guild", "save-forecast-member", "preview-forecast-application",
  "apply-forecast-plan", "close-forecast-cycle", "prepare-next-forecast-cycle"]);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const failure = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });

export const isForecastPlanAction = (action) => ACTIONS.has(action);

async function rpc(db, name, args, optional = false) {
  const { data, error } = await db.rpc(name, args);
  if (error) {
    if (["42P01", "42703", "42883", "PGRST202", "PGRST204", "PGRST205"].includes(error.code)) {
      if (optional) return null;
      throw failure("Migration intersaison_plan_cycle requise avant cette action.", 428);
    }
    throw failure(error.message || "Action du plan impossible.", error.code === "42501" ? 403 : 409);
  }
  return data;
}

export function projectForecastPlan(bundle) {
  if (!bundle?.plan) return null;
  const plan = bundle.plan;
  const entries = plan.entries || {};
  const eligible = new Set(bundle.members.map((m) => m.id));
  const recipients = (bundle.recipients || []).filter((r) => eligible.has(r.member_key || r.member_id));
  const legacy = (bundle.placements || []).filter((event) => eligible.has(event.member_key));
  const baseRevision = Math.max(0, ...legacy.map((e) => e.revision), ...(bundle.roles || []).map((e) => e.revision));
  const events = (bundle.events || []).filter((event) => event.kind === "member" && eligible.has(event.subject));
  const added = (events.length ? events.map((event) => [event.subject, event.after_value, event.revision])
    : Object.entries(entries).map(([key, entry]) => [key, entry, plan.revision])).map(([key, entry, revision]) => ({ id: `plan-${key}-${revision}`, member_key: key, member_id: key,
    member_name_snapshot: bundle.members.find((m) => m.id === key)?.watcher_name || "Compte indisponible",
    action: entry.guildCode ? "set" : "remove", guild_code: entry.guildCode, revision: baseRevision + revision,
    actor_name: entry.actorName, created_at: entry.at }));
  const included = new Set([...recipients.map((r) => r.member_key || r.member_id), ...legacy.map((p) => p.member_key), ...Object.keys(entries)]);
  const active = (member) => Boolean(member.guild_code && member.community_access_type !== "community" && member.roster_status !== "inactive");
  const members = (bundle.members || []).filter((member) => active(member) || included.has(member.id));
  const roles = [...(bundle.roles || [])];
  for (const event of events) roles.push({ member_key: event.subject, forecast_role: event.after_value.forecastRole,
    revision: baseRevision + event.revision, actor_name: event.actor_name, created_at: event.created_at });
  for (const [key, entry] of Object.entries(entries).filter(([key]) => !events.some((e) => e.subject === key))) roles.push({ member_key: key,
    forecast_role: entry.forecastRole, revision: baseRevision + plan.revision, actor_name: entry.actorName, created_at: entry.at });
  const guilds = Object.entries(plan.guilds).map(([code, guild]) => ({ code, name: guild.name, objective: guild.objective }));
  const forecast = buildSurveyChoiceForecast({ members, recipients, responses: bundle.responses || [],
    placements: [...legacy, ...added], roles, guilds });
  for (const player of forecast.players) {
    const member = bundle.members.find((m) => m.id === player.memberKey);
    player.activeNow = Boolean(member);
    player.isCommunity = member ? !active(member) : false;
    player.canPlace = Boolean(member && !plan.closed_at);
  }
  return { forecast, members: bundle.members, plan: { seasonId: plan.season_id, revision: plan.revision,
    appliedRevision: plan.applied_revision, closedAt: plan.closed_at, guilds: plan.guilds,
    referenceObjectives: plan.reference_objectives }, lifecycleReady: true };
}

export async function loadForecastPlan(db, actor, organization, seasonId = null) {
  const bundle = await rpc(db, "read_intersaison_plan", { p_org: organization.id, p_actor: actor.id, p_season: seasonId }, true);
  if (bundle?.members?.length) {
    const avatars = await readForecastAvatars(bundle.members, bundle.members.map((m) => m.id));
    bundle.members = bundle.members.map((m) => ({ ...m, discord_avatar_url: avatars[m.id] || "" }));
  }
  return projectForecastPlan(bundle);
}

export async function runForecastPlanAction(db, actor, organization, action, body) {
  if (!ACTIONS.has(action) || !UUID.test(body.seasonId || "")) throw failure("Cycle de plan invalide.", 400);
  const context = { p_org: organization.id, p_actor: actor.id, p_season: body.seasonId };
  let result;
  if (action === "save-forecast-guild" || action === "save-forecast-member") {
    if (!Number.isInteger(body.expectedPlanRevision) || body.expectedPlanRevision < 1) throw failure("Version du plan requise.", 400);
    const member = action === "save-forecast-member";
    if (member && !UUID.test(body.memberId || "")) throw failure("Compte invalide.", 400);
    // Explicit whitelist: the browser cannot submit organization, actor, permissions or active-guild IDs.
    result = await rpc(db, "save_intersaison_plan", { ...context, p_revision: body.expectedPlanRevision,
      p_kind: member ? "member" : "guild", p_data: member
        ? { memberId: body.memberId, guildCode: body.guildCode || null, forecastRole: body.forecastRole || "member" }
        : { code: body.guildCode || null, name: body.name, objective: body.objective } });
  } else if (action === "preview-forecast-application") {
    return { preview: await rpc(db, "preview_intersaison_plan", context) };
  } else {
    if (body.confirmed !== true) throw failure("Confirmation explicite requise.", 400);
    if (action === "prepare-next-forecast-cycle") result = await rpc(db, "prepare_next_intersaison_plan", { ...context, p_confirmed: true });
    else {
      if (!/^[a-f0-9]{32}$/.test(body.fingerprint || "")) throw failure("Prévisualisation requise.", 400);
      if (action === "apply-forecast-plan" && !UUID.test(body.requestId || "")) throw failure("Clé de confirmation requise.", 400);
      result = await rpc(db, action === "apply-forecast-plan" ? "apply_intersaison_plan" : "close_intersaison_plan",
        { ...context, p_fingerprint: body.fingerprint, p_confirmed: true,
          ...(action === "apply-forecast-plan" ? { p_request: body.requestId } : {}) });
    }
  }
  return { result, ...(await loadForecastPlan(db, actor, organization)) };
}
