with checks as (
  select
    'table_exists' as check_name,
    'true' as expected_value,
    (to_regclass('public.guild_member_admin_vision_state') is not null)::text as actual_value,
    case when to_regclass('public.guild_member_admin_vision_state') is not null then 'OK' else 'ERROR' end as status
  union all
  select
    'required_columns',
    '15',
    count(*)::text,
    case when count(*) = 15 then 'OK' else 'ERROR' end
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'guild_member_admin_vision_state'
    and column_name in (
      'id',
      'organization_id',
      'guild_code',
      'member_id',
      'manual_verified',
      'manual_verified_at',
      'manual_verified_by_member_id',
      'discord_status',
      'discord_checked_at',
      'discord_checked_by_member_id',
      'discord_id_snapshot',
      'discord_display_name',
      'discord_error',
      'created_at',
      'updated_at'
    )
  union all
  select
    'unique_member_state',
    'present',
    case when exists (
      select 1
      from pg_constraint
      where conname = 'guild_member_admin_vision_state_member_unique'
        and conrelid = 'public.guild_member_admin_vision_state'::regclass
    ) then 'present' else 'missing' end,
    case when exists (
      select 1
      from pg_constraint
      where conname = 'guild_member_admin_vision_state_member_unique'
        and conrelid = 'public.guild_member_admin_vision_state'::regclass
    ) then 'OK' else 'ERROR' end
  union all
  select
    'discord_status_constraint',
    'present',
    case when exists (
      select 1
      from pg_constraint
      where conname = 'guild_member_admin_vision_state_discord_status_check'
        and conrelid = 'public.guild_member_admin_vision_state'::regclass
    ) then 'present' else 'missing' end,
    case when exists (
      select 1
      from pg_constraint
      where conname = 'guild_member_admin_vision_state_discord_status_check'
        and conrelid = 'public.guild_member_admin_vision_state'::regclass
    ) then 'OK' else 'ERROR' end
  union all
  select
    'rls_enabled',
    'true',
    coalesce(relrowsecurity, false)::text,
    case when coalesce(relrowsecurity, false) then 'OK' else 'ERROR' end
  from pg_class
  join pg_namespace on pg_namespace.oid = pg_class.relnamespace
  where pg_namespace.nspname = 'public'
    and pg_class.relname = 'guild_member_admin_vision_state'
  union all
  select
    'service_role_policy',
    'present',
    case when exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'guild_member_admin_vision_state'
        and policyname = 'guild_member_admin_vision_service_role_all'
    ) then 'present' else 'missing' end,
    case when exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'guild_member_admin_vision_state'
        and policyname = 'guild_member_admin_vision_service_role_all'
    ) then 'OK' else 'ERROR' end
  union all
  select
    'orphan_state_rows',
    '0',
    count(*)::text,
    case when count(*) = 0 then 'OK' else 'ERROR' end
  from public.guild_member_admin_vision_state state
  left join public.guild_members member on member.id = state.member_id
  where member.id is null
  union all
  select
    'cross_organization_state_rows',
    '0',
    count(*)::text,
    case when count(*) = 0 then 'OK' else 'ERROR' end
  from public.guild_member_admin_vision_state state
  left join public.portal_guilds guild
    on guild.guild_code = state.guild_code
   and guild.organization_id = state.organization_id
  where guild.id is null
)
select check_name, expected_value, actual_value, status
from checks
order by check_name;
