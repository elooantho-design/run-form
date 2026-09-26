begin;

create extension if not exists pgcrypto;

create table if not exists public.guild_dm_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.portal_organizations(id) on delete cascade,
  created_by_member_id uuid null references public.guild_members(id) on delete set null,
  created_by_name text not null default 'Admin',
  message text not null,
  target_guild_codes text[] not null default '{}',
  status text not null default 'queued',
  total_recipients integer not null default 0,
  sent_count integer not null default 0,
  confirmed_count integer not null default 0,
  failed_count integer not null default 0,
  missing_discord_count integer not null default 0,
  sent_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guild_dm_campaigns_message_not_blank
    check (char_length(btrim(message)) between 1 and 1800),
  constraint guild_dm_campaigns_status_check
    check (status in ('queued', 'sending', 'completed', 'partial', 'failed')),
  constraint guild_dm_campaigns_counts_check
    check (
      total_recipients >= 0
      and sent_count >= 0
      and confirmed_count >= 0
      and failed_count >= 0
      and missing_discord_count >= 0
    ),
  constraint guild_dm_campaigns_targets_not_empty
    check (array_length(target_guild_codes, 1) is not null)
);

create table if not exists public.guild_dm_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.guild_dm_campaigns(id) on delete cascade,
  organization_id uuid not null references public.portal_organizations(id) on delete cascade,
  member_id uuid null references public.guild_members(id) on delete set null,
  guild_code text not null,
  member_name_snapshot text not null,
  discord_user_id text not null,
  status text not null default 'queued',
  sent_at timestamptz null,
  last_sent_at timestamptz null,
  confirmed_at timestamptz null,
  send_attempts integer not null default 0,
  last_attempt_at timestamptz null,
  last_error text null,
  reminder_count integer not null default 0,
  discord_message_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guild_dm_recipients_status_check
    check (status in ('queued', 'sending', 'sent', 'confirmed', 'failed')),
  constraint guild_dm_recipients_guild_code_not_blank
    check (btrim(guild_code) <> ''),
  constraint guild_dm_recipients_name_not_blank
    check (btrim(member_name_snapshot) <> ''),
  constraint guild_dm_recipients_discord_id_not_blank
    check (btrim(discord_user_id) <> ''),
  constraint guild_dm_recipients_attempt_counts_check
    check (send_attempts >= 0 and reminder_count >= 0)
);

create unique index if not exists guild_dm_recipients_campaign_discord_uidx
  on public.guild_dm_recipients (campaign_id, discord_user_id);

create index if not exists guild_dm_campaigns_org_created_idx
  on public.guild_dm_campaigns (organization_id, created_at desc);

create index if not exists guild_dm_campaigns_status_idx
  on public.guild_dm_campaigns (status, created_at)
  where status in ('queued', 'sending', 'partial');

create index if not exists guild_dm_recipients_queue_idx
  on public.guild_dm_recipients (status, last_attempt_at nulls first, created_at)
  where status = 'queued';

create index if not exists guild_dm_recipients_campaign_status_idx
  on public.guild_dm_recipients (campaign_id, status, confirmed_at);

create index if not exists guild_dm_recipients_org_discord_idx
  on public.guild_dm_recipients (organization_id, discord_user_id);

alter table public.guild_dm_campaigns enable row level security;
alter table public.guild_dm_recipients enable row level security;

revoke all on table public.guild_dm_campaigns from anon, authenticated;
revoke all on table public.guild_dm_recipients from anon, authenticated;

grant select, insert, update, delete on table public.guild_dm_campaigns to service_role;
grant select, insert, update, delete on table public.guild_dm_recipients to service_role;

drop policy if exists guild_dm_campaigns_service_role_all
  on public.guild_dm_campaigns;
create policy guild_dm_campaigns_service_role_all
on public.guild_dm_campaigns
for all
to service_role
using (true)
with check (true);

drop policy if exists guild_dm_recipients_service_role_all
  on public.guild_dm_recipients;
create policy guild_dm_recipients_service_role_all
on public.guild_dm_recipients
for all
to service_role
using (true)
with check (true);

commit;
