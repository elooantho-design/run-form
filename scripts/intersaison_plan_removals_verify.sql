-- Read-only verification. One JSON result, no business mutation or plan application.
with definitions as (
  select p.proname, p.oid, p.prosecdef, p.proconfig, pg_get_functiondef(p.oid) as source
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('read_intersaison_plan','save_intersaison_plan','intersaison_plan_targets')
), checks as (
  select 'three_functions' as check_name, count(*)=3 as ok from definitions
  union all select 'read_capability_marker', coalesce(bool_and(source like '%placement_modes_version%'),false) from definitions where proname='read_intersaison_plan'
  union all select 'read_membership_version', coalesce(bool_and(source like '%membership_version%' and source like '%ctid%'),false) from definitions where proname='read_intersaison_plan'
  union all select 'explicit_mode_validation', coalesce(bool_and(source like '%placement_mode not in%'),false) from definitions where proname='save_intersaison_plan'
  union all select 'member_row_locked', coalesce(bool_and(source like '%for update of live%'),false) from definitions where proname='save_intersaison_plan'
  union all select 'server_owned_community_confirmation', coalesce(bool_and(source like '%communityPlacementVersion%' and source like '%ctid%'),false) from definitions where proname='save_intersaison_plan'
  union all select 'forced_unassignment_overrides_vote', coalesce(bool_and(source like '%placementMode%=''unassigned'' then null%'),false) from definitions where proname='intersaison_plan_targets'
  union all select 'community_requires_fresh_placement', coalesce(bool_and(source like '%communityPlacementVersion%live.xmin%' and source like '%live.ctid%'),false) from definitions where proname='intersaison_plan_targets'
  union all select 'security_definer', coalesce(bool_and(prosecdef),false) from definitions
  union all select 'fixed_search_path', coalesce(bool_and('search_path=public, pg_temp'=any(proconfig)),false) from definitions
  union all select 'anonymous_denied', coalesce(bool_and(not has_function_privilege('anon',oid,'execute')),false) from definitions
  union all select 'authenticated_denied', coalesce(bool_and(not has_function_privilege('authenticated',oid,'execute')),false) from definitions
  union all select 'service_read_save_only', coalesce(bool_and(has_function_privilege('service_role',oid,'execute')=(proname<>'intersaison_plan_targets')),false) from definitions
), counts as (
  select c.id as survey_2_id,c.status as survey_2_status,c.season_id,
    (select count(*) from public.intersaison_survey_recipients r where r.survey_campaign_id=c.id) as recipients,
    (select count(*) from public.intersaison_survey_responses r where r.survey_campaign_id=c.id and r.is_current) as responses
  from public.intersaison_survey_campaigns c where c.poll_number=2 and not c.is_test and c.status<>'cancelled'
), fingerprints as (
  select 'guild_members' as source,count(*) as rows,md5(coalesce(string_agg(to_jsonb(m)::text,chr(10) order by to_jsonb(m)::text),'')) as fingerprint from public.guild_members m
  union all select 'placements',count(*),md5(coalesce(string_agg(to_jsonb(m)::text,chr(10) order by to_jsonb(m)::text),'')) from public.intersaison_survey_placements m
  union all select 'survey_recipients',count(*),md5(coalesce(string_agg(to_jsonb(m)::text,chr(10) order by to_jsonb(m)::text),'')) from public.intersaison_survey_recipients m
  union all select 'survey_responses',count(*),md5(coalesce(string_agg(to_jsonb(m)::text,chr(10) order by to_jsonb(m)::text),'')) from public.intersaison_survey_responses m
)
select jsonb_build_object('all_checks_ok',(select bool_and(ok) from checks),
  'checks',(select jsonb_agg(jsonb_build_object('check_name',check_name,'status',case when ok then 'OK' else 'ERROR' end) order by check_name) from checks),
  'survey_two',(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from counts c),
  'fingerprints',(select jsonb_agg(to_jsonb(f) order by source) from fingerprints f)) as intersaison_plan_removals_verify;
