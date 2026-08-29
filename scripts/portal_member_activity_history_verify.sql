-- Read-only verification for the historical member activity backfill.
-- Returns one consolidated table with OK/ERROR statuses.

with active_members as (
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
    max(entry.updated_at) as reliable_at
  from public.member_pb_entries entry
  where entry.member_id is not null
    and (
      entry.champion_id is not null
      or coalesce(nullif(regexp_replace(coalesce(entry.pb_raw::text, ''), '[^0-9]', '', 'g'), ''), '0')::numeric > 0
    )
  group by entry.member_id
),
hero_box_history as (
  select awakening.member_id
  from public.member_awakenings awakening
  where awakening.member_id is not null
    and awakening.awakening_level >= 0
  group by awakening.member_id
),
demonic_history as (
  select
    entry.member_id,
    max(entry.updated_at) as reliable_at
  from public.member_demonic_monsters entry
  where entry.member_id is not null
    and entry.level > 0
  group by entry.member_id
),
repro_history as (
  select
    repro.member_id,
    max(coalesce(repro.updated_at, repro.created_at)) as reliable_at
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
expected_state as (
  select
    member.id as member_id,
    greatest(
      log_history.last_seen_at,
      log_history.last_pb_update_at,
      log_history.last_demonic_update_at,
      log_history.last_hero_box_update_at,
      pb_history.reliable_at,
      demonic_history.reliable_at,
      repro_history.reliable_at
    ) as expected_last_seen_at,
    greatest(log_history.last_pb_update_at, pb_history.reliable_at) as expected_last_pb_update_at,
    greatest(log_history.last_demonic_update_at, demonic_history.reliable_at) as expected_last_demonic_update_at,
    log_history.last_hero_box_update_at as expected_last_hero_box_update_at,
    repro_history.reliable_at as expected_last_gvg_repro_at
  from active_members member
  left join log_history on log_history.member_id = member.id
  left join pb_history on pb_history.member_id = member.id
  left join demonic_history on demonic_history.member_id = member.id
  left join repro_history on repro_history.member_id = member.id
),
checks as (
  select
    'table_exists' as check_name,
    'true' as expected_value,
    (to_regclass('public.portal_member_activity_state') is not null)::text as actual_value,
    case when to_regclass('public.portal_member_activity_state') is not null then 'OK' else 'ERROR' end as status
  union all
  select
    'active_members_with_state_row',
    count(member.id)::text,
    count(state.member_id)::text,
    case when count(state.member_id) = count(member.id) then 'OK' else 'ERROR' end
  from active_members member
  left join public.portal_member_activity_state state on state.member_id = member.id
  union all
  select
    'pb_history_dated_members_backfilled',
    count(expected_state.member_id)::text,
    count(state.member_id)::text,
    case when count(state.member_id) = count(expected_state.member_id) then 'OK' else 'ERROR' end
  from expected_state
  left join public.portal_member_activity_state state
    on state.member_id = expected_state.member_id
    and state.last_pb_update_at >= expected_state.expected_last_pb_update_at
  where expected_state.expected_last_pb_update_at is not null
  union all
  select
    'demonic_history_dated_members_backfilled',
    count(expected_state.member_id)::text,
    count(state.member_id)::text,
    case when count(state.member_id) = count(expected_state.member_id) then 'OK' else 'ERROR' end
  from expected_state
  left join public.portal_member_activity_state state
    on state.member_id = expected_state.member_id
    and state.last_demonic_update_at >= expected_state.expected_last_demonic_update_at
  where expected_state.expected_last_demonic_update_at is not null
  union all
  select
    'gvg_repro_history_members_backfilled',
    count(expected_state.member_id)::text,
    count(state.member_id)::text,
    case when count(state.member_id) = count(expected_state.member_id) then 'OK' else 'ERROR' end
  from expected_state
  left join public.portal_member_activity_state state
    on state.member_id = expected_state.member_id
    and state.last_gvg_repro_at >= expected_state.expected_last_gvg_repro_at
  where expected_state.expected_last_gvg_repro_at is not null
  union all
  select
    'presence_reliable_dates_backfilled',
    count(expected_state.member_id)::text,
    count(state.member_id)::text,
    case when count(state.member_id) = count(expected_state.member_id) then 'OK' else 'ERROR' end
  from expected_state
  left join public.portal_member_activity_state state
    on state.member_id = expected_state.member_id
    and state.last_seen_at >= expected_state.expected_last_seen_at
  where expected_state.expected_last_seen_at is not null
  union all
  select
    'hero_box_data_without_reliable_date_still_detectable_by_api',
    '>=0',
    count(*)::text,
    'OK'
  from hero_box_history
  left join log_history on log_history.member_id = hero_box_history.member_id
  where log_history.last_hero_box_update_at is null
  union all
  select
    'level_zero_demonic_rows_ignored_by_backfill',
    'informational',
    count(*)::text,
    'OK'
  from public.member_demonic_monsters entry
  where entry.level <= 0
  union all
  select
    'strat_backfill_not_invented',
    '0',
    count(*)::text,
    case when count(*) = 0 then 'OK' else 'ERROR' end
  from public.portal_member_activity_state
  where last_gvg_strat_view_at is not null
    and last_gvg_strat_context_id is null
)
select check_name, expected_value, actual_value, status
from checks
order by check_name;
