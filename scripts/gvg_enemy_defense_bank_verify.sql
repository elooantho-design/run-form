with checks as (
  select
    'table_gvg_enemy_defenses' as check_name,
    'present' as expected_value,
    case when to_regclass('public.gvg_enemy_defenses') is null then 'missing' else 'present' end as actual_value

  union all

  select
    'table_gvg_enemy_defense_guild_stats',
    'present',
    case when to_regclass('public.gvg_enemy_defense_guild_stats') is null then 'missing' else 'present' end

  union all

  select
    'table_gvg_enemy_defense_processed_resets',
    'present',
    case when to_regclass('public.gvg_enemy_defense_processed_resets') is null then 'missing' else 'present' end

  union all

  select
    'archive_rpc',
    'present',
    case
      when exists (
        select 1
        from pg_proc proc
        join pg_namespace ns on ns.oid = proc.pronamespace
        where ns.nspname = 'public'
          and proc.proname = 'archive_gvg_enemy_defense_bank'
          and pg_get_function_arguments(proc.oid) = 'p_portal_guild_id uuid, p_source_gvg_key text, p_technical_guild text, p_defenses jsonb'
      )
      then 'present'
      else 'missing'
    end

  union all

  select
    'canonical_fingerprint_unique_constraint',
    'present',
    case
      when exists (
        select 1
        from pg_constraint
        where conrelid = 'public.gvg_enemy_defenses'::regclass
          and conname = 'gvg_enemy_defenses_fingerprint_unique'
      )
      then 'present'
      else 'missing'
    end

  union all

  select
    'guild_stats_unique_constraint',
    'present',
    case
      when exists (
        select 1
        from pg_constraint
        where conrelid = 'public.gvg_enemy_defense_guild_stats'::regclass
          and conname = 'gvg_enemy_defense_guild_stats_unique'
      )
      then 'present'
      else 'missing'
    end

  union all

  select
    'processed_resets_unique_constraint',
    'present',
    case
      when exists (
        select 1
        from pg_constraint
        where conrelid = 'public.gvg_enemy_defense_processed_resets'::regclass
          and conname = 'gvg_enemy_defense_processed_resets_unique'
      )
      then 'present'
      else 'missing'
    end

  union all

  select
    'rls_enabled_tables',
    '3',
    count(*)::text
  from pg_class cls
  join pg_namespace ns on ns.oid = cls.relnamespace
  where ns.nspname = 'public'
    and cls.relname in (
      'gvg_enemy_defenses',
      'gvg_enemy_defense_guild_stats',
      'gvg_enemy_defense_processed_resets'
    )
    and cls.relrowsecurity is true

  union all

  select
    'service_role_policies',
    '3',
    count(*)::text
  from pg_policies
  where schemaname = 'public'
    and tablename in (
      'gvg_enemy_defenses',
      'gvg_enemy_defense_guild_stats',
      'gvg_enemy_defense_processed_resets'
    )
    and policyname in (
      'gvg_enemy_defenses_service_role_all',
      'gvg_enemy_defense_guild_stats_service_role_all',
      'gvg_enemy_defense_processed_resets_service_role_all'
    )

  union all

  select
    'anon_authenticated_table_grants',
    '0',
    count(*)::text
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name in (
      'gvg_enemy_defenses',
      'gvg_enemy_defense_guild_stats',
      'gvg_enemy_defense_processed_resets'
    )
    and grantee in ('anon', 'authenticated')

  union all

  select
    'invalid_stats_counts',
    '0',
    count(*)::text
  from public.gvg_enemy_defense_guild_stats
  where encounters < 0
     or opened < 0
     or opened > encounters

  union all

  select
    'duplicate_canonical_fingerprints',
    '0',
    count(*)::text
  from (
    select defense_fingerprint
    from public.gvg_enemy_defenses
    group by defense_fingerprint
    having count(*) > 1
  ) duplicates

  union all

  select
    'duplicate_guild_stats',
    '0',
    count(*)::text
  from (
    select portal_guild_id, enemy_defense_id
    from public.gvg_enemy_defense_guild_stats
    group by portal_guild_id, enemy_defense_id
    having count(*) > 1
  ) duplicates

  union all

  select
    'permanent_images_prefix',
    'all populated image paths use enemy-defense-bank/<sha256>.webp',
    count(*) filter (
      where image_storage_path is not null
        and image_storage_path !~ '^enemy-defense-bank/[0-9a-f]{64}\.webp$'
    )::text
  from public.gvg_enemy_defenses

  union all

  select
    'permanent_images_vps_url',
    'all populated image URLs use https://vps-aad12be0.vps.ovh.net/assets/enemy-defense-bank/',
    count(*) filter (
      where image_url is not null
        and image_url !~ '^https://vps-aad12be0\.vps\.ovh\.net/assets/enemy-defense-bank/[0-9a-f]{64}\.webp$'
    )::text
  from public.gvg_enemy_defenses
)
select
  check_name,
  expected_value,
  actual_value,
  case
    when check_name = 'permanent_images_prefix' and actual_value = '0' then 'OK'
    when check_name = 'permanent_images_vps_url' and actual_value = '0' then 'OK'
    when actual_value = expected_value then 'OK'
    else 'ERROR'
  end as status
from checks
order by check_name;
