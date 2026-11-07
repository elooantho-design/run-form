-- Strictly read-only. Compare business/function fingerprints with preflight.
with required_functions(signature) as (values
  ('public.read_gvg_ally_delivery(uuid,uuid)'),
  ('public.claim_gvg_ally_delivery(uuid,uuid,uuid,text,jsonb,uuid,uuid)'),
  ('public.finish_gvg_ally_delivery(uuid,uuid,text,text,text)')
), checks as (
  select 'function_'||signature as check_name,to_regprocedure(signature) is not null as ok from required_functions
  union all select 'anonymous_denied',bool_and(not has_function_privilege('anon',to_regprocedure(signature),'EXECUTE')) from required_functions
  union all select 'authenticated_denied',bool_and(not has_function_privilege('authenticated',to_regprocedure(signature),'EXECUTE')) from required_functions
  union all select 'service_entrypoints',bool_and(has_function_privilege('service_role',to_regprocedure(signature),'EXECUTE')) from required_functions
  union all select 'security_definer',bool_and(p.prosecdef) from required_functions f join pg_proc p on p.oid=to_regprocedure(f.signature)
  union all select 'fixed_search_paths',bool_and(p.proconfig @> array['search_path=pg_catalog, public']) from required_functions f join pg_proc p on p.oid=to_regprocedure(f.signature)
  union all select 'delivery_rls',coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.gvg_ally_deliveries')),false)
  union all select 'settings_rls',coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.gvg_ally_delivery_settings')),false)
  union all select 'no_direct_access',not has_table_privilege('service_role','public.gvg_ally_deliveries','SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('authenticated','public.gvg_ally_deliveries','SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('anon','public.gvg_ally_deliveries','SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('service_role','public.gvg_ally_delivery_settings','SELECT,INSERT,UPDATE,DELETE')
  union all select 'defense_unique',exists(select 1 from pg_constraint where conrelid='public.gvg_ally_deliveries'::regclass and contype='u'
    and pg_get_constraintdef(oid)='UNIQUE (portal_guild_id, defense_id)')
  union all select 'survives_defense_deletion',not exists(select 1 from pg_constraint where conrelid='public.gvg_ally_deliveries'::regclass and contype='f'
    and confrelid in ('public.gvg_defense'::regclass,'public.guild_members'::regclass))
  union all select 'reset_lock',position('gvg-reset-guild:' in pg_get_functiondef(to_regprocedure('public.claim_gvg_ally_delivery(uuid,uuid,uuid,text,jsonb,uuid,uuid)')))>0
  union all select 'uncertain_never_requeued',position('r.status<>''failed''' in pg_get_functiondef(to_regprocedure('public.claim_gvg_ally_delivery(uuid,uuid,uuid,text,jsonb,uuid,uuid)')))>0
  union all select 'settings_singleton',(select count(*)=1 from public.gvg_ally_delivery_settings)
), fingerprints as (
  select 'guild_members' as source,count(*) as rows,md5(coalesce(jsonb_agg(to_jsonb(t) order by t.id)::text,'[]')) as fingerprint from public.guild_members t
  union all select 'gvg_defense',count(*),md5(coalesce(jsonb_agg(to_jsonb(t) order by t.id)::text,'[]')) from public.gvg_defense t
  union all select 'ally_states',count(*),md5(coalesce(jsonb_agg(to_jsonb(t) order by t.defense_id)::text,'[]')) from public.gvg_ally_followup_state t
), protected_functions as (
  select md5(string_agg(p.oid::regprocedure::text||':'||pg_get_functiondef(p.oid),E'\n' order by p.oid::regprocedure::text)) as fingerprint
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and (p.proname like '%gvg_reset%' or p.proname like '%gvg_ally%'
    or p.proname like '%similarity%') and p.proname not in ('read_gvg_ally_delivery','claim_gvg_ally_delivery','finish_gvg_ally_delivery')
)
select jsonb_build_object('all_checks_ok',(select bool_and(coalesce(ok,false)) from checks),
  'checks',(select jsonb_agg(jsonb_build_object('check_name',check_name,'status',case when ok then 'OK' else 'BLOCKED' end) order by check_name) from checks),
  'fingerprints',(select jsonb_agg(to_jsonb(f) order by source) from fingerprints f),
  'protected_functions',(select fingerprint from protected_functions),
  'delivery_enabled',(select delivery_enabled from public.gvg_ally_delivery_settings where singleton),
  'receipts',(select count(*) from public.gvg_ally_deliveries),
  'notice','Envoi uniquement apres confirmation explicite dans le dashboard. Aucun envoi declenche par le SQL.') as gvg_ally_delivery_verify;
