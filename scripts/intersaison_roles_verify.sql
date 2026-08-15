-- Read-only verification after scripts/intersaison_roles.sql.

select
  campaign.id as campaign_id,
  campaign.label,
  organization.organization_key,
  count(assignment.id) as total_assignments,
  count(assignment.id) filter (where assignment.intersaison_role = 'member') as member_count,
  count(assignment.id) filter (where assignment.intersaison_role = 'officer') as officer_count,
  count(assignment.id) filter (where assignment.intersaison_role = 'leader') as leader_count,
  count(assignment.id) filter (where assignment.intersaison_role is null) as null_count
from public.intersaison_campaigns campaign
left join public.portal_organizations organization on organization.id = campaign.organization_id
left join public.intersaison_assignments assignment on assignment.campaign_id = campaign.id
where campaign.status = 'active'
group by campaign.id, campaign.label, organization.organization_key
order by organization.organization_key nulls last, campaign.created_at desc nulls last;

select
  campaign.id as campaign_id,
  dashboard.code as dashboard_code,
  dashboard.name as dashboard_name,
  count(assignment.id) as total_assignments,
  count(assignment.id) filter (where assignment.intersaison_role = 'member') as member_count,
  count(assignment.id) filter (where assignment.intersaison_role = 'officer') as officer_count,
  count(assignment.id) filter (where assignment.intersaison_role = 'leader') as leader_count,
  count(assignment.id) filter (where assignment.intersaison_role is null) as null_count
from public.intersaison_campaigns campaign
join public.intersaison_dashboards dashboard on dashboard.campaign_id = campaign.id
left join public.intersaison_assignments assignment on assignment.dashboard_id = dashboard.id
where campaign.status = 'active'
group by campaign.id, dashboard.id, dashboard.code, dashboard.name, dashboard.sort_order
order by campaign.created_at desc nulls last, dashboard.sort_order, dashboard.code;
