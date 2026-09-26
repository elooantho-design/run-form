begin;

alter table public.guild_dm_campaigns
  drop constraint if exists guild_dm_campaigns_status_check;

alter table public.guild_dm_campaigns
  add constraint guild_dm_campaigns_status_check
  check (status in ('queued', 'sending', 'completed', 'partial', 'failed', 'cancelled'));

alter table public.guild_dm_recipients
  drop constraint if exists guild_dm_recipients_status_check;

alter table public.guild_dm_recipients
  add constraint guild_dm_recipients_status_check
  check (status in ('queued', 'sending', 'sent', 'confirmed', 'failed', 'cancelled'));

commit;
