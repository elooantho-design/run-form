-- Read-only preflight for the historical member activity backfill.
-- This script does not modify data.

with table_checks as (
  select *
  from (values
    ('guild_members', to_regclass('public.guild_members') is not null),
    ('portal_member_activity_state', to_regclass('public.portal_member_activity_state') is not null),
    ('portal_activity_logs', to_regclass('public.portal_activity_logs') is not null),
    ('member_pb_entries', to_regclass('public.member_pb_entries') is not null),
    ('member_awakenings', to_regclass('public.member_awakenings') is not null),
    ('member_demonic_monsters', to_regclass('public.member_demonic_monsters') is not null),
    ('gvg_repro', to_regclass('public.gvg_repro') is not null)
  ) as checks(table_name, exists_flag)
),
active_members as (
  select member.id
  from public.guild_members member
  where coalesce(member.guild_code, '') <> ''
    and coalesce(member.community_access_type, '') <> 'community'
    and coalesce(member.role, '') not in ('community_member', 'content_creator')
    and coalesce(member.roster_status, 'active') = 'active'
),
pb_history as (
  select
    entry.member_id,
    max(entry.updated_at) as reliable_at,
    count(*) as row_count
  from public.member_pb_entries entry
  where entry.member_id is not null
    and (
      entry.champion_id is not null
      or coalesce(nullif(regexp_replace(coalesce(entry.pb_raw::text, ''), '[^0-9]', '', 'g'), ''), '0')::numeric > 0
    )
  group by entry.member_id
),
hero_box_history as (
  select
    awakening.member_id,
    count(*) as row_count
  from public.member_awakenings awakening
  where awakening.member_id is not null
    and awakening.awakening_level >= 0
  group by awakening.member_id
),
demonic_history as (
  select
    entry.member_id,
    max(entry.updated_at) as reliable_at,
    count(*) as row_count
  from public.member_demonic_monsters entry
  where entry.member_id is not null
    and entry.level > 0
  group by entry.member_id
),
repro_history as (
  select
    repro.member_id,
    max(coalesce(repro.updated_at, repro.created_at)) as reliable_at,
    count(*) as row_count
  from public.gvg_repro repro
  where repro.member_id is not null
  group by repro.member_id
),
log_history as (
  select
    member.id as member_id,
    max(log.created_at) filter (where log.actor_member_id = member.id) as last_seen_at,
    max(log.created_at) filter (
      where log.action_type in ('pb_update', 'pb_hero_update')
        and (log.target_member_id = member.id or log.actor_member_id = member.id)
    ) as last_pb_update_at,
    max(log.created_at) filter (
      where log.action_type = 'demon_monster_update'
        and (log.target_member_id = member.id or log.actor_member_id = member.id)
    ) as last_demonic_update_at,
    max(log.created_at) filter (
      where log.action_type in ('hero_box_update', 'hero_box_bulk_a5')
        and (log.target_member_id = member.id or log.actor_member_id = member.id)
    ) as last_hero_box_update_at
  from active_members member
  left join public.portal_activity_logs log
    on log.actor_member_id = member.id
    or log.target_member_id = member.id
  group by member.id
),
prepared as (
  select
    member.id,
    greatest(
      state.last_seen_at,
      log_history.last_seen_at,
      log_history.last_pb_update_at,
      log_history.last_demonic_update_at,
      log_history.last_hero_box_update_at,
      pb_history.reliable_at,
      demonic_history.reliable_at,
      repro_history.reliable_at
    ) as next_last_seen_at,
    greatest(state.last_pb_update_at, log_history.last_pb_update_at, pb_history.reliable_at) as next_last_pb_update_at,
    greatest(state.last_demonic_update_at, log_history.last_demonic_update_at, demonic_history.reliable_at) as next_last_demonic_update_at,
    greatest(state.last_hero_box_update_at, log_history.last_hero_box_update_at) as next_last_hero_box_update_at,
    greatest(state.last_gvg_repro_at, repro_history.reliable_at) as next_last_gvg_repro_at,
    hero_box_history.row_count is not null as has_hero_box_without_reliable_date
  from active_members member
  left join public.portal_member_activity_state state on state.member_id = member.id
  left join log_history on log_history.member_id = member.id
  left join pb_history on pb_history.member_id = member.id
  left join hero_box_history on hero_box_history.member_id = member.id
  left join demonic_history on demonic_history.member_id = member.id
  left join repro_history on repro_history.member_id = member.id
)
select
  'table_' || table_name as check_name,
  'true' as expected_value,
  exists_flag::text as actual_value,
  case when exists_flag then 'OK' else 'ERROR' end as status
from table_checks
union all
select 'active_non_community_members', '>=0', count(*)::text, 'OK'
from active_members
union all
select 'members_with_pb_history', '>=0', count(*)::text, 'OK'
from pb_history
union all
select 'members_with_hero_box_history_without_reliable_date', '>=0', count(*)::text, 'OK'
from hero_box_history
union all
select 'members_with_demonic_history_level_gt_zero', '>=0', count(*)::text, 'OK'
from demonic_history
union all
select 'members_with_gvg_repro_history', '>=0', count(*)::text, 'OK'
from repro_history
union all
select 'members_that_would_receive_last_seen_date', '>=0', count(*)::text, 'OK'
from prepared
where next_last_seen_at is not null
union all
select 'members_with_data_but_no_reliable_date', '>=0', count(*)::text, 'OK'
from prepared
where next_last_seen_at is null
  and has_hero_box_without_reliable_date
order by check_name;
