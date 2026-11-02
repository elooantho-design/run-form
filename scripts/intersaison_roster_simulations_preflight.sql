-- Strictly read-only. One result for Supabase SQL Editor.
with required(table_name,column_name) as (values
  ('portal_organizations','id'),('portal_organizations','organization_key'),('portal_organizations','is_active'),
  ('portal_guilds','id'),('portal_guilds','organization_id'),('portal_guilds','guild_code'),('portal_guilds','display_name'),('portal_guilds','is_active'),
  ('guild_members','id'),('guild_members','watcher_name'),('guild_members','guild_code'),('guild_members','role'),
  ('guild_members','roster_status'),('guild_members','community_access_type'),('guild_members','primary_member_id'),('guild_members','discord_id'),
  ('intersaison_assignments','organization_id'),('intersaison_assignments','member_id'),
  ('intersaison_survey_recipients','organization_id'),('intersaison_survey_recipients','member_id'),
  ('intersaison_plan_applications','organization_id'),('intersaison_plan_applications','members'),
  ('guild_survey_recipients','organization_id'),('guild_survey_recipients','member_key'),('guild_survey_recipients','owner_member_ids')
), checks as (
  select table_name||'.'||column_name as name, exists(select 1 from information_schema.columns c
    where c.table_schema='public' and c.table_name=r.table_name and c.column_name=r.column_name) as ok from required r
  union all select 'one_active_paladin',count(*)=1 from public.portal_organizations
    where lower(organization_key) in ('paladin','paladin_cluster') and is_active
  union all select 'unambiguous_guild_codes',not exists(select guild_code from public.portal_guilds group by guild_code having count(*)>1)
  union all select 'service_role_present',exists(select 1 from pg_roles where rolname='service_role')
)
select jsonb_build_object('all_checks_ok',bool_and(ok),'checks',jsonb_agg(jsonb_build_object('name',name,'status',case when ok then 'OK' else 'ERROR' end) order by name),
  'business_writes',false,'existing_guild_capacity_fallback',30) as roster_simulations_preflight from checks;
