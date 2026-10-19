-- Read only. No roles, placements, answers, campaigns or messages are created.
with checks as (
  select 'role_columns' as check_name,'11' as expected,count(*)::text as actual,
    case when count(*)=11 then 'OK' else 'ERROR' end as status from information_schema.columns
    where table_schema='public' and table_name='intersaison_survey_forecast_roles'
      and column_name in ('id','organization_id','season_id','member_key','member_id','member_name_snapshot',
        'forecast_role','revision','actor_member_id','actor_name','created_at')
  union all
  select 'role_values_constraint','leader, officer, member',coalesce(max(pg_get_constraintdef(oid)),'missing'),
    case when max(pg_get_constraintdef(oid)) like '%leader%' and max(pg_get_constraintdef(oid)) like '%officer%'
      and max(pg_get_constraintdef(oid)) like '%member%' then 'OK' else 'ERROR' end
    from pg_constraint where conrelid='public.intersaison_survey_forecast_roles'::regclass and conname='intersaison_forecast_role_value'
  union all
  select 'role_season_tenant_fk','present',count(*)::text,case when count(*)=1 then 'OK' else 'ERROR' end
    from pg_constraint where conrelid='public.intersaison_survey_forecast_roles'::regclass
      and conname='intersaison_forecast_role_season_org_fk' and contype='f'
  union all
  select 'role_revision_unique','present',count(*)::text,case when count(*)=1 then 'OK' else 'ERROR' end
    from pg_constraint where conrelid='public.intersaison_survey_forecast_roles'::regclass
      and conname='intersaison_forecast_role_revision_unique' and contype='u'
  union all
  select 'roles_rls','true',relrowsecurity::text,case when relrowsecurity then 'OK' else 'ERROR' end
    from pg_class where oid='public.intersaison_survey_forecast_roles'::regclass
  union all
  select 'roles_table_service_read_only','true',has_table_privilege('service_role','public.intersaison_survey_forecast_roles','SELECT')::text,
    case when has_table_privilege('service_role','public.intersaison_survey_forecast_roles','SELECT')
      and not has_table_privilege('service_role','public.intersaison_survey_forecast_roles','INSERT,UPDATE,DELETE')
      and not has_table_privilege('anon','public.intersaison_survey_forecast_roles','SELECT,INSERT,UPDATE,DELETE')
      and not has_table_privilege('authenticated','public.intersaison_survey_forecast_roles','SELECT,INSERT,UPDATE,DELETE') then 'OK' else 'ERROR' end
  union all
  select 'forecast_rpc_service_only','true',coalesce(to_regprocedure('public.save_intersaison_survey_forecast_entry(uuid,uuid,uuid,uuid,text,text,integer,integer)')::text,'missing'),
    case when has_function_privilege('service_role','public.save_intersaison_survey_forecast_entry(uuid,uuid,uuid,uuid,text,text,integer,integer)','EXECUTE')
      and not has_function_privilege('anon','public.save_intersaison_survey_forecast_entry(uuid,uuid,uuid,uuid,text,text,integer,integer)','EXECUTE')
      and not has_function_privilege('authenticated','public.save_intersaison_survey_forecast_entry(uuid,uuid,uuid,uuid,text,text,integer,integer)','EXECUTE') then 'OK' else 'ERROR' end
  union all
  select 'existing_submit_rpc','present',coalesce(to_regprocedure('public.submit_intersaison_survey_choice(uuid,text,text,text,text,text)')::text,'missing'),
    case when to_regprocedure('public.submit_intersaison_survey_choice(uuid,text,text,text,text,text)') is not null then 'OK' else 'ERROR' end
  union all
  select 'cross_tenant_role_rows','0',count(*)::text,case when count(*)=0 then 'OK' else 'ERROR' end
    from public.intersaison_survey_forecast_roles r join public.intersaison_survey_seasons s on s.id=r.season_id
    where r.organization_id<>s.organization_id
)
select * from checks order by check_name;
