-- Read-only. Delivery stays disabled until a separately authorized worker rollout.
with tables(name) as(values('guild_survey_settings'),('guild_surveys'),('guild_survey_recipients'),('guild_survey_responses'),('guild_survey_waves'),('guild_survey_deliveries'),('guild_survey_delivery_events')),
functions(signature) as(values('public.guild_survey_request(uuid,text,uuid,integer,jsonb)'),('public.authorize_guild_survey_delivery(uuid,text)')),
checks as(
  select 'rls_'||name as check_name,case when coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.'||name)),false) then 'OK' else 'ERROR' end as status from tables
  union all select 'private_table_'||name,case when not coalesce(has_table_privilege('anon',to_regclass('public.'||name),'select,insert,update,delete'),true)
    and not coalesce(has_table_privilege('authenticated',to_regclass('public.'||name),'select,insert,update,delete'),true)
    and not coalesce(has_table_privilege('service_role',to_regclass('public.'||name),'insert,update,delete'),true) then 'OK' else 'ERROR' end from tables
  union all select 'service_rpc_'||signature,case when coalesce(has_function_privilege('service_role',to_regprocedure(signature),'execute'),false)
    and not coalesce(has_function_privilege('anon',to_regprocedure(signature),'execute'),true)
    and not coalesce(has_function_privilege('authenticated',to_regprocedure(signature),'execute'),true) then 'OK' else 'ERROR' end from functions
  union all select 'private_helpers',case when exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname like '\_guild\_survey\_%' escape '\' and
      (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute')))
    then 'ERROR' else 'OK' end
  union all select 'scoped_queue_guards',case when (select count(*) from pg_trigger where tgname in ('guild_survey_delivery_guard','guild_survey_dm_campaign_guard') and tgenabled='O')=2 then 'OK' else 'ERROR' end
  union all select 'worker_claim_authorization',case when position('authorized_at' in pg_get_functiondef(to_regprocedure('public.guard_guild_survey_delivery()')))>0 then 'OK' else 'ERROR' end
)
select jsonb_build_object('checks',(select jsonb_agg(to_jsonb(checks) order by check_name) from checks),
  'all_checks_ok',not exists(select 1 from checks where status='ERROR'),
  'delivery_enabled',(select delivery_enabled from public.guild_survey_settings where singleton),
  'surveys',(select count(*) from public.guild_surveys),
  'waves',(select count(*) from public.guild_survey_waves),
  'notice','Delivery disabled is normal before the separately authorized worker rollout.') as guild_surveys_verify;
