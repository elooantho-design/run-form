-- Read-only preflight for multi-organization Inter-saison.

select
  'organizations' as section,
  organization_key,
  display_name,
  organization_type,
  is_active
from public.portal_organizations
order by organization_key;

select
  'guilds' as section,
  org.organization_key,
  guild.guild_code,
  guild.display_name,
  guild.is_active,
  count(member.id) as member_count
from public.portal_guilds guild
join public.portal_organizations org on org.id = guild.organization_id
left join public.guild_members member on member.guild_code = guild.guild_code
group by org.organization_key, guild.guild_code, guild.display_name, guild.is_active
order by org.organization_key, guild.guild_code;

select
  'unmapped_guild_members' as section,
  coalesce(member.guild_code, '<null>') as guild_code,
  count(*) as member_count
from public.guild_members member
left join public.portal_guilds guild on guild.guild_code = member.guild_code
where member.guild_code is null
   or guild.id is null
group by member.guild_code
order by member.guild_code nulls last;

select
  'intersaison_campaigns' as section,
  campaign.*
from public.intersaison_campaigns campaign
order by campaign.created_at desc nulls last;

with organization_column as (
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'intersaison_campaigns'
      and column_name = 'organization_id'
  ) as organization_id_column_exists
)
select
  'intersaison_active_campaign_summary' as section,
  organization_column.organization_id_column_exists,
  count(*) filter (where campaign.status = 'active') as active_campaign_total,
  coalesce(
    array_agg(campaign.id order by campaign.created_at desc nulls last)
      filter (where campaign.status = 'active'),
    array[]::uuid[]
  ) as active_campaign_ids,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', campaign.id,
        'status', campaign.status,
        'organization_id', to_jsonb(campaign)->>'organization_id'
      )
      order by campaign.created_at desc nulls last
    ) filter (where campaign.status = 'active'),
    '[]'::jsonb
  ) as active_campaigns,
  case
    when organization_column.organization_id_column_exists then 'ready'
    else 'not_applicable_before_migration'
  end as active_campaign_conflict_check
from public.intersaison_campaigns campaign
cross join organization_column
group by organization_column.organization_id_column_exists;

with organization_column as (
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'intersaison_campaigns'
      and column_name = 'organization_id'
  ) as organization_id_column_exists
),
campaign_rows as (
  select
    campaign.id,
    campaign.status,
    campaign.created_at,
    nullif(to_jsonb(campaign)->>'organization_id', '') as organization_id
  from public.intersaison_campaigns campaign
),
conflicts as (
  select
    campaign_rows.organization_id,
    count(*) as active_campaign_count,
    array_agg(campaign_rows.id order by campaign_rows.created_at desc nulls last) as campaign_ids
  from campaign_rows
  cross join organization_column
  where organization_column.organization_id_column_exists
    and campaign_rows.status = 'active'
    and campaign_rows.organization_id is not null
  group by campaign_rows.organization_id
  having count(*) > 1
)
select
  'intersaison_active_campaign_conflicts' as section,
  organization_column.organization_id_column_exists,
  case
    when organization_column.organization_id_column_exists then 'checked'
    else 'not_applicable_before_migration'
  end as active_campaign_conflict_check,
  conflicts.organization_id,
  coalesce(conflicts.active_campaign_count, 0) as active_campaign_count,
  coalesce(conflicts.campaign_ids, array[]::uuid[]) as campaign_ids
from organization_column
left join conflicts on true;

select
  'intersaison_assignment_counts' as section,
  assignment.campaign_id,
  coalesce(assignment.source_guild_code, '<null>') as source_guild_code,
  count(*) as assignment_count
from public.intersaison_assignments assignment
group by assignment.campaign_id, assignment.source_guild_code
order by assignment.campaign_id, assignment.source_guild_code nulls last;

select
  'intersaison_dashboards' as section,
  dashboard.campaign_id,
  dashboard.code,
  dashboard.name,
  dashboard.sort_order,
  dashboard.is_draft,
  count(assignment.id) as assigned_count
from public.intersaison_dashboards dashboard
left join public.intersaison_assignments assignment on assignment.dashboard_id = dashboard.id
group by dashboard.campaign_id, dashboard.code, dashboard.name, dashboard.sort_order, dashboard.is_draft
order by dashboard.campaign_id, dashboard.sort_order;

select
  'rpc_create_intersaison_campaign' as section,
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as signature,
  pg_get_userbyid(p.proowner) as owner_name,
  p.prosecdef as security_definer,
  p.proconfig as function_config,
  pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'create_intersaison_campaign';
