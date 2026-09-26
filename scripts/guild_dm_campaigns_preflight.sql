-- Preflight lecture seule pour les campagnes MP Discord de Gestion guilde.

with required_tables(table_name) as (
  values
    ('portal_organizations'),
    ('portal_guilds'),
    ('guild_members')
),
table_checks as (
  select
    'table_' || table_name as check_name,
    'present' as expected_value,
    case when to_regclass('public.' || table_name) is null then 'missing' else 'present' end as actual_value,
    case when to_regclass('public.' || table_name) is null then 'ERROR' else 'OK' end as status
  from required_tables
),
existing_campaign_tables as (
  select
    'existing_guild_dm_tables' as check_name,
    'diagnostic' as expected_value,
    concat(
      'campaigns=', coalesce(to_regclass('public.guild_dm_campaigns')::text, 'missing'),
      ', recipients=', coalesce(to_regclass('public.guild_dm_recipients')::text, 'missing')
    ) as actual_value,
    'OK' as status
),
member_discord_column as (
  select
    'guild_members_discord_id_column' as check_name,
    'present' as expected_value,
    case
      when exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'guild_members'
          and column_name = 'discord_id'
      ) then 'present'
      else 'missing'
    end as actual_value,
    case
      when exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'guild_members'
          and column_name = 'discord_id'
      ) then 'OK'
      else 'ERROR'
    end as status
),
active_guilds as (
  select
    'active_portal_guilds' as check_name,
    '>0' as expected_value,
    count(*)::text as actual_value,
    case when count(*) > 0 then 'OK' else 'ERROR' end as status
  from public.portal_guilds
  where is_active is true
),
reachable_members as (
  select
    'members_with_discord_id' as check_name,
    'diagnostic' as expected_value,
    count(*)::text as actual_value,
    'OK' as status
  from public.guild_members
  where nullif(btrim(discord_id), '') is not null
)
select * from table_checks
union all select * from existing_campaign_tables
union all select * from member_discord_column
union all select * from active_guilds
union all select * from reachable_members
order by check_name;
