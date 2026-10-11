with checks as (
  select
    'survey_tables' as check_name,
    '5' as expected_value,
    count(*)::text as actual_value,
    case when count(*) = 5 then 'OK' else 'ERROR' end as status
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in (
      'intersaison_survey_seasons',
      'intersaison_survey_campaigns',
      'intersaison_survey_recipients',
      'intersaison_survey_responses',
      'intersaison_survey_guild_objectives'
    )
    and c.relkind in ('r', 'p')
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
  union all
  select
    'guild_dm_interaction_constraint',
    'present',
    case when exists (
      select 1
      from pg_constraint
      where conname = 'guild_dm_campaigns_interaction_type_check'
        and conrelid = 'public.guild_dm_campaigns'::regclass
    ) then 'present' else 'missing' end,
    case when exists (
      select 1
      from pg_constraint
      where conname = 'guild_dm_campaigns_interaction_type_check'
        and conrelid = 'public.guild_dm_campaigns'::regclass
    ) then 'OK' else 'ERROR' end
  union all
  select
    'season_status_constraint',
    'present',
    case when exists (
      select 1
      from pg_constraint
      where conname = 'intersaison_survey_seasons_status_check'
        and conrelid = 'public.intersaison_survey_seasons'::regclass
    ) then 'present' else 'missing' end,
    case when exists (
      select 1
      from pg_constraint
      where conname = 'intersaison_survey_seasons_status_check'
        and conrelid = 'public.intersaison_survey_seasons'::regclass
    ) then 'OK' else 'ERROR' end
  union all
  select
    'campaign_unique_poll',
    'present',
    case when to_regclass('public.intersaison_survey_campaigns_season_poll_uidx') is null then 'missing' else 'present' end,
    case when to_regclass('public.intersaison_survey_campaigns_season_poll_uidx') is null then 'ERROR' else 'OK' end
  union all
  select
    'one_active_season_index',
    'present_with_finished_exclusion',
    case
      when to_regclass('public.intersaison_survey_one_active_season_by_org_idx') is null then 'missing'
      when pg_get_indexdef(to_regclass('public.intersaison_survey_one_active_season_by_org_idx')) ilike '%status <> ''finished''%' then 'present_with_finished_exclusion'
      else 'present_without_expected_predicate'
    end,
    case
      when to_regclass('public.intersaison_survey_one_active_season_by_org_idx') is not null
       and pg_get_indexdef(to_regclass('public.intersaison_survey_one_active_season_by_org_idx')) ilike '%status <> ''finished''%'
      then 'OK'
      else 'ERROR'
    end
  union all
  select
    'recipient_unique_member',
    'present',
    case when to_regclass('public.intersaison_survey_recipients_campaign_member_uidx') is null then 'missing' else 'present' end,
    case when to_regclass('public.intersaison_survey_recipients_campaign_member_uidx') is null then 'ERROR' else 'OK' end
  union all
  select
    'response_current_unique',
    'present',
    case when to_regclass('public.intersaison_survey_responses_current_recipient_uidx') is null then 'missing' else 'present' end,
    case when to_regclass('public.intersaison_survey_responses_current_recipient_uidx') is null then 'ERROR' else 'OK' end
  union all
  select
    'rls_enabled',
    '5',
    count(*) filter (where c.relrowsecurity)::text,
    case when count(*) filter (where c.relrowsecurity) = 5 then 'OK' else 'ERROR' end
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in (
      'intersaison_survey_seasons',
      'intersaison_survey_campaigns',
      'intersaison_survey_recipients',
      'intersaison_survey_responses',
      'intersaison_survey_guild_objectives'
    )
  union all
  select
    'service_role_policies',
    '5',
    count(*)::text,
    case when count(*) = 5 then 'OK' else 'ERROR' end
  from pg_policies
  where schemaname = 'public'
    and policyname in (
      'intersaison_survey_seasons_service_role_all',
      'intersaison_survey_campaigns_service_role_all',
      'intersaison_survey_recipients_service_role_all',
      'intersaison_survey_responses_service_role_all',
      'intersaison_survey_objectives_service_role_all'
    )
  union all
  select
    'orphan_survey_recipients',
    '0',
    count(*)::text,
    case when count(*) = 0 then 'OK' else 'ERROR' end
  from public.intersaison_survey_recipients recipient
  left join public.intersaison_survey_campaigns campaign on campaign.id = recipient.survey_campaign_id
  where campaign.id is null
  union all
  select
    'campaign_season_org_mismatches',
    '0',
    count(*)::text,
    case when count(*) = 0 then 'OK' else 'ERROR' end
  from public.intersaison_survey_campaigns campaign
  join public.intersaison_survey_seasons season on season.id = campaign.season_id
  where campaign.organization_id is distinct from season.organization_id
  union all
  select
    'recipient_campaign_org_mismatches',
    '0',
    count(*)::text,
    case when count(*) = 0 then 'OK' else 'ERROR' end
  from public.intersaison_survey_recipients recipient
  join public.intersaison_survey_campaigns campaign on campaign.id = recipient.survey_campaign_id
  where recipient.organization_id is distinct from campaign.organization_id
  union all
  select
    'recipient_member_guild_org_mismatches',
    '0',
    count(*)::text,
    case when count(*) = 0 then 'OK' else 'ERROR' end
  from public.intersaison_survey_recipients recipient
  join public.guild_members member on member.id = recipient.member_id
  left join public.portal_guilds guild
    on guild.organization_id = recipient.organization_id
   and guild.guild_code = member.guild_code
   and guild.is_active = true
  where recipient.member_id is not null
    and guild.id is null
  union all
  select
    'recipient_dm_org_mismatches',
    '0',
    count(*)::text,
    case when count(*) = 0 then 'OK' else 'ERROR' end
  from public.intersaison_survey_recipients recipient
  join public.guild_dm_recipients dm_recipient on dm_recipient.id = recipient.guild_dm_recipient_id
  where recipient.guild_dm_recipient_id is not null
    and recipient.organization_id is distinct from dm_recipient.organization_id
  union all
  select
    'campaign_dm_org_mismatches',
    '0',
    count(*)::text,
    case when count(*) = 0 then 'OK' else 'ERROR' end
  from public.intersaison_survey_campaigns campaign
  join public.guild_dm_campaigns dm_campaign on dm_campaign.id = campaign.guild_dm_campaign_id
  where campaign.guild_dm_campaign_id is not null
    and campaign.organization_id is distinct from dm_campaign.organization_id
  union all
  select
    'orphan_survey_responses',
    '0',
    count(*)::text,
    case when count(*) = 0 then 'OK' else 'ERROR' end
  from public.intersaison_survey_responses response
  left join public.intersaison_survey_recipients recipient on recipient.id = response.survey_recipient_id
  where recipient.id is null
  union all
  select
    'response_recipient_org_mismatches',
    '0',
    count(*)::text,
    case when count(*) = 0 then 'OK' else 'ERROR' end
  from public.intersaison_survey_responses response
  join public.intersaison_survey_recipients recipient on recipient.id = response.survey_recipient_id
  where response.organization_id is distinct from recipient.organization_id
  union all
  select
    'response_campaign_org_mismatches',
    '0',
    count(*)::text,
    case when count(*) = 0 then 'OK' else 'ERROR' end
  from public.intersaison_survey_responses response
  join public.intersaison_survey_campaigns campaign on campaign.id = response.survey_campaign_id
  where response.organization_id is distinct from campaign.organization_id
  union all
  select
    'objectives_guild_org_mismatches',
    '0',
    count(*)::text,
    case when count(*) = 0 then 'OK' else 'ERROR' end
  from public.intersaison_survey_guild_objectives objective
  left join public.portal_guilds guild
    on guild.organization_id = objective.organization_id
   and guild.guild_code = objective.guild_code
   and guild.is_active = true
  where guild.id is null
)
select check_name, expected_value, actual_value, status
from checks
order by check_name;
