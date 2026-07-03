create extension if not exists pgcrypto;

create table if not exists public.portal_guild_licenses (
  id uuid primary key default gen_random_uuid(),
  guild_space_key text not null unique,
  guild_label text not null,
  plan text not null default 'trial_private',
  status text not null default 'trial',
  trial_started_at timestamptz null,
  trial_ends_at timestamptz null,
  current_period_started_at timestamptz null,
  current_period_ends_at timestamptz null,
  notes text not null default '',
  updated_by uuid null,
  updated_by_name text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint portal_guild_licenses_plan_check check (
    plan in ('trial_private', 'trial_paladin', 'manual', 'gvg', 'complete', 'suspended')
  ),
  constraint portal_guild_licenses_status_check check (
    status in ('active', 'trial', 'suspended', 'cancelled')
  )
);

create index if not exists portal_guild_licenses_space_idx
  on public.portal_guild_licenses (guild_space_key);

create index if not exists portal_guild_licenses_status_idx
  on public.portal_guild_licenses (status);

insert into public.portal_guild_licenses (
  guild_space_key,
  guild_label,
  plan,
  status,
  trial_started_at,
  trial_ends_at,
  notes
) values (
  'GUILDTEST',
  'Guild Test',
  'trial_private',
  'trial',
  now(),
  now() + interval '1 month',
  'Espace de test des abonnements.'
) on conflict (guild_space_key) do nothing;
