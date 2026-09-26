-- Verify lecture seule pour le mode test des campagnes MP Discord.

with checks as (
  select
    'campaign_is_test_column' as check_name,
    'present' as expected_value,
    case when count(*) = 1 then 'present' else 'missing' end as actual_value,
    case when count(*) = 1 then 'OK' else 'ERROR' end as status
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'guild_dm_campaigns'
    and column_name = 'is_test'

  union all

  select
    'campaign_is_test_type',
    'boolean',
    coalesce(max(data_type), 'missing'),
    case when max(data_type) = 'boolean' then 'OK' else 'ERROR' end
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'guild_dm_campaigns'
    and column_name = 'is_test'

  union all

  select
    'campaign_is_test_nullable',
    'NO',
    coalesce(max(is_nullable), 'missing'),
    case when max(is_nullable) = 'NO' then 'OK' else 'ERROR' end
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'guild_dm_campaigns'
    and column_name = 'is_test'

  union all

  select
    'campaign_is_test_default',
    'false',
    coalesce(max(column_default), 'missing'),
    case when coalesce(max(column_default), '') in ('false', 'false::boolean') then 'OK' else 'ERROR' end
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'guild_dm_campaigns'
    and column_name = 'is_test'

  union all

  select
    'campaign_org_is_test_index',
    'present',
    case when to_regclass('public.guild_dm_campaigns_org_is_test_created_idx') is not null then 'present' else 'missing' end,
    case when to_regclass('public.guild_dm_campaigns_org_is_test_created_idx') is not null then 'OK' else 'ERROR' end

  union all

  select
    'test_campaign_recipient_count_violations',
    '0',
    count(*)::text,
    case when count(*) = 0 then 'OK' else 'ERROR' end
  from (
    select campaign.id
    from public.guild_dm_campaigns campaign
    left join public.guild_dm_recipients recipient on recipient.campaign_id = campaign.id
    where campaign.is_test is true
    group by campaign.id
    having count(recipient.id) <> 1
  ) violations
)
select *
from checks
order by check_name;
