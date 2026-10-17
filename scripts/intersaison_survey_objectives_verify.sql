-- Read-only. Run after intersaison_survey_objectives.sql.
with expected_functions(signature) as (
  values
    ('public.assert_intersaison_objectives_admin(uuid,uuid)'),
    ('public.check_intersaison_objective_version()'),
    ('public.save_intersaison_survey_objectives_draft(uuid,uuid,uuid,jsonb,integer)'),
    ('public.validate_intersaison_survey_objectives_draft(uuid,uuid,uuid,uuid)')
), checks as (
  select 'tables' as check_name, '2' as expected_value, count(*)::text as actual_value,
    case when count(*) = 2 then 'OK' else 'ERROR' end as status
  from pg_class where oid in (to_regclass('public.intersaison_survey_objective_versions'),to_regclass('public.intersaison_survey_objective_items'))
  union all
  select 'function_' || signature, 'present', coalesce(to_regprocedure(signature)::text, 'missing'),
    case when to_regprocedure(signature) is not null then 'OK' else 'ERROR' end from expected_functions
  union all
  select 'scope_foreign_keys', '3', count(*)::text, case when count(*) = 3 then 'OK' else 'ERROR' end
  from pg_constraint where connamespace = 'public'::regnamespace and contype = 'f'
    and conname in ('survey_objective_version_season_org_fk','survey_objective_item_version_org_fk','survey_objective_item_guild_org_fk')
  union all
  select 'rls_enabled', '2', count(*)::text, case when count(*) = 2 then 'OK' else 'ERROR' end
  from pg_class where oid in ('public.intersaison_survey_objective_versions'::regclass,'public.intersaison_survey_objective_items'::regclass) and relrowsecurity
  union all
  select 'service_read_policies', '2', count(*)::text, case when count(*) = 2 then 'OK' else 'ERROR' end
  from pg_policies where schemaname = 'public'
    and policyname in ('survey_objective_versions_service_read','survey_objective_items_service_read') and cmd = 'SELECT'
  union all
  select 'deferred_complete_trigger', 'present', count(*)::text, case when count(*) = 1 then 'OK' else 'ERROR' end
  from pg_trigger where tgrelid = 'public.intersaison_survey_objective_versions'::regclass
    and tgname = 'intersaison_objective_version_complete' and tgdeferrable and tginitdeferred
  union all
  select 'version_indexes', '2', count(*)::text, case when count(*) = 2 then 'OK' else 'ERROR' end
  from pg_class where oid in (to_regclass('public.intersaison_survey_objective_versions_latest_idx'),to_regclass('public.intersaison_survey_objective_versions_official_uidx'))
  union all
  select 'invalid_version_sets', '0', count(*)::text, case when count(*) = 0 then 'OK' else 'ERROR' end
  from public.intersaison_survey_objective_versions v where
    (select count(*) from public.intersaison_survey_objective_items i where i.version_id = v.id) <> 7
    or (v.status in ('validated','official') and exists (
      select 1 from public.intersaison_survey_objective_items i where i.version_id = v.id and btrim(i.objective_text,E' \t\n\r') = ''
    ))
  union all
  select 'cross_organization_versions', '0', count(*)::text, case when count(*) = 0 then 'OK' else 'ERROR' end
  from public.intersaison_survey_objective_versions v join public.intersaison_survey_seasons s on s.id = v.season_id
  where v.organization_id <> s.organization_id
  union all
  select 'direct_write_privileges', '0', count(*)::text, case when count(*) = 0 then 'OK' else 'ERROR' end
  from information_schema.role_table_grants where table_schema = 'public'
    and table_name in ('intersaison_survey_objective_versions','intersaison_survey_objective_items')
    and grantee in ('anon','authenticated','service_role','PUBLIC') and privilege_type <> 'SELECT'
  union all
  select 'rpc_service_execute', '2', count(*)::text, case when count(*) = 2 then 'OK' else 'ERROR' end
  from expected_functions where signature like 'public.%_intersaison_survey_objectives_draft%'
    and has_function_privilege('service_role',signature,'EXECUTE')
  union all
  select 'rpc_public_access', '0', count(*)::text, case when count(*) = 0 then 'OK' else 'ERROR' end
  from expected_functions where has_function_privilege('anon',signature,'EXECUTE') or has_function_privilege('authenticated',signature,'EXECUTE')
  union all
  select 'no_dm_operations_in_rpc', '0', count(*)::text, case when count(*) = 0 then 'OK' else 'ERROR' end
  from expected_functions where pg_get_functiondef(to_regprocedure(signature)) ~* '(guild_dm_|intersaison_survey_(campaigns|recipients|responses))'
)
select check_name, expected_value, actual_value, status from checks order by check_name;
