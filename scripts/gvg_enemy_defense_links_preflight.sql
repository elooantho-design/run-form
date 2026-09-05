with expected_tables(table_name) as (
  values
    ('gvg_enemy_defenses'),
    ('gvg_enemy_defense_guild_stats'),
    ('gvg_enemy_defense_processed_resets'),
    ('guild_defenses'),
    ('guild_defense_slots'),
    ('portal_guilds'),
    ('portal_organizations')
),
table_state as (
  select
    expected_tables.table_name,
    to_regclass('public.' || expected_tables.table_name) is not null as exists_now
  from expected_tables
),
expected_columns(table_name, column_name) as (
  values
    ('guild_defenses', 'source_enemy_defense_id'),
    ('guild_defenses', 'source_enemy_defense_fingerprint'),
    ('guild_defenses', 'source_enemy_portal_guild_id'),
    ('guild_defenses', 'source_enemy_label'),
    ('guild_defenses', 'source_enemy_imported_at'),
    ('guild_defense_slots', 'position'),
    ('guild_defense_slots', 'direction')
),
column_state as (
  select
    expected_columns.table_name,
    expected_columns.column_name,
    exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = expected_columns.table_name
        and c.column_name = expected_columns.column_name
    ) as exists_now
  from expected_columns
),
existing_review_tables as (
  select
    to_regclass('public.gvg_enemy_defense_similarity_reviews') is not null as reviews_exists,
    to_regclass('public.gvg_enemy_defense_strat_availability') is not null as availability_exists
),
row_estimates as (
  select
    table_state.table_name,
    case
      when class.oid is null then 'missing'
      else greatest(class.reltuples, 0)::bigint::text || '_estimated'
    end as estimated_rows
  from table_state
  left join pg_class class
    on class.oid = to_regclass('public.' || table_state.table_name)
)
select
  'required_table_' || table_name as check_name,
  'present' as expected_value,
  case when exists_now then 'present' else 'missing' end as actual_value,
  case when exists_now then 'OK' else 'ERROR' end as status
from table_state

union all

select
  'new_column_' || table_name || '_' || column_name,
  'missing_before_migration_or_present_if_already_applied',
  case when exists_now then 'present' else 'missing' end,
  'OK'
from column_state

union all

select
  'target_table_similarity_reviews',
  'missing_before_migration_or_present_if_already_applied',
  case when reviews_exists then 'present' else 'missing' end,
  'OK'
from existing_review_tables

union all

select
  'target_table_strat_availability',
  'missing_before_migration_or_present_if_already_applied',
  case when availability_exists then 'present' else 'missing' end,
  'OK'
from existing_review_tables

union all

select
  'current_enemy_defense_bank_rows',
  'informational',
  coalesce((select estimated_rows from row_estimates where table_name = 'gvg_enemy_defenses'), 'missing'),
  'OK'

union all

select
  'current_enemy_guild_stats_rows',
  'informational',
  coalesce((select estimated_rows from row_estimates where table_name = 'gvg_enemy_defense_guild_stats'), 'missing'),
  'OK'

union all

select
  'current_local_defenses',
  'informational',
  coalesce((select estimated_rows from row_estimates where table_name = 'guild_defenses'), 'missing'),
  'OK'

union all

select
  'current_local_defense_slots',
  'informational',
  coalesce((select estimated_rows from row_estimates where table_name = 'guild_defense_slots'), 'missing'),
  'OK'

union all

select
  'migration_scope',
  'schema_only_no_g3_reset_no_backfill',
  'schema_only_no_g3_reset_no_backfill',
  'OK'

union all

select
  'image_storage_policy',
  'vps_only_no_supabase_storage',
  'vps_only_no_supabase_storage',
  'OK'
order by check_name;
