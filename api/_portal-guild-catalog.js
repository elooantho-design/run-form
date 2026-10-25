export async function loadPortalGuildCatalog(db, member) {
  const guildCode = String(member?.guild_code || "").trim();
  if (!guildCode || member?.community_access_type === "community") return { guilds: [] };
  const { data: actorGuild, error } = await db.from("portal_guilds")
    .select("organization_id").eq("guild_code", guildCode).eq("is_active", true).maybeSingle();
  if (error) throw error;
  if (!actorGuild) return { guilds: [] };
  const { data: organization, error: organizationError } = await db.from("portal_organizations")
    .select("id,organization_key").eq("id", actorGuild.organization_id).eq("is_active", true).maybeSingle();
  if (organizationError) throw organizationError;
  if (!organization) return { guilds: [] };
  const { data, error: guildError } = await db.from("portal_guilds")
    .select("id,guild_code,display_name,organization_id").eq("organization_id", organization.id).eq("is_active", true);
  if (guildError) throw guildError;
  return { organizationId: organization.id, organizationKey: organization.organization_key, guilds: data || [] };
}
