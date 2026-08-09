-- Read-only preflight before preserving Inter-saison history during member deletion.
-- This script only reads catalog/data. It does not modify Supabase.

select
  'columns' as section,
  column_info.table_name,
  column_info.column_name,
  column_info.data_type,
  column_info.is_nullable,
  column_info.column_default
from information_schema.columns column_info
where column_info.table_schema = 'public'
  and (
    (
      column_info.table_name = 'intersaison_assignments'
      and column_info.column_name in (
        'id',
        'campaign_id',
        'dashboard_id',
        'member_id',
        'watcher_name',
        'discord_id_raw',
        'source_guild_code',
        'target_guild_code',
        'assignment_source',
        'is_manually_confirmed',
        'wished_guild_codes'
      )
    )
    or (
      column_info.table_name = 'intersaison_notes'
      and column_info.column_name in (
        'id',
        'assignment_id',
        'note',
        'created_by_member_id',
        'created_at',
        'updated_at'
      )
    )
  )
order by column_info.table_name, column_info.ordinal_position;

select
  'foreign_keys' as section,
  constraint_info.conname as constraint_name,
  source_table.relname as source_table,
  array_agg(source_attribute.attname order by source_columns.ordinality) as source_columns,
  target_table.relname as target_table,
  array_agg(target_attribute.attname order by target_columns.ordinality) as target_columns,
  case constraint_info.confdeltype
    when 'a' then 'NO ACTION'
    when 'r' then 'RESTRICT'
    when 'c' then 'CASCADE'
    when 'n' then 'SET NULL'
    when 'd' then 'SET DEFAULT'
    else constraint_info.confdeltype::text
  end as on_delete,
  pg_get_constraintdef(constraint_info.oid) as constraint_definition
from pg_constraint constraint_info
join pg_class source_table on source_table.oid = constraint_info.conrelid
join pg_namespace source_namespace on source_namespace.oid = source_table.relnamespace
join pg_class target_table on target_table.oid = constraint_info.confrelid
join pg_namespace target_namespace on target_namespace.oid = target_table.relnamespace
join unnest(constraint_info.conkey) with ordinality as source_columns(attnum, ordinality) on true
join pg_attribute source_attribute
  on source_attribute.attrelid = constraint_info.conrelid
 and source_attribute.attnum = source_columns.attnum
join unnest(constraint_info.confkey) with ordinality as target_columns(attnum, ordinality)
  on target_columns.ordinality = source_columns.ordinality
join pg_attribute target_attribute
  on target_attribute.attrelid = constraint_info.confrelid
 and target_attribute.attnum = target_columns.attnum
where constraint_info.contype = 'f'
  and source_namespace.nspname = 'public'
  and target_namespace.nspname = 'public'
  and (
    (source_table.relname = 'intersaison_assignments' and target_table.relname = 'guild_members')
    or (source_table.relname = 'intersaison_notes' and target_table.relname in ('guild_members', 'intersaison_assignments'))
  )
group by
  constraint_info.oid,
  constraint_info.conname,
  source_table.relname,
  target_table.relname,
  constraint_info.confdeltype
order by source_table.relname, constraint_info.conname;

select
  'assignments_by_campaign_status' as section,
  coalesce(campaign.status, 'missing_campaign') as campaign_status,
  count(*) as assignment_count,
  count(*) filter (where assignment.member_id is not null) as assignment_with_member_count,
  count(*) filter (where assignment.member_id is null) as detached_assignment_count
from public.intersaison_assignments assignment
left join public.intersaison_campaigns campaign on campaign.id = assignment.campaign_id
group by coalesce(campaign.status, 'missing_campaign')
order by campaign_status;

select
  'notes_created_by_member' as section,
  count(*) as note_count,
  count(*) filter (where note.created_by_member_id is not null) as note_with_creator_count,
  count(*) filter (where note.created_by_member_id is null) as detached_note_creator_count
from public.intersaison_notes note;

select
  'orphan_assignment_member_ids' as section,
  assignment.id as assignment_id,
  assignment.member_id,
  assignment.watcher_name,
  assignment.source_guild_code,
  assignment.target_guild_code,
  assignment.campaign_id
from public.intersaison_assignments assignment
left join public.guild_members member on member.id = assignment.member_id
where assignment.member_id is not null
  and member.id is null
order by assignment.watcher_name nulls last, assignment.id
limit 100;

select
  'orphan_note_creator_member_ids' as section,
  note.id as note_id,
  note.assignment_id,
  note.created_by_member_id
from public.intersaison_notes note
left join public.guild_members member on member.id = note.created_by_member_id
where note.created_by_member_id is not null
  and member.id is null
order by note.id
limit 100;

select
  'orphan_note_assignment_ids' as section,
  note.id as note_id,
  note.assignment_id,
  note.created_by_member_id
from public.intersaison_notes note
left join public.intersaison_assignments assignment on assignment.id = note.assignment_id
where note.assignment_id is not null
  and assignment.id is null
order by note.id
limit 100;

select
  'delete_blocker_sample_active_assignments' as section,
  assignment.id as assignment_id,
  assignment.member_id,
  assignment.watcher_name,
  assignment.discord_id_raw,
  assignment.source_guild_code,
  assignment.target_guild_code,
  assignment.is_manually_confirmed,
  assignment.wished_guild_codes,
  dashboard.code as dashboard_code,
  dashboard.name as dashboard_name,
  campaign.id as campaign_id,
  campaign.label as campaign_label,
  campaign.status as campaign_status
from public.intersaison_assignments assignment
join public.intersaison_campaigns campaign on campaign.id = assignment.campaign_id
left join public.intersaison_dashboards dashboard on dashboard.id = assignment.dashboard_id
where campaign.status = 'active'
  and assignment.member_id is not null
order by campaign.created_at desc nulls last, assignment.watcher_name nulls last
limit 100;
