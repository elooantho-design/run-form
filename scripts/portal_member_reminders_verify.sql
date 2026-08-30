with organizations as (
  select id, organization_key
  from public.portal_organizations
  where organization_key in ('paladin', 'mad')
),
capabilities as (
  select
    org.organization_key,
    capability.capability_key,
    capability.enabled
  from organizations org
  left join public.portal_organization_capabilities capability
    on capability.organization_id = org.id
),
checks as (
  select
    'table_portal_organization_capabilities' as check_name,
    'present' as expected_value,
    case when to_regclass('public.portal_organization_capabilities') is not null then 'present' else 'missing' end as actual_value,
    case when to_regclass('public.portal_organization_capabilities') is not null then 'OK' else 'ERROR' end as status
  union all
  select
    'table_portal_member_reminders',
    'present',
    case when to_regclass('public.portal_member_reminders') is not null then 'present' else 'missing' end,
    case when to_regclass('public.portal_member_reminders') is not null then 'OK' else 'ERROR' end
  union all
  select
    'paladin_discord_log_reminders',
    'true',
    coalesce(max(enabled::text) filter (where organization_key = 'paladin' and capability_key = 'discord_log_reminders'), 'missing'),
    case when coalesce(bool_or(enabled) filter (where organization_key = 'paladin' and capability_key = 'discord_log_reminders'), false) then 'OK' else 'ERROR' end
  from capabilities
  union all
  select
    'paladin_discord_defense_dm',
    'true',
    coalesce(max(enabled::text) filter (where organization_key = 'paladin' and capability_key = 'discord_defense_dm'), 'missing'),
    case when coalesce(bool_or(enabled) filter (where organization_key = 'paladin' and capability_key = 'discord_defense_dm'), false) then 'OK' else 'ERROR' end
  from capabilities
  union all
  select
    'mad_discord_log_reminders',
    'false',
    coalesce(max(enabled::text) filter (where organization_key = 'mad' and capability_key = 'discord_log_reminders'), 'missing'),
    case
      when coalesce(bool_or(enabled) filter (where organization_key = 'mad' and capability_key = 'discord_log_reminders'), false) = false
        and count(*) filter (where organization_key = 'mad' and capability_key = 'discord_log_reminders') = 1
      then 'OK'
      else 'ERROR'
    end
  from capabilities
  union all
  select
    'mad_discord_defense_dm',
    'false',
    coalesce(max(enabled::text) filter (where organization_key = 'mad' and capability_key = 'discord_defense_dm'), 'missing'),
    case
      when coalesce(bool_or(enabled) filter (where organization_key = 'mad' and capability_key = 'discord_defense_dm'), false) = false
        and count(*) filter (where organization_key = 'mad' and capability_key = 'discord_defense_dm') = 1
      then 'OK'
      else 'ERROR'
    end
  from capabilities
  union all
  select
    'future_organization_default_disabled',
    'false',
    coalesce((
      select column_default
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'portal_organization_capabilities'
        and column_name = 'enabled'
    ), 'missing'),
    case
      when exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'portal_organization_capabilities'
          and column_name = 'enabled'
          and column_default ilike '%false%'
      )
      then 'OK'
      else 'ERROR'
    end
  union all
  select
    'reminder_type_constraint',
    'present',
    case when exists (
      select 1
      from pg_constraint
      where conname = 'portal_member_reminders_type_check'
    ) then 'present' else 'missing' end,
    case when exists (
      select 1
      from pg_constraint
      where conname = 'portal_member_reminders_type_check'
    ) then 'OK' else 'ERROR' end
  union all
  select
    'reminder_status_constraint',
    'present',
    case when exists (
      select 1
      from pg_constraint
      where conname = 'portal_member_reminders_status_check'
    ) then 'present' else 'missing' end,
    case when exists (
      select 1
      from pg_constraint
      where conname = 'portal_member_reminders_status_check'
    ) then 'OK' else 'ERROR' end
  union all
  select
    'latest_success_index',
    'present',
    case when to_regclass('public.portal_member_reminders_latest_success_idx') is not null then 'present' else 'missing' end,
    case when to_regclass('public.portal_member_reminders_latest_success_idx') is not null then 'OK' else 'ERROR' end
  union all
  select
    'invalid_reminder_member_org',
    '0',
    count(*)::text,
    case when count(*) = 0 then 'OK' else 'ERROR' end
  from public.portal_member_reminders reminder
  left join public.guild_members member on member.id = reminder.member_id
  left join public.portal_guilds guild
    on guild.guild_code = member.guild_code
   and guild.organization_id = reminder.organization_id
  where member.id is null
     or guild.guild_code is null
)
select check_name, expected_value, actual_value, status
from checks
order by check_name;
