-- Test fixture only. Captured authorization helper from the already installed GvG reset migration.
create function public._gvg_reset_context(p_portal_guild_id uuid, p_actor_member_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  m public.guild_members%rowtype;
  g public.portal_guilds%rowtype;
  actor_org uuid;
  matches integer;
  technical text;
begin
  select * into m from public.guild_members where id = p_actor_member_id for share;
  if not found or lower(btrim(coalesce(m.roster_status,'active'))) <> 'active'
    or lower(btrim(coalesce(m.community_access_type,'guild'))) = 'community'
    or lower(btrim(coalesce(m.role,''))) not in ('admin','administrateur','leader') then
    raise exception 'gvg_reset_actor_forbidden' using errcode = '42501';
  end if;
  -- community_status is intentionally NOT an eligibility condition for guild accounts.
  select * into g from public.portal_guilds where id = p_portal_guild_id for share;
  if not found or g.is_active is distinct from true then
    raise exception 'gvg_reset_target_inactive' using errcode = '42501';
  end if;
  technical := public._gvg_reset_code(g.guild_code);
  if coalesce(technical,'') = '' then raise exception 'gvg_reset_invalid_guild_code'; end if;
  select count(*) into matches from public.portal_guilds
    where public._gvg_reset_code(guild_code) = technical;
  if matches <> 1 then raise exception 'gvg_reset_ambiguous_target'; end if;

  select count(*), (array_agg(organization_id))[1] into matches, actor_org
    from public.portal_guilds
    where upper(btrim(guild_code)) = upper(btrim(m.guild_code));
  if matches <> 1 or actor_org is distinct from g.organization_id then
    raise exception 'gvg_reset_organization_forbidden' using errcode = '42501';
  end if;
  perform 1 from public.portal_guilds where is_active is true
    and upper(btrim(guild_code)) = upper(btrim(m.guild_code)) for share;
  if not found then raise exception 'gvg_reset_actor_guild_inactive' using errcode = '42501'; end if;
  perform 1 from public.portal_organizations where id = g.organization_id
    and is_active is true for share;
  if not found then raise exception 'gvg_reset_organization_inactive' using errcode = '42501'; end if;
  return jsonb_build_object('organization_id',g.organization_id, 'technical_guild',technical,
    'actor_name',coalesce(nullif(m.watcher_name,''),m.id::text), 'actor_role',m.role);
end $$;
