with expected_source_columns(column_name) as (
  values
    ('id'),
    ('guild'),
    ('bastion'),
    ('type'),
    ('tower'),
    ('team'),
    ('defense_key'),
    ('raw_name'),
    ('heroes'),
    ('image_url'),
    ('status'),
    ('repro_by'),
    ('is_ally'),
    ('record_status'),
    ('created_at'),
    ('updated_at')
),
source_columns as (
  select column_name
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'gvg_defense'
),
portal_guild_matches as (
  select
    guild_code,
    regexp_replace(upper(btrim(guild_code)), '\s+', '_', 'g') as technical_gvg_code
  from public.portal_guilds
  where is_active is true
)
select *
from (
  select
    10 as sort_order,
    'source_table_gvg_defense' as check_name,
    'present' as expected_value,
    case when to_regclass('public.gvg_defense') is null then 'missing' else 'present' end as actual_value,
    case when to_regclass('public.gvg_defense') is null then 'ERROR' else 'OK' end as status

  union all

  select
    20,
    'source_columns_available',
    (select count(*)::text from expected_source_columns),
    (select count(*)::text from expected_source_columns e join source_columns s using (column_name)),
    case
      when (select count(*) from expected_source_columns e join source_columns s using (column_name))
        = (select count(*) from expected_source_columns)
      then 'OK'
      else 'ERROR'
    end

  union all

  select
    30,
    'missing_source_columns',
    '0',
    coalesce((
      select string_agg(e.column_name, ', ' order by e.column_name)
      from expected_source_columns e
      left join source_columns s using (column_name)
      where s.column_name is null
    ), '0'),
    case
      when exists (
        select 1
        from expected_source_columns e
        left join source_columns s using (column_name)
        where s.column_name is null
      )
      then 'ERROR'
      else 'OK'
    end

  union all

  select
    40,
    'portal_guilds_table',
    'present',
    case when to_regclass('public.portal_guilds') is null then 'missing' else 'present' end,
    case when to_regclass('public.portal_guilds') is null then 'ERROR' else 'OK' end

  union all

  select
    50,
    'mad_g1_portal_mapping',
    'exactly 1 active Portal guild matching technical MAD_G1',
    count(*)::text,
    case when count(*) = 1 then 'OK' else 'ERROR' end
  from portal_guild_matches
  where technical_gvg_code = 'MAD_G1'

  union all

  select
    60,
    'current_gvg_guild_values',
    'diagnostic',
    coalesce(string_agg(distinct guild, ', ' order by guild), 'none'),
    'OK'
  from public.gvg_defense

  union all

  select
    70,
    'enemy_rows_waiting_for_future_reset',
    'diagnostic only - no backfill',
    count(*)::text,
    'OK'
  from public.gvg_defense
  where is_ally is distinct from true

  union all

  select
    80,
    'gvg_images_bucket',
    'present',
    case when exists (select 1 from storage.buckets where id = 'gvg-images') then 'present' else 'missing' end,
    case when exists (select 1 from storage.buckets where id = 'gvg-images') then 'OK' else 'ERROR' end

  union all

  select
    90,
    'target_table_gvg_enemy_defenses',
    'will be created or reused by migration',
    case when to_regclass('public.gvg_enemy_defenses') is null then 'missing_before_migration' else 'present' end,
    'OK'

  union all

  select
    100,
    'target_table_gvg_enemy_defense_guild_stats',
    'will be created or reused by migration',
    case when to_regclass('public.gvg_enemy_defense_guild_stats') is null then 'missing_before_migration' else 'present' end,
    'OK'

  union all

  select
    110,
    'target_table_gvg_enemy_defense_processed_resets',
    'will be created or reused by migration',
    case when to_regclass('public.gvg_enemy_defense_processed_resets') is null then 'missing_before_migration' else 'present' end,
    'OK'

  union all

  select
    120,
    'archive_rpc',
    'will be created or replaced by migration',
    case
      when exists (
        select 1
        from pg_proc proc
        join pg_namespace ns on ns.oid = proc.pronamespace
        where ns.nspname = 'public'
          and proc.proname = 'archive_gvg_enemy_defense_bank'
      )
      then 'present'
      else 'missing_before_migration'
    end,
    'OK'
) checks
order by sort_order;
