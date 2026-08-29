select
  'guild_defense_library_columns' as check_name,
  7::text as expected_value,
  count(*)::text as actual_value,
  case when count(*) = 7 then 'OK' else 'ERROR' end as status
from information_schema.columns
where table_schema = 'public'
  and table_name = 'guild_defenses'
  and column_name in (
    'organization_id',
    'guild_code',
    'source_defense_id',
    'source_guild_code',
    'source_defense_name',
    'is_hidden',
    'imported_at'
  )

union all

select
  'guild_member_defense_id_columns' as check_name,
  2::text as expected_value,
  count(*)::text as actual_value,
  case when count(*) = 2 then 'OK' else 'ERROR' end as status
from information_schema.columns
where table_schema = 'public'
  and table_name = 'guild_members'
  and column_name in ('defense_1_id', 'defense_2_id')

union all

select
  'portal_guild_code_duplicates' as check_name,
  0::text as expected_value,
  count(*)::text as actual_value,
  case when count(*) = 0 then 'OK' else 'ERROR' end as status
from (
  select guild_code
  from public.portal_guilds
  group by guild_code
  having count(distinct organization_id) > 1
) duplicates

union all

select
  'portal_guilds_global_unique_index' as check_name,
  '>=1' as expected_value,
  count(*)::text as actual_value,
  case when count(*) >= 1 then 'OK' else 'ERROR' end as status
from pg_indexes
where schemaname = 'public'
  and tablename = 'portal_guilds'
  and indexdef ilike 'CREATE UNIQUE INDEX%'
  and indexdef ilike '%guild_code%'
  and indexdef not ilike '%organization_id%'

union all

select
  'defenses_without_organization' as check_name,
  0::text as expected_value,
  count(*)::text as actual_value,
  case when count(*) = 0 then 'OK' else 'ERROR' end as status
from public.guild_defenses
where organization_id is null

union all

select
  'native_defenses_outside_expected_g2' as check_name,
  0::text as expected_value,
  count(*)::text as actual_value,
  case when count(*) = 0 then 'OK' else 'ERROR' end as status
from public.guild_defenses
where source_defense_id is null
  and coalesce(is_hidden, false) = false
  and upper(coalesce(guild_code, '')) <> 'G2'

union all

select
  'paladin_guilds_attached_to_non_paladin_org' as check_name,
  0::text as expected_value,
  count(*)::text as actual_value,
  case when count(*) = 0 then 'OK' else 'ERROR' end as status
from public.guild_defenses defense
join public.portal_organizations org on org.id = defense.organization_id
where upper(coalesce(defense.guild_code, '')) in ('G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7')
  and lower(coalesce(org.organization_key, '')) <> 'paladin'

union all

select
  'duplicate_active_imports' as check_name,
  0::text as expected_value,
  count(*)::text as actual_value,
  case when count(*) = 0 then 'OK' else 'ERROR' end as status
from (
  select organization_id, guild_code, source_defense_id
  from public.guild_defenses
  where source_defense_id is not null
    and coalesce(is_hidden, false) = false
  group by organization_id, guild_code, source_defense_id
  having count(*) > 1
) duplicates

union all

select
  'unique_import_index_tenant_scoped' as check_name,
  1::text as expected_value,
  count(*)::text as actual_value,
  case when count(*) = 1 then 'OK' else 'ERROR' end as status
from pg_indexes
where schemaname = 'public'
  and tablename = 'guild_defenses'
  and indexname = 'guild_defenses_unique_active_import_idx'
  and indexdef ilike '%organization_id%'
  and indexdef ilike '%guild_code%'
  and indexdef ilike '%source_defense_id%'

union all

select
  'import_rpc_present' as check_name,
  1::text as expected_value,
  count(*)::text as actual_value,
  case when count(*) = 1 then 'OK' else 'ERROR' end as status
from pg_proc proc
join pg_namespace namespace on namespace.oid = proc.pronamespace
where namespace.nspname = 'public'
  and proc.proname = 'import_guild_defense_snapshot'

union all

select
  'assignments_migrated_where_unambiguous' as check_name,
  '0 missing id when local name is unique' as expected_value,
  count(*)::text as actual_value,
  case when count(*) = 0 then 'OK' else 'ERROR' end as status
from (
  with assignment_empty_markers(raw_value) as (
    values
      (''),
      ('--'),
      ('-'),
      ('—'),
      ('–'),
      ('â€”'),
      ('â€“')
  )
  select
    member.id,
    member.guild_code,
    member_guild.organization_id,
    slot.slot_name,
    slot.defense_id,
    normalized_slot.defense_name
  from public.guild_members member
  left join public.portal_guilds member_guild on member_guild.guild_code = member.guild_code
  cross join lateral (values
    ('defense_1_id', member.defense_1, member.defense_1_id),
    ('defense_2_id', member.defense_2, member.defense_2_id)
  ) as slot(slot_name, raw_defense_name, defense_id)
  left join assignment_empty_markers
    on assignment_empty_markers.raw_value = btrim(coalesce(slot.raw_defense_name, ''))
  cross join lateral (
    select case
      when slot.raw_defense_name is null then null
      when assignment_empty_markers.raw_value is not null then null
      else btrim(slot.raw_defense_name)
    end as defense_name
  ) normalized_slot
  where normalized_slot.defense_name is not null
) assignment_slots
where assignment_slots.defense_id is null
  and (
    select count(*)
    from public.guild_defenses defense
    where defense.name = assignment_slots.defense_name
      and defense.guild_code = assignment_slots.guild_code
      and defense.organization_id = assignment_slots.organization_id
      and coalesce(defense.is_hidden, false) = false
  ) = 1

union all

select
  'invalid_assignment_ids' as check_name,
  0::text as expected_value,
  count(*)::text as actual_value,
  case when count(*) = 0 then 'OK' else 'ERROR' end as status
from (
  select member.id, 'defense_1_id' as slot_name
  from public.guild_members member
  left join public.portal_guilds member_guild on member_guild.guild_code = member.guild_code
  left join public.guild_defenses defense on defense.id = member.defense_1_id
  where member.defense_1_id is not null
    and (
      defense.id is null
      or defense.guild_code is distinct from member.guild_code
      or defense.organization_id is distinct from member_guild.organization_id
    )

  union all

  select member.id, 'defense_2_id' as slot_name
  from public.guild_members member
  left join public.portal_guilds member_guild on member_guild.guild_code = member.guild_code
  left join public.guild_defenses defense on defense.id = member.defense_2_id
  where member.defense_2_id is not null
    and (
      defense.id is null
      or defense.guild_code is distinct from member.guild_code
      or defense.organization_id is distinct from member_guild.organization_id
    )
) invalid_assignments

union all

select
  'cross_organization_imports' as check_name,
  0::text as expected_value,
  count(*)::text as actual_value,
  case when count(*) = 0 then 'OK' else 'ERROR' end as status
from public.guild_defenses copy_defense
join public.guild_defenses source_defense on source_defense.id = copy_defense.source_defense_id
where copy_defense.source_defense_id is not null
  and copy_defense.organization_id is distinct from source_defense.organization_id

union all

select
  'source_defense_id_fk_removed' as check_name,
  0::text as expected_value,
  count(*)::text as actual_value,
  case when count(*) = 0 then 'OK' else 'ERROR' end as status
from pg_constraint c
join pg_attribute a
  on a.attrelid = c.conrelid
 and a.attnum = any(c.conkey)
where c.conrelid = 'public.guild_defenses'::regclass
  and c.contype = 'f'
  and a.attname = 'source_defense_id';
