with checks as (
  select
    'survey_campaign_is_test_column' as check_name,
    'present' as expected_value,
    case when exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'intersaison_survey_campaigns'
        and column_name = 'is_test'
    ) then 'present' else 'missing' end as actual_value,
    case when exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'intersaison_survey_campaigns'
        and column_name = 'is_test'
    ) then 'OK' else 'ERROR' end as status
  union all
  select
    'survey_campaign_is_test_type',
    'boolean',
    coalesce((
      select data_type
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'intersaison_survey_campaigns'
        and column_name = 'is_test'
    ), 'missing'),
    case when exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'intersaison_survey_campaigns'
        and column_name = 'is_test'
        and data_type = 'boolean'
    ) then 'OK' else 'ERROR' end
  union all
  select
    'survey_campaign_is_test_default',
    'false',
    coalesce((
      select column_default
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'intersaison_survey_campaigns'
        and column_name = 'is_test'
    ), 'missing'),
    case when exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'intersaison_survey_campaigns'
        and column_name = 'is_test'
        and column_default ilike '%false%'
    ) then 'OK' else 'ERROR' end
  union all
  select
    'survey_campaign_official_unique_index',
    'test_excluded',
    case
      when to_regclass('public.intersaison_survey_campaigns_season_poll_uidx') is null then 'missing'
      when pg_get_indexdef(to_regclass('public.intersaison_survey_campaigns_season_poll_uidx')) ilike '%is_test = false%' then 'test_excluded'
      when pg_get_indexdef(to_regclass('public.intersaison_survey_campaigns_season_poll_uidx')) ilike '%is_test IS FALSE%' then 'test_excluded'
      else pg_get_indexdef(to_regclass('public.intersaison_survey_campaigns_season_poll_uidx'))
    end,
    case
      when to_regclass('public.intersaison_survey_campaigns_season_poll_uidx') is not null
       and (
         pg_get_indexdef(to_regclass('public.intersaison_survey_campaigns_season_poll_uidx')) ilike '%is_test = false%'
         or pg_get_indexdef(to_regclass('public.intersaison_survey_campaigns_season_poll_uidx')) ilike '%is_test IS FALSE%'
       )
      then 'OK' else 'ERROR' end
  union all
  select
    'survey_campaign_test_index',
    'present',
    case when to_regclass('public.intersaison_survey_campaigns_org_test_created_idx') is null then 'missing' else 'present' end,
    case when to_regclass('public.intersaison_survey_campaigns_org_test_created_idx') is null then 'ERROR' else 'OK' end
  union all
  select
    'official_campaign_duplicates',
    '0',
    count(*)::text,
    case when count(*) = 0 then 'OK' else 'ERROR' end
  from (
    select season_id, poll_number
    from public.intersaison_survey_campaigns
    where status <> 'cancelled'
      and is_test = false
    group by season_id, poll_number
    having count(*) > 1
  ) duplicate_official
  union all
  select
    'test_campaigns_link_dm_test_campaigns',
    '0',
    count(*)::text,
    case when count(*) = 0 then 'OK' else 'ERROR' end
  from public.intersaison_survey_campaigns survey_campaign
  join public.guild_dm_campaigns dm_campaign on dm_campaign.id = survey_campaign.guild_dm_campaign_id
  where survey_campaign.is_test = true
    and coalesce(dm_campaign.is_test, false) is not true
)
select check_name, expected_value, actual_value, status
from checks
order by check_name;
