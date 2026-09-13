begin;

alter table public.gvg_discord_repro_requests
  add column if not exists requester_member_id uuid null references public.guild_members(id) on delete set null,
  add column if not exists requester_discord_id text null,
  add column if not exists requester_name text null,
  add column if not exists compatible_message_id text null,
  add column if not exists min_awakenings jsonb not null default '{}'::jsonb,
  add column if not exists conditions_updated boolean not null default false;

create table if not exists public.gvg_discord_repro_controls (
  id uuid primary key default gen_random_uuid(),
  guild text not null,
  discord_channel_id text not null,
  discord_message_id text null,
  state text not null default 'active',
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gvg_discord_repro_controls_state_check
    check (state in ('active', 'deleted', 'send_failed'))
);

create unique index if not exists gvg_discord_repro_controls_guild_active_uidx
  on public.gvg_discord_repro_controls(guild)
  where state in ('active', 'send_failed');

create unique index if not exists gvg_discord_repro_controls_message_uidx
  on public.gvg_discord_repro_controls(discord_message_id)
  where discord_message_id is not null;

create index if not exists gvg_discord_repro_controls_guild_state_idx
  on public.gvg_discord_repro_controls(guild, state);

create table if not exists public.gvg_discord_repro_participants (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.gvg_discord_repro_requests(id) on delete cascade,
  member_id uuid not null references public.guild_members(id) on delete cascade,
  discord_user_id text not null,
  display_name text not null,
  comment text null,
  warning_active boolean not null default false,
  ping_message_id text null,
  state text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gvg_discord_repro_participants_state_check
    check (state in ('pending', 'active', 'cancelled', 'deleted'))
);

create unique index if not exists gvg_discord_repro_participants_active_member_uidx
  on public.gvg_discord_repro_participants(request_id, member_id)
  where state in ('pending', 'active');

create index if not exists gvg_discord_repro_participants_request_state_idx
  on public.gvg_discord_repro_participants(request_id, state);

create index if not exists gvg_discord_repro_participants_member_state_idx
  on public.gvg_discord_repro_participants(member_id, state);

alter table public.gvg_discord_repro_controls enable row level security;
alter table public.gvg_discord_repro_participants enable row level security;

revoke all on public.gvg_discord_repro_controls from anon, authenticated;
revoke all on public.gvg_discord_repro_participants from anon, authenticated;

grant select, insert, update, delete on public.gvg_discord_repro_controls to service_role;
grant select, insert, update, delete on public.gvg_discord_repro_participants to service_role;

drop policy if exists gvg_discord_repro_controls_service_role_all on public.gvg_discord_repro_controls;
create policy gvg_discord_repro_controls_service_role_all
on public.gvg_discord_repro_controls
for all
to service_role
using (true)
with check (true);

drop policy if exists gvg_discord_repro_participants_service_role_all on public.gvg_discord_repro_participants;
create policy gvg_discord_repro_participants_service_role_all
on public.gvg_discord_repro_participants
for all
to service_role
using (true)
with check (true);

commit;
