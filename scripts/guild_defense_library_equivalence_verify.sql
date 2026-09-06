with checks as (
  select
    'table_library_similarity_reviews' as check_name,
    'present' as expected_value,
    case when to_regclass('public.guild_defense_library_similarity_reviews') is null then 'missing' else 'present' end as actual_value

  union all

  select
    'constraint_unique_pair',
    'present',
    case when exists (
      select 1
      from pg_constraint
      where conrelid = to_regclass('public.guild_defense_library_similarity_reviews')
        and conname = 'guild_defense_library_similarity_reviews_unique_pair'
    ) then 'present' else 'missing' end

  union all

  select
    'constraint_ordered_pair',
    'present',
    case when exists (
      select 1
      from pg_constraint
      where conrelid = to_regclass('public.guild_defense_library_similarity_reviews')
        and conname = 'guild_defense_library_similarity_reviews_ordered_pair_check'
    ) then 'present' else 'missing' end

  union all

  select
    'constraint_status_check',
    'pending_identical_different',
    case when exists (
      select 1
      from pg_constraint
      where conrelid = to_regclass('public.guild_defense_library_similarity_reviews')
        and conname = 'guild_defense_library_similarity_reviews_status_check'
    ) then 'pending_identical_different' else 'missing' end

  union all

  select
    'rls_enabled',
    'true',
    coalesce((
      select relrowsecurity::text
      from pg_class
      where oid = to_regclass('public.guild_defense_library_similarity_reviews')
    ), 'missing')

  union all

  select
    'service_role_policy',
    'present',
    case when exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'guild_defense_library_similarity_reviews'
        and policyname = 'guild_defense_library_similarity_reviews_service_role_all'
    ) then 'present' else 'missing' end

  union all

  select
    'index_org_status',
    'present',
    case when exists (
      select 1
      from pg_indexes
      where schemaname = 'public'
        and indexname = 'guild_defense_library_similarity_reviews_org_status_idx'
    ) then 'present' else 'missing' end

  union all

  select
    'index_signature',
    'present',
    case when exists (
      select 1
      from pg_indexes
      where schemaname = 'public'
        and indexname = 'guild_defense_library_similarity_reviews_signature_idx'
    ) then 'present' else 'missing' end

  union all

  select
    'invalid_same_defense_pairs',
    '0',
    coalesce((
      select count(*)::text
      from public.guild_defense_library_similarity_reviews
      where left_defense_id = right_defense_id
    ), '0')

  union all

  select
    'invalid_reversed_pairs',
    '0',
    coalesce((
      select count(*)::text
      from public.guild_defense_library_similarity_reviews
      where left_defense_id::text >= right_defense_id::text
    ), '0')

  union all

  select
    'cross_tenant_review_pairs',
    '0',
    coalesce((
      select count(*)::text
      from public.guild_defense_library_similarity_reviews review
      left join public.guild_defenses left_defense on left_defense.id = review.left_defense_id
      left join public.guild_defenses right_defense on right_defense.id = review.right_defense_id
      where left_defense.organization_id is distinct from review.organization_id
         or right_defense.organization_id is distinct from review.organization_id
    ), '0')

  union all

  select
    'non_native_review_pairs',
    '0',
    coalesce((
      select count(*)::text
      from public.guild_defense_library_similarity_reviews review
      left join public.guild_defenses left_defense on left_defense.id = review.left_defense_id
      left join public.guild_defenses right_defense on right_defense.id = review.right_defense_id
      where left_defense.source_defense_id is not null
         or right_defense.source_defense_id is not null
    ), '0')
)
select
  check_name,
  expected_value,
  actual_value,
  case when expected_value = actual_value then 'OK' else 'ERROR' end as status
from checks
order by check_name;
