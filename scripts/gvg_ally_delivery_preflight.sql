-- Strictly read-only. Run before the additive delivery installation.
with checks as (
  select 'preparation_installed' as check_name,to_regprocedure('public.read_gvg_ally_followup(uuid,uuid)') is not null as ok
  union all select 'save_installed',to_regprocedure('public.save_gvg_ally_followup(uuid,uuid,uuid,text,jsonb,bigint,text)') is not null
  union all select 'reset_context_installed',to_regprocedure('public._gvg_reset_context(uuid,uuid)') is not null
  union all select 'states_installed',to_regclass('public.gvg_ally_followup_state') is not null
  union all select 'guild_catalog',to_regclass('public.portal_guilds') is not null
  union all select 'reset_operations',to_regclass('public.gvg_reset_operations') is not null
  union all select 'not_already_installed',to_regclass('public.gvg_ally_deliveries') is null and to_regclass('public.gvg_ally_delivery_settings') is null
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
  'notice','Installation additive. Aucun message, reset, transfert ou changement du worker.') as gvg_ally_delivery_preflight;
