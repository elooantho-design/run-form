-- Preflight read-only for the conservative guild defense library merge migration.
-- Do not modify data. Run this before scripts/guild_defense_library_merge.sql.

with required_tables(table_name) as (
  values
    ('guild_defenses'),
    ('guild_defense_slots'),
    ('guild_defense_conditions'),
    ('guild_defense_blocks'),
    ('guild_members'),
    ('portal_organizations'),
    ('guild_defense_library_similarity_reviews')
),
table_checks as (
  select
    'table_' || required_tables.table_name as check_name,
    required_tables.table_name as subject,
    'present' as expected_value,
    case when to_regclass('public.' || required_tables.table_name) is null then 'missing' else 'present' end as actual_value
  from required_tables
),
required_columns(table_name, column_name) as (
  values
    ('guild_defenses', 'id'),
    ('guild_defenses', 'name'),
    ('guild_defenses', 'tier'),
    ('guild_defenses', 'type'),
    ('guild_defenses', 'faction'),
    ('guild_defenses', 'guild_code'),
    ('guild_defenses', 'organization_id'),
    ('guild_defenses', 'source_defense_id'),
    ('guild_defenses', 'source_guild_code'),
    ('guild_defenses', 'source_defense_name'),
    ('guild_defenses', 'source_enemy_defense_id'),
    ('guild_defenses', 'source_enemy_defense_fingerprint'),
    ('guild_defenses', 'source_enemy_portal_guild_id'),
    ('guild_defenses', 'source_enemy_label'),
    ('guild_defenses', 'source_enemy_imported_at'),
    ('guild_defenses', 'image_url'),
    ('guild_defenses', 'is_hidden'),
    ('guild_defenses', 'created_at'),
    ('guild_defense_slots', 'defense_id'),
    ('guild_defense_slots', 'champion_id'),
    ('guild_defense_slots', 'slot_index'),
    ('guild_defense_slots', 'position'),
    ('guild_defense_slots', 'direction'),
    ('guild_defense_conditions', 'defense_id'),
    ('guild_defense_conditions', 'champion_id'),
    ('guild_defense_conditions', 'min_awakening'),
    ('guild_defense_blocks', 'defense_id'),
    ('guild_defense_blocks', 'block_type'),
    ('guild_defense_blocks', 'content'),
    ('guild_defense_blocks', 'sort_order'),
    ('guild_members', 'defense_1'),
    ('guild_members', 'defense_2'),
    ('guild_members', 'defense_1_id'),
    ('guild_members', 'defense_2_id'),
    ('guild_defense_library_similarity_reviews', 'id'),
    ('guild_defense_library_similarity_reviews', 'organization_id'),
    ('guild_defense_library_similarity_reviews', 'left_defense_id'),
    ('guild_defense_library_similarity_reviews', 'right_defense_id'),
    ('guild_defense_library_similarity_reviews', 'status'),
    ('guild_defense_library_similarity_reviews', 'similarity_signature')
),
column_checks as (
  select
    'column_' || required_columns.table_name || '_' || required_columns.column_name as check_name,
    required_columns.table_name || '.' || required_columns.column_name as subject,
    'present' as expected_value,
    case when exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = required_columns.table_name
        and column_name = required_columns.column_name
    ) then 'present' else 'missing' end as actual_value
  from required_columns
),
future_column_checks as (
  select
    'future_column_' || column_name as check_name,
    'guild_defenses.' || column_name as subject,
    'will be added if missing' as expected_value,
    case when exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'guild_defenses'
        and column_name = future_columns.column_name
    ) then 'already_present' else 'missing_ok' end as actual_value
  from (values
    ('merged_into_defense_id'),
    ('merged_at'),
    ('merged_by_member_id')
  ) as future_columns(column_name)
),
merge_artifact_checks as (
  select
    'merge_audit_table' as check_name,
    'public.guild_defense_library_merges' as subject,
    'missing before migration or present after retry' as expected_value,
    case when to_regclass('public.guild_defense_library_merges') is null then 'missing_ok' else 'present' end as actual_value
  union all
  select
    'merge_rpc' as check_name,
    'public.merge_guild_defense_library_roots' as subject,
    'missing before migration or present after retry' as expected_value,
    case when to_regprocedure('public.merge_guild_defense_library_roots(uuid, uuid, uuid, uuid, text, jsonb)') is null then 'missing_ok' else 'present' end
),
root_scan as (
  select
    count(*) filter (
      where defense.source_defense_id is null
        and coalesce(defense.is_hidden, false) = false
        and nullif(to_jsonb(defense)->>'merged_into_defense_id', '') is null
    ) as active_native_roots,
    count(*) filter (
      where nullif(to_jsonb(defense)->>'merged_into_defense_id', '') is not null
    ) as already_merged_rows,
    count(*) filter (
      where nullif(to_jsonb(defense)->>'merged_into_defense_id', '') is not null
        and coalesce(defense.is_hidden, false) = false
    ) as visible_merged_rows
  from public.guild_defenses defense
),
review_scan as (
  select
    count(*) filter (where review.status = 'identical') as identical_reviews,
    count(*) filter (
      where left_defense.organization_id is distinct from right_defense.organization_id
         or review.organization_id is distinct from left_defense.organization_id
         or review.organization_id is distinct from right_defense.organization_id
    ) as cross_tenant_review_pairs,
    count(*) filter (
      where left_defense.source_defense_id is not null
         or right_defense.source_defense_id is not null
    ) as non_native_review_pairs,
    count(*) filter (
      where nullif(to_jsonb(left_defense)->>'merged_into_defense_id', '') is not null
         or nullif(to_jsonb(right_defense)->>'merged_into_defense_id', '') is not null
         or coalesce(left_defense.is_hidden, false) = true
         or coalesce(right_defense.is_hidden, false) = true
    ) as inactive_review_pairs
  from public.guild_defense_library_similarity_reviews review
  left join public.guild_defenses left_defense
    on left_defense.id = review.left_defense_id
  left join public.guild_defenses right_defense
    on right_defense.id = review.right_defense_id
),
duplicate_imports as (
  select count(*) as duplicate_active_import_groups
  from (
    select defense.organization_id, defense.guild_code, defense.source_defense_id
    from public.guild_defenses defense
    where defense.source_defense_id is not null
      and coalesce(defense.is_hidden, false) = false
      and nullif(to_jsonb(defense)->>'merged_into_defense_id', '') is null
    group by defense.organization_id, defense.guild_code, defense.source_defense_id
    having count(*) > 1
  ) duplicates
),
diagnostics as (
  select
    'active_native_roots' as check_name,
    'public.guild_defenses' as subject,
    'informational' as expected_value,
    active_native_roots::text as actual_value,
    'INFO' as status
  from root_scan
  union all
  select
    'already_merged_rows',
    'public.guild_defenses',
    'informational',
    already_merged_rows::text,
    'INFO'
  from root_scan
  union all
  select
    'visible_merged_rows',
    'public.guild_defenses',
    '0',
    visible_merged_rows::text,
    case when visible_merged_rows = 0 then 'OK' else 'ERROR' end
  from root_scan
  union all
  select
    'identical_reviews',
    'public.guild_defense_library_similarity_reviews',
    'informational',
    identical_reviews::text,
    'INFO'
  from review_scan
  union all
  select
    'cross_tenant_review_pairs',
    'public.guild_defense_library_similarity_reviews',
    '0',
    cross_tenant_review_pairs::text,
    case when cross_tenant_review_pairs = 0 then 'OK' else 'ERROR' end
  from review_scan
  union all
  select
    'non_native_review_pairs',
    'public.guild_defense_library_similarity_reviews',
    '0',
    non_native_review_pairs::text,
    case when non_native_review_pairs = 0 then 'OK' else 'ERROR' end
  from review_scan
  union all
  select
    'inactive_review_pairs',
    'public.guild_defense_library_similarity_reviews',
    'informational',
    inactive_review_pairs::text,
    'INFO'
  from review_scan
  union all
  select
    'duplicate_active_imports_before_merge',
    'public.guild_defenses',
    '0',
    duplicate_active_import_groups::text,
    case when duplicate_active_import_groups = 0 then 'OK' else 'ERROR' end
  from duplicate_imports
)
select
  check_name,
  subject,
  expected_value,
  actual_value,
  case when expected_value = 'present' and actual_value <> 'present' then 'ERROR' else 'OK' end as status
from table_checks
union all
select
  check_name,
  subject,
  expected_value,
  actual_value,
  case when expected_value = 'present' and actual_value <> 'present' then 'ERROR' else 'OK' end
from column_checks
union all
select
  check_name,
  subject,
  expected_value,
  actual_value,
  'OK'
from future_column_checks
union all
select
  check_name,
  subject,
  expected_value,
  actual_value,
  'OK'
from merge_artifact_checks
union all
select check_name, subject, expected_value, actual_value, status
from diagnostics
order by check_name;
