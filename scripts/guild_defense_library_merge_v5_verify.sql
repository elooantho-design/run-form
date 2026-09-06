-- Verify V5 de la fusion Bibliotheque.
-- Read-only: inspecte la RPC, l'index unique et les invariants de merge.

with rpc_definition as (
  select pg_get_functiondef('public.merge_guild_defense_library_roots(uuid, uuid, uuid, uuid, text, jsonb)'::regprocedure) as body
),
rpc_source as (
  select
    body,
    lower(regexp_replace(body, '[[:space:]]+', ' ', 'g')) as normalized_body
  from rpc_definition
),
rpc_markers as (
  select
    body,
    normalized_body,
    strpos(
      normalized_body,
      'v_keep_child_id := public.guild_defense_library_preferred_defense( v_existing_absorbed_guild_copy.id, v_absorbed.id );'
    ) as root_collision_start,
    strpos(
      normalized_body,
      'v_keep_child_id := public.guild_defense_library_preferred_defense( v_existing_child.id, v_child.id );'
    ) as child_collision_start
  from rpc_source
),
rpc_sections as (
  select
    body,
    normalized_body,
    root_collision_start,
    coalesce(
      root_collision_start
        + nullif(strpos(substring(normalized_body from root_collision_start), 'for v_child in'), 0)
        - 1,
      0
    ) as root_collision_end,
    child_collision_start,
    coalesce(
      child_collision_start
        + nullif(strpos(substring(normalized_body from child_collision_start), 'if not v_absorbed_root_handled then'), 0)
        - 1,
      0
    ) as child_collision_end
  from rpc_markers
),
rpc_collision_sections as (
  select
    body,
    case
      when root_collision_start > 0 and root_collision_end > root_collision_start
        then substring(normalized_body from root_collision_start for root_collision_end - root_collision_start)
      else ''
    end as root_collision_body,
    case
      when child_collision_start > 0 and child_collision_end > child_collision_start
        then substring(normalized_body from child_collision_start for child_collision_end - child_collision_start)
      else ''
    end as child_collision_body
  from rpc_sections
),
checks as (
  select
    'rpc_merge_guild_defense_library_roots' as check_name,
    'present' as expected_value,
    case when to_regprocedure('public.merge_guild_defense_library_roots(uuid, uuid, uuid, uuid, text, jsonb)') is null then 'missing' else 'present' end as actual_value

  union all

  select
    'rpc_comment_mentions_v5',
    'present',
    case when exists (
      select 1
      from pg_description description
      join pg_proc proc
        on proc.oid = description.objoid
      join pg_namespace namespace
        on namespace.oid = proc.pronamespace
      where namespace.nspname = 'public'
        and proc.proname = 'merge_guild_defense_library_roots'
        and description.description ilike '%V5%'
        and description.description ilike '%guild_defenses_unique_active_import_idx%'
    ) then 'present' else 'missing' end

  union all

  select
    'unique_active_import_index_preserved',
    'present',
    case when exists (
      select 1
      from pg_indexes
      where schemaname = 'public'
        and indexname = 'guild_defenses_unique_active_import_idx'
        and indexdef ilike '%unique%'
        and indexdef ilike '%source_defense_id%'
        and indexdef ilike '%is_hidden%'
    ) then 'present' else 'missing' end

  union all

  select
    'root_collision_repoints_before_hide',
    'present',
    case when exists (
      select 1
      from rpc_collision_sections
      where strpos(root_collision_body, 'guild_defense_library_repoint_references') > 0
        and strpos(root_collision_body, 'is_hidden = true') > strpos(root_collision_body, 'guild_defense_library_repoint_references')
    ) then 'present' else 'missing' end

  union all

  select
    'root_collision_hides_loser_before_keeper_import',
    'present',
    case when exists (
      select 1
      from rpc_collision_sections
      where strpos(root_collision_body, 'is_hidden = true') > 0
        and strpos(root_collision_body, 'source_defense_id = v_canonical.id') > strpos(root_collision_body, 'is_hidden = true')
    ) then 'present' else 'missing' end

  union all

  select
    'child_collision_repoints_before_hide',
    'present',
    case when exists (
      select 1
      from rpc_collision_sections
      where strpos(child_collision_body, 'guild_defense_library_repoint_references') > 0
        and strpos(child_collision_body, 'is_hidden = true') > strpos(child_collision_body, 'guild_defense_library_repoint_references')
    ) then 'present' else 'missing' end

  union all

  select
    'child_collision_hides_loser_before_keeper_import',
    'present',
    case when exists (
      select 1
      from rpc_collision_sections
      where strpos(child_collision_body, 'is_hidden = true') > 0
        and strpos(child_collision_body, 'source_defense_id = v_canonical.id') > strpos(child_collision_body, 'is_hidden = true')
    ) then 'present' else 'missing' end

  union all

  select
    'merge_never_deletes_defenses',
    'missing',
    case when exists (
      select 1
      from rpc_source
      where body ~* '\mdelete\s+from\s+public\.guild_defenses\M'
    ) then 'present' else 'missing' end

  union all

  select
    'active_duplicate_imports',
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
    'assignments_to_hidden_or_merged_defense_1',
    '0',
    count(*)::text
  from public.guild_members member
  join public.guild_defenses defense
    on defense.id = member.defense_1_id
  where coalesce(defense.is_hidden, false) = true
     or defense.merged_into_defense_id is not null

  union all

  select
    'assignments_to_hidden_or_merged_defense_2',
    '0',
    count(*)::text
  from public.guild_members member
  join public.guild_defenses defense
    on defense.id = member.defense_2_id
  where coalesce(defense.is_hidden, false) = true
     or defense.merged_into_defense_id is not null

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
    'condition_key_bigint_signature',
    'bigint, integer',
    coalesce((
      select string_agg(oidvectortypes(proc.proargtypes), ' | ' order by oidvectortypes(proc.proargtypes))
      from pg_proc proc
      join pg_namespace namespace
        on namespace.oid = proc.pronamespace
      where namespace.nspname = 'public'
        and proc.proname = 'guild_defense_library_condition_key'
    ), 'missing')

  union all

  select
    'review_signature_still_checks_identity',
    'present',
    case when exists (
      select 1
      from rpc_source
      where body like '%left_identity_signature%'
        and body like '%right_identity_signature%'
        and body like '%guild_defense_library_identity_signature%'
    ) then 'present' else 'missing' end
),
live_case_info as (
  select
    'real_case_oren_test_v3_preferred_keeper' as check_name,
    'informational' as expected_value,
    coalesce((
      select public.guild_defense_library_preferred_defense(
        '39cfe901-7119-447e-b5ae-3e9aa4febbb2'::uuid,
        '366a394d-4a8d-4ec8-991b-2508d31d7e17'::uuid
      )::text
    ), 'missing') as actual_value,
    'INFO' as status
  where exists (
    select 1
    from public.guild_defenses
    where id in (
      '39cfe901-7119-447e-b5ae-3e9aa4febbb2'::uuid,
      '366a394d-4a8d-4ec8-991b-2508d31d7e17'::uuid
    )
  )

  union all

  select
    'real_case_oren_test_v3_merge_absent_before_user_action',
    'informational',
    count(*)::text,
    'INFO'
  from public.guild_defense_library_merges
  where canonical_defense_id = '874c28e6-fb8d-499f-94df-a8bf53c5930a'::uuid
    and absorbed_defense_id = '366a394d-4a8d-4ec8-991b-2508d31d7e17'::uuid
)
select
  check_name,
  expected_value,
  actual_value,
  case when actual_value = expected_value then 'OK' else 'ERROR' end as status
from checks

union all

select
  check_name,
  expected_value,
  actual_value,
  status
from live_case_info
order by check_name;
