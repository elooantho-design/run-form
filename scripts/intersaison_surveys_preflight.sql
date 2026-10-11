-- Read-only preflight for the Inter-saison survey center.
with checks as (
  select
    'base_tables' as check_name,
    '4' as expected_value,
    count(*)::text as actual_value,
    case when count(*) = 4 then 'OK' else 'ERROR' end as status
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('portal_organizations', 'portal_guilds', 'guild_members', 'guild_dm_campaigns')
    and c.relkind in ('r', 'p')
  union all
  select
    'guild_dm_recipients_table',
    'present',
    case when to_regclass('public.guild_dm_recipients') is null then 'missing' else 'present' end,
    case when to_regclass('public.guild_dm_recipients') is null then 'ERROR' else 'OK' end
  union all
  select
    'guild_dm_interaction_columns',
    '2',
    count(*)::text,
    case when count(*) = 2 then 'OK' else 'INFO' end
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'guild_dm_campaigns'
    and column_name in ('interaction_type', 'interaction_payload')
  union all
  select
    'survey_tables_state',
    'absent_or_compatible',
    case
      when to_regclass('public.intersaison_survey_seasons') is null then 'absent'
      when (
        select count(*)
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'intersaison_survey_campaigns'
          and column_name in ('season_id', 'poll_number', 'guild_dm_campaign_id', 'status')
      ) = 4 then 'present_compatible'
      else 'present_incompatible'
    end,
    case
      when to_regclass('public.intersaison_survey_seasons') is null then 'OK'
      when (
        select count(*)
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'intersaison_survey_campaigns'
          and column_name in ('season_id', 'poll_number', 'guild_dm_campaign_id', 'status')
      ) = 4 then 'OK'
      else 'ERROR'
    end
  union all
  select
    'active_guild_code_duplicates',
    '0',
    count(*)::text,
    case when count(*) = 0 then 'OK' else 'ERROR' end
  from (
    select guild_code
    from public.portal_guilds
    where is_active = true
    group by guild_code
    having count(distinct organization_id) > 1
  ) duplicate_codes
  union all
  select
    'global_guild_code_guard',
    'present',
    case when to_regclass('public.portal_guilds_guild_code_temporary_unique_idx') is null then 'missing' else 'present' end,
    case when to_regclass('public.portal_guilds_guild_code_temporary_unique_idx') is null then 'INFO' else 'OK' end
  union all
  select
    'active_guilds',
    '>0',
    count(*)::text,
    case when count(*) > 0 then 'OK' else 'ERROR' end
  from public.portal_guilds
  where is_active = true
  union all
  select
    'current_active_members',
    '>0',
    count(*)::text,
    case when count(*) > 0 then 'OK' else 'ERROR' end
  from public.guild_members member
  join public.portal_guilds guild on guild.guild_code = member.guild_code and guild.is_active = true
  where coalesce(member.roster_status, 'active') = 'active'
)
select check_name, expected_value, actual_value, status
from checks
order by check_name;
