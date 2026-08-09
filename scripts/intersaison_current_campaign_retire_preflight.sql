-- Read-only preflight before retiring the historical contaminated Inter-saison campaign.
-- This script does not mutate data.

with target_campaign as (
  select 'fd5f6382-270e-4006-ace8-ab0072c4dd00'::uuid as id
)
select
  'campaign' as section,
  campaign.*
from public.intersaison_campaigns campaign
where campaign.id = (select id from target_campaign);

with target_campaign as (
  select 'fd5f6382-270e-4006-ace8-ab0072c4dd00'::uuid as id
),
assignment_rows as (
  select assignment.*
  from public.intersaison_assignments assignment
  where assignment.campaign_id = (select id from target_campaign)
)
select
  'summary' as section,
  (select count(*) from public.intersaison_dashboards dashboard where dashboard.campaign_id = (select id from target_campaign)) as dashboard_count,
  (select count(*) from assignment_rows) as assignment_count,
  (select count(*) from public.intersaison_notes note join assignment_rows assignment on assignment.id = note.assignment_id) as note_count,
  (select count(*) from assignment_rows where is_manually_confirmed) as confirmed_assignment_count,
  (select count(*) from assignment_rows where target_guild_code is not null) as target_guild_assignment_count,
  (select count(*) from assignment_rows where target_guild_code is null) as draft_assignment_count;

with target_campaign as (
  select 'fd5f6382-270e-4006-ace8-ab0072c4dd00'::uuid as id
)
select
  'dashboards' as section,
  dashboard.id,
  dashboard.code,
  dashboard.name,
  dashboard.sort_order,
  dashboard.is_draft,
  count(assignment.id) as assignment_count,
  count(assignment.id) filter (where assignment.is_manually_confirmed) as confirmed_count
from public.intersaison_dashboards dashboard
left join public.intersaison_assignments assignment on assignment.dashboard_id = dashboard.id
where dashboard.campaign_id = (select id from target_campaign)
group by dashboard.id, dashboard.code, dashboard.name, dashboard.sort_order, dashboard.is_draft
order by dashboard.sort_order;

select
  'allowed_status_values_hint' as section,
  constraint_info.conname as constraint_name,
  pg_get_constraintdef(constraint_info.oid) as constraint_definition
from pg_constraint constraint_info
where constraint_info.conrelid = 'public.intersaison_campaigns'::regclass
  and constraint_info.contype = 'c';
