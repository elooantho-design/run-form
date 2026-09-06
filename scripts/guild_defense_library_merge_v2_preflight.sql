-- Preflight read-only pour la correction V2 de fusion Bibliotheque.
-- Ne modifie aucune donnee.

with checks as (
  select
    'table_guild_defenses' as check_name,
    'present' as expected_value,
    case when to_regclass('public.guild_defenses') is null then 'missing' else 'present' end as actual_value

  union all

  select
    'table_guild_defense_library_merges',
    'present',
    case when to_regclass('public.guild_defense_library_merges') is null then 'missing' else 'present' end

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
    'helper_apply_conservative_merge',
    'present',
    case when to_regprocedure('public.guild_defense_library_apply_conservative_merge(uuid, uuid)') is null then 'missing' else 'present' end

  union all

  select
    'helper_repoint_references',
    'present',
    case when to_regprocedure('public.guild_defense_library_repoint_references(uuid, uuid)') is null then 'missing' else 'present' end

  union all

  select
    'duplicate_active_imports_before_v2',
    '0',
    count(*)::text
  from (
    select defense.organization_id, defense.guild_code, defense.source_defense_id
    from public.guild_defenses defense
    where defense.source_defense_id is not null
      and coalesce(defense.is_hidden, false) = false
      and defense.merged_into_defense_id is null
    group by defense.organization_id, defense.guild_code, defense.source_defense_id
    having count(*) > 1
  ) duplicate_imports

  union all

  select
    'active_absorbed_rows_still_native_before_v2',
    '0',
    count(*)::text
  from public.guild_defense_library_merges merge_row
  join public.guild_defenses absorbed
    on absorbed.id = merge_row.absorbed_defense_id
  where coalesce(absorbed.is_hidden, false) = false
    and absorbed.merged_into_defense_id is null
    and absorbed.source_defense_id is null

  union all

  select
    'cross_guild_identical_pairs_requiring_root_local_preservation',
    'diagnostic',
    count(*)::text
  from public.guild_defense_library_similarity_reviews review
  join public.guild_defenses left_defense
    on left_defense.id = review.left_defense_id
  join public.guild_defenses right_defense
    on right_defense.id = review.right_defense_id
  where review.status = 'identical'
    and left_defense.source_defense_id is null
    and right_defense.source_defense_id is null
    and coalesce(left_defense.is_hidden, false) = false
    and coalesce(right_defense.is_hidden, false) = false
    and left_defense.merged_into_defense_id is null
    and right_defense.merged_into_defense_id is null
    and left_defense.organization_id = right_defense.organization_id
    and left_defense.guild_code is distinct from right_defense.guild_code
)
select
  check_name,
  expected_value,
  actual_value,
  case
    when expected_value = 'diagnostic' then 'INFO'
    when actual_value = expected_value then 'OK'
    else 'ERROR'
  end as status
from checks
order by check_name;
