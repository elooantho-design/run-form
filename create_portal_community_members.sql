create table if not exists public.portal_community_access_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  discord_contact text not null,
  preferred_language text not null default 'fr',
  guild_name text null,
  message text null,
  status text not null default 'pending',
  source_ip text null,
  handled_at timestamptz null,
  handled_by_member_id uuid null references public.guild_members(id) on delete set null,
  handled_by_name text null,
  created_member_id uuid null references public.guild_members(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
);

alter table public.guild_members
  add column if not exists community_access_type text null;

alter table public.guild_members
  add column if not exists community_status text not null default 'active';

alter table public.guild_members
  add column if not exists preferred_language text null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'portal_community_access_requests_status_check'
  ) then
    alter table public.portal_community_access_requests
      add constraint portal_community_access_requests_status_check
      check (status in ('pending', 'accepted', 'refused'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'portal_community_access_requests_language_check'
  ) then
    alter table public.portal_community_access_requests
      add constraint portal_community_access_requests_language_check
      check (preferred_language in ('fr', 'en'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'guild_members_community_access_type_check'
  ) then
    alter table public.guild_members
      add constraint guild_members_community_access_type_check
      check (community_access_type is null or community_access_type = 'community');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'guild_members_community_status_check'
  ) then
    alter table public.guild_members
      add constraint guild_members_community_status_check
      check (community_status in ('active', 'inactive'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'guild_members_preferred_language_check'
  ) then
    alter table public.guild_members
      add constraint guild_members_preferred_language_check
      check (preferred_language is null or preferred_language in ('fr', 'en'));
  end if;
end $$;

create index if not exists portal_community_access_requests_status_created_idx
  on public.portal_community_access_requests (status, created_at desc);

create index if not exists portal_community_access_requests_discord_contact_idx
  on public.portal_community_access_requests (discord_contact);

create index if not exists guild_members_community_access_type_idx
  on public.guild_members (community_access_type);

create index if not exists guild_members_community_status_idx
  on public.guild_members (community_status);

create or replace function public.set_portal_community_access_requests_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'portal_community_access_requests_updated_at'
  ) then
    create trigger portal_community_access_requests_updated_at
      before update on public.portal_community_access_requests
      for each row
      execute function public.set_portal_community_access_requests_updated_at();
  end if;
end $$;

alter table public.portal_community_access_requests enable row level security;

revoke all on table public.portal_community_access_requests from anon, authenticated;
