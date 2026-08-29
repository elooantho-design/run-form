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
  'source_defense_id_foreign_keys' as check_name,
  constraint.conname as constraint_name,
  constraint.confdeltype as on_delete_code,
  pg_get_constraintdef(constraint.oid) as constraint_definition
from pg_constraint constraint
join pg_attribute attribute
  on attribute.attrelid = constraint.conrelid
 and attribute.attnum = any(constraint.conkey)
where constraint.conrelid = 'public.guild_defenses'::regclass
  and constraint.contype = 'f'
  and attribute.attname = 'source_defense_id'
order by constraint.conname;

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
  'defenses_by_guild_and_org' as check_name,
  coalesce(org.organization_key, '<unmapped>') as organization_key,
  coalesce(defense.guild_code, '<null>') as guild_code,
  count(*) as defense_count,
  count(*) filter (where defense.source_defense_id is null) as native_count,
  count(*) filter (where defense.source_defense_id is not null) as imported_or_legacy_variant_count,
  count(*) filter (where coalesce(defense.is_hidden, false)) as hidden_count,
  count(*) filter (where coalesce(defense.is_global, false)) as legacy_global_count
from public.guild_defenses defense
left join public.portal_guilds guild on guild.guild_code = defense.guild_code
left join public.portal_organizations org on org.id = guild.organization_id
group by org.organization_key, defense.guild_code
order by org.organization_key nulls last, defense.guild_code nulls last;

select
  'defenses_without_identifiable_org' as check_name,
  count(*) as defense_count
from public.guild_defenses defense
left join public.portal_guilds guild on guild.guild_code = defense.guild_code
where defense.guild_code is null
   or guild.id is null;

select
  'defense_relation_counts' as check_name,
  count(distinct defense.id) as defenses,
  count(slot.*) as slot_rows,
  count(condition.*) as condition_rows,
  count(block.*) as block_rows,
  count(vote.*) as like_rows
from public.guild_defenses defense
left join public.guild_defense_slots slot on slot.defense_id = defense.id
left join public.guild_defense_conditions condition on condition.defense_id = defense.id
left join public.guild_defense_blocks block on block.defense_id = defense.id
left join public.cluster_defense_likes vote on vote.defense_id = defense.id;

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
    count(defense.id) as matching_local_defenses,
    array_agg(defense.id order by defense.created_at) filter (where defense.id is not null) as matching_defense_ids
  from member_defenses
  left join public.guild_defenses defense
    on defense.name = member_defenses.defense_name
   and defense.guild_code = member_defenses.guild_code
   and coalesce(defense.is_hidden, false) = false
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
  count(*) filter (where matching_local_defenses = 1) as migrable_slots,
  count(*) filter (where matching_local_defenses = 0) as orphan_or_missing_slots,
  count(*) filter (where matching_local_defenses > 1) as ambiguous_slots
from matches;

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
    count(defense.id) as matching_local_defenses,
    array_agg(defense.id order by defense.created_at) filter (where defense.id is not null) as matching_defense_ids
  from member_defenses
  left join public.guild_defenses defense
    on defense.name = member_defenses.defense_name
   and defense.guild_code = member_defenses.guild_code
   and coalesce(defense.is_hidden, false) = false
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
  matching_defense_ids
from matches
where matching_local_defenses <> 1
order by guild_code, watcher_name, slot_name
limit 100;

select
  'duplicate_import_candidates' as check_name,
  guild_code,
  source_defense_id,
  count(*) as active_copy_count
from public.guild_defenses
where source_defense_id is not null
  and coalesce(is_hidden, false) = false
group by guild_code, source_defense_id
having count(*) > 1
order by active_copy_count desc, guild_code;

select
  'orphan_import_sources' as check_name,
  count(*) as orphan_copy_count
from public.guild_defenses copy
left join public.guild_defenses source on source.id = copy.source_defense_id
where copy.source_defense_id is not null
  and source.id is null;
