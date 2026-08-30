/* global process */
import { createClient } from "@supabase/supabase-js";
import {
  PALADIN_SPACE_KEY,
  getGuildSpaceKey,
  getGuildSpaceLabel,
  normalizeGuildCode,
  normalizeGuildCodeKey,
} from "../src/lib/guildScope.js";
import {
  PORTAL_LICENSE_PLANS,
  addMonths,
  daysUntil,
  getPortalLicenseAccess,
  isTrialLicensePlan,
  normalizeLicensePlan,
  normalizeLicenseStatus,
} from "../src/lib/portalLicensePlans.js";
import {
  applyPortalCorsHeaders,
  readJsonBody,
  requirePortalSession,
  requirePortalLeaderSession,
  sendPortalJson,
  verifyPortalRequestOrigin,
} from "./_portal-auth.js";
import {
  DISCORD_DEFENSE_DM_CAPABILITY,
  DISCORD_LOG_REMINDERS_CAPABILITY,
  loadDiscordCapabilitiesForOrganizations,
  normalizeOrganizationKeyForLookup,
  resolvePortalActorOrganization,
  updateDiscordCapabilitiesForOrganization,
} from "./_portal-discord-capabilities.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

function sendJson(res, status, payload) {
  sendPortalJson(res, status, payload, res._portalReq || null);
}

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeDateInput(value) {
  const raw = cleanText(value);
  if (!raw) return null;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeRole(role) {
  return cleanText(role)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isMissingLicenseTable(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes("portal_guild_licenses")
  );
}

function isMissingOrganizationTable(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return error?.code === "42P01" || error?.code === "PGRST205" || message.includes("portal_organizations");
}

async function readBody(req) {
  return readJsonBody(req);
}

async function requireLeader(req) {
  const sessionCheck = await requirePortalLeaderSession(req, supabase);
  if (sessionCheck.error) {
    return { error: sessionCheck.error, status: sessionCheck.status };
  }
  return { leader: sessionCheck.member };
}

function buildExternalSpaces(members, licenses, organizations = []) {
  const spaces = new Map();

  for (const organization of organizations || []) {
    const organizationKey = normalizeOrganizationKeyForLookup(organization.organization_key);
    if (!organizationKey) continue;
    const guildSpaceKey = organizationKey === "paladin" ? PALADIN_SPACE_KEY : normalizeGuildCodeKey(organizationKey);
    spaces.set(guildSpaceKey, {
      organizationId: organization.id || "",
      organizationKey,
      guildSpaceKey,
      label: organization.display_name || getGuildSpaceLabel(organizationKey),
      guildCodes: new Set(),
      memberCount: 0,
      adminCount: 0,
      officerCount: 0,
      isInternal: organizationKey === "paladin",
    });
  }

  for (const member of members || []) {
    const guildCode = normalizeGuildCode(member.guild_code);
    if (!guildCode) continue;

    const spaceKey = getGuildSpaceKey(guildCode);
    if (!spaceKey) continue;

    if (!spaces.has(spaceKey)) {
      spaces.set(spaceKey, {
        organizationId: "",
        organizationKey: spaceKey,
        guildSpaceKey: spaceKey,
        label: getGuildSpaceLabel(guildCode),
        guildCodes: new Set(),
        memberCount: 0,
        adminCount: 0,
        officerCount: 0,
        isInternal: spaceKey === PALADIN_SPACE_KEY,
      });
    }

    const space = spaces.get(spaceKey);
    space.guildCodes.add(guildCode);
    space.memberCount += 1;

    const role = normalizeRole(member.role);
    if (role.includes("admin") || role === "leader") space.adminCount += 1;
    if (role.includes("officier")) space.officerCount += 1;
  }

  for (const license of licenses || []) {
    const spaceKey = normalizeGuildCodeKey(license.guild_space_key);
    if (!spaceKey) continue;

    if (!spaces.has(spaceKey)) {
      spaces.set(spaceKey, {
        organizationId: license.organization_id || "",
        organizationKey: spaceKey,
        guildSpaceKey: spaceKey,
        label: license.guild_label || getGuildSpaceLabel(spaceKey),
        guildCodes: new Set(),
        memberCount: 0,
        adminCount: 0,
        officerCount: 0,
        isInternal: spaceKey === PALADIN_SPACE_KEY,
      });
    }

    const space = spaces.get(spaceKey);
    if (!space.organizationId && license.organization_id) space.organizationId = license.organization_id;
  }

  return [...spaces.values()]
    .map((space) => ({
      ...space,
      guildCodes: [...space.guildCodes].sort((a, b) => a.localeCompare(b, "fr", { numeric: true })),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "fr"));
}

function serializeLicense(license, space, discordCapabilities = {}, discordCapabilitiesReady = true) {
  const plan = normalizeLicensePlan(license?.plan);
  const status = normalizeLicenseStatus(license?.status, plan);
  const access = getPortalLicenseAccess({ ...license, plan, status });
  const trialDaysLeft = daysUntil(license?.trial_ends_at);
  const periodDaysLeft = daysUntil(license?.current_period_ends_at);
  const currentDeadline = isTrialLicensePlan(plan)
    ? license?.trial_ends_at || null
    : license?.current_period_ends_at || null;

  return {
    id: license?.id || null,
    organizationId: space.organizationId || license?.organization_id || "",
    organizationKey: space.organizationKey || space.guildSpaceKey,
    isInternal: Boolean(space.isInternal),
    guildSpaceKey: space.guildSpaceKey,
    guildLabel: license?.guild_label || space.label,
    guildCodes: space.guildCodes,
    memberCount: space.memberCount,
    adminCount: space.adminCount,
    officerCount: space.officerCount,
    plan,
    planLabel: PORTAL_LICENSE_PLANS[plan]?.label || plan,
    status,
    notes: license?.notes || "",
    trialStartedAt: license?.trial_started_at || null,
    trialEndsAt: license?.trial_ends_at || null,
    currentPeriodStartedAt: license?.current_period_started_at || null,
    currentPeriodEndsAt: license?.current_period_ends_at || null,
    currentDeadline,
    trialDaysLeft,
    periodDaysLeft,
    daysLeft: isTrialLicensePlan(plan) ? trialDaysLeft : periodDaysLeft,
    access,
    discordCapabilitiesReady,
    discordCapabilities: {
      [DISCORD_LOG_REMINDERS_CAPABILITY]: discordCapabilities?.[DISCORD_LOG_REMINDERS_CAPABILITY] === true,
      [DISCORD_DEFENSE_DM_CAPABILITY]: discordCapabilities?.[DISCORD_DEFENSE_DM_CAPABILITY] === true,
    },
    source: license?.id ? "database" : "default",
    updatedAt: license?.updated_at || null,
    updatedBy: license?.updated_by_name || "",
  };
}

async function listLicenses(res) {
  const [membersResult, licensesResult, organizationsResult] = await Promise.all([
    supabase
      .from("guild_members")
      .select("id, role, watcher_name, discord_id, guild_code")
      .order("guild_code", { ascending: true })
      .order("watcher_name", { ascending: true }),
    supabase
      .from("portal_guild_licenses")
      .select("*")
      .order("guild_label", { ascending: true }),
    supabase
      .from("portal_organizations")
      .select("id, organization_key, display_name, is_active")
      .eq("is_active", true)
      .order("organization_key", { ascending: true }),
  ]);

  if (membersResult.error) {
    sendJson(res, 500, { error: membersResult.error.message || "Chargement guildes impossible." });
    return;
  }

  if (licensesResult.error) {
    if (isMissingLicenseTable(licensesResult.error)) {
      sendJson(res, 200, {
        schemaReady: false,
        licenses: [],
        plans: PORTAL_LICENSE_PLANS,
        error: "Table portal_guild_licenses manquante.",
      });
      return;
    }

    sendJson(res, 500, { error: licensesResult.error.message || "Chargement licences impossible." });
    return;
  }

  if (organizationsResult.error && !isMissingOrganizationTable(organizationsResult.error)) {
    sendJson(res, 500, { error: organizationsResult.error.message || "Chargement organisations impossible." });
    return;
  }

  const licenseBySpace = new Map(
    (licensesResult.data || []).map((license) => [
      normalizeGuildCodeKey(license.guild_space_key),
      license,
    ])
  );
  const spaces = buildExternalSpaces(
    membersResult.data || [],
    licensesResult.data || [],
    organizationsResult.error ? [] : organizationsResult.data || [],
  );
  const capabilityAccess = await loadDiscordCapabilitiesForOrganizations(
    supabase,
    spaces.map((space) => space.organizationId).filter(Boolean),
  );
  const licenses = spaces.map((space) =>
    serializeLicense(
      licenseBySpace.get(space.guildSpaceKey),
      space,
      capabilityAccess.byOrganizationId.get(space.organizationId) || {},
      capabilityAccess.schemaReady !== false,
    )
  );

  sendJson(res, 200, {
    schemaReady: true,
    organizationSchemaReady: !organizationsResult.error,
    discordCapabilitiesReady: capabilityAccess.schemaReady !== false,
    plans: PORTAL_LICENSE_PLANS,
    licenses,
  });
}

async function readCurrentLicense(req, res) {
  const sessionCheck = await requirePortalSession(req, supabase);
  if (sessionCheck.error) {
    sendJson(res, sessionCheck.status, { error: sessionCheck.error });
    return;
  }

  const guildCode = normalizeGuildCode(sessionCheck.member?.guild_code);
  const guildSpaceKey = getGuildSpaceKey(guildCode);
  const actorOrganization = await resolvePortalActorOrganization(supabase, sessionCheck.member);
  const capabilityAccess = await loadDiscordCapabilitiesForOrganizations(
    supabase,
    actorOrganization.organizationId ? [actorOrganization.organizationId] : [],
  );
  const currentCapabilities =
    capabilityAccess.byOrganizationId.get(actorOrganization.organizationId) || {};

  if (!guildSpaceKey || guildSpaceKey === PALADIN_SPACE_KEY) {
    sendJson(res, 200, {
      schemaReady: true,
      license: null,
      organization: {
        id: actorOrganization.organizationId || "",
        key: actorOrganization.organizationKey || "",
        name: actorOrganization.organizationName || "",
      },
      discordCapabilitiesReady: capabilityAccess.schemaReady !== false,
      discordCapabilities: currentCapabilities,
    });
    return;
  }

  const { data, error } = await supabase
    .from("portal_guild_licenses")
    .select("plan, status, trial_started_at, trial_ends_at, current_period_started_at, current_period_ends_at")
    .eq("guild_space_key", guildSpaceKey)
    .maybeSingle();

  if (error) {
    if (isMissingLicenseTable(error)) {
      sendJson(res, 200, {
        schemaReady: false,
        license: null,
        organization: {
          id: actorOrganization.organizationId || "",
          key: actorOrganization.organizationKey || "",
          name: actorOrganization.organizationName || "",
        },
        discordCapabilitiesReady: capabilityAccess.schemaReady !== false,
        discordCapabilities: currentCapabilities,
      });
      return;
    }

    sendJson(res, 500, { error: error.message || "Chargement licence impossible." });
    return;
  }

  sendJson(res, 200, {
    schemaReady: true,
    license: data || null,
    organization: {
      id: actorOrganization.organizationId || "",
      key: actorOrganization.organizationKey || "",
      name: actorOrganization.organizationName || "",
    },
    discordCapabilitiesReady: capabilityAccess.schemaReady !== false,
    discordCapabilities: currentCapabilities,
  });
}

function buildUpsertPayload(body, existing, leader) {
  const now = new Date();
  const plan = normalizeLicensePlan(body.plan || existing?.plan);
  const status = normalizeLicenseStatus(body.status || existing?.status, plan);
  const isTrial = isTrialLicensePlan(plan);
  const currentPeriodEnds = existing?.current_period_ends_at
    ? new Date(existing.current_period_ends_at)
    : null;
  const hasActivePeriod =
    currentPeriodEnds && !Number.isNaN(currentPeriodEnds.getTime()) && currentPeriodEnds > now;

  const payload = {
    guild_space_key: normalizeGuildCodeKey(body.guildSpaceKey || body.guild_space_key || existing?.guild_space_key),
    guild_label: cleanText(body.guildLabel || body.guild_label || existing?.guild_label),
    plan,
    status,
    notes: cleanText(body.notes ?? existing?.notes),
    updated_at: now.toISOString(),
    updated_by: leader.id,
    updated_by_name: leader.watcher_name || leader.discord_id || "Leader",
  };

  if (!payload.guild_label) payload.guild_label = payload.guild_space_key;

  if (isTrial) {
    const trialStartedAt = normalizeDateInput(body.trialStartedAt || body.trial_started_at);
    const trialEndsAt = normalizeDateInput(body.trialEndsAt || body.trial_ends_at);
    payload.trial_started_at = trialStartedAt || existing?.trial_started_at || now.toISOString();
    payload.trial_ends_at = trialEndsAt || existing?.trial_ends_at || addMonths(payload.trial_started_at, 1).toISOString();
    payload.current_period_started_at = existing?.current_period_started_at || null;
    payload.current_period_ends_at = existing?.current_period_ends_at || null;
  } else if (plan === "suspended" || status === "suspended") {
    payload.trial_started_at = existing?.trial_started_at || null;
    payload.trial_ends_at = existing?.trial_ends_at || null;
    payload.current_period_started_at = existing?.current_period_started_at || null;
    payload.current_period_ends_at = existing?.current_period_ends_at || null;
  } else {
    const currentPeriodStartedAt = normalizeDateInput(body.currentPeriodStartedAt || body.current_period_started_at);
    const currentPeriodEndsAt = normalizeDateInput(body.currentPeriodEndsAt || body.current_period_ends_at);
    payload.trial_started_at = existing?.trial_started_at || null;
    payload.trial_ends_at = existing?.trial_ends_at || null;
    payload.current_period_started_at = currentPeriodStartedAt || existing?.current_period_started_at || now.toISOString();
    payload.current_period_ends_at =
      currentPeriodEndsAt ||
      existing?.current_period_ends_at ||
      addMonths(hasActivePeriod ? currentPeriodEnds : payload.current_period_started_at, 1).toISOString();
  }

  return payload;
}

async function loadExistingLicense(guildSpaceKey) {
  const { data, error } = await supabase
    .from("portal_guild_licenses")
    .select("*")
    .eq("guild_space_key", guildSpaceKey)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

function readDiscordCapabilitiesDraft(body = {}) {
  const source = body.discordCapabilities || body.discord_capabilities || body.capabilities || {};
  return {
    [DISCORD_LOG_REMINDERS_CAPABILITY]: source[DISCORD_LOG_REMINDERS_CAPABILITY] === true,
    [DISCORD_DEFENSE_DM_CAPABILITY]: source[DISCORD_DEFENSE_DM_CAPABILITY] === true,
  };
}

function hasDiscordCapabilitiesDraft(body = {}) {
  const source = body.discordCapabilities || body.discord_capabilities || body.capabilities;
  return source && typeof source === "object" && !Array.isArray(source);
}

async function loadOrganizationByLicenseScope({ guildSpaceKey, organizationId }) {
  const cleanOrganizationId = cleanText(organizationId);
  if (cleanOrganizationId) {
    const { data, error } = await supabase
      .from("portal_organizations")
      .select("id, organization_key, display_name")
      .eq("id", cleanOrganizationId)
      .maybeSingle();
    if (error) throw error;
    if (data?.id) return data;
  }

  const organizationKey = normalizeOrganizationKeyForLookup(
    normalizeGuildCodeKey(guildSpaceKey) === PALADIN_SPACE_KEY ? "paladin" : guildSpaceKey,
  );
  if (!organizationKey) return null;

  const { data, error } = await supabase
    .from("portal_organizations")
    .select("id, organization_key, display_name")
    .eq("organization_key", organizationKey)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function saveDiscordCapabilitiesForScope(body, res, leader) {
  const guildSpaceKey = normalizeGuildCodeKey(body.guildSpaceKey || body.guild_space_key);
  const organization = await loadOrganizationByLicenseScope({
    guildSpaceKey,
    organizationId: body.organizationId || body.organization_id,
  });

  if (!organization?.id) {
    sendJson(res, 404, { error: "Organisation introuvable." });
    return;
  }

  const capabilityAccess = await updateDiscordCapabilitiesForOrganization(
    supabase,
    organization.id,
    readDiscordCapabilitiesDraft(body),
    leader,
  );

  sendJson(res, 200, {
    success: true,
    organization: {
      id: organization.id,
      key: organization.organization_key || "",
      name: organization.display_name || organization.organization_key || "",
    },
    discordCapabilitiesReady: capabilityAccess.schemaReady !== false,
    discordCapabilities: capabilityAccess.capabilities,
  });
}

async function updateLicense(body, res, leader) {
  const guildSpaceKey = normalizeGuildCodeKey(body.guildSpaceKey || body.guild_space_key);
  if (!guildSpaceKey) {
    sendJson(res, 400, { error: "Espace externe invalide." });
    return;
  }

  if (guildSpaceKey === PALADIN_SPACE_KEY) {
    await saveDiscordCapabilitiesForScope(body, res, leader);
    return;
  }

  const existing = await loadExistingLicense(guildSpaceKey);
  const payload = buildUpsertPayload({ ...body, guildSpaceKey }, existing, leader);

  const { data, error } = await supabase
    .from("portal_guild_licenses")
    .upsert(payload, { onConflict: "guild_space_key" })
    .select("*")
    .single();

  if (error) {
    sendJson(res, 500, { error: error.message || "Mise a jour licence impossible." });
    return;
  }

  if (hasDiscordCapabilitiesDraft(body)) {
    const organization = await loadOrganizationByLicenseScope({
      guildSpaceKey,
      organizationId: body.organizationId || body.organization_id || data?.organization_id,
    });
    if (organization?.id) {
      await updateDiscordCapabilitiesForOrganization(
        supabase,
        organization.id,
        readDiscordCapabilitiesDraft(body),
        leader,
      );
    }
  }

  sendJson(res, 200, { success: true, license: data });
}

async function markPaid(body, res, leader) {
  const guildSpaceKey = normalizeGuildCodeKey(body.guildSpaceKey || body.guild_space_key);
  const existing = await loadExistingLicense(guildSpaceKey);

  if (!existing) {
    sendJson(res, 404, { error: "Licence introuvable." });
    return;
  }

  const now = new Date();
  const currentEnd = existing.current_period_ends_at ? new Date(existing.current_period_ends_at) : null;
  const baseDate =
    currentEnd && !Number.isNaN(currentEnd.getTime()) && currentEnd > now ? currentEnd : now;
  const nextEnd = addMonths(baseDate, 1);

  const { data, error } = await supabase
    .from("portal_guild_licenses")
    .update({
      status: "active",
      current_period_started_at: baseDate.toISOString(),
      current_period_ends_at: nextEnd.toISOString(),
      updated_at: now.toISOString(),
      updated_by: leader.id,
      updated_by_name: leader.watcher_name || leader.discord_id || "Leader",
    })
    .eq("guild_space_key", guildSpaceKey)
    .select("*")
    .single();

  if (error) {
    sendJson(res, 500, { error: error.message || "Validation paiement impossible." });
    return;
  }

  sendJson(res, 200, { success: true, license: data });
}

async function handleMutation(req, res, leader) {
  const body = await readBody(req);
  const action = cleanText(body.action).toLowerCase();

  if (action === "save") {
    await updateLicense(body, res, leader);
    return;
  }

  if (action === "save_capabilities") {
    await saveDiscordCapabilitiesForScope(body, res, leader);
    return;
  }

  if (action === "mark_paid") {
    await markPaid(body, res, leader);
    return;
  }

  if (action === "suspend") {
    await updateLicense({ ...body, plan: body.plan || "suspended", status: "suspended" }, res, leader);
    return;
  }

  if (action === "resume") {
    await updateLicense({ ...body, status: "active" }, res, leader);
    return;
  }

  sendJson(res, 400, { error: "Action licence inconnue." });
}

export default async function handler(req, res) {
  try {
    res._portalReq = req;
    applyPortalCorsHeaders(req, res);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (!["GET", "POST"].includes(req.method)) {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    if (!verifyPortalRequestOrigin(req)) {
      sendJson(res, 403, { error: "Origine de la requete refusee." });
      return;
    }

    const scope = cleanText(req.query?.scope || req.query?.action).toLowerCase();

    if (req.method === "GET" && scope === "current") {
      await readCurrentLicense(req, res);
      return;
    }

    const parsedBody = req.method === "POST" ? await readBody(req) : {};
    req.body = parsedBody;
    const leaderCheck = await requireLeader(req);

    if (leaderCheck.error) {
      sendJson(res, leaderCheck.status, { error: leaderCheck.error });
      return;
    }

    if (req.method === "GET") {
      await listLicenses(res);
      return;
    }

    if (req.method === "POST") {
      await handleMutation(req, res, leaderCheck.leader);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(res, 500, { error: error?.message || "Erreur licences." });
  }
}
