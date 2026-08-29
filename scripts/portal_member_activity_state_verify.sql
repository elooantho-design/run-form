with checks as (
  select
    'table_exists' as check_name,
    'true' as expected_value,
    (to_regclass('public.portal_member_activity_state') is not null)::text as actual_value,
    case when to_regclass('public.portal_member_activity_state') is not null then 'OK' else 'ERROR' end as status
  union all
  select
    'required_columns',
    '10',
    count(*)::text,
    case when count(*) = 10 then 'OK' else 'ERROR' end
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'portal_member_activity_state'
    and column_name in (
      'member_id',
      'last_seen_at',
      'last_pb_update_at',
      'last_demonic_update_at',
      'last_hero_box_update_at',
      'last_gvg_strat_view_at',
      'last_gvg_strat_context_id',
      'last_gvg_repro_at',
      'created_at',
      'updated_at'
    )
  union all
  select
    'rls_enabled',
    'true',
    coalesce(relrowsecurity, false)::text,
    case when coalesce(relrowsecurity, false) then 'OK' else 'ERROR' end
  from pg_class
  join pg_namespace on pg_namespace.oid = pg_class.relnamespace
  where pg_namespace.nspname = 'public'
    and pg_class.relname = 'portal_member_activity_state'
  union all
  select
    'orphan_state_rows',
    '0',
    count(*)::text,
    case when count(*) = 0 then 'OK' else 'ERROR' end
  from public.portal_member_activity_state state
  left join public.guild_members member on member.id = state.member_id
  where member.id is null
  union all
  select
    'active_members_with_state_row',
    'all_active_members',
    count(state.member_id)::text || '/' || count(member.id)::text,
    case when count(state.member_id) = count(member.id) then 'OK' else 'ERROR' end
  from public.guild_members member
  left join public.portal_member_activity_state state on state.member_id = member.id
  where coalesce(member.guild_code, '') <> ''
    and coalesce(member.community_access_type, '') <> 'community'
    and coalesce(member.role, '') not in ('community_member', 'content_creator')
    and coalesce(member.roster_status, 'active') = 'active'
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
