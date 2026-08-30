with table_checks as (
  select
    required.table_name,
    to_regclass('public.' || required.table_name) is not null as exists
  from (
    values
      ('portal_organizations'),
      ('portal_guilds'),
      ('guild_members'),
      ('portal_activity_logs'),
      ('portal_organization_capabilities'),
      ('portal_member_reminders')
  ) as required(table_name)
),
column_checks as (
  select
    required.table_name,
    required.column_name,
    exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = required.table_name
        and c.column_name = required.column_name
    ) as exists
  from (
    values
      ('guild_members', 'discord_id'),
      ('portal_organizations', 'organization_key'),
      ('portal_guilds', 'organization_id'),
      ('portal_organization_capabilities', 'organization_id'),
      ('portal_organization_capabilities', 'capability_key'),
      ('portal_organization_capabilities', 'enabled'),
      ('portal_member_reminders', 'organization_id'),
      ('portal_member_reminders', 'member_id'),
      ('portal_member_reminders', 'reminder_type'),
      ('portal_member_reminders', 'status')
  ) as required(table_name, column_name)
),
organizations as (
  select
    organization_key,
    count(*) as row_count
  from public.portal_organizations
  where organization_key in ('paladin', 'mad')
  group by organization_key
),
checks as (
  select
    'table_' || table_name as check_name,
    'present' as expected_value,
    case when exists then 'present' else 'missing' end as actual_value,
    case when exists then 'OK' else 'ERROR' end as status
  from table_checks
  union all
  select
    'column_' || table_name || '_' || column_name as check_name,
    'present' as expected_value,
    case when exists then 'present' else 'missing' end as actual_value,
    case when exists then 'OK' else 'ERROR' end as status
  from column_checks
  union all
  select
    'organization_paladin_exists',
    '1',
    coalesce((select row_count::text from organizations where organization_key = 'paladin'), '0'),
    case when coalesce((select row_count from organizations where organization_key = 'paladin'), 0) = 1 then 'OK' else 'ERROR' end
  union all
  select
    'organization_mad_exists',
    '1',
    coalesce((select row_count::text from organizations where organization_key = 'mad'), '0'),
    case when coalesce((select row_count from organizations where organization_key = 'mad'), 0) = 1 then 'OK' else 'ERROR' end
)
select check_name, expected_value, actual_value, status
from checks
order by check_name;
