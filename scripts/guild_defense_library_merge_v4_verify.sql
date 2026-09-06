-- Verify V4 de la fusion Bibliotheque.
-- Retourne un tableau consolide check_name / expected_value / actual_value / status.

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
function_body_checks as (
  select
    pg_get_functiondef('public.merge_guild_defense_library_roots(uuid, uuid, uuid, uuid, text, jsonb)'::regprocedure) as merge_roots_body,
    pg_get_functiondef('public.guild_defense_library_merge_score(uuid)'::regprocedure) as merge_score_body
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
    'helper_condition_key_old_uuid_signature_removed',
    'missing',
    case when to_regprocedure('public.guild_defense_library_condition_key(uuid, integer)') is null then 'missing' else 'present' end

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
source_checks as (
  select
    'merge_score_uses_condition_key' as check_name,
    'present' as expected_value,
    case when exists (
      select 1
      from function_body_checks
      where merge_score_body like '%guild_defense_library_condition_key(condition_row.champion_id, condition_row.min_awakening)%'
    ) then 'present' else 'missing' end as actual_value

  union all

  select
    'merge_score_counts_distinct_condition_keys',
    'present',
    case when exists (
      select 1
      from function_body_checks
      where merge_score_body like '%count(distinct public.guild_defense_library_condition_key(condition_row.champion_id, condition_row.min_awakening))%'
    ) then 'present' else 'missing' end

  union all

  select
    'rpc_uses_preferred_defense_score',
    'present',
    case when exists (
      select 1
      from function_body_checks
      where merge_roots_body like '%guild_defense_library_preferred_defense%'
        and merge_roots_body like '%guild_defense_library_merge_score%'
    ) then 'present' else 'missing' end

  union all

  select
    'rpc_v2_preserves_absorbed_root_as_local_copy',
    'present',
    case when exists (
      select 1
      from function_body_checks
      where merge_roots_body like '%absorbed_root_preserved_as_local_copy%'
        and merge_roots_body like '%source_defense_id = v_canonical.id%'
    ) then 'present' else 'missing' end

  union all

  select
    'rpc_v2_skips_root_repoint_when_local_copy_preserved',
    'present',
    case when exists (
      select 1
      from function_body_checks
      where merge_roots_body like '%absorbed_root_preserved_as_local_copy%'
        and merge_roots_body like '%reason%'
        and merge_roots_body like '%local_defense_id%'
    ) then 'present' else 'missing' end
),
condition_sample as (
  select
    condition_row.champion_id,
    condition_row.min_awakening,
    public.guild_defense_library_condition_key(condition_row.champion_id, condition_row.min_awakening) as generated_key
  from public.guild_defense_conditions condition_row
  where condition_row.champion_id is not null
  order by condition_row.defense_id, condition_row.champion_id, condition_row.min_awakening
  limit 1
),
zero_condition_score_sample as (
  select
    defense.id,
    public.guild_defense_library_merge_score(defense.id) as score
  from public.guild_defenses defense
  where not exists (
    select 1
    from public.guild_defense_conditions condition_row
    where condition_row.defense_id = defense.id
  )
  order by defense.created_at nulls last, defense.id
  limit 1
),
multi_condition_score_sample as (
  select
    defense.id,
    public.guild_defense_library_merge_score(defense.id) as score
  from public.guild_defenses defense
  where (
    select count(*)
    from public.guild_defense_conditions condition_row
    where condition_row.defense_id = defense.id
  ) >= 2
  order by defense.created_at nulls last, defense.id
  limit 1
),
identical_review_score_sample as (
  select
    review.id as review_id,
    public.guild_defense_library_merge_score(review.left_defense_id) as left_score,
    public.guild_defense_library_merge_score(review.right_defense_id) as right_score,
    public.guild_defense_library_preferred_defense(review.left_defense_id, review.right_defense_id) as preferred_defense_id
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
  order by review.updated_at desc nulls last, review.created_at desc nulls last, review.id
  limit 1
),
real_case_score_sample as (
  select
    review.id as review_id,
    left_defense.name as left_name,
    right_defense.name as right_name,
    public.guild_defense_library_merge_score(review.left_defense_id) as left_score,
    public.guild_defense_library_merge_score(review.right_defense_id) as right_score,
    public.guild_defense_library_preferred_defense(review.left_defense_id, review.right_defense_id) as preferred_defense_id
  from public.guild_defense_library_similarity_reviews review
  join public.guild_defenses left_defense
    on left_defense.id = review.left_defense_id
  join public.guild_defenses right_defense
    on right_defense.id = review.right_defense_id
  where review.status = 'identical'
    and (
      (
        left_defense.name ilike '%Forto Arbitre Dassomi%'
        and right_defense.name ilike '%Arbitre%'
      )
      or
      (
        right_defense.name ilike '%Forto Arbitre Dassomi%'
        and left_defense.name ilike '%Arbitre%'
      )
    )
  order by review.updated_at desc nulls last, review.created_at desc nulls last, review.id
  limit 1
),
deterministic_smoke_checks as (
  select
    'condition_key_bigint_literal_call' as check_name,
    '1234567890123:a5' as expected_value,
    public.guild_defense_library_condition_key(1234567890123::bigint, 5)::text as actual_value
),
live_sample_checks as (
  select
    'condition_key_bigint_with_real_condition' as check_name,
    'informational' as expected_value,
    coalesce((
      select 'key=' || generated_key
      from condition_sample
    ), 'missing_sample') as actual_value,
    'INFO' as status

  union all

  select
    'merge_score_zero_condition_sample',
    'informational',
    coalesce((
      select 'score=' || score::text
      from zero_condition_score_sample
    ), 'missing_sample'),
    'INFO'

  union all

  select
    'merge_score_multi_condition_sample',
    'informational',
    coalesce((
      select 'score=' || score::text
      from multi_condition_score_sample
    ), 'missing_sample'),
    'INFO'

  union all

  select
    'identical_review_merge_score_sample',
    'informational',
    coalesce((
      select 'review=' || review_id::text || ';left=' || left_score::text || ';right=' || right_score::text || ';preferred=' || preferred_defense_id::text
      from identical_review_score_sample
    ), 'missing_sample'),
    'INFO'

  union all

  select
    'real_case_forto_arbitre_dassomi_arbitre_score_type_safe',
    'informational',
    coalesce((
      select 'review=' || review_id::text || ';left=' || left_score::text || ';right=' || right_score::text || ';preferred=' || preferred_defense_id::text
      from real_case_score_sample
    ), 'missing_sample'),
    'INFO'
),
v2_v3_invariant_checks as (
  select
    'active_absorbed_rows_still_native_after_merge' as check_name,
    '0' as expected_value,
    count(*)::text as actual_value
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

  union all

  select
    'identical_reviews_similarity_mismatch',
    '0',
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
    and (
      public.guild_defense_library_similarity_signature(left_defense.id) is distinct from review.similarity_signature
      or public.guild_defense_library_similarity_signature(right_defense.id) is distinct from review.similarity_signature
    )

  union all

  select
    'identical_reviews_identity_mismatch',
    '0',
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
    and (
      public.guild_defense_library_identity_signature(left_defense.id) is distinct from review.left_identity_signature
      or public.guild_defense_library_identity_signature(right_defense.id) is distinct from review.right_identity_signature
    )
),
strict_checks as (
  select check_name, expected_value, actual_value
  from column_type_checks

  union all

  select check_name, expected_value, actual_value
  from helper_type_checks

  union all

  select check_name, expected_value, actual_value
  from source_checks

  union all

  select check_name, expected_value, actual_value
  from deterministic_smoke_checks

  union all

  select check_name, expected_value, actual_value
  from v2_v3_invariant_checks
)
select
  check_name,
  expected_value,
  actual_value,
  case
    when actual_value = expected_value then 'OK'
    else 'ERROR'
  end as status
from strict_checks

union all

select
  check_name,
  expected_value,
  actual_value,
  status
from live_sample_checks
order by check_name;
