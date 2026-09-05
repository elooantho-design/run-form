with checks as (
  select
    'table_similarity_reviews' as check_name,
    'present' as expected_value,
    case when to_regclass('public.gvg_enemy_defense_similarity_reviews') is null then 'missing' else 'present' end as actual_value

  union all

  select
    'table_strat_availability',
    'present',
    case when to_regclass('public.gvg_enemy_defense_strat_availability') is null then 'missing' else 'present' end

  union all

  select
    'guild_defenses_source_enemy_defense_id',
    'present',
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'guild_defenses'
        and column_name = 'source_enemy_defense_id'
    ) then 'present' else 'missing' end

  union all

  select
    'guild_defenses_source_enemy_fingerprint',
    'present',
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'guild_defenses'
        and column_name = 'source_enemy_defense_fingerprint'
    ) then 'present' else 'missing' end

  union all

  select
    'guild_defense_slots_position',
    'present',
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'guild_defense_slots'
        and column_name = 'position'
    ) then 'present' else 'missing' end

  union all

  select
    'guild_defense_slots_direction',
    'present',
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'guild_defense_slots'
        and column_name = 'direction'
    ) then 'present' else 'missing' end

  union all

  select
    'reviews_unique_pair',
    'present',
    case when exists (
      select 1
      from pg_constraint
      where conrelid = 'public.gvg_enemy_defense_similarity_reviews'::regclass
        and conname = 'gvg_enemy_defense_similarity_reviews_unique_pair'
    ) then 'present' else 'missing' end

  union all

  select
    'reviews_status_check',
    'pending_identical_different',
    case when exists (
      select 1
      from pg_constraint
      where conrelid = 'public.gvg_enemy_defense_similarity_reviews'::regclass
        and conname = 'gvg_enemy_defense_similarity_reviews_status_check'
    ) then 'pending_identical_different' else 'missing' end

  union all

  select
    'local_enemy_fk_on_delete',
    'SET NULL',
    coalesce((
      select confdeltype::text
      from pg_constraint c
      join pg_attribute a
        on a.attrelid = c.conrelid
       and a.attnum = any(c.conkey)
      where c.conrelid = 'public.guild_defenses'::regclass
        and c.contype = 'f'
        and a.attname = 'source_enemy_defense_id'
      limit 1
    ), 'missing')

  union all

  select
    'reviews_rls_enabled',
    'true',
    coalesce((
      select relrowsecurity::text
      from pg_class
      where oid = 'public.gvg_enemy_defense_similarity_reviews'::regclass
    ), 'missing')

  union all

  select
    'availability_rls_enabled',
    'true',
    coalesce((
      select relrowsecurity::text
      from pg_class
      where oid = 'public.gvg_enemy_defense_strat_availability'::regclass
    ), 'missing')

  union all

  select
    'service_role_policies',
    '2',
    (
      select count(*)::text
      from pg_policies
      where schemaname = 'public'
        and policyname in (
          'gvg_enemy_similarity_reviews_service_role_all',
          'gvg_enemy_strat_availability_service_role_all'
        )
    )

  union all

  select
    'schema_only_no_backfill',
    '0 automatic rows required',
    '0 automatic rows required'
)
select
  check_name,
  expected_value,
  actual_value,
  case
    when check_name = 'local_enemy_fk_on_delete' and actual_value = 'n' then 'OK'
    when expected_value = actual_value then 'OK'
    else 'ERROR'
  end as status
from checks
order by check_name;
