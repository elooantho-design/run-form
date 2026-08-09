-- Read-only preflight for durable guild_members roster eligibility.
-- This script does not mutate data.

select
  'guild_members_columns' as section,
  column_info.ordinal_position,
  column_info.column_name,
  column_info.data_type,
  column_info.is_nullable,
  column_info.column_default
from information_schema.columns column_info
where column_info.table_schema = 'public'
  and column_info.table_name = 'guild_members'
order by column_info.ordinal_position;

select
  'roster_status_column_check' as section,
  exists (
    select 1
    from information_schema.columns column_info
    where column_info.table_schema = 'public'
      and column_info.table_name = 'guild_members'
      and column_info.column_name = 'roster_status'
  ) as roster_status_column_exists;

select
  'target_members' as section,
  member.id,
  member.watcher_name,
  member.guild_code,
  to_jsonb(member)->>'role' as role,
  to_jsonb(member)->>'status' as status,
  to_jsonb(member)->>'assignment' as assignment,
  to_jsonb(member)->>'community_access_type' as community_access_type,
  to_jsonb(member)->>'community_status' as community_status,
  to_jsonb(member)->>'roster_status' as roster_status_if_present
from public.guild_members member
where lower(member.watcher_name) in (
  lower('Kadichon'),
  lower('Moontoon'),
  lower('Lilith'),
  lower('Lilith 2'),
  lower('Mokonou'),
  lower('Xfix')
)
order by lower(member.watcher_name), member.id;

select
  'target_member_name_counts' as section,
  target.watcher_name,
  count(member.id) as match_count,
  array_agg(member.id order by member.id) filter (where member.id is not null) as member_ids
from (
  values
    ('Kadichon'),
    ('Moontoon'),
    ('Lilith'),
    ('Lilith 2'),
    ('Mokonou'),
    ('Xfix')
) as target(watcher_name)
left join public.guild_members member
  on lower(member.watcher_name) = lower(target.watcher_name)
group by target.watcher_name
order by target.watcher_name;

select
  'member_counts_by_guild_code' as section,
  coalesce(member.guild_code, '<null>') as guild_code,
  count(*) as member_count
from public.guild_members member
group by member.guild_code
order by member.guild_code nulls last;

with roster_column as (
  select exists (
    select 1
    from information_schema.columns column_info
    where column_info.table_schema = 'public'
      and column_info.table_name = 'guild_members'
      and column_info.column_name = 'roster_status'
  ) as roster_status_column_exists
),
distribution as (
  select
    coalesce(to_jsonb(member)->>'roster_status', '<null>') as roster_status,
    count(*) as member_count
  from public.guild_members member
  cross join roster_column
  where roster_column.roster_status_column_exists
  group by coalesce(to_jsonb(member)->>'roster_status', '<null>')
)
select
  'roster_status_distribution_if_present' as section,
  roster_column.roster_status_column_exists,
  distribution.roster_status,
  distribution.member_count
from roster_column
join distribution
  on roster_column.roster_status_column_exists
union all
select
  'roster_status_distribution_if_present' as section,
  false as roster_status_column_exists,
  'not_applicable_before_migration' as roster_status,
  0 as member_count
from roster_column
where not roster_column.roster_status_column_exists
order by roster_status;
