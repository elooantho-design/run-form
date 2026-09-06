-- Preflight read-only pour la correction V3 des signatures de fusion Bibliotheque.
-- Ne modifie aucune donnee. A executer avant scripts/guild_defense_library_merge_v3.sql.

with checks as (
  select
    'table_guild_defenses' as check_name,
    'present' as expected_value,
    case when to_regclass('public.guild_defenses') is null then 'missing' else 'present' end as actual_value

  union all

  select
    'table_guild_defense_slots',
    'present',
    case when to_regclass('public.guild_defense_slots') is null then 'missing' else 'present' end

  union all

  select
    'table_champions',
    'present',
    case when to_regclass('public.champions') is null then 'missing' else 'present' end

  union all

  select
    'table_similarity_reviews',
    'present',
    case when to_regclass('public.guild_defense_library_similarity_reviews') is null then 'missing' else 'present' end

  union all

  select
    'rpc_merge_guild_defense_library_roots',
    'present',
    case when to_regprocedure('public.merge_guild_defense_library_roots(uuid, uuid, uuid, uuid, text, jsonb)') is null then 'missing' else 'present' end

  union all

  select
    'helper_similarity_signature',
    'present',
    case when to_regprocedure('public.guild_defense_library_similarity_signature(uuid)') is null then 'missing' else 'present' end

  union all

  select
    'helper_identity_signature',
    'present',
    case when to_regprocedure('public.guild_defense_library_identity_signature(uuid)') is null then 'missing' else 'present' end

  union all

  select
    'helper_layouts_compatible',
    'present',
    case when to_regprocedure('public.guild_defense_library_layouts_compatible(uuid, uuid)') is null then 'missing' else 'present' end

  union all

  select
    'pgcrypto_digest',
    'present',
    case
      when exists (
        select 1
        from pg_proc proc
        join pg_namespace namespace
          on namespace.oid = proc.pronamespace
        where proc.proname = 'digest'
          and namespace.nspname in ('public', 'extensions')
          and oidvectortypes(proc.proargtypes) = 'bytea, text'
      ) then 'present'
      else 'missing'
    end

  union all

  select
    'column_champions_name',
    'present',
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'champions' and column_name = 'name'
    ) then 'present' else 'missing' end

  union all

  select
    'column_champions_portal_name',
    'present',
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'champions' and column_name = 'portal_name'
    ) then 'present' else 'missing' end

  union all

  select
    'column_champions_english_name',
    'present',
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'champions' and column_name = 'english_name'
    ) then 'present' else 'missing' end

  union all

  select
    'column_slots_position',
    'present',
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'guild_defense_slots' and column_name = 'position'
    ) then 'present' else 'missing' end

  union all

  select
    'column_slots_direction',
    'present',
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'guild_defense_slots' and column_name = 'direction'
    ) then 'present' else 'missing' end

  union all

  select
    'review_similarity_signatures_are_sha256',
    '0',
    count(*)::text
  from public.guild_defense_library_similarity_reviews review
  where review.similarity_signature !~ '^[0-9a-f]{64}$'

  union all

  select
    'review_identity_signatures_are_sha256',
    '0',
    count(*)::text
  from public.guild_defense_library_similarity_reviews review
  where review.left_identity_signature !~ '^[0-9a-f]{64}$'
     or review.right_identity_signature !~ '^[0-9a-f]{64}$'
)
select
  check_name,
  expected_value,
  actual_value,
  case when actual_value = expected_value then 'OK' else 'ERROR' end as status
from checks
order by check_name;
