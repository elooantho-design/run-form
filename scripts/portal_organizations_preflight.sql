-- Read-only preflight for the future multi-organization model.
-- Execute before any write migration.

select
  'guild_members_by_guild_code' as section,
  coalesce(guild_code, '<null>') as guild_code,
  count(*) as member_count
from public.guild_members
group by guild_code
order by guild_code nulls last;

select
  'portal_guild_licenses' as section,
  guild_space_key,
  guild_label,
  plan,
  status,
  trial_started_at,
  trial_ends_at,
  current_period_started_at,
  current_period_ends_at
from public.portal_guild_licenses
order by guild_space_key;

select
  'existing_portal_organizations_table' as section,
  to_regclass('public.portal_organizations') as table_regclass;

select
  'existing_portal_guilds_table' as section,
  to_regclass('public.portal_guilds') as table_regclass;

select
  'guild_member_columns' as section,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'guild_members'
order by ordinal_position;

select
  'license_columns' as section,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'portal_guild_licenses'
order by ordinal_position;

select
  'intersaison_tables' as section,
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'intersaison_campaigns',
    'intersaison_dashboards',
    'intersaison_assignments',
    'intersaison_notes'
  )
order by table_name, ordinal_position;

select
  'rpc_create_intersaison_campaign' as section,
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as signature,
  pg_get_userbyid(p.proowner) as owner_name,
  p.prosecdef as security_definer,
  p.proconfig as function_config,
  pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'create_intersaison_campaign';

select
  'rpc_grants' as section,
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as signature,
  (aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))).grantor::regrole::text as grantor,
  (aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))).grantee::regrole::text as grantee,
  (aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))).privilege_type as privilege_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'create_intersaison_campaign';
