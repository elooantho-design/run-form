-- Strictly read-only. Existing business fingerprints must match the preflight
-- if no admin or import changed them between the two controls.
with required_functions(signature,is_public) as (values
  ('public.read_gvg_ally_followup(uuid,uuid)',true),
  ('public.save_gvg_ally_followup(uuid,uuid,uuid,text,jsonb,bigint,text)',true),
  ('public._gvg_ally_assignment(text)',false),('public._gvg_ally_position(public.gvg_defense)',false),
  ('public._gvg_ally_signature(public.gvg_defense)',false),('public._gvg_ally_roster_version(text)',false),
  ('public._gvg_ally_members(text)',false),('public._gvg_ally_invalidate_owner()',false)
), checks as (
  select 'function_'||signature as check_name,to_regprocedure(signature) is not null as ok from required_functions
  union all select 'anonymous_denied',bool_and(not has_function_privilege('anon',to_regprocedure(signature),'EXECUTE')) from required_functions
  union all select 'authenticated_denied',bool_and(not has_function_privilege('authenticated',to_regprocedure(signature),'EXECUTE')) from required_functions
  union all select 'service_entrypoints_only',bool_and(has_function_privilege('service_role',to_regprocedure(signature),'EXECUTE')=is_public) from required_functions
  union all select 'state_rls',relrowsecurity from pg_class where oid=to_regclass('public.gvg_ally_followup_state')
  union all select 'provisional_rls',relrowsecurity from pg_class where oid=to_regclass('public.gvg_ally_provisional_assignments')
  union all select 'no_direct_mutation',not has_table_privilege('service_role','public.gvg_ally_followup_state','INSERT,UPDATE,DELETE')
    and not has_table_privilege('service_role','public.gvg_ally_provisional_assignments','INSERT,UPDATE,DELETE')
  union all select 'owner_invalidation_trigger',exists(select 1 from pg_trigger where tgname='gvg_ally_invalidate_owner' and tgrelid='public.guild_members'::regclass and tgenabled='O')
  union all select 'fixed_search_paths',bool_and(p.proconfig @> array['search_path=pg_catalog, public'])
    from required_functions f join pg_proc p on p.oid=to_regprocedure(f.signature)
), fingerprints as (
  select 'guild_members' as source,count(*) as rows,md5(coalesce(jsonb_agg(to_jsonb(t) order by t.id)::text,'[]')) as fingerprint from public.guild_members t
  union all select 'gvg_defense',count(*),md5(coalesce(jsonb_agg(to_jsonb(t) order by t.id)::text,'[]')) from public.gvg_defense t
)
select jsonb_build_object('all_checks_ok',(select bool_and(coalesce(ok,false)) from checks),'checks',
  (select jsonb_agg(jsonb_build_object('check_name',check_name,'status',case when ok then 'OK' else 'BLOCKED' end) order by check_name) from checks),
  'fingerprints',(select jsonb_agg(to_jsonb(f) order by source) from fingerprints f),
  'states',(select count(*) from public.gvg_ally_followup_state),'provisional_assignments',(select count(*) from public.gvg_ally_provisional_assignments),
  'delivery_enabled',false,'reset_connected',false) as gvg_ally_followup_verify;
