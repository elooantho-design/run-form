import { loadPortalGuildCatalog } from "./_portal-guild-catalog.js";

const guildKey = value => String(value || "").trim().toUpperCase().replace(/\s+/g, "_");
function denied() {
  const error = new Error("Guilde non autorisee pour cette session.");
  error.statusCode = 403;
  return error;
}

export async function loadAuthorizedPortalGuilds(db, actor) {
  if (!actor?.id || actor.community_access_type === "community") throw denied();
  const catalog = await loadPortalGuildCatalog(db, actor);
  const guilds = (catalog.guilds || []).filter(guild => guild.organization_id === catalog.organizationId);
  if (!catalog.organizationId || guilds.filter(guild => guildKey(guild.guild_code) === guildKey(actor.guild_code)).length !== 1) throw denied();
  const keys = guilds.map(guild => guildKey(guild.guild_code));
  if (keys.some(key => !/^[A-Z0-9_-]{2,24}$/.test(key)) || new Set(keys).size !== keys.length) throw denied();
  return { ...catalog, guilds };
}

export async function resolvePortalGuildScope(db, actor, requestedGuildCode) {
  const catalog = await loadAuthorizedPortalGuilds(db, actor);
  const requested = guildKey(requestedGuildCode || actor.guild_code);
  const target = catalog.guilds.find(guild => guildKey(guild.guild_code) === requested);
  if (!target) throw denied();
  const codes = catalog.guilds.map(guild => guild.guild_code);
  return {
    actorMemberId: actor.id,
    organizationId: catalog.organizationId,
    organizationKey: catalog.organizationKey,
    activeGuildCode: target.guild_code,
    allowedGuildCodes: codes,
    manageableGuildCodes: codes,
  };
}

export function defenseMatchesGuildScope(defense, scope, { includeHidden = false } = {}) {
  if (!defense || !scope?.organizationId || (!includeHidden && defense.is_hidden)) return false;
  if (defense.organization_id && defense.organization_id !== scope.organizationId) return false;
  return guildKey(defense.guild_code) === guildKey(scope.activeGuildCode)
    && scope.allowedGuildCodes.some(code => guildKey(code) === guildKey(defense.guild_code));
}
