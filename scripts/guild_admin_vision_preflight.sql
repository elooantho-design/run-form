with checks as (
  select
    'base_tables' as check_name,
    '3' as expected_value,
    count(*)::text as actual_value,
    case when count(*) = 3 then 'OK' else 'ERROR' end as status
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('guild_members', 'portal_guilds', 'portal_organizations')
    and c.relkind in ('r', 'p')
  union all
  select
    'guild_members_required_columns',
    '8',
    count(*)::text,
    case when count(*) = 8 then 'OK' else 'ERROR' end
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'guild_members'
    and column_name in (
      'id',
      'watcher_name',
      'discord_id',
      'guild_code',
      'role',
      'created_at',
      'roster_status',
      'primary_member_id'
    )
  union all
  select
    'portal_guilds_required_columns',
    '4',
    count(*)::text,
    case when count(*) = 4 then 'OK' else 'ERROR' end
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'portal_guilds'
    and column_name in ('id', 'organization_id', 'guild_code', 'is_active')
  union all
  select
    'admin_vision_table_state',
    'absent_or_compatible',
    case
      when to_regclass('public.guild_member_admin_vision_state') is null then 'absent'
      else 'present'
    end,
    case
      when to_regclass('public.guild_member_admin_vision_state') is null then 'OK'
      when (
        select count(*)
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'guild_member_admin_vision_state'
          and column_name in (
            'organization_id',
            'guild_code',
            'member_id',
            'manual_verified',
            'discord_status'
          )
      ) = 5 then 'OK'
      else 'ERROR'
    end
  union all
  select
    'pgcrypto_extension_available',
    'true',
    (exists (
      select 1
      from pg_available_extensions
      where name = 'pgcrypto'
    ))::text,
    case when exists (
      select 1
      from pg_available_extensions
      where name = 'pgcrypto'
    ) then 'OK' else 'ERROR' end
)
select check_name, expected_value, actual_value, status
from checks
order by check_name;
