-- Read-only preflight for the tenant-scoped guild defense library.
-- Do not modify data. Run this before scripts/guild_defense_library.sql.

select
  'required_tables' as check_name,
  required.table_name,
  to_regclass('public.' || required.table_name) as regclass
from (values
  ('portal_organizations'),
  ('portal_guilds'),
  ('guild_defenses'),
  ('guild_defense_slots'),
  ('guild_defense_conditions'),
  ('guild_defense_blocks'),
  ('guild_members'),
  ('cluster_defense_likes')
) as required(table_name)
order by required.table_name;

select
  'guild_defense_columns' as check_name,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'guild_defenses'
order by ordinal_position;

select
  'guild_member_assignment_columns' as check_name,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'guild_members'
  and column_name in ('defense_1', 'defense_2', 'defense_1_id', 'defense_2_id')
order by ordinal_position;

select
  required.check_name,
  required.table_name,
  required.column_name,
  case when column_info.column_name is not null then 'true' else 'false' end as exists
from (values
  ('column_organization_id_exists', 'guild_defenses', 'organization_id'),
  ('column_source_defense_id_exists', 'guild_defenses', 'source_defense_id'),
  ('column_source_guild_code_exists', 'guild_defenses', 'source_guild_code'),
  ('column_source_defense_name_exists', 'guild_defenses', 'source_defense_name'),
  ('column_imported_at_exists', 'guild_defenses', 'imported_at'),
  ('column_defense_1_id_exists', 'guild_members', 'defense_1_id'),
  ('column_defense_2_id_exists', 'guild_members', 'defense_2_id')
) as required(check_name, table_name, column_name)
left join information_schema.columns column_info
  on column_info.table_schema = 'public'
 and column_info.table_name = required.table_name
 and column_info.column_name = required.column_name
order by required.check_name;

select
  'source_defense_id_foreign_keys' as check_name,
  c.conname as constraint_name,
  c.confdeltype as on_delete_code,
  pg_get_constraintdef(c.oid) as constraint_definition
from pg_constraint c
join pg_attribute a
  on a.attrelid = c.conrelid
 and a.attnum = any(c.conkey)
where c.conrelid = 'public.guild_defenses'::regclass
  and c.contype = 'f'
  and a.attname = 'source_defense_id'
order by c.conname;

select
  'portal_guilds_by_organization' as check_name,
  org.organization_key,
  guild.guild_code,
  guild.display_name,
  guild.is_active
from public.portal_guilds guild
join public.portal_organizations org on org.id = guild.organization_id
order by org.organization_key, guild.guild_code;

select
  'portal_guilds_unique_constraints' as check_name,
  c.conname as constraint_name,
  pg_get_constraintdef(c.oid) as constraint_definition
from pg_constraint c
where c.conrelid = 'public.portal_guilds'::regclass
  and c.contype = 'u'
order by c.conname;

select
  'portal_guilds_unique_indexes' as check_name,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'portal_guilds'
  and indexdef ilike 'CREATE UNIQUE INDEX%'
order by indexname;

with duplicates as (
  select
    guild.guild_code,
    count(distinct guild.organization_id) as organization_count,
    array_agg(
      distinct coalesce(org.organization_key, guild.organization_id::text)
      order by coalesce(org.organization_key, guild.organization_id::text)
    ) as organizations
  from public.portal_guilds guild
  left join public.portal_organizations org on org.id = guild.organization_id
  group by guild.guild_code
  having count(distinct guild.organization_id) > 1
)
select
  'guild_code_cross_tenant_duplicates' as check_name,
  count(*) as duplicated_guild_codes,
  coalesce(jsonb_agg(to_jsonb(duplicates) order by duplicates.guild_code), '[]'::jsonb) as samples
from duplicates;

select
  'existing_defense_total' as check_name,
  count(*) as defense_count
from public.guild_defenses;

select
  'existing_defenses_grouped_by_current_guild_code' as check_name,
  coalesce(defense.guild_code, '<null>') as guild_code,
  count(*) as defense_count
from public.guild_defenses defense
group by defense.guild_code
order by defense.guild_code nulls last;

