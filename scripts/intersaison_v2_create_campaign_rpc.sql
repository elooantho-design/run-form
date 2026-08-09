begin;

create or replace function public.create_intersaison_campaign_for_organization(
  p_organization_id uuid,
  p_poll_channel_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_campaign_id uuid;
  v_draft_dashboard_id uuid;
  v_guild_count integer;
begin
  if p_organization_id is null then
    raise exception 'organization_id manquant.';
  end if;

  if not exists (
    select 1
    from public.portal_organizations org
    where org.id = p_organization_id
      and org.is_active = true
  ) then
    raise exception 'Organisation inactive ou introuvable.';
  end if;

  select count(*)
  into v_guild_count
  from public.portal_guilds guild
  where guild.organization_id = p_organization_id
    and guild.is_active = true;

  if v_guild_count < 1 then
    raise exception 'Aucune guilde active pour cette organisation.';
  end if;

  if exists (
    select 1
    from public.intersaison_campaigns campaign
    where campaign.organization_id = p_organization_id
      and campaign.status = 'active'
  ) then
    raise exception 'Une campagne intersaison active existe deja pour cette organisation.';
  end if;

  insert into public.intersaison_campaigns (
    label,
    status,
    guild_count,
    poll_channel_id,
    organization_id
  )
  values (
    'Intersaison ' || to_char(current_date, 'YYYY-MM-DD'),
    'active',
    v_guild_count,
    p_poll_channel_id,
    p_organization_id
  )
  returning id into v_campaign_id;

  insert into public.intersaison_dashboards (
    campaign_id,
    organization_id,
    code,
    name,
    sort_order,
    is_draft
  )
  select
    v_campaign_id,
    p_organization_id,
    guild.guild_code,
    guild.display_name,
    row_number() over (order by guild.guild_code),
    false
  from public.portal_guilds guild
  where guild.organization_id = p_organization_id
    and guild.is_active = true
  order by guild.guild_code;

  insert into public.intersaison_dashboards (
    campaign_id,
    organization_id,
    code,
    name,
    sort_order,
    is_draft
  )
  values (
    v_campaign_id,
    p_organization_id,
    'BROUILLON',
    'Dashboard Brouillon',
    999,
    true
  )
  returning id into v_draft_dashboard_id;

  insert into public.intersaison_assignments (
    campaign_id,
    organization_id,
    dashboard_id,
    member_id,
    watcher_name,
    discord_id_raw,
    source_guild_code,
    target_guild_code,
    assignment_source,
    is_manually_confirmed
  )
  select
    v_campaign_id,
    p_organization_id,
    v_draft_dashboard_id,
    member.id,
    member.watcher_name,
    member.discord_id,
    member.guild_code,
    null,
    'guild_member',
    false
  from public.guild_members member
  join public.portal_guilds guild
    on guild.guild_code = member.guild_code
   and guild.organization_id = p_organization_id
   and guild.is_active = true
  where coalesce(member.roster_status, 'active') = 'active'
  order by guild.guild_code, member.watcher_name;

  return v_campaign_id;
end;
$function$;

revoke all on function public.create_intersaison_campaign_for_organization(uuid, text) from public, anon, authenticated;
grant execute on function public.create_intersaison_campaign_for_organization(uuid, text) to service_role;

commit;
