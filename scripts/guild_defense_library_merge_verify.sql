-- Verify the conservative guild defense library merge migration.
-- Run after scripts/guild_defense_library_merge.sql.

with checks as (
  select
    'guild_defense_library_merge_columns' as check_name,
    '3' as expected_value,
    count(*)::text as actual_value
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'guild_defenses'
    and column_name in ('merged_into_defense_id', 'merged_at', 'merged_by_member_id')

  union all

  select
    'guild_defense_library_merge_fk_merged_into',
    'present',
    case when exists (
      select 1
      from pg_constraint constraint_row
      join pg_attribute attribute_row
        on attribute_row.attrelid = constraint_row.conrelid
       and attribute_row.attnum = any(constraint_row.conkey)
      where constraint_row.conrelid = 'public.guild_defenses'::regclass
        and constraint_row.confrelid = 'public.guild_defenses'::regclass
        and constraint_row.contype = 'f'
        and attribute_row.attname = 'merged_into_defense_id'
    ) then 'present' else 'missing' end

  union all

  select
    'guild_defenses_merged_not_self_check',
    'present',
    case when exists (
      select 1
      from pg_constraint
      where conrelid = 'public.guild_defenses'::regclass
        and conname = 'guild_defenses_merged_not_self_check'
    ) then 'present' else 'missing' end

  union all

  select
    'guild_defenses_merged_at_check',
    'present',
    case when exists (
      select 1
      from pg_constraint
      where conrelid = 'public.guild_defenses'::regclass
        and conname = 'guild_defenses_merged_at_check'
    ) then 'present' else 'missing' end

  union all

  select
    'table_guild_defense_library_merges',
    'present',
    case when to_regclass('public.guild_defense_library_merges') is null then 'missing' else 'present' end

  union all

  select
    'guild_defense_library_merges_unique_absorbed',
    'present',
    case when exists (
      select 1
      from pg_constraint
      where conrelid = 'public.guild_defense_library_merges'::regclass
        and conname = 'guild_defense_library_merges_absorbed_unique'
    ) then 'present' else 'missing' end

  union all

  select
    'guild_defense_library_merges_distinct_check',
    'present',
    case when exists (
      select 1
      from pg_constraint
      where conrelid = 'public.guild_defense_library_merges'::regclass
        and conname = 'guild_defense_library_merges_distinct_check'
    ) then 'present' else 'missing' end

  union all

  select
    'guild_defense_library_merges_validate_trigger',
    'present',
    case when exists (
      select 1
      from pg_trigger
      where tgrelid = 'public.guild_defense_library_merges'::regclass
        and tgname = 'guild_defense_library_merges_validate_before_write'
        and not tgisinternal
    ) then 'present' else 'missing' end

  union all

  select
    'index_guild_defenses_merged_into',
    'present',
    case when exists (
      select 1
      from pg_indexes
      where schemaname = 'public'
        and indexname = 'guild_defenses_merged_into_idx'
    ) then 'present' else 'missing' end

  union all

  select
    'index_active_unmerged_roots',
    'present',
    case when exists (
      select 1
      from pg_indexes
      where schemaname = 'public'
        and indexname = 'guild_defenses_org_active_unmerged_roots_idx'
    ) then 'present' else 'missing' end

  union all

  select
    'index_unique_active_import_excludes_merged',
    'merged_into_defense_id is null',
    case when exists (
      select 1
      from pg_indexes
      where schemaname = 'public'
        and indexname = 'guild_defenses_unique_active_import_idx'
        and indexdef ilike '%merged_into_defense_id is null%'
    ) then 'merged_into_defense_id is null' else 'missing' end

  union all

  select
    'rls_merge_table',
    'enabled',
    case when exists (
      select 1
      from pg_class
      where oid = 'public.guild_defense_library_merges'::regclass
        and relrowsecurity = true
    ) then 'enabled' else 'disabled' end

  union all

  select
    'service_role_policy_merge_table',
    'present',
    case when exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'guild_defense_library_merges'
        and policyname = 'guild_defense_library_merges_service_role_all'
    ) then 'present' else 'missing' end

  union all

  select
    'rpc_merge_guild_defense_library_roots',
    'present',
    case when to_regprocedure('public.merge_guild_defense_library_roots(uuid, uuid, uuid, uuid, text, jsonb)') is null then 'missing' else 'present' end

  union all

  select
    'helper_merge_score',
    'present',
    case when to_regprocedure('public.guild_defense_library_merge_score(uuid)') is null then 'missing' else 'present' end

  union all

  select
    'helper_apply_conservative_merge',
    'present',
    case when to_regprocedure('public.guild_defense_library_apply_conservative_merge(uuid, uuid)') is null then 'missing' else 'present' end

  union all

  select
    'absorbed_roots_still_visible',
    '0',
    count(*)::text
  from public.guild_defenses
  where merged_into_defense_id is not null
    and coalesce(is_hidden, false) = false

  union all

  select
    'merged_rows_without_timestamp',
    '0',
    count(*)::text
  from public.guild_defenses
  where merged_into_defense_id is not null
    and merged_at is null

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

  union all

  select
    'invalid_self_merge_rows',
    '0',
    count(*)::text
  from public.guild_defense_library_merges
  where canonical_defense_id = absorbed_defense_id

  union all

  select
    'absorbed_root_duplicate_audits',
    '0',
    count(*)::text
  from (
    select absorbed_defense_id
    from public.guild_defense_library_merges
    group by absorbed_defense_id
    having count(*) > 1
  ) duplicate_audits

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
)
select
  check_name,
  expected_value,
  actual_value,
  case when actual_value = expected_value then 'OK' else 'ERROR' end as status
from checks
order by check_name;
