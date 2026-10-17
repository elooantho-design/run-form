-- Read-only. Missing objective tables are expected before the migration.
with required_columns(table_name, column_name, udt_name) as (
  values
    ('intersaison_survey_seasons','id','uuid'),
    ('intersaison_survey_seasons','organization_id','uuid'),
    ('intersaison_survey_seasons','status','text'),
    ('portal_organizations','id','uuid'),
    ('portal_organizations','organization_key','text'),
    ('portal_organizations','is_active','bool'),
    ('portal_guilds','organization_id','uuid'),
    ('portal_guilds','guild_code','text'),
    ('portal_guilds','is_active','bool'),
    ('guild_members','id','uuid'),
    ('guild_members','role','text'),
    ('guild_members','guild_code','text')
), checks as (
  select 'column_' || r.table_name || '.' || r.column_name as check_name,
    r.udt_name as expected_value, coalesce(c.udt_name, 'missing') as actual_value,
    case when c.udt_name = r.udt_name then 'OK' else 'ERROR' end as status
  from required_columns r left join information_schema.columns c
    on c.table_schema = 'public' and c.table_name = r.table_name and c.column_name = r.column_name
  union all
  select 'portal_guilds_org_code_unique', 'unique (organization_id, guild_code)',
    case when exists (select 1 from pg_constraint where conrelid = to_regclass('public.portal_guilds')
      and contype = 'u' and pg_get_constraintdef(oid) = 'UNIQUE (organization_id, guild_code)') then 'present' else 'missing' end,
    case when exists (select 1 from pg_constraint where conrelid = to_regclass('public.portal_guilds')
      and contype = 'u' and pg_get_constraintdef(oid) = 'UNIQUE (organization_id, guild_code)') then 'OK' else 'ERROR' end
  union all
  select 'paladin_active_guilds', '7', count(*)::text, case when count(*) = 7 then 'OK' else 'ERROR' end
  from public.portal_guilds g join public.portal_organizations o on o.id = g.organization_id
  where lower(o.organization_key) in ('paladin','paladin_cluster') and o.is_active and g.is_active
    and g.guild_code in ('G1','G2','G3','G4','G5','G6','G7')
  union all
  select 'required_roles', '3', count(*)::text, case when count(*) = 3 then 'OK' else 'ERROR' end
  from pg_roles where rolname in ('anon','authenticated','service_role')
  union all
  select 'legacy_reference_objectives_preserved', 'table present; no writes planned',
    coalesce(to_regclass('public.intersaison_survey_guild_objectives')::text, 'missing'),
    case when to_regclass('public.intersaison_survey_guild_objectives') is not null then 'OK' else 'ERROR' end
  union all
  select 'objective_tables_installation', '0 before migration / 2 on rerun', count(*)::text,
    case when count(*) in (0,2) then 'OK' else 'ERROR' end
  from pg_class where oid in (to_regclass('public.intersaison_survey_objective_versions'),to_regclass('public.intersaison_survey_objective_items'))
)
select check_name, expected_value, actual_value, status from checks order by check_name;
