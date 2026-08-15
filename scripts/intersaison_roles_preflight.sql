-- Read-only preflight before adding intersaison assignment preparation roles.
-- This script does not mutate data or schema.

select
  'intersaison_assignments_columns' as section,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'intersaison_assignments'
order by ordinal_position;

select
  'role_column_presence' as section,
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'intersaison_assignments'
      and column_name = 'intersaison_role'
  ) as intersaison_role_column_exists;

select
  'active_campaigns' as section,
  campaign.id as campaign_id,
  campaign.label,
  campaign.status,
  campaign.organization_id,
  organization.organization_key,
  organization.display_name as organization_name,
  campaign.created_at,
  campaign.updated_at
from public.intersaison_campaigns campaign
left join public.portal_organizations organization on organization.id = campaign.organization_id
where campaign.status = 'active'
order by organization.organization_key nulls last, campaign.created_at desc nulls last;

select
  'active_campaign_totals' as section,
  campaign.id as campaign_id,
  campaign.organization_id,
  organization.organization_key,
  count(distinct dashboard.id) as dashboard_count,
  count(distinct assignment.id) as assignment_count,
  count(distinct note.id) as note_count,
  count(distinct assignment.id) filter (where assignment.is_manually_confirmed) as confirmed_count,
  count(distinct assignment.id) filter (where coalesce(array_length(assignment.wished_guild_codes, 1), 0) > 0) as wished_count
from public.intersaison_campaigns campaign
left join public.portal_organizations organization on organization.id = campaign.organization_id
left join public.intersaison_dashboards dashboard on dashboard.campaign_id = campaign.id
left join public.intersaison_assignments assignment on assignment.campaign_id = campaign.id
left join public.intersaison_notes note on note.assignment_id = assignment.id
where campaign.status = 'active'
group by campaign.id, campaign.organization_id, organization.organization_key
order by organization.organization_key nulls last, campaign.created_at desc nulls last;

select
  'active_dashboard_distribution' as section,
  campaign.id as campaign_id,
  organization.organization_key,
  dashboard.id as dashboard_id,
  dashboard.code as dashboard_code,
  dashboard.name as dashboard_name,
  dashboard.is_draft,
  count(distinct assignment.id) as assignment_count,
  count(distinct note.id) as note_count,
  count(distinct assignment.id) filter (where assignment.is_manually_confirmed) as confirmed_count,
  count(distinct assignment.id) filter (where coalesce(array_length(assignment.wished_guild_codes, 1), 0) > 0) as wished_count
from public.intersaison_campaigns campaign
join public.intersaison_dashboards dashboard on dashboard.campaign_id = campaign.id
left join public.portal_organizations organization on organization.id = campaign.organization_id
left join public.intersaison_assignments assignment on assignment.dashboard_id = dashboard.id
left join public.intersaison_notes note on note.assignment_id = assignment.id
where campaign.status = 'active'
group by
  campaign.id,
  organization.organization_key,
  dashboard.id,
  dashboard.code,
  dashboard.name,
  dashboard.is_draft,
  dashboard.sort_order
order by organization.organization_key nulls last, dashboard.sort_order, dashboard.code;

do $$
declare
  v_role_exists boolean;
  v_row record;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'intersaison_assignments'
      and column_name = 'intersaison_role'
  )
  into v_role_exists;

  raise notice 'intersaison_role_column_exists=%', v_role_exists;

  if v_role_exists then
    for v_row in execute $sql$
      select
        campaign.id as campaign_id,
        organization.organization_key,
        assignment.intersaison_role,
        count(*) as assignment_count
      from public.intersaison_campaigns campaign
      join public.intersaison_assignments assignment on assignment.campaign_id = campaign.id
      left join public.portal_organizations organization on organization.id = campaign.organization_id
      where campaign.status = 'active'
      group by campaign.id, organization.organization_key, assignment.intersaison_role
      order by organization.organization_key nulls last, assignment.intersaison_role nulls first
    $sql$
    loop
      raise notice
        'active_role_distribution campaign_id=%, organization_key=%, intersaison_role=%, assignment_count=%',
        v_row.campaign_id,
        v_row.organization_key,
        coalesce(v_row.intersaison_role, '<null>'),
        v_row.assignment_count;
    end loop;

    for v_row in execute $sql$
      select
        count(*) as rows_to_backfill
      from public.intersaison_campaigns campaign
      join public.intersaison_assignments assignment on assignment.campaign_id = campaign.id
      where campaign.status = 'active'
        and assignment.intersaison_role is null
    $sql$
    loop
      raise notice 'active_rows_to_backfill=%', v_row.rows_to_backfill;
    end loop;
  else
    for v_row in execute $sql$
      select
        count(*) as rows_to_backfill
      from public.intersaison_campaigns campaign
      join public.intersaison_assignments assignment on assignment.campaign_id = campaign.id
      where campaign.status = 'active'
    $sql$
    loop
      raise notice 'active_rows_to_backfill_if_column_is_added=%', v_row.rows_to_backfill;
    end loop;
  end if;
end $$;
