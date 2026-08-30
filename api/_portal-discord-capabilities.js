export const PORTAL_DISCORD_CAPABILITIES_TABLE = "portal_organization_capabilities";

export const DISCORD_LOG_REMINDERS_CAPABILITY = "discord_log_reminders";
export const DISCORD_DEFENSE_DM_CAPABILITY = "discord_defense_dm";

export const PORTAL_DISCORD_CAPABILITY_KEYS = [
  DISCORD_LOG_REMINDERS_CAPABILITY,
  DISCORD_DEFENSE_DM_CAPABILITY,
];

const EMPTY_CAPABILITIES = Object.freeze({
  [DISCORD_LOG_REMINDERS_CAPABILITY]: false,
  [DISCORD_DEFENSE_DM_CAPABILITY]: false,
});

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeText(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeGuildCode(value) {
  return cleanText(value).toUpperCase().replace(/\s+/g, "_");
}

function normalizeOrganizationKey(value) {
  return normalizeText(value).replace(/[^a-z0-9_-]/g, "");
}

function isMissingTable(error, tableName) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  const table = String(tableName || "").toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes(`relation "public.${table}" does not exist`) ||
    message.includes(`relation "${table}" does not exist`) ||
    message.includes(table) ||
    message.includes("could not find the table")
  );
}

export function isMissingPortalDiscordCapabilitiesTable(error) {
  return isMissingTable(error, PORTAL_DISCORD_CAPABILITIES_TABLE);
}

export function normalizeDiscordCapabilityKey(value) {
  const normalized = normalizeText(value);
  return PORTAL_DISCORD_CAPABILITY_KEYS.includes(normalized) ? normalized : "";
}

export function serializeDiscordCapabilities(rows = []) {
  const capabilities = { ...EMPTY_CAPABILITIES };

  (rows || []).forEach((row) => {
    const key = normalizeDiscordCapabilityKey(row?.capability_key || row?.capabilityKey || row?.key);
    if (!key) return;
    capabilities[key] = row?.enabled === true;
  });

  return capabilities;
}

export function serializeDiscordCapabilityAccess(rows = [], options = {}) {
  return {
    schemaReady: options.schemaReady !== false,
    capabilities: serializeDiscordCapabilities(rows),
  };
}

export function hasDiscordCapability(capabilities, capabilityKey) {
  const key = normalizeDiscordCapabilityKey(capabilityKey);
  return Boolean(key && capabilities?.[key] === true);
}

export async function resolvePortalActorOrganization(supabase, actor) {
  const actorGuildCode = normalizeGuildCode(actor?.guild_code || actor?.guildCode);
  if (!actorGuildCode) {
    return {
      schemaReady: false,
      organizationId: "",
      organizationKey: "",
      actorGuildCode: "",
      guildCodes: [],
    };
  }

  const { data: actorGuild, error: actorGuildError } = await supabase
    .from("portal_guilds")
    .select("id, organization_id, guild_code, is_active")
    .eq("guild_code", actorGuildCode)
    .eq("is_active", true)
    .maybeSingle();

  if (actorGuildError) {
    if (isMissingTable(actorGuildError, "portal_guilds")) {
      return {
        schemaReady: false,
        organizationId: "",
        organizationKey: "",
        actorGuildCode,
        guildCodes: [actorGuildCode],
      };
    }
    throw actorGuildError;
  }

  if (!actorGuild?.organization_id) {
    return {
      schemaReady: false,
      organizationId: "",
      organizationKey: "",
      actorGuildCode,
      guildCodes: [actorGuildCode],
    };
  }

  const { data: organization, error: organizationError } = await supabase
    .from("portal_organizations")
    .select("id, organization_key, display_name, is_active")
    .eq("id", actorGuild.organization_id)
    .eq("is_active", true)
    .maybeSingle();

  if (organizationError) {
    if (isMissingTable(organizationError, "portal_organizations")) {
      return {
        schemaReady: false,
        organizationId: actorGuild.organization_id,
        organizationKey: "",
        actorGuildCode,
        guildCodes: [actorGuildCode],
      };
    }
    throw organizationError;
  }

  const guildCodes = await loadOrganizationGuildCodes(supabase, actorGuild.organization_id);

  return {
    schemaReady: true,
    organizationId: organization?.id || actorGuild.organization_id,
    organizationKey: organization?.organization_key || "",
    organizationName: organization?.display_name || organization?.organization_key || "",
    actorGuildCode,
    guildCodes,
  };
}

