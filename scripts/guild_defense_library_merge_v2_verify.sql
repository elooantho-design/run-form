with rpc_source as (
  select pg_get_functiondef('public.merge_guild_defense_library_roots(uuid, uuid, uuid, uuid, text, jsonb)'::regprocedure) as body
),
checks as (
  select
    'rpc_merge_guild_defense_library_roots' as check_name,
    'present' as expected_value,
    case when to_regprocedure('public.merge_guild_defense_library_roots(uuid, uuid, uuid, uuid, text, jsonb)') is null then 'missing' else 'present' end as actual_value

  union all

  select
    'rpc_v2_preserves_absorbed_root_as_local_copy',
    'present',
    case when exists (
      select 1
      from rpc_source
      where body like '%absorbed_root_preserved_as_local_copy%'
        and body like '%source_defense_id = v_canonical.id%'
    ) then 'present' else 'missing' end

  union all

  select
    'rpc_v2_skips_root_repoint_when_local_copy_preserved',
    'present',
    case when exists (
      select 1
      from rpc_source
      where body like '%absorbed_root_preserved_as_local_copy%'
        and body like '%reason%'
        and body like '%local_defense_id%'
    ) then 'present' else 'missing' end

  union all

  select
    'active_absorbed_rows_still_native_after_merge',
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
    'active_absorbed_rows_with_wrong_source_after_merge',
    '0',
    count(*)::text
  from public.guild_defense_library_merges merge_row
  join public.guild_defenses absorbed
    on absorbed.id = merge_row.absorbed_defense_id
  where coalesce(absorbed.is_hidden, false) = false
    and absorbed.merged_into_defense_id is null
    and absorbed.source_defense_id is distinct from merge_row.canonical_defense_id

  union all

  select
    'converted_absorbed_rows_marked_hidden_or_merged',
    '0',
    count(*)::text
  from public.guild_defense_library_merges merge_row
  join public.guild_defenses absorbed
    on absorbed.id = merge_row.absorbed_defense_id
  where absorbed.source_defense_id = merge_row.canonical_defense_id
    and (coalesce(absorbed.is_hidden, false) = true or absorbed.merged_into_defense_id is not null)

  union all

  select
    'duplicate_active_imports_after_merge',
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
    'cross_tenant_merge_rows',
    '0',
    count(*)::text
  from public.guild_defense_library_merges merge_row
  join public.guild_defenses canonical
    on canonical.id = merge_row.canonical_defense_id
  join public.guild_defenses absorbed
    on absorbed.id = merge_row.absorbed_defense_id
  where canonical.organization_id is distinct from merge_row.organization_id
     or absorbed.organization_id is distinct from merge_row.organization_id
     or canonical.organization_id is distinct from absorbed.organization_id
)
select
  check_name,
  expected_value,
  actual_value,
  case when actual_value = expected_value then 'OK' else 'ERROR' end as status
from checks
order by check_name;
