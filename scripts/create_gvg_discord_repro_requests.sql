create table if not exists public.gvg_discord_repro_requests (
  id uuid primary key default gen_random_uuid(),
  guild text not null default 'G1',
  gvg_defense_id uuid not null references public.gvg_defense(id) on delete cascade,
  discord_channel_id text not null,
  discord_message_id text null unique,
  discord_response_message_id text null,
  reproducer_member_id uuid null references public.guild_members(id) on delete set null,
  reproducer_discord_id text null,
  reproducer_name text null,
  state text not null default 'requested',
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  repro_submitted_at timestamptz null,
  opened_at timestamptz null,
  constraint gvg_discord_repro_requests_state_check
    check (state in ('requested', 'send_failed', 'repro_active', 'opened', 'deleted'))
);

create unique index if not exists gvg_discord_repro_requests_defense_uidx
  on public.gvg_discord_repro_requests(gvg_defense_id);

create index if not exists gvg_discord_repro_requests_guild_state_idx
  on public.gvg_discord_repro_requests(guild, state);

create index if not exists gvg_discord_repro_requests_message_idx
  on public.gvg_discord_repro_requests(discord_message_id);

comment on table public.gvg_discord_repro_requests
  is 'Lien entre une defense GVG Portal et le message Discord de demande de repro.';
