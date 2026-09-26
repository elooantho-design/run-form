-- Verify lecture seule pour la fin de vie des campagnes MP Discord.

with checks as (
  select
    'campaign_status_cancelled_allowed' as check_name,
    'contains cancelled' as expected_value,
    coalesce((
      select pg_get_constraintdef(oid)
      from pg_constraint
      where conname = 'guild_dm_campaigns_status_check'
        and conrelid = 'public.guild_dm_campaigns'::regclass
    ), 'missing') as actual_value,
    case when coalesce((
      select pg_get_constraintdef(oid)
      from pg_constraint
      where conname = 'guild_dm_campaigns_status_check'
        and conrelid = 'public.guild_dm_campaigns'::regclass
    ), '') like '%cancelled%' then 'OK' else 'ERROR' end as status

  union all

  select
    'recipient_status_cancelled_allowed',
    'contains cancelled',
    coalesce((
      select pg_get_constraintdef(oid)
      from pg_constraint
      where conname = 'guild_dm_recipients_status_check'
        and conrelid = 'public.guild_dm_recipients'::regclass
    ), 'missing'),
    case when coalesce((
      select pg_get_constraintdef(oid)
      from pg_constraint
      where conname = 'guild_dm_recipients_status_check'
        and conrelid = 'public.guild_dm_recipients'::regclass
    ), '') like '%cancelled%' then 'OK' else 'ERROR' end

  union all

  select
    'recipients_campaign_fk_delete_rule',
    'CASCADE',
    coalesce((
      select rc.delete_rule
      from information_schema.referential_constraints rc
      join information_schema.table_constraints tc
        on tc.constraint_catalog = rc.constraint_catalog
       and tc.constraint_schema = rc.constraint_schema
       and tc.constraint_name = rc.constraint_name
      where tc.table_schema = 'public'
        and tc.table_name = 'guild_dm_recipients'
        and tc.constraint_type = 'FOREIGN KEY'
        and rc.unique_constraint_name in (
          select constraint_name
          from information_schema.table_constraints
          where table_schema = 'public'
            and table_name = 'guild_dm_campaigns'
            and constraint_type = 'PRIMARY KEY'
        )
      limit 1
    ), 'missing'),
    case when (
      select rc.delete_rule
      from information_schema.referential_constraints rc
      join information_schema.table_constraints tc
        on tc.constraint_catalog = rc.constraint_catalog
       and tc.constraint_schema = rc.constraint_schema
       and tc.constraint_name = rc.constraint_name
      where tc.table_schema = 'public'
        and tc.table_name = 'guild_dm_recipients'
        and tc.constraint_type = 'FOREIGN KEY'
        and rc.unique_constraint_name in (
          select constraint_name
          from information_schema.table_constraints
          where table_schema = 'public'
            and table_name = 'guild_dm_campaigns'
            and constraint_type = 'PRIMARY KEY'
        )
      limit 1
    ) = 'CASCADE' then 'OK' else 'ERROR' end

  union all

  select
    'invalid_campaign_statuses',
    '0',
    count(*)::text,
    case when count(*) = 0 then 'OK' else 'ERROR' end
  from public.guild_dm_campaigns
  where status not in ('queued', 'sending', 'completed', 'partial', 'failed', 'cancelled')

  union all

  select
    'invalid_recipient_statuses',
    '0',
    count(*)::text,
    case when count(*) = 0 then 'OK' else 'ERROR' end
  from public.guild_dm_recipients
  where status not in ('queued', 'sending', 'sent', 'confirmed', 'failed', 'cancelled')
)
select *
from checks
order by check_name;