with guild_matches as (
  select
    guild.guild_code,
    count(distinct guild.organization_id) as organization_count,
    array_agg(
      distinct coalesce(org.organization_key, guild.organization_id::text)
      order by coalesce(org.organization_key, guild.organization_id::text)
    ) as organization_keys
  from public.portal_guilds guild
  left join public.portal_organizations org on org.id = guild.organization_id
  group by guild.guild_code
)
select
  'existing_defenses_expected_native_guild_g2' as check_name,
  'G2' as expected_native_guild,
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
left join guild_matches on guild_matches.guild_code = defense.guild_code;

with guild_matches as (
  select
    guild.guild_code,
    count(distinct guild.organization_id) as organization_count,
    array_agg(
      distinct coalesce(org.organization_key, guild.organization_id::text)
      order by coalesce(org.organization_key, guild.organization_id::text)
    ) as organization_keys
  from public.portal_guilds guild
  left join public.portal_organizations org on org.id = guild.organization_id
  group by guild.guild_code
)
select
  'defenses_by_guild_and_org' as check_name,
  case
    when defense.guild_code is null or btrim(defense.guild_code) = '' then '<null>'
    when guild_matches.organization_count = 1 then guild_matches.organization_keys[1]
    when guild_matches.organization_count > 1 then '<ambiguous: ' || array_to_string(guild_matches.organization_keys, ', ') || '>'
    else '<unmapped>'
  end as organization_key,
  coalesce(defense.guild_code, '<null>') as guild_code,
  count(*) as defense_count,
  count(*) filter (where nullif(to_jsonb(defense)->>'source_defense_id', '') is null) as native_count,
  count(*) filter (where nullif(to_jsonb(defense)->>'source_defense_id', '') is not null) as imported_or_legacy_variant_count,
  count(*) filter (where coalesce(defense.is_hidden, false)) as hidden_count,
  count(*) filter (where coalesce(defense.is_global, false)) as legacy_global_count
from public.guild_defenses defense
left join guild_matches on guild_matches.guild_code = defense.guild_code
group by organization_key, defense.guild_code
order by organization_key nulls last, defense.guild_code nulls last;

with guild_matches as (
  select
    guild.guild_code,
    count(distinct guild.organization_id) as organization_count
  from public.portal_guilds guild
  group by guild.guild_code
)
select
  'defenses_with_identifiable_organization' as check_name,
  count(*) filter (where guild_matches.organization_count = 1) as identifiable_count,
  count(*) filter (
    where defense.guild_code is null
       or btrim(defense.guild_code) = ''
       or guild_matches.organization_count is distinct from 1
  ) as without_identifiable_count
from public.guild_defenses defense
left join guild_matches on guild_matches.guild_code = defense.guild_code;

select
  'defense_relation_counts' as check_name,
  (select count(*) from public.guild_defenses)::bigint as defenses,
  (select count(*) from public.guild_defense_slots)::bigint as slot_rows,
  (select count(*) from public.guild_defense_conditions)::bigint as condition_rows,
  (select count(*) from public.guild_defense_blocks)::bigint as block_rows,
  (select count(*) from public.cluster_defense_likes)::bigint as like_rows;

with member_defenses as (
  select
    member.id as member_id,
    member.watcher_name,
    member.guild_code,
    slot.slot_name,
    slot.defense_name
  from public.guild_members member
  cross join lateral (values
    ('defense_1', nullif(nullif(member.defense_1, '--'), '—')),
    ('defense_2', nullif(nullif(member.defense_2, '--'), '—'))
  ) as slot(slot_name, defense_name)
  where slot.defense_name is not null
),
matches as (
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
)
select
  'assignment_name_resolution' as check_name,
  count(*) as assignment_slots,
  count(*) filter (where matching_local_defenses = 1) as unique_local_slots,
  count(*) filter (where matching_local_defenses = 0) as missing_local_slots,
  count(*) filter (where matching_local_defenses > 1) as ambiguous_local_slots,
  count(*) filter (where matching_g2_native_defenses = 1) as unique_historical_g2_slots,
  count(*) filter (where matching_g2_native_defenses = 0) as missing_historical_g2_slots,
  count(*) filter (where matching_g2_native_defenses > 1) as ambiguous_historical_g2_slots
from matches;

