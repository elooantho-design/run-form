-- Read-only preflight for the current active campaign.
-- This does not delete anything.

with paladin as (
  select id
  from public.portal_organizations
  where organization_key = 'paladin'
),
paladin_guilds as (
  select guild_code
  from public.portal_guilds
  where organization_id = (select id from paladin)
    and is_active = true
),
target_campaign as (
  select 'fd5f6382-270e-4006-ace8-ab0072c4dd00'::uuid as id
)
select
  assignment.id as assignment_id,
  assignment.member_id,
  assignment.watcher_name,
  assignment.source_guild_code,
  dashboard.code as current_dashboard_code,
  dashboard.name as current_dashboard_name,
  assignment.target_guild_code,
  exists (
    select 1
    from public.intersaison_notes note
    where note.assignment_id = assignment.id
  ) as has_note,
  assignment.is_manually_confirmed,
  assignment.wished_guild_codes,
  assignment.assignment_source
from public.intersaison_assignments assignment
left join public.intersaison_dashboards dashboard on dashboard.id = assignment.dashboard_id
where assignment.campaign_id = (select id from target_campaign)
  and (
    assignment.source_guild_code is null
    or not exists (
      select 1
      from paladin_guilds guild
      where guild.guild_code = assignment.source_guild_code
    )
  )
order by assignment.source_guild_code nulls last, assignment.watcher_name;

with target_campaign as (
  select 'fd5f6382-270e-4006-ace8-ab0072c4dd00'::uuid as id
)
select
  'g8_usage' as section,
  dashboard.id as dashboard_id,
  dashboard.code as dashboard_code,
  dashboard.name as dashboard_name,
  count(distinct assignment.id) as assigned_count,
  count(distinct note.id) as note_count,
  count(distinct assignment.id) filter (where assignment.target_guild_code = 'G8') as target_g8_count,
  count(distinct assignment.id) filter (where assignment.is_manually_confirmed) as confirmed_count
from public.intersaison_dashboards dashboard
left join public.intersaison_assignments assignment on assignment.dashboard_id = dashboard.id
left join public.intersaison_notes note on note.assignment_id = assignment.id
where dashboard.campaign_id = (select id from target_campaign)
  and dashboard.code = 'G8'
group by dashboard.id, dashboard.code, dashboard.name;

with target_campaign as (
  select 'fd5f6382-270e-4006-ace8-ab0072c4dd00'::uuid as id
)
select
  'g8_physical_dashboard_assignments' as section,
  assignment.id as assignment_id,
  assignment.member_id,
  assignment.watcher_name,
  assignment.source_guild_code,
  dashboard.code as current_dashboard_code,
  assignment.target_guild_code,
  assignment.assignment_source,
  exists (
    select 1
    from public.intersaison_notes note
    where note.assignment_id = assignment.id
  ) as has_note,
  assignment.is_manually_confirmed,
  assignment.wished_guild_codes
from public.intersaison_assignments assignment
join public.intersaison_dashboards dashboard on dashboard.id = assignment.dashboard_id
where assignment.campaign_id = (select id from target_campaign)
  and dashboard.code = 'G8'
order by assignment.source_guild_code nulls last, assignment.watcher_name;

with target_campaign as (
  select 'fd5f6382-270e-4006-ace8-ab0072c4dd00'::uuid as id
)
select
  'g8_target_guild_assignments' as section,
  assignment.id as assignment_id,
  assignment.member_id,
  assignment.watcher_name,
  assignment.source_guild_code,
  dashboard.code as current_dashboard_code,
  assignment.target_guild_code,
  assignment.assignment_source,
  exists (
    select 1
    from public.intersaison_notes note
    where note.assignment_id = assignment.id
  ) as has_note,
  assignment.is_manually_confirmed,
  assignment.wished_guild_codes
from public.intersaison_assignments assignment
left join public.intersaison_dashboards dashboard on dashboard.id = assignment.dashboard_id
where assignment.campaign_id = (select id from target_campaign)
  and assignment.target_guild_code = 'G8'
order by assignment.source_guild_code nulls last, assignment.watcher_name;
