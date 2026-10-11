-- Read-only preflight for Inter-saison survey personal test mode.
with checks as (
  select
    'survey_campaigns_table' as check_name,
    'present' as expected_value,
    case when to_regclass('public.intersaison_survey_campaigns') is null then 'missing' else 'present' end as actual_value,
    case when to_regclass('public.intersaison_survey_campaigns') is null then 'ERROR' else 'OK' end as status
  union all
  select
    'survey_campaign_is_test_column_state',
    'absent_or_compatible',
    case
      when exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'intersaison_survey_campaigns'
          and column_name = 'is_test'
          and data_type = 'boolean'
      ) then 'present_boolean'
      when not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'intersaison_survey_campaigns'
          and column_name = 'is_test'
      ) then 'absent'
      else 'present_incompatible'
    end,
    case
      when exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'intersaison_survey_campaigns'
          and column_name = 'is_test'
          and data_type = 'boolean'
      ) then 'OK'
      when not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'intersaison_survey_campaigns'
          and column_name = 'is_test'
      ) then 'OK'
      else 'ERROR'
    end
  union all
  select
    'survey_campaign_unique_index_state',
    'present',
    case
      when to_regclass('public.intersaison_survey_campaigns_season_poll_uidx') is null then 'missing'
      when pg_get_indexdef(to_regclass('public.intersaison_survey_campaigns_season_poll_uidx')) ilike '%is_test%' then 'present_test_aware'
      else 'present_legacy'
    end,
    case when to_regclass('public.intersaison_survey_campaigns_season_poll_uidx') is null then 'ERROR' else 'OK' end
  union all
  select
    'guild_dm_campaign_is_test_column',
    'present',
    case when exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'guild_dm_campaigns'
        and column_name = 'is_test'
        and data_type = 'boolean'
    ) then 'present' else 'missing' end,
    case when exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'guild_dm_campaigns'
        and column_name = 'is_test'
        and data_type = 'boolean'
    ) then 'OK' else 'ERROR' end
  union all
  select
    'guild_dm_interaction_columns',
    '2',
    count(*)::text,
    case when count(*) = 2 then 'OK' else 'ERROR' end
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'guild_dm_campaigns'
    and column_name in ('interaction_type', 'interaction_payload')
)
select check_name, expected_value, actual_value, status
from checks
order by check_name;