with g2_organization as (
  select guild.organization_id
  from public.portal_guilds guild
  where guild.guild_code = 'G2'
),
member_defenses as (
  select distinct
    member.guild_code as target_guild_code,
    slot.defense_name
  from public.guild_members member
  cross join lateral (values
    (nullif(nullif(member.defense_1, '--'), '—')),
    (nullif(nullif(member.defense_2, '--'), '—'))
  ) as slot(defense_name)
  join public.portal_guilds target_guild
    on target_guild.guild_code = member.guild_code
  join g2_organization
    on g2_organization.organization_id = target_guild.organization_id
  where slot.defense_name is not null
    and member.guild_code <> 'G2'
),
source_matches as (
  select
    member_defenses.target_guild_code,
    member_defenses.defense_name,
    count(source_defense.id) as matching_g2_sources
  from member_defenses
  left join public.guild_defenses source_defense
    on source_defense.guild_code = 'G2'
   and source_defense.name = member_defenses.defense_name
   and nullif(to_jsonb(source_defense)->>'source_defense_id', '') is null
   and coalesce(source_defense.is_hidden, false) = false
  group by member_defenses.target_guild_code, member_defenses.defense_name
)
select
  'legacy_g2_assignment_copy_candidates' as check_name,
  count(*) filter (where matching_g2_sources = 1) as importable_target_name_pairs,
  count(*) filter (where matching_g2_sources = 0) as missing_target_name_pairs,
  count(*) filter (where matching_g2_sources > 1) as ambiguous_target_name_pairs
from source_matches;

with member_defenses as (
  select
    member.id as member_id,
    member.watcher_name,
    member.guild_code,
    slot.slot_name,
    slot.defense_name
  from public.guild_members member
  cross join lateral (values
    ('defense_1', nullif(nullif(member.defense_1, '--'), '—')),
    ('defense_2', nullif(nullif(member.defense_2, '--'), '—'))
  ) as slot(slot_name, defense_name)
  where slot.defense_name is not null
),
matches as (
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
)
select
  'ambiguous_or_missing_assignment_samples' as check_name,
  member_id,
  watcher_name,
  guild_code,
  slot_name,
  defense_name,
  matching_local_defenses,
  matching_local_defense_ids,
  matching_g2_native_defenses,
  matching_g2_native_defense_ids
from matches
where matching_local_defenses <> 1
   or matching_g2_native_defenses <> 1
order by guild_code, watcher_name, slot_name
limit 100;

with column_state as (
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'guild_defenses'
      and column_name = 'source_defense_id'
  ) as source_defense_id_exists
),
duplicate_rows as (
  select
    defense.guild_code,
    nullif(to_jsonb(defense)->>'source_defense_id', '') as source_defense_id,
    count(*) as active_copy_count
  from public.guild_defenses defense
  cross join column_state
  where column_state.source_defense_id_exists
    and nullif(to_jsonb(defense)->>'source_defense_id', '') is not null
    and coalesce(defense.is_hidden, false) = false
  group by defense.guild_code, nullif(to_jsonb(defense)->>'source_defense_id', '')
  having count(*) > 1
)
select
  'duplicate_import_candidates' as check_name,
  duplicate_rows.guild_code,
  duplicate_rows.source_defense_id,
  duplicate_rows.active_copy_count,
  'calculated' as applicability
from duplicate_rows
union all
select
  'duplicate_import_candidates' as check_name,
  null::text as guild_code,
  null::text as source_defense_id,
  0::bigint as active_copy_count,
  'not applicable before migration' as applicability
from column_state
where not column_state.source_defense_id_exists
order by check_name, guild_code nulls last;

with column_state as (
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'guild_defenses'
      and column_name = 'source_defense_id'
  ) as source_defense_id_exists
),
copy_scan as (
  select
    defense.id,
    nullif(to_jsonb(defense)->>'source_defense_id', '') as source_defense_id
  from public.guild_defenses defense
)
select
  'orphan_import_sources' as check_name,
  count(*) filter (
    where column_state.source_defense_id_exists
      and copy_scan.source_defense_id is not null
      and source_defense.id is null
  ) as orphan_copy_count,
  case
    when column_state.source_defense_id_exists then 'calculated'
    else 'not applicable before migration'
  end as applicability
from column_state
cross join copy_scan
left join public.guild_defenses source_defense
  on source_defense.id::text = copy_scan.source_defense_id
group by column_state.source_defense_id_exists;
