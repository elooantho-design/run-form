begin;

-- organization_id semantics:
-- - intersaison_campaigns.organization_id is the organization that owns the campaign.
-- - intersaison_dashboards.organization_id and intersaison_assignments.organization_id
--   are the tenant/owner organization of the campaign the row belongs to.
-- - These columns do NOT represent the real organization of the member.
-- - A member's real organization is still determined through:
--   guild_members.guild_code -> portal_guilds -> portal_organizations.
-- - Later, the source of truth should become:
--   guild_members.portal_guild_id -> portal_guilds -> portal_organizations.

alter table public.intersaison_campaigns
  add column if not exists organization_id uuid null references public.portal_organizations(id) on delete restrict;

alter table public.intersaison_dashboards
  add column if not exists organization_id uuid null references public.portal_organizations(id) on delete restrict;

alter table public.intersaison_assignments
  add column if not exists organization_id uuid null references public.portal_organizations(id) on delete restrict;

create index if not exists intersaison_campaigns_organization_idx
  on public.intersaison_campaigns (organization_id, status, created_at);

create unique index if not exists intersaison_campaigns_one_active_by_org_idx
  on public.intersaison_campaigns (organization_id)
  where status = 'active' and organization_id is not null;

create index if not exists intersaison_dashboards_organization_campaign_idx
  on public.intersaison_dashboards (organization_id, campaign_id, sort_order);

create index if not exists intersaison_assignments_organization_campaign_idx
  on public.intersaison_assignments (organization_id, campaign_id, source_guild_code);

do $$
declare
  paladin_organization_id uuid;
begin
  select id
  into paladin_organization_id
  from public.portal_organizations
  where organization_key = 'paladin'
    and is_active = true;

  if paladin_organization_id is null then
    raise exception 'Organisation paladin introuvable. Execute portal_organizations_seed.sql avant cette migration.';
  end if;

  update public.intersaison_campaigns
  set organization_id = paladin_organization_id
  where id = 'fd5f6382-270e-4006-ace8-ab0072c4dd00'
    and organization_id is null;

  update public.intersaison_dashboards dashboard
  set organization_id = campaign.organization_id
  from public.intersaison_campaigns campaign
  where dashboard.campaign_id = campaign.id
    and dashboard.organization_id is null
    and campaign.organization_id is not null;

  update public.intersaison_assignments assignment
  set organization_id = campaign.organization_id
  from public.intersaison_campaigns campaign
  where assignment.campaign_id = campaign.id
    and assignment.organization_id is null
    and campaign.organization_id is not null;
end $$;

commit;
