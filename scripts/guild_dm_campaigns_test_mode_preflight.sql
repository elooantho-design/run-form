-- Preflight lecture seule pour le mode test des campagnes MP Discord.

with checks as (
  select
    'table_guild_dm_campaigns' as check_name,
    'present' as expected_value,
    case when to_regclass('public.guild_dm_campaigns') is not null then 'present' else 'missing' end as actual_value,
    case when to_regclass('public.guild_dm_campaigns') is not null then 'OK' else 'ERROR' end as status

  union all

  select
    'table_guild_dm_recipients',
    'present',
    case when to_regclass('public.guild_dm_recipients') is not null then 'present' else 'missing' end,
    case when to_regclass('public.guild_dm_recipients') is not null then 'OK' else 'ERROR' end

  union all

  select
    'campaign_is_test_column_current_state',
    'diagnostic',
    case
      when exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'guild_dm_campaigns'
          and column_name = 'is_test'
      ) then 'present'
      else 'missing'
    end,
    'OK'
)
select *
from checks
order by check_name;
