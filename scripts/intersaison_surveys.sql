begin;

create extension if not exists pgcrypto;

alter table public.guild_dm_campaigns
  add column if not exists interaction_type text not null default 'ack',
  add column if not exists interaction_payload jsonb not null default '{}'::jsonb;

alter table public.guild_dm_campaigns
  drop constraint if exists guild_dm_campaigns_interaction_type_check;

alter table public.guild_dm_campaigns
  add constraint guild_dm_campaigns_interaction_type_check
  check (interaction_type in ('ack', 'none', 'intersaison_objectives', 'intersaison_choice'));

create index if not exists guild_dm_campaigns_interaction_type_idx
  on public.guild_dm_campaigns (interaction_type, status, created_at)
  where interaction_type <> 'ack';

create table if not exists public.intersaison_survey_seasons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.portal_organizations(id) on delete cascade,
  label text not null default 'Inter-saison',
  status text not null default 'inactive',
  created_by_member_id uuid null references public.guild_members(id) on delete set null,
  created_by_name text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint intersaison_survey_seasons_label_not_blank check (btrim(label) <> ''),
  constraint intersaison_survey_seasons_status_check
    check (status in (
      'inactive',
      'survey1_preparing',
      'survey1_open',
      'survey1_closed',
      'survey2_preparing',
      'survey2_open',
      'survey2_closed',
      'finished'
    ))
);

create unique index if not exists intersaison_survey_one_active_season_by_org_idx
  on public.intersaison_survey_seasons (organization_id)
  where status <> 'finished';

create table if not exists public.intersaison_survey_campaigns (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.intersaison_survey_seasons(id) on delete cascade,
  organization_id uuid not null references public.portal_organizations(id) on delete cascade,
  poll_number integer not null,
  guild_dm_campaign_id uuid null references public.guild_dm_campaigns(id) on delete set null,
  status text not null default 'preparing',
  title text not null,
  message text not null,
  target_guild_codes text[] not null default '{}'::text[],
  launched_by_member_id uuid null references public.guild_members(id) on delete set null,
  launched_by_name text null,
  launched_at timestamptz null,
  closed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint intersaison_survey_campaigns_poll_check check (poll_number in (1, 2)),
  constraint intersaison_survey_campaigns_status_check check (status in ('preparing', 'open', 'closed', 'cancelled')),
  constraint intersaison_survey_campaigns_title_not_blank check (btrim(title) <> ''),
  constraint intersaison_survey_campaigns_message_not_blank check (btrim(message) <> '')
);

create unique index if not exists intersaison_survey_campaigns_season_poll_uidx
  on public.intersaison_survey_campaigns (season_id, poll_number)
  where status <> 'cancelled';

create index if not exists intersaison_survey_campaigns_org_poll_idx
  on public.intersaison_survey_campaigns (organization_id, poll_number, status, created_at desc);

create table if not exists public.intersaison_survey_recipients (
  id uuid primary key default gen_random_uuid(),
  survey_campaign_id uuid not null references public.intersaison_survey_campaigns(id) on delete cascade,
  organization_id uuid not null references public.portal_organizations(id) on delete cascade,
  member_id uuid null references public.guild_members(id) on delete set null,
  guild_code_snapshot text not null,
  member_name_snapshot text not null,
  discord_user_id text null,
  guild_dm_recipient_id uuid null references public.guild_dm_recipients(id) on delete set null,
  delivery_status text not null default 'not_included',
  response_status text not null default 'none',
  last_error text null,
  reminder_count integer not null default 0,
  last_reminder_at timestamptz null,
  responded_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint intersaison_survey_recipients_guild_not_blank check (btrim(guild_code_snapshot) <> ''),
  constraint intersaison_survey_recipients_name_not_blank check (btrim(member_name_snapshot) <> ''),
  constraint intersaison_survey_recipients_delivery_status_check
    check (delivery_status in ('not_included', 'queued', 'sending', 'sent', 'confirmed', 'failed', 'missing_invalid', 'excluded_duplicate', 'cancelled')),
  constraint intersaison_survey_recipients_response_status_check
    check (response_status in ('none', 'responded')),
  constraint intersaison_survey_recipients_reminder_count_check check (reminder_count >= 0)
);

create unique index if not exists intersaison_survey_recipients_campaign_member_uidx
  on public.intersaison_survey_recipients (survey_campaign_id, member_id)
  where member_id is not null;

create index if not exists intersaison_survey_recipients_campaign_status_idx
  on public.intersaison_survey_recipients (survey_campaign_id, delivery_status, response_status);

create index if not exists intersaison_survey_recipients_dm_recipient_idx
  on public.intersaison_survey_recipients (guild_dm_recipient_id)
  where guild_dm_recipient_id is not null;

