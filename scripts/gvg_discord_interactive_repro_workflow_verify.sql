with checks as (
  select
    'controls_table' as check_name,
    'present' as expected_value,
    case when to_regclass('public.gvg_discord_repro_controls') is null then 'missing' else 'present' end as actual_value
  union all
  select
    'participants_table',
    'present',
    case when to_regclass('public.gvg_discord_repro_participants') is null then 'missing' else 'present' end
  union all
  select
    'request_min_awakenings_column',
    'present',
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'gvg_discord_repro_requests'
        and column_name = 'min_awakenings'
        and data_type = 'jsonb'
    ) then 'present' else 'missing' end
  union all
  select
    'request_compatible_message_column',
    'present',
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'gvg_discord_repro_requests'
        and column_name = 'compatible_message_id'
    ) then 'present' else 'missing' end
  union all
  select
    'controls_active_unique_index',
    'present',
    case when exists (
      select 1 from pg_indexes
      where schemaname = 'public'
        and tablename = 'gvg_discord_repro_controls'
        and indexname = 'gvg_discord_repro_controls_guild_active_uidx'
    ) then 'present' else 'missing' end
  union all
  select
    'participants_active_unique_index',
    'present',
    case when exists (
      select 1 from pg_indexes
      where schemaname = 'public'
        and tablename = 'gvg_discord_repro_participants'
        and indexname = 'gvg_discord_repro_participants_active_member_uidx'
    ) then 'present' else 'missing' end
  union all
  select
    'controls_rls_enabled',
    'true',
    coalesce((
      select relrowsecurity::text
      from pg_class
      where oid = 'public.gvg_discord_repro_controls'::regclass
    ), 'false')
  union all
  select
    'participants_rls_enabled',
    'true',
    coalesce((
      select relrowsecurity::text
      from pg_class
      where oid = 'public.gvg_discord_repro_participants'::regclass
    ), 'false')
  union all
  select
    'duplicate_active_controls',
    '0',
    coalesce((
      select count(*)::text
      from (
        select guild
        from public.gvg_discord_repro_controls
        where state in ('active', 'send_failed')
        group by guild
        having count(*) > 1
      ) duplicates
    ), '0')
  union all
  select
    'duplicate_active_participants',
    '0',
    coalesce((
      select count(*)::text
      from (
        select request_id, member_id
        from public.gvg_discord_repro_participants
        where state in ('pending', 'active')
        group by request_id, member_id
        having count(*) > 1
      ) duplicates
    ), '0')
)
select
  check_name,
  expected_value,
  actual_value,
  case when actual_value = expected_value then 'OK' else 'ERROR' end as status
from checks
order by check_name;
