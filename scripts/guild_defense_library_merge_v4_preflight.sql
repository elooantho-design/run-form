-- Preflight read-only pour la correction V4 des types SQL de fusion Bibliotheque.
-- Ne modifie aucune donnee. A executer avant scripts/guild_defense_library_merge_v4.sql.

with expected_column_types(table_name, column_name, expected_type) as (
  values
    ('guild_defense_conditions', 'champion_id', 'bigint'),
    ('guild_defense_conditions', 'min_awakening', 'integer'),
    ('guild_defense_slots', 'champion_id', 'bigint'),
    ('guild_defense_slots', 'slot_index', 'integer'),
    ('guild_defenses', 'id', 'uuid'),
    ('guild_defenses', 'organization_id', 'uuid'),
    ('guild_defenses', 'source_defense_id', 'uuid'),
    ('guild_defenses', 'merged_into_defense_id', 'uuid'),
    ('guild_members', 'id', 'uuid'),
    ('guild_members', 'defense_1_id', 'uuid'),
    ('guild_members', 'defense_2_id', 'uuid'),
    ('guild_defense_library_similarity_reviews', 'id', 'uuid'),
    ('guild_defense_library_similarity_reviews', 'organization_id', 'uuid'),
    ('guild_defense_library_similarity_reviews', 'left_defense_id', 'uuid'),
    ('guild_defense_library_similarity_reviews', 'right_defense_id', 'uuid'),
    ('guild_defense_library_merges', 'review_id', 'uuid'),
    ('guild_defense_library_merges', 'organization_id', 'uuid'),
    ('guild_defense_library_merges', 'canonical_defense_id', 'uuid'),
    ('guild_defense_library_merges', 'absorbed_defense_id', 'uuid'),
    ('guild_defense_library_merges', 'merged_by_member_id', 'uuid')
),
column_type_checks as (
  select
    'column_' || expected.table_name || '_' || expected.column_name as check_name,
    expected.expected_type as expected_value,
    coalesce(format_type(attribute.atttypid, attribute.atttypmod), 'missing') as actual_value
  from expected_column_types expected
  left join pg_namespace namespace
    on namespace.nspname = 'public'
  left join pg_class relation
    on relation.relnamespace = namespace.oid
   and relation.relname = expected.table_name
  left join pg_attribute attribute
    on attribute.attrelid = relation.oid
   and attribute.attname = expected.column_name
   and attribute.attnum > 0
   and not attribute.attisdropped
),
function_signatures as (
  select
    proc.proname as function_name,
    oidvectortypes(proc.proargtypes) as arguments
  from pg_proc proc
  join pg_namespace namespace
    on namespace.oid = proc.pronamespace
  where namespace.nspname = 'public'
    and proc.proname in (
      'guild_defense_library_condition_key',
      'guild_defense_library_similarity_signature',
      'guild_defense_library_review_signature',
      'guild_defense_library_identity_signature',
      'guild_defense_library_layouts_compatible',
      'guild_defense_library_enemy_links_compatible',
      'guild_defense_library_merge_score',
      'guild_defense_library_preferred_defense',
      'guild_defense_library_repoint_references',
      'guild_defense_library_apply_conservative_merge',
      'merge_guild_defense_library_roots'
    )
),
helper_type_checks as (
  select
    'helper_condition_key_signature' as check_name,
    'bigint, integer' as expected_value,
    coalesce((
      select string_agg(arguments, ' | ' order by arguments)
      from function_signatures
      where function_name = 'guild_defense_library_condition_key'
    ), 'missing') as actual_value

  union all

  select
    'helper_similarity_signature_signature',
    'uuid',
    coalesce((
      select string_agg(arguments, ' | ' order by arguments)
      from function_signatures
      where function_name = 'guild_defense_library_similarity_signature'
    ), 'missing')

  union all

  select
    'helper_review_signature_signature',
    'uuid',
    coalesce((
      select string_agg(arguments, ' | ' order by arguments)
      from function_signatures
      where function_name = 'guild_defense_library_review_signature'
    ), 'missing')

  union all

  select
    'helper_identity_signature_signature',
    'uuid',
    coalesce((
      select string_agg(arguments, ' | ' order by arguments)
      from function_signatures
      where function_name = 'guild_defense_library_identity_signature'
    ), 'missing')

  union all

  select
    'helper_layouts_compatible_signature',
    'uuid, uuid',
    coalesce((
      select string_agg(arguments, ' | ' order by arguments)
      from function_signatures
      where function_name = 'guild_defense_library_layouts_compatible'
    ), 'missing')

  union all

  select
    'helper_enemy_links_compatible_signature',
    'uuid, uuid',
    coalesce((
      select string_agg(arguments, ' | ' order by arguments)
      from function_signatures
      where function_name = 'guild_defense_library_enemy_links_compatible'
    ), 'missing')

  union all

  select
    'helper_merge_score_signature',
    'uuid',
    coalesce((
      select string_agg(arguments, ' | ' order by arguments)
      from function_signatures
      where function_name = 'guild_defense_library_merge_score'
    ), 'missing')

  union all

  select
    'helper_preferred_defense_signature',
    'uuid, uuid',
    coalesce((
      select string_agg(arguments, ' | ' order by arguments)
      from function_signatures
      where function_name = 'guild_defense_library_preferred_defense'
    ), 'missing')

  union all

  select
    'helper_repoint_references_signature',
    'uuid, uuid',
    coalesce((
      select string_agg(arguments, ' | ' order by arguments)
      from function_signatures
      where function_name = 'guild_defense_library_repoint_references'
    ), 'missing')

  union all

  select
    'helper_apply_conservative_merge_signature',
    'uuid, uuid',
    coalesce((
      select string_agg(arguments, ' | ' order by arguments)
      from function_signatures
      where function_name = 'guild_defense_library_apply_conservative_merge'
    ), 'missing')

  union all

  select
    'rpc_merge_roots_signature',
    'uuid, uuid, uuid, uuid, text, jsonb',
    coalesce((
      select string_agg(arguments, ' | ' order by arguments)
      from function_signatures
      where function_name = 'merge_guild_defense_library_roots'
    ), 'missing')
),
data_samples as (
  select
    count(*) filter (
      where exists (
        select 1
        from public.guild_defense_conditions condition_row
        where condition_row.defense_id = defense.id
      )
    ) as defenses_with_conditions,
    count(*) filter (
      where (
        select count(*)
        from public.guild_defense_conditions condition_row
        where condition_row.defense_id = defense.id
      ) >= 2
    ) as defenses_with_multiple_conditions,
    count(*) filter (
      where not exists (
        select 1
        from public.guild_defense_conditions condition_row
        where condition_row.defense_id = defense.id
      )
    ) as defenses_without_conditions,
    count(*) as total_defenses
  from public.guild_defenses defense
),
sample_checks as (
  select
    'sample_defenses_with_conditions' as check_name,
    'informational' as expected_value,
    defenses_with_conditions::text as actual_value,
    'INFO' as status
  from data_samples

  union all

  select
    'sample_defenses_with_multiple_conditions',
    'informational',
    defenses_with_multiple_conditions::text,
    'INFO'
  from data_samples

  union all

  select
    'sample_defenses_without_conditions',
    'informational',
    defenses_without_conditions::text,
    'INFO'
  from data_samples
),
all_type_checks as (
  select check_name, expected_value, actual_value
  from column_type_checks

  union all

  select check_name, expected_value, actual_value
  from helper_type_checks
)
select
  check_name,
  expected_value,
  actual_value,
  case
    when actual_value = expected_value then 'OK'
    when check_name = 'helper_condition_key_signature' and actual_value = 'uuid, integer' then 'INFO'
    else 'ERROR'
  end as status
from all_type_checks

union all

select
  check_name,
  expected_value,
  actual_value,
  status
from sample_checks

order by check_name;
