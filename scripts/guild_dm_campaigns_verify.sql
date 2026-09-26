-- Verify lecture seule pour les campagnes MP Discord de Gestion guilde.

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
    'campaign_columns',
    '15',
    count(*)::text,
    case when count(*) = 15 then 'OK' else 'ERROR' end
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'guild_dm_campaigns'
    and column_name in (
      'id',
      'organization_id',
      'created_by_member_id',
      'created_by_name',
      'message',
      'target_guild_codes',
      'status',
      'total_recipients',
      'sent_count',
      'confirmed_count',
      'failed_count',
      'missing_discord_count',
      'sent_at',
      'created_at',
      'updated_at'
    )

  union all

  select
    'recipient_columns',
    '18',
    count(*)::text,
    case when count(*) = 18 then 'OK' else 'ERROR' end
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'guild_dm_recipients'
    and column_name in (
      'id',
      'campaign_id',
      'organization_id',
      'member_id',
      'guild_code',
      'member_name_snapshot',
      'discord_user_id',
      'status',
      'sent_at',
      'last_sent_at',
      'confirmed_at',
      'send_attempts',
      'last_attempt_at',
      'last_error',
      'reminder_count',
      'discord_message_id',
      'created_at',
      'updated_at'
    )

  union all

  select
    'recipient_unique_campaign_discord',
    'present',
    case when to_regclass('public.guild_dm_recipients_campaign_discord_uidx') is not null then 'present' else 'missing' end,
    case when to_regclass('public.guild_dm_recipients_campaign_discord_uidx') is not null then 'OK' else 'ERROR' end

  union all

  select
    'recipient_queue_index',
    'present',
    case when to_regclass('public.guild_dm_recipients_queue_idx') is not null then 'present' else 'missing' end,
    case when to_regclass('public.guild_dm_recipients_queue_idx') is not null then 'OK' else 'ERROR' end

  union all

  select
    'campaign_status_constraint',
    'present',
    case when exists (
      select 1
      from pg_constraint
      where conname = 'guild_dm_campaigns_status_check'
    ) then 'present' else 'missing' end,
    case when exists (
      select 1
      from pg_constraint
      where conname = 'guild_dm_campaigns_status_check'
    ) then 'OK' else 'ERROR' end

  union all

  select
    'recipient_status_constraint',
    'present',
    case when exists (
      select 1
      from pg_constraint
      where conname = 'guild_dm_recipients_status_check'
    ) then 'present' else 'missing' end,
    case when exists (
      select 1
      from pg_constraint
      where conname = 'guild_dm_recipients_status_check'
    ) then 'OK' else 'ERROR' end

  union all

  select
    'campaign_rls',
    'enabled',
    case when relrowsecurity then 'enabled' else 'disabled' end,
    case when relrowsecurity then 'OK' else 'ERROR' end
  from pg_class
  where oid = 'public.guild_dm_campaigns'::regclass

  union all

  select
    'recipient_rls',
    'enabled',
    case when relrowsecurity then 'enabled' else 'disabled' end,
    case when relrowsecurity then 'OK' else 'ERROR' end
  from pg_class
  where oid = 'public.guild_dm_recipients'::regclass

  union all

  select
    'campaign_service_role_policy',
    'present',
    case when exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'guild_dm_campaigns'
        and policyname = 'guild_dm_campaigns_service_role_all'
    ) then 'present' else 'missing' end,
    case when exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'guild_dm_campaigns'
        and policyname = 'guild_dm_campaigns_service_role_all'
    ) then 'OK' else 'ERROR' end

  union all

  select
    'recipient_service_role_policy',
    'present',
    case when exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'guild_dm_recipients'
        and policyname = 'guild_dm_recipients_service_role_all'
    ) then 'present' else 'missing' end,
    case when exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'guild_dm_recipients'
        and policyname = 'guild_dm_recipients_service_role_all'
    ) then 'OK' else 'ERROR' end

  union all

  select
    'cross_organization_recipients',
    '0',
    count(*)::text,
    case when count(*) = 0 then 'OK' else 'ERROR' end
  from public.guild_dm_recipients recipient
  join public.guild_dm_campaigns campaign on campaign.id = recipient.campaign_id
  where recipient.organization_id is distinct from campaign.organization_id
)
select *
from checks
order by check_name;
