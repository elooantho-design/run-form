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
  'defenses_without_organization' as check_name,
  0::text as expected_value,
  count(*)::text as actual_value,
  case when count(*) = 0 then 'OK' else 'ERROR' end as status
from public.guild_defenses
where organization_id is null

union all

select
  'duplicate_active_imports' as check_name,
  0::text as expected_value,
  count(*)::text as actual_value,
  case when count(*) = 0 then 'OK' else 'ERROR' end as status
from (
  select guild_code, source_defense_id
  from public.guild_defenses
  where source_defense_id is not null
    and coalesce(is_hidden, false) = false
  group by guild_code, source_defense_id
  having count(*) > 1
) duplicates

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
  '0 ambiguous/missing id when local name is unique' as expected_value,
  count(*)::text as actual_value,
  case when count(*) = 0 then 'OK' else 'ERROR' end as status
from public.guild_members member
where (
    nullif(nullif(member.defense_1, '--'), '—') is not null
    and member.defense_1_id is null
    and (
      select count(*)
      from public.guild_defenses defense
      where defense.name = member.defense_1
        and defense.guild_code = member.guild_code
        and coalesce(defense.is_hidden, false) = false
    ) = 1
  )
   or (
    nullif(nullif(member.defense_2, '--'), '—') is not null
    and member.defense_2_id is null
    and (
      select count(*)
      from public.guild_defenses defense
      where defense.name = member.defense_2
        and defense.guild_code = member.guild_code
        and coalesce(defense.is_hidden, false) = false
    ) = 1
  )

union all

select
  'cross_organization_imports' as check_name,
  0::text as expected_value,
  count(*)::text as actual_value,
  case when count(*) = 0 then 'OK' else 'ERROR' end as status
from public.guild_defenses copy
join public.guild_defenses source on source.id = copy.source_defense_id
where copy.source_defense_id is not null
  and copy.organization_id is distinct from source.organization_id

union all

select
  'source_defense_id_fk_removed' as check_name,
  0::text as expected_value,
  count(*)::text as actual_value,
  case when count(*) = 0 then 'OK' else 'ERROR' end as status
from pg_constraint constraint
join pg_attribute attribute
  on attribute.attrelid = constraint.conrelid
 and attribute.attnum = any(constraint.conkey)
where constraint.conrelid = 'public.guild_defenses'::regclass
  and constraint.contype = 'f'
  and attribute.attname = 'source_defense_id';
