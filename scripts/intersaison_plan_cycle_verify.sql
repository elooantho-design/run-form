-- Read-only. One result for schema checks, installation activity and integrity fingerprints.
with tables(name) as(values('intersaison_plan_cycles'),('intersaison_plan_applications'),('intersaison_plan_objective_bank'),('intersaison_plan_events')),
checks as (
select 'table_'||name as check_name,case when to_regclass('public.'||name) is not null then 'OK' else 'ERROR' end as status from tables
union all
select 'rls_'||c.relname,case when c.relrowsecurity then 'OK' else 'ERROR' end from pg_class c
 where c.oid in ('public.intersaison_plan_cycles'::regclass,'public.intersaison_plan_applications'::regclass,'public.intersaison_plan_objective_bank'::regclass,'public.intersaison_plan_events'::regclass)
union all
select 'function_'||name,case when to_regprocedure('public.'||name) is not null then 'OK' else 'ERROR' end
from (values('read_intersaison_plan(uuid,uuid,uuid)'),('save_intersaison_plan(uuid,uuid,uuid,integer,text,jsonb)'),
 ('preview_intersaison_plan(uuid,uuid,uuid)'),('apply_intersaison_plan(uuid,uuid,uuid,text,uuid,boolean)'),
 ('close_intersaison_plan(uuid,uuid,uuid,text,boolean)'),('prepare_next_intersaison_plan(uuid,uuid,uuid,boolean)')) required(name)
union all select 'anonymous_functions_denied',case when not exists(select 1 from pg_proc p
 where p.pronamespace='public'::regnamespace and p.proname in ('read_intersaison_plan','save_intersaison_plan','preview_intersaison_plan',
 'apply_intersaison_plan','close_intersaison_plan','prepare_next_intersaison_plan') and has_function_privilege('anon',p.oid,'execute')) then 'OK' else 'ERROR' end
union all select 'authenticated_functions_denied',case when not exists(select 1 from pg_proc p
 where p.pronamespace='public'::regnamespace and p.proname like '%intersaison_plan%' and has_function_privilege('authenticated',p.oid,'execute')) then 'OK' else 'ERROR' end
union all select 'cycles_scoped',case when not exists(select 1 from public.intersaison_plan_cycles p join public.intersaison_survey_seasons s
 on s.id=p.season_id where s.organization_id<>p.organization_id) then 'OK' else 'ERROR' end
union all select 'paladin_namespace_trigger',case when exists(select 1 from pg_trigger where tgrelid='public.portal_guilds'::regclass
 and tgname='portal_guilds_paladin_namespace' and tgenabled='O') then 'OK' else 'ERROR' end
union all select 'dynamic_objective_scope',case when exists(select 1 from information_schema.columns where table_schema='public'
 and table_name='intersaison_survey_objective_versions' and column_name='guild_codes') then 'OK' else 'ERROR' end
union all select 'campaign_name_snapshot',case when exists(select 1 from information_schema.columns where table_schema='public'
 and table_name='intersaison_survey_campaigns' and column_name='guild_names') then 'OK' else 'ERROR' end
union all select 'frozen_discord_choice_scope',case when exists(select 1 from pg_proc where pronamespace='public'::regnamespace
 and proname='submit_intersaison_survey_choice' and position('Choix absent des objectifs envoyés.' in prosrc)>0) then 'OK' else 'ERROR' end
union all select 'legacy_placement_guard',case when (select count(*) from pg_trigger where tgname='intersaison_plan_legacy_guard'
 and tgenabled='O' and tgrelid in('public.intersaison_survey_placements'::regclass,'public.intersaison_survey_forecast_roles'::regclass))=2 then 'OK' else 'ERROR' end
union all select 'direct_mutation_denied',case when not has_table_privilege('service_role','public.intersaison_plan_cycles','update')
 and not has_table_privilege('authenticated','public.intersaison_plan_events','insert') then 'OK' else 'ERROR' end
union all select 'private_helpers_denied',case when not exists(select 1 from pg_proc where pronamespace='public'::regnamespace
 and proname in('intersaison_active_guild_codes','intersaison_active_guild_names','guard_legacy_intersaison_plan_write',
 'guard_paladin_guild_namespace','capture_intersaison_campaign_guild_names') and
 (has_function_privilege('anon',oid,'execute') or has_function_privilege('authenticated',oid,'execute'))) then 'OK' else 'ERROR' end
),
fingerprints as (
 select 'guild_members' as source,count(*) as rows,md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'[]')) as fingerprint from public.guild_members t
 union all select 'survey_responses',count(*),md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'[]')) from public.intersaison_survey_responses t
 union all select 'survey_recipients',count(*),md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'[]')) from public.intersaison_survey_recipients t
 union all select 'placements',count(*),md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'[]')) from public.intersaison_survey_placements t
),
survey_two as (
 select s.id as season_id,s.status as season_status,c.id as survey_2_id,c.status as survey_2_status,
  (select count(*) from public.intersaison_survey_recipients where survey_campaign_id=c.id) as recipients,
  (select count(*) from public.intersaison_survey_responses where survey_campaign_id=c.id and is_current) as responses
 from public.intersaison_survey_seasons s join public.intersaison_survey_campaigns c on c.season_id=s.id and c.organization_id=s.organization_id
 join public.portal_organizations o on o.id=s.organization_id
 where lower(o.organization_key) in ('paladin','paladin_cluster') and s.status<>'finished' and c.poll_number=2 and not c.is_test
)

-- Immediately after installation all activity counts must be zero.
select jsonb_build_object(
 'all_checks_ok',(select bool_and(status='OK') from checks),
 'checks',(select jsonb_agg(to_jsonb(c) order by check_name) from checks c),
 'activity',jsonb_build_object('applications',(select count(*) from public.intersaison_plan_applications),
   'new_bank_versions',(select count(*) from public.intersaison_plan_objective_bank),
   'plan_events',(select count(*) from public.intersaison_plan_events)),
 'fingerprints',(select jsonb_agg(to_jsonb(f) order by source) from fingerprints f),
 'survey_two',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from survey_two s)
) as intersaison_plan_verify;