export async function loadOrganizationGuildCodes(supabase, organizationId) {
  const cleanOrganizationId = cleanText(organizationId);
  if (!cleanOrganizationId) return [];

  const { data, error } = await supabase
    .from("portal_guilds")
    .select("guild_code")
    .eq("organization_id", cleanOrganizationId)
    .eq("is_active", true)
    .order("guild_code", { ascending: true });

  if (error) {
    if (isMissingTable(error, "portal_guilds")) return [];
    throw error;
  }

  return (data || []).map((row) => normalizeGuildCode(row?.guild_code)).filter(Boolean);
}

export async function loadDiscordCapabilitiesForOrganization(supabase, organizationId) {
  const cleanOrganizationId = cleanText(organizationId);
  if (!cleanOrganizationId) {
    return serializeDiscordCapabilityAccess([], { schemaReady: false });
  }

  const { data, error } = await supabase
    .from(PORTAL_DISCORD_CAPABILITIES_TABLE)
    .select("organization_id, capability_key, enabled, updated_at, updated_by_member_id, updated_by_name")
    .eq("organization_id", cleanOrganizationId)
    .in("capability_key", PORTAL_DISCORD_CAPABILITY_KEYS);

  if (error) {
    if (isMissingPortalDiscordCapabilitiesTable(error)) {
      return serializeDiscordCapabilityAccess([], { schemaReady: false });
    }
    throw error;
  }

  return serializeDiscordCapabilityAccess(data || [], { schemaReady: true });
}

export async function loadDiscordCapabilitiesForOrganizations(supabase, organizationIds) {
  const ids = Array.from(new Set((organizationIds || []).map(cleanText).filter(Boolean)));
  if (!ids.length) return { schemaReady: true, byOrganizationId: new Map() };

  const { data, error } = await supabase
    .from(PORTAL_DISCORD_CAPABILITIES_TABLE)
    .select("organization_id, capability_key, enabled, updated_at, updated_by_member_id, updated_by_name")
    .in("organization_id", ids)
    .in("capability_key", PORTAL_DISCORD_CAPABILITY_KEYS);

  if (error) {
    if (isMissingPortalDiscordCapabilitiesTable(error)) {
      return { schemaReady: false, byOrganizationId: new Map(ids.map((id) => [id, serializeDiscordCapabilities([])])) };
    }
    throw error;
  }

  const rowsByOrganizationId = new Map(ids.map((id) => [id, []]));
  (data || []).forEach((row) => {
    const organizationId = cleanText(row?.organization_id);
    if (!rowsByOrganizationId.has(organizationId)) return;
    rowsByOrganizationId.get(organizationId).push(row);
  });

  return {
    schemaReady: true,
    byOrganizationId: new Map(
      ids.map((id) => [id, serializeDiscordCapabilities(rowsByOrganizationId.get(id) || [])]),
    ),
  };
}

export async function updateDiscordCapabilitiesForOrganization(supabase, organizationId, capabilities, actor) {
  const cleanOrganizationId = cleanText(organizationId);
  if (!cleanOrganizationId) {
    const error = new Error("Organisation introuvable pour ces capabilities Discord.");
    error.statusCode = 400;
    throw error;
  }

  const now = new Date().toISOString();
  const rows = PORTAL_DISCORD_CAPABILITY_KEYS.map((capabilityKey) => ({
    organization_id: cleanOrganizationId,
    capability_key: capabilityKey,
    enabled: capabilities?.[capabilityKey] === true,
    updated_at: now,
    updated_by_member_id: actor?.id || null,
    updated_by_name: actor?.watcher_name || actor?.discord_id || "Leader",
  }));

  const { data, error } = await supabase
    .from(PORTAL_DISCORD_CAPABILITIES_TABLE)
    .upsert(rows, { onConflict: "organization_id,capability_key" })
    .select("organization_id, capability_key, enabled, updated_at, updated_by_member_id, updated_by_name");

  if (error) {
    if (isMissingPortalDiscordCapabilitiesTable(error)) {
      const missing = new Error("Migration capabilities Discord non executee.");
      missing.statusCode = 428;
      throw missing;
    }
    throw error;
  }

  return serializeDiscordCapabilityAccess(data || [], { schemaReady: true });
}

export function normalizeOrganizationKeyForLookup(value) {
  return normalizeOrganizationKey(value);
}
