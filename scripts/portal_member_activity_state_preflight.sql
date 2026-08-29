-- Read-only preflight for the Portal member activity overview.
-- This script does not modify data.

select
  'guild_members_exists' as check_name,
  'true' as expected_value,
  (to_regclass('public.guild_members') is not null)::text as actual_value,
  case when to_regclass('public.guild_members') is not null then 'OK' else 'ERROR' end as status;

select
  'portal_activity_logs_exists' as check_name,
  'true' as expected_value,
  (to_regclass('public.portal_activity_logs') is not null)::text as actual_value,
  case when to_regclass('public.portal_activity_logs') is not null then 'OK' else 'ERROR' end as status;

select
  'target_table_exists_before_migration' as check_name,
  'false_or_ready' as expected_value,
  (to_regclass('public.portal_member_activity_state') is not null)::text as actual_value,
  'OK' as status;

select
  'active_non_community_members' as check_name,
  '>= 0' as expected_value,
  count(*)::text as actual_value,
  'OK' as status
from public.guild_members member
where coalesce(member.guild_code, '') <> ''
  and coalesce(member.community_access_type, '') <> 'community'
  and coalesce(member.role, '') not in ('community_member', 'content_creator')
  and coalesce(member.roster_status, 'active') = 'active';

select
  action_type as check_name,
  'explicit_activity_log_count' as expected_value,
  count(*)::text as actual_value,
  'OK' as status
from public.portal_activity_logs
where action_type in (
  'pb_update',
  'pb_hero_update',
  'demon_monster_update',
  'hero_box_update',
  'hero_box_bulk_a5'
)
group by action_type
order by action_type;
