begin;

create or replace function public.finalize_intersaison_campaign_for_organization(
  p_campaign_id uuid,
  p_organization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_locked_campaign_id uuid;
  v_draft_count integer;
  v_blocked_count integer;
  v_transfer_count integer;
  v_community_count integer;
  v_unchanged_count integer;
  v_updated_campaign_count integer;
begin
  if p_campaign_id is null or p_organization_id is null then
    raise exception 'campaign_id et organization_id sont obligatoires.';
  end if;

  select campaign.id
  into v_locked_campaign_id
  from public.intersaison_campaigns campaign
  where campaign.id = p_campaign_id
    and campaign.organization_id = p_organization_id
    and campaign.status = 'active'
  for update;

  if v_locked_campaign_id is null then
    raise exception 'Campagne active introuvable pour cette organisation.';
  end if;

  perform 1
  from public.intersaison_dashboards dashboard
  where dashboard.campaign_id = p_campaign_id
  order by dashboard.id
  for update;

  select count(*)
  into v_draft_count
  from public.intersaison_dashboards dashboard
  where dashboard.campaign_id = p_campaign_id
    and dashboard.organization_id = p_organization_id
    and dashboard.code = 'BROUILLON'
    and dashboard.is_draft = true;

  if v_draft_count <> 1 then
    raise exception 'La campagne doit contenir exactement un dashboard BROUILLON.';
  end if;

  perform 1
  from public.intersaison_assignments assignment
  where assignment.campaign_id = p_campaign_id
  order by assignment.id
  for update;

  perform 1
  from public.guild_members member
  where member.id in (
    select assignment.member_id
    from public.intersaison_assignments assignment
    where assignment.campaign_id = p_campaign_id
      and assignment.member_id is not null
  )
  order by member.id
  for update;

  perform 1
  from public.portal_guilds guild
  where guild.organization_id = p_organization_id
     or guild.guild_code in (
      select member.guild_code
      from public.intersaison_assignments assignment
      join public.guild_members member on member.id = assignment.member_id
      where assignment.campaign_id = p_campaign_id
        and member.guild_code is not null
    )
     or guild.guild_code in (
      select dashboard.code
      from public.intersaison_dashboards dashboard
      where dashboard.campaign_id = p_campaign_id
        and dashboard.code is not null
    )
  order by guild.id
  for update;

  select count(*)
  into v_blocked_count
  from public.intersaison_assignments assignment
  left join public.guild_members member on member.id = assignment.member_id
  left join public.portal_guilds member_guild
    on member_guild.guild_code = member.guild_code
  left join public.intersaison_dashboards dashboard
    on dashboard.id = assignment.dashboard_id
   and dashboard.campaign_id = p_campaign_id
  left join public.portal_guilds target_guild
    on target_guild.guild_code = dashboard.code
   and target_guild.organization_id = p_organization_id
   and target_guild.is_active = true
  where assignment.campaign_id = p_campaign_id
    and (
      assignment.organization_id is distinct from p_organization_id
      or member.id is null
      or member.guild_code is null
      or member_guild.id is null
      or member_guild.organization_id is distinct from p_organization_id
      or member_guild.is_active is not true
      or dashboard.id is null
      or dashboard.campaign_id is distinct from p_campaign_id
      or dashboard.organization_id is distinct from p_organization_id
      or (dashboard.is_draft is true and dashboard.code <> 'BROUILLON')
      or (dashboard.code = 'BROUILLON' and dashboard.is_draft is not true)
      or (dashboard.is_draft is true and dashboard.code = 'BROUILLON' and lower(coalesce(member.role, '')) = 'leader')
      or (dashboard.is_draft is false and dashboard.code = 'BROUILLON')
      or (dashboard.is_draft is false and target_guild.id is null)
    );

  if v_blocked_count > 0 then
    raise exception 'Validation intersaison bloquee: % assignation(s) invalide(s) ou hors perimetre.', v_blocked_count;
  end if;

  select count(*)
  into v_transfer_count
  from public.intersaison_assignments assignment
  join public.guild_members member on member.id = assignment.member_id
  join public.intersaison_dashboards dashboard
    on dashboard.id = assignment.dashboard_id
   and dashboard.campaign_id = p_campaign_id
  join public.portal_guilds target_guild
    on target_guild.guild_code = dashboard.code
   and target_guild.organization_id = p_organization_id
   and target_guild.is_active = true
  where assignment.campaign_id = p_campaign_id
    and assignment.organization_id = p_organization_id
    and dashboard.campaign_id = p_campaign_id
    and dashboard.organization_id = p_organization_id
    and dashboard.is_draft = false
    and dashboard.code <> 'BROUILLON'
    and member.guild_code is distinct from dashboard.code;

  select count(*)
  into v_unchanged_count
  from public.intersaison_assignments assignment
  join public.guild_members member on member.id = assignment.member_id
  join public.intersaison_dashboards dashboard
    on dashboard.id = assignment.dashboard_id
   and dashboard.campaign_id = p_campaign_id
  join public.portal_guilds target_guild
    on target_guild.guild_code = dashboard.code
   and target_guild.organization_id = p_organization_id
   and target_guild.is_active = true
  where assignment.campaign_id = p_campaign_id
    and assignment.organization_id = p_organization_id
    and dashboard.campaign_id = p_campaign_id
    and dashboard.organization_id = p_organization_id
    and dashboard.is_draft = false
    and dashboard.code <> 'BROUILLON'
    and member.guild_code is not distinct from dashboard.code;

  select count(*)
  into v_community_count
  from public.intersaison_assignments assignment
  join public.intersaison_dashboards dashboard
    on dashboard.id = assignment.dashboard_id
   and dashboard.campaign_id = p_campaign_id
  where assignment.campaign_id = p_campaign_id
    and assignment.organization_id = p_organization_id
    and dashboard.campaign_id = p_campaign_id
    and dashboard.organization_id = p_organization_id
    and dashboard.is_draft = true
    and dashboard.code = 'BROUILLON';

  update public.guild_members member
  set
    guild_code = dashboard.code,
    roster_status = 'active'
  from public.intersaison_assignments assignment
  join public.intersaison_dashboards dashboard
    on dashboard.id = assignment.dashboard_id
   and dashboard.campaign_id = p_campaign_id
  join public.portal_guilds target_guild
    on target_guild.guild_code = dashboard.code
   and target_guild.organization_id = p_organization_id
   and target_guild.is_active = true
  where assignment.member_id = member.id
    and assignment.campaign_id = p_campaign_id
    and assignment.organization_id = p_organization_id
    and dashboard.campaign_id = p_campaign_id
    and dashboard.organization_id = p_organization_id
    and dashboard.is_draft = false
    and dashboard.code <> 'BROUILLON';

  update public.guild_members member
  set
    guild_code = null,
    role = 'community_member',
    community_access_type = 'community',
    community_status = 'active',
    assignment = 'Communauté',
    status = 'Actif',
    defense_1 = '—',
    defense_2 = '—',
    roster_status = 'inactive'
  from public.intersaison_assignments assignment
  join public.intersaison_dashboards dashboard
    on dashboard.id = assignment.dashboard_id
   and dashboard.campaign_id = p_campaign_id
  where assignment.member_id = member.id
    and assignment.campaign_id = p_campaign_id
    and assignment.organization_id = p_organization_id
    and dashboard.campaign_id = p_campaign_id
    and dashboard.organization_id = p_organization_id
    and dashboard.is_draft = true
    and dashboard.code = 'BROUILLON';

  update public.intersaison_campaigns
  set
    status = 'validated',
    validated_at = now()
  where id = p_campaign_id
    and organization_id = p_organization_id
    and status = 'active';

  get diagnostics v_updated_campaign_count = row_count;

  if v_updated_campaign_count <> 1 then
    raise exception 'Impossible de finaliser la campagne.';
  end if;

  return jsonb_build_object(
    'guildTransferCount', v_transfer_count,
    'unchangedGuildPlacementCount', v_unchanged_count,
    'communityConversionCount', v_community_count,
    'campaignStatus', 'validated'
  );
end;
$function$;

revoke all on function public.finalize_intersaison_campaign_for_organization(uuid, uuid) from public, anon, authenticated;
grant execute on function public.finalize_intersaison_campaign_for_organization(uuid, uuid) to service_role;

commit;
