-- Strictly read-only. Run before gvg_ally_followup.sql.
with checks as (
  select 'reset_context_installed' as check_name,to_regprocedure('public._gvg_reset_context(uuid,uuid)') is not null as ok
  union all select 'reset_code_installed',to_regprocedure('public._gvg_reset_code(text)') is not null
  union all select 'guild_members',to_regclass('public.guild_members') is not null
  union all select 'guild_catalog',to_regclass('public.portal_guilds') is not null
  union all select 'organizations',to_regclass('public.portal_organizations') is not null
  union all select 'gvg_defense',to_regclass('public.gvg_defense') is not null
  union all select 'reset_operations',to_regclass('public.gvg_reset_operations') is not null
  union all select 'assignment_column',exists(select 1 from information_schema.columns where table_schema='public' and table_name='guild_members' and column_name='assignment')
  union all select 'personal_thread_column',exists(select 1 from information_schema.columns where table_schema='public' and table_name='guild_members' and column_name='personal_forum_post_url')
  union all select 'not_already_installed',to_regclass('public.gvg_ally_followup_state') is null and to_regclass('public.gvg_ally_provisional_assignments') is null
), fingerprints as (
  select 'guild_members' as source,count(*) as rows,md5(coalesce(jsonb_agg(to_jsonb(t) order by t.id)::text,'[]')) as fingerprint from public.guild_members t
  union all select 'gvg_defense',count(*),md5(coalesce(jsonb_agg(to_jsonb(t) order by t.id)::text,'[]')) from public.gvg_defense t
)
select jsonb_build_object('all_checks_ok',(select bool_and(ok) from checks),'checks',
  (select jsonb_agg(jsonb_build_object('check_name',check_name,'status',case when ok then 'OK' else 'BLOCKED' end) order by check_name) from checks),
  'fingerprints',(select jsonb_agg(to_jsonb(f) order by source) from fingerprints f),'delivery_enabled',false,
  'notice','Installation additive de preparation uniquement. Aucun envoi ni branchement au reset.') as gvg_ally_followup_preflight;
