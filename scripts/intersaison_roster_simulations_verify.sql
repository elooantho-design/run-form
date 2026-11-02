-- Strictly read-only. Does not create a simulation or synchronize members.
with tables(name) as (values ('intersaison_roster_simulations'),('intersaison_roster_entries'),('intersaison_roster_events')),
functions(signature,is_public_api) as (values
  ('public.roster_simulation_request(uuid,text,uuid,integer,jsonb)',true),
  ('public._roster_simulation_actor(uuid)',false),('public._roster_simulation_guilds(uuid)',false),
  ('public._roster_simulation_members(uuid)',false),('public._roster_simulation_detail(uuid)',false)
), checks as (
  select 'rls_'||name as name,coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.'||name)),false) as ok from tables
  union all select 'table_access_denied_'||t.name,not exists(select 1 from (values('anon'),('authenticated'),('service_role'))r(role)
    where has_table_privilege(r.role,'public.'||t.name,'SELECT,INSERT,UPDATE,DELETE')) from tables t
  union all select 'secured_'||signature,coalesce((select prosecdef and proconfig @> array['search_path=public, pg_temp']
    from pg_proc where oid=to_regprocedure(signature)),false) from functions
  union all select 'execute_acl_'||signature,to_regprocedure(signature) is not null
    and not has_function_privilege('anon',signature,'EXECUTE') and not has_function_privilege('authenticated',signature,'EXECUTE')
    and has_function_privilege('service_role',signature,'EXECUTE')=is_public_api from functions
  union all select 'no_real_transfer_branch',pg_get_functiondef(to_regprocedure('public.roster_simulation_request(uuid,text,uuid,integer,jsonb)'))
    !~* '(update|insert into|delete from)[[:space:]]+(public\.)?(guild_members|guild_dm_|intersaison_survey_|guild_survey_)'
)
select jsonb_build_object('all_checks_ok',bool_and(ok),'checks',jsonb_agg(jsonb_build_object('name',name,'status',case when ok then 'OK' else 'ERROR' end) order by name),
  'simulations',(select count(*) from public.intersaison_roster_simulations),
  'entries',(select count(*) from public.intersaison_roster_entries),
  'events',(select count(*) from public.intersaison_roster_events),'real_application_enabled',false) as roster_simulations_verify from checks;