create table if not exists public.intersaison_survey_responses (
  id uuid primary key default gen_random_uuid(),
  survey_campaign_id uuid not null references public.intersaison_survey_campaigns(id) on delete cascade,
  survey_recipient_id uuid not null references public.intersaison_survey_recipients(id) on delete cascade,
  organization_id uuid not null references public.portal_organizations(id) on delete cascade,
  member_id uuid null references public.guild_members(id) on delete set null,
  discord_user_id text null,
  poll_number integer not null,
  guild_code_snapshot text not null,
  member_name_snapshot text not null,
  objective_text text null,
  first_choice_guild_code text null,
  second_choice_guild_code text null,
  comment_text text null,
  response_version integer not null default 1,
  is_current boolean not null default true,
  responded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint intersaison_survey_responses_poll_check check (poll_number in (1, 2)),
  constraint intersaison_survey_responses_version_check check (response_version >= 1)
);

create unique index if not exists intersaison_survey_responses_current_recipient_uidx
  on public.intersaison_survey_responses (survey_recipient_id)
  where is_current = true;

create index if not exists intersaison_survey_responses_campaign_poll_idx
  on public.intersaison_survey_responses (survey_campaign_id, poll_number, responded_at desc);

create table if not exists public.intersaison_survey_guild_objectives (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.intersaison_survey_seasons(id) on delete cascade,
  organization_id uuid not null references public.portal_organizations(id) on delete cascade,
  guild_code text not null,
  objective_text text not null default '',
  updated_by_member_id uuid null references public.guild_members(id) on delete set null,
  updated_by_name text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint intersaison_survey_objectives_guild_not_blank check (btrim(guild_code) <> '')
);

create unique index if not exists intersaison_survey_objectives_season_guild_uidx
  on public.intersaison_survey_guild_objectives (season_id, guild_code);

create or replace function public.intersaison_survey_touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.intersaison_survey_touch_updated_at() from public, anon, authenticated;
grant execute on function public.intersaison_survey_touch_updated_at() to service_role;

drop trigger if exists intersaison_survey_seasons_touch_updated_at on public.intersaison_survey_seasons;
create trigger intersaison_survey_seasons_touch_updated_at
before update on public.intersaison_survey_seasons
for each row execute function public.intersaison_survey_touch_updated_at();

drop trigger if exists intersaison_survey_campaigns_touch_updated_at on public.intersaison_survey_campaigns;
create trigger intersaison_survey_campaigns_touch_updated_at
before update on public.intersaison_survey_campaigns
for each row execute function public.intersaison_survey_touch_updated_at();

drop trigger if exists intersaison_survey_recipients_touch_updated_at on public.intersaison_survey_recipients;
create trigger intersaison_survey_recipients_touch_updated_at
before update on public.intersaison_survey_recipients
for each row execute function public.intersaison_survey_touch_updated_at();

drop trigger if exists intersaison_survey_objectives_touch_updated_at on public.intersaison_survey_guild_objectives;
create trigger intersaison_survey_objectives_touch_updated_at
before update on public.intersaison_survey_guild_objectives
for each row execute function public.intersaison_survey_touch_updated_at();

alter table public.intersaison_survey_seasons enable row level security;
alter table public.intersaison_survey_campaigns enable row level security;
alter table public.intersaison_survey_recipients enable row level security;
alter table public.intersaison_survey_responses enable row level security;
alter table public.intersaison_survey_guild_objectives enable row level security;

revoke all on table public.intersaison_survey_seasons from anon, authenticated;
revoke all on table public.intersaison_survey_campaigns from anon, authenticated;
revoke all on table public.intersaison_survey_recipients from anon, authenticated;
revoke all on table public.intersaison_survey_responses from anon, authenticated;
revoke all on table public.intersaison_survey_guild_objectives from anon, authenticated;

grant select, insert, update, delete on table public.intersaison_survey_seasons to service_role;
grant select, insert, update, delete on table public.intersaison_survey_campaigns to service_role;
grant select, insert, update, delete on table public.intersaison_survey_recipients to service_role;
grant select, insert, update, delete on table public.intersaison_survey_responses to service_role;
grant select, insert, update, delete on table public.intersaison_survey_guild_objectives to service_role;

drop policy if exists intersaison_survey_seasons_service_role_all on public.intersaison_survey_seasons;
create policy intersaison_survey_seasons_service_role_all
on public.intersaison_survey_seasons for all to service_role using (true) with check (true);

drop policy if exists intersaison_survey_campaigns_service_role_all on public.intersaison_survey_campaigns;
create policy intersaison_survey_campaigns_service_role_all
on public.intersaison_survey_campaigns for all to service_role using (true) with check (true);

drop policy if exists intersaison_survey_recipients_service_role_all on public.intersaison_survey_recipients;
create policy intersaison_survey_recipients_service_role_all
on public.intersaison_survey_recipients for all to service_role using (true) with check (true);

drop policy if exists intersaison_survey_responses_service_role_all on public.intersaison_survey_responses;
create policy intersaison_survey_responses_service_role_all
on public.intersaison_survey_responses for all to service_role using (true) with check (true);

drop policy if exists intersaison_survey_objectives_service_role_all on public.intersaison_survey_guild_objectives;
create policy intersaison_survey_objectives_service_role_all
on public.intersaison_survey_guild_objectives for all to service_role using (true) with check (true);

commit;
