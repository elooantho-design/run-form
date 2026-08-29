-- Read-only preflight for the tenant-scoped guild defense library.
-- Supabase SQL Editor shows this as one consolidated result set.
-- Do not modify data. Run this before scripts/guild_defense_library.sql.

with
required_tables(table_name) as (
  values
    ('portal_organizations'),
    ('portal_guilds'),
    ('guild_defenses'),
    ('guild_defense_slots'),
    ('guild_defense_conditions'),
    ('guild_defense_blocks'),
    ('guild_members'),
    ('cluster_defense_likes')
),
future_columns(check_name, table_name, column_name) as (
  values
    ('column_organization_id_exists', 'guild_defenses', 'organization_id'),
    ('column_source_defense_id_exists', 'guild_defenses', 'source_defense_id'),
    ('column_source_guild_code_exists', 'guild_defenses', 'source_guild_code'),
    ('column_source_defense_name_exists', 'guild_defenses', 'source_defense_name'),
    ('column_imported_at_exists', 'guild_defenses', 'imported_at'),
    ('column_defense_1_id_exists', 'guild_members', 'defense_1_id'),
    ('column_defense_2_id_exists', 'guild_members', 'defense_2_id')
),
assignment_empty_markers(raw_value) as (
  values
    (''),
    ('--'),
    ('-'),
    ('—'),
    ('–'),
    ('â€”'),
    ('â€“')
),
column_state as (
  select
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'guild_defenses'
        and column_name = 'source_defense_id'
    ) as source_defense_id_exists
),
guild_matches as (
  select
    guild.guild_code,
    count(distinct guild.organization_id) as organization_count,
    array_agg(distinct coalesce(org.organization_key, guild.organization_id::text)) as organization_keys
  from public.portal_guilds guild
  left join public.portal_organizations org on org.id = guild.organization_id
  group by guild.guild_code
),
guild_code_duplicates as (
  select
    guild.guild_code,
    count(distinct guild.organization_id) as organization_count,
    array_agg(distinct coalesce(org.organization_key, guild.organization_id::text)) as organizations
  from public.portal_guilds guild
  left join public.portal_organizations org on org.id = guild.organization_id
  group by guild.guild_code
  having count(distinct guild.organization_id) > 1
),
source_fks as (
  select
    c.conname as constraint_name,
    c.confdeltype as on_delete_code,
    pg_get_constraintdef(c.oid) as constraint_definition
  from pg_constraint c
  join pg_attribute a
    on a.attrelid = c.conrelid
   and a.attnum = any(c.conkey)
  where c.conrelid = to_regclass('public.guild_defenses')
    and c.contype = 'f'
    and a.attname = 'source_defense_id'
),
portal_unique_constraints as (
  select
    c.conname as constraint_name,
    pg_get_constraintdef(c.oid) as constraint_definition
  from pg_constraint c
  where c.conrelid = to_regclass('public.portal_guilds')
    and c.contype = 'u'
),
portal_unique_indexes as (
  select
    indexname,
    indexdef
  from pg_indexes
  where schemaname = 'public'
    and tablename = 'portal_guilds'
    and indexdef ilike 'CREATE UNIQUE INDEX%'
),
defenses_with_org as (
  select
    defense.id,
    defense.name,
    defense.guild_code,
    defense.is_hidden,
    defense.is_global,
    nullif(to_jsonb(defense)->>'source_defense_id', '') as source_defense_id_text,
    case
      when defense.guild_code is null or btrim(defense.guild_code) = '' then '<null>'
      when guild_matches.organization_count = 1 then guild_matches.organization_keys[1]
      when guild_matches.organization_count > 1 then '<ambiguous: ' || array_to_string(guild_matches.organization_keys, ', ') || '>'
      else '<unmapped>'
    end as inferred_organization_key,
    guild_matches.organization_count
  from public.guild_defenses defense
  left join guild_matches on guild_matches.guild_code = defense.guild_code
),
expected_native_g2 as (
  select
    count(*) as total_defenses,
    count(*) filter (where upper(coalesce(defense.guild_code, '')) = 'G2') as currently_g2,
    count(*) filter (
      where defense.guild_code is not null
        and btrim(defense.guild_code) <> ''
        and upper(defense.guild_code) <> 'G2'
    ) as currently_elsewhere,
    count(*) filter (where defense.guild_code is null or btrim(defense.guild_code) = '') as null_or_blank_guild_code,
    count(*) filter (
      where defense.guild_code is not null
        and btrim(defense.guild_code) <> ''
        and guild_matches.guild_code is null
    ) as unknown_guild_code,
    count(*) filter (where guild_matches.organization_count = 1) as identifiable_organization,
    count(*) filter (where guild_matches.organization_count > 1) as ambiguous_organization
  from public.guild_defenses defense
  left join guild_matches on guild_matches.guild_code = defense.guild_code
),
defenses_by_guild_and_org as (
  select
    inferred_organization_key,
    coalesce(guild_code, '<null>') as guild_code,
    count(*) as defense_count,
    count(*) filter (where source_defense_id_text is null) as native_count,
    count(*) filter (where source_defense_id_text is not null) as imported_or_legacy_variant_count,
    count(*) filter (where coalesce(is_hidden, false)) as hidden_count,
    count(*) filter (where coalesce(is_global, false)) as legacy_global_count
  from defenses_with_org
  group by inferred_organization_key, guild_code
),
defenses_with_identifiable_organization as (
  select
    count(*) filter (where organization_count = 1) as identifiable_count,
    count(*) filter (
      where guild_code is null
         or btrim(guild_code) = ''
         or organization_count is distinct from 1
    ) as without_identifiable_count
  from defenses_with_org
),
relation_counts as (
  select
    (select count(*) from public.guild_defenses)::bigint as defenses,
    (select count(*) from public.guild_defense_slots)::bigint as slot_rows,
    (select count(*) from public.guild_defense_conditions)::bigint as condition_rows,
    (select count(*) from public.guild_defense_blocks)::bigint as block_rows,
    (select count(*) from public.cluster_defense_likes)::bigint as like_rows
),
assignment_normalized_slots as (
  select
    member.id as member_id,
    member.watcher_name,
    member.guild_code,
    slot.slot_name,
    slot.raw_defense_name,
    case
      when slot.raw_defense_name is null then null
      when assignment_empty_markers.raw_value is not null then null
      else btrim(slot.raw_defense_name)
    end as defense_name
  from public.guild_members member
  cross join lateral (values
    ('defense_1', member.defense_1),
    ('defense_2', member.defense_2)
  ) as slot(slot_name, raw_defense_name)
  left join assignment_empty_markers
    on assignment_empty_markers.raw_value = btrim(coalesce(slot.raw_defense_name, ''))
),
assignment_raw_values as (
  select
    slot_name,
    raw_defense_name,
    btrim(coalesce(raw_defense_name, '')) as trimmed_defense_name,
    case
      when raw_defense_name is null then '<NULL>'
      when raw_defense_name = '' then '<empty>'
      when btrim(raw_defense_name) = '' then '<spaces>'
      else raw_defense_name
    end as raw_value_label,
    max(defense_name) as normalized_defense_name,
    count(*) as occurrence_count
  from assignment_normalized_slots
  group by slot_name, raw_defense_name
),
member_defenses as (
  select
    member_id,
    watcher_name,
    guild_code,
    slot_name,
    defense_name
  from assignment_normalized_slots
  where defense_name is not null
),
assignment_matches as (
  select
    member_defenses.*,
    count(distinct local_defense.id) as matching_local_defenses,
    count(distinct g2_defense.id) as matching_g2_native_defenses,
    array_agg(distinct local_defense.id) filter (where local_defense.id is not null) as matching_local_defense_ids,
    array_agg(distinct g2_defense.id) filter (where g2_defense.id is not null) as matching_g2_native_defense_ids
  from member_defenses
  left join public.guild_defenses local_defense
    on local_defense.name = member_defenses.defense_name
   and local_defense.guild_code = member_defenses.guild_code
   and coalesce(local_defense.is_hidden, false) = false
  left join public.guild_defenses g2_defense
    on g2_defense.name = member_defenses.defense_name
   and g2_defense.guild_code = 'G2'
   and nullif(to_jsonb(g2_defense)->>'source_defense_id', '') is null
   and coalesce(g2_defense.is_hidden, false) = false
  group by
    member_defenses.member_id,
    member_defenses.watcher_name,
    member_defenses.guild_code,
    member_defenses.slot_name,
    member_defenses.defense_name
),
legacy_g2_organization as (
  select guild.organization_id
  from public.portal_guilds guild
  where guild.guild_code = 'G2'
),
legacy_g2_member_defenses as (
  select distinct
    member_defenses.guild_code as target_guild_code,
    member_defenses.defense_name
  from member_defenses
  join public.portal_guilds target_guild
    on target_guild.guild_code = member_defenses.guild_code
  join legacy_g2_organization
    on legacy_g2_organization.organization_id = target_guild.organization_id
  where member_defenses.guild_code <> 'G2'
),
legacy_g2_source_matches as (
  select
    legacy_g2_member_defenses.target_guild_code,
    legacy_g2_member_defenses.defense_name,
    count(source_defense.id) as matching_g2_sources
  from legacy_g2_member_defenses
  left join public.guild_defenses source_defense
    on source_defense.guild_code = 'G2'
   and source_defense.name = legacy_g2_member_defenses.defense_name
   and nullif(to_jsonb(source_defense)->>'source_defense_id', '') is null
   and coalesce(source_defense.is_hidden, false) = false
  group by legacy_g2_member_defenses.target_guild_code, legacy_g2_member_defenses.defense_name
),
ambiguous_or_missing_assignment_samples as (
  select *
  from assignment_matches
  where matching_local_defenses <> 1
     or matching_g2_native_defenses <> 1
  order by guild_code, watcher_name, slot_name
  limit 100
),
duplicate_imports as (
  select
    defense.guild_code,
    nullif(to_jsonb(defense)->>'source_defense_id', '') as source_defense_id_text,
    count(*) as active_copy_count
  from public.guild_defenses defense
  cross join column_state
  where column_state.source_defense_id_exists
    and nullif(to_jsonb(defense)->>'source_defense_id', '') is not null
    and coalesce(defense.is_hidden, false) = false
  group by defense.guild_code, nullif(to_jsonb(defense)->>'source_defense_id', '')
  having count(*) > 1
),
copy_scan as (
  select
    defense.id,
    nullif(to_jsonb(defense)->>'source_defense_id', '') as source_defense_id_text
  from public.guild_defenses defense
),
orphan_import_summary as (
  select
    count(*) filter (
      where column_state.source_defense_id_exists
        and copy_scan.source_defense_id_text is not null
        and source_defense.id is null
    ) as orphan_copy_count,
    column_state.source_defense_id_exists
  from column_state
  cross join copy_scan
  left join public.guild_defenses source_defense
    on source_defense.id::text = copy_scan.source_defense_id_text
  group by column_state.source_defense_id_exists
),
result_rows as (
  select
    10 as sort_order,
    'required_tables'::text as check_name,
    required_tables.table_name::text as subject,
    'present'::text as expected_value,
    case when to_regclass('public.' || required_tables.table_name) is null then 'missing' else 'present' end as actual_value,
    case when to_regclass('public.' || required_tables.table_name) is null then 'ERROR' else 'OK' end as status,
    jsonb_build_object('regclass', to_regclass('public.' || required_tables.table_name)::text) as details
  from required_tables

  union all

  select
    20,
    'guild_defense_columns',
    column_name::text,
    'schema inventory',
    data_type::text,
    'INFO',
    jsonb_build_object(
      'is_nullable', is_nullable,
      'column_default', column_default,
      'ordinal_position', ordinal_position
    )
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'guild_defenses'

  union all

  select
    30,
    'guild_member_assignment_columns',
    column_name::text,
    'schema inventory',
    data_type::text,
    'INFO',
    jsonb_build_object(
      'is_nullable', is_nullable,
      'column_default', column_default,
      'ordinal_position', ordinal_position
    )
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'guild_members'
    and column_name in ('defense_1', 'defense_2', 'defense_1_id', 'defense_2_id')

  union all

  select
    40,
    future_columns.check_name,
    future_columns.table_name || '.' || future_columns.column_name,
    'reported',
    case when column_info.column_name is not null then 'true' else 'false' end,
    'INFO',
    jsonb_build_object(
      'table_name', future_columns.table_name,
      'column_name', future_columns.column_name
    )
  from future_columns
  left join information_schema.columns column_info
    on column_info.table_schema = 'public'
   and column_info.table_name = future_columns.table_name
   and column_info.column_name = future_columns.column_name

  union all

  select
    50,
    'source_defense_id_foreign_keys',
    'guild_defenses.source_defense_id',
    '0 legacy FK preferred',
    count(*)::text,
    case when count(*) = 0 then 'OK' else 'WARN' end,
    coalesce(jsonb_agg(to_jsonb(source_fks) order by source_fks.constraint_name), '[]'::jsonb)
  from source_fks

  union all

  select
    60,
    'portal_guilds_by_organization',
    org.organization_key || ':' || guild.guild_code,
    'active guild inventory',
    case when guild.is_active then 'active' else 'inactive' end,
    'INFO',
    jsonb_build_object(
      'organization_key', org.organization_key,
      'guild_code', guild.guild_code,
      'display_name', guild.display_name,
      'organization_id', guild.organization_id
    )
  from public.portal_guilds guild
  join public.portal_organizations org on org.id = guild.organization_id

  union all

  select
    70,
    'portal_guilds_unique_constraints',
    'public.portal_guilds',
    'reported',
    count(*)::text,
    'INFO',
    coalesce(jsonb_agg(to_jsonb(portal_unique_constraints) order by portal_unique_constraints.constraint_name), '[]'::jsonb)
  from portal_unique_constraints

  union all

  select
    80,
    'portal_guilds_unique_indexes',
    'public.portal_guilds',
    'reported',
    count(*)::text,
    'INFO',
    coalesce(jsonb_agg(to_jsonb(portal_unique_indexes) order by portal_unique_indexes.indexname), '[]'::jsonb)
  from portal_unique_indexes

  union all

  select
    90,
    'guild_code_cross_tenant_duplicates',
    'portal_guilds.guild_code',
    '0',
    count(*)::text,
    case when count(*) = 0 then 'OK' else 'ERROR' end,
    coalesce(jsonb_agg(to_jsonb(guild_code_duplicates) order by guild_code_duplicates.guild_code), '[]'::jsonb)
  from guild_code_duplicates

  union all

  select
    100,
    'existing_defense_total',
    'public.guild_defenses',
    'reported',
    count(*)::text,
    'INFO',
    jsonb_build_object('defense_count', count(*))
  from public.guild_defenses

  union all

  select
    110,
    'existing_defenses_grouped_by_current_guild_code',
    coalesce(defense.guild_code, '<null>'),
    'reported',
    count(*)::text,
    'INFO',
    jsonb_build_object('guild_code', defense.guild_code, 'defense_count', count(*))
  from public.guild_defenses defense
  group by defense.guild_code

  union all

  select
    120,
    'existing_defenses_expected_native_guild_g2',
    'expected_native_guild:G2',
    'currently_elsewhere=0, null_or_blank=0, unknown=0, ambiguous=0',
    format(
      'total=%s, currently_g2=%s, currently_elsewhere=%s, null_or_blank=%s, unknown=%s, ambiguous=%s',
      total_defenses,
      currently_g2,
      currently_elsewhere,
      null_or_blank_guild_code,
      unknown_guild_code,
      ambiguous_organization
    ),
    case
      when currently_elsewhere = 0
       and null_or_blank_guild_code = 0
       and unknown_guild_code = 0
       and ambiguous_organization = 0
        then 'OK'
      else 'ERROR'
    end,
    to_jsonb(expected_native_g2)
  from expected_native_g2

  union all

  select
    130,
    'defenses_by_guild_and_org',
    inferred_organization_key || ':' || guild_code,
    'reported',
    defense_count::text,
    'INFO',
    jsonb_build_object(
      'organization_key', inferred_organization_key,
      'guild_code', guild_code,
      'defense_count', defense_count,
      'native_count', native_count,
      'imported_or_legacy_variant_count', imported_or_legacy_variant_count,
      'hidden_count', hidden_count,
      'legacy_global_count', legacy_global_count
    )
  from defenses_by_guild_and_org

  union all

  select
    140,
    'defenses_with_identifiable_organization',
    'public.guild_defenses',
    'without_identifiable_count=0',
    format(
      'identifiable=%s, without_identifiable=%s',
      identifiable_count,
      without_identifiable_count
    ),
    case when without_identifiable_count = 0 then 'OK' else 'ERROR' end,
    to_jsonb(defenses_with_identifiable_organization)
  from defenses_with_identifiable_organization

  union all

  select
    150,
    'defense_relation_counts',
    'guild defense related tables',
    'reported',
    format(
      'defenses=%s, slots=%s, conditions=%s, blocks=%s, likes=%s',
      defenses,
      slot_rows,
      condition_rows,
      block_rows,
      like_rows
    ),
    'INFO',
    to_jsonb(relation_counts)
  from relation_counts

  union all

  select
    155,
    'assignment_raw_values',
    slot_name || ':' || raw_value_label,
    'reported',
    occurrence_count::text,
    'INFO',
    jsonb_build_object(
      'slot_name', slot_name,
      'raw_value', raw_defense_name,
      'trimmed_value', trimmed_defense_name,
      'normalized_defense_name', normalized_defense_name,
      'is_empty_assignment', normalized_defense_name is null,
      'occurrence_count', occurrence_count
    )
  from assignment_raw_values

  union all

  select
    160,
    'assignment_name_resolution',
    'guild_members.defense_1/defense_2',
    'missing/ambiguous slots=0',
    format(
      'assignment_slots=%s, missing_local=%s, ambiguous_local=%s, missing_historical_g2=%s, ambiguous_historical_g2=%s',
      count(*),
      count(*) filter (where matching_local_defenses = 0),
      count(*) filter (where matching_local_defenses > 1),
      count(*) filter (where matching_g2_native_defenses = 0),
      count(*) filter (where matching_g2_native_defenses > 1)
    ),
    case
      when count(*) filter (where matching_local_defenses <> 1 or matching_g2_native_defenses <> 1) = 0
        then 'OK'
      else 'ERROR'
    end,
    jsonb_build_object(
      'assignment_slots', count(*),
      'unique_local_slots', count(*) filter (where matching_local_defenses = 1),
      'missing_local_slots', count(*) filter (where matching_local_defenses = 0),
      'ambiguous_local_slots', count(*) filter (where matching_local_defenses > 1),
      'unique_historical_g2_slots', count(*) filter (where matching_g2_native_defenses = 1),
      'missing_historical_g2_slots', count(*) filter (where matching_g2_native_defenses = 0),
      'ambiguous_historical_g2_slots', count(*) filter (where matching_g2_native_defenses > 1)
    )
  from assignment_matches

  union all

  select
    170,
    'legacy_g2_assignment_copy_candidates',
    'non-G2 assignments inside G2 organization',
    'reported',
    format(
      'importable=%s, missing=%s, ambiguous=%s',
      count(*) filter (where matching_g2_sources = 1),
      count(*) filter (where matching_g2_sources = 0),
      count(*) filter (where matching_g2_sources > 1)
    ),
    case
      when count(*) filter (where matching_g2_sources <> 1) = 0 then 'OK'
      else 'ERROR'
    end,
    jsonb_build_object(
      'importable_target_name_pairs', count(*) filter (where matching_g2_sources = 1),
      'missing_target_name_pairs', count(*) filter (where matching_g2_sources = 0),
      'ambiguous_target_name_pairs', count(*) filter (where matching_g2_sources > 1)
    )
  from legacy_g2_source_matches

  union all

  select
    180,
    'ambiguous_or_missing_assignment_samples',
    coalesce(guild_code, '<null>') || ':' || coalesce(watcher_name, member_id::text) || ':' || slot_name,
    'no sample',
    defense_name,
    'ERROR',
    jsonb_build_object(
      'member_id', member_id,
      'watcher_name', watcher_name,
      'guild_code', guild_code,
      'slot_name', slot_name,
      'defense_name', defense_name,
      'matching_local_defenses', matching_local_defenses,
      'matching_local_defense_ids', matching_local_defense_ids,
      'matching_g2_native_defenses', matching_g2_native_defenses,
      'matching_g2_native_defense_ids', matching_g2_native_defense_ids
    )
  from ambiguous_or_missing_assignment_samples

  union all

  select
    181,
    'ambiguous_or_missing_assignment_samples',
    'none',
    'no sample',
    '0',
    'OK',
    '[]'::jsonb
  where not exists (select 1 from ambiguous_or_missing_assignment_samples)

  union all

  select
    190,
    'duplicate_import_candidates',
    coalesce(duplicate_imports.guild_code, '<null>') || ':' || duplicate_imports.source_defense_id_text,
    'active_copy_count<=1',
    duplicate_imports.active_copy_count::text,
    'ERROR',
    jsonb_build_object(
      'guild_code', duplicate_imports.guild_code,
      'source_defense_id', duplicate_imports.source_defense_id_text,
      'active_copy_count', duplicate_imports.active_copy_count,
      'applicability', 'calculated'
    )
  from duplicate_imports

  union all

  select
    191,
    'duplicate_import_candidates',
    'none',
    'active_copy_count<=1',
    '0',
    'OK',
    jsonb_build_object('applicability', 'calculated')
  from column_state
  where column_state.source_defense_id_exists
    and not exists (select 1 from duplicate_imports)

  union all

  select
    192,
    'duplicate_import_candidates',
    'not_applicable',
    'source_defense_id column exists',
    'false',
    'INFO',
    jsonb_build_object('applicability', 'not applicable before migration')
  from column_state
  where not column_state.source_defense_id_exists

  union all

  select
    200,
    'orphan_import_sources',
    'guild_defenses.source_defense_id',
    '0',
    orphan_copy_count::text,
    case
      when not source_defense_id_exists then 'INFO'
      when orphan_copy_count = 0 then 'OK'
      else 'ERROR'
    end,
    jsonb_build_object(
      'orphan_copy_count', orphan_copy_count,
      'applicability', case
        when source_defense_id_exists then 'calculated'
        else 'not applicable before migration'
      end
    )
  from orphan_import_summary
)
select
  sort_order,
  check_name,
  subject,
  expected_value,
  actual_value,
  status,
  details
from result_rows
order by sort_order, check_name, subject;
