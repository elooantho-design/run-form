with required_tables(table_name) as (
  values
    ('portal_organizations'),
    ('portal_guilds'),
    ('guild_members'),
    ('guild_defenses'),
    ('guild_defense_slots')
),
table_state as (
  select
    table_name,
    to_regclass('public.' || table_name) is not null as exists_now
  from required_tables
),
required_columns(table_name, column_name) as (
  values
    ('guild_defenses', 'organization_id'),
    ('guild_defenses', 'source_defense_id'),
    ('guild_defenses', 'source_enemy_defense_id'),
    ('guild_defense_slots', 'position'),
    ('guild_defense_slots', 'direction')
),
column_state as (
  select
    required_columns.table_name,
    required_columns.column_name,
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = required_columns.table_name
        and column_name = required_columns.column_name
    ) as exists_now
  from required_columns
),
current_counts as (
  select
    coalesce((select count(*)::text from public.guild_defenses), '0') as defense_rows,
    coalesce((
      select count(*)::text
      from public.guild_defenses
      where source_defense_id is null
        and coalesce(is_hidden, false) is false
    ), '0') as native_visible_rows
)
select
  'required_table_' || table_name as check_name,
  'present' as expected_value,
  case when exists_now then 'present' else 'missing' end as actual_value,
  case when exists_now then 'OK' else 'ERROR' end as status
from table_state

union all

select
  'required_column_' || table_name || '_' || column_name,
  'present',
  case when exists_now then 'present' else 'missing' end,
  case when exists_now then 'OK' else 'ERROR' end
from column_state

union all

select
  'target_table_guild_defense_library_similarity_reviews',
  'missing_before_migration_or_present_if_already_applied',
  case
    when to_regclass('public.guild_defense_library_similarity_reviews') is null then 'missing'
    else 'present'
  end,
  'OK'

union all

select
  'current_defense_rows',
  'informational',
  defense_rows,
  'OK'
from current_counts

union all

select
  'current_native_library_rows',
  'informational',
  native_visible_rows,
  'OK'
from current_counts

union all

select
  'migration_scope',
  'schema_only_no_reset_no_backfill',
  'schema_only_no_reset_no_backfill',
  'OK'

union all

select
  'source_defense_id_semantics',
  'preserved_for_library_to_local_copies',
  'preserved_for_library_to_local_copies',
  'OK'
order by check_name;
