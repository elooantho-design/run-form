begin;

create extension if not exists pgcrypto;

create table if not exists public.guild_member_admin_vision_state (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.portal_organizations(id) on delete cascade,
  guild_code text not null,
  member_id uuid not null references public.guild_members(id) on delete cascade,
  manual_verified boolean not null default false,
  manual_verified_at timestamptz null,
  manual_verified_by_member_id uuid null references public.guild_members(id) on delete set null,
  discord_status text not null default 'not_checked',
  discord_checked_at timestamptz null,
  discord_checked_by_member_id uuid null references public.guild_members(id) on delete set null,
  discord_id_snapshot text null,
  discord_display_name text null,
  discord_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guild_member_admin_vision_state_guild_not_blank
    check (btrim(guild_code) <> ''),
  constraint guild_member_admin_vision_state_discord_status_check
    check (discord_status in ('not_checked', 'verified', 'missing_invalid', 'not_found', 'error')),
  constraint guild_member_admin_vision_state_member_unique
    unique (organization_id, guild_code, member_id)
);

create index if not exists guild_member_admin_vision_org_guild_manual_idx
  on public.guild_member_admin_vision_state (organization_id, guild_code, manual_verified, member_id);

create index if not exists guild_member_admin_vision_discord_status_idx
  on public.guild_member_admin_vision_state (organization_id, guild_code, discord_status, discord_checked_at desc);

create or replace function public.guild_member_admin_vision_touch_updated_at()
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

revoke all on function public.guild_member_admin_vision_touch_updated_at() from public, anon, authenticated;
grant execute on function public.guild_member_admin_vision_touch_updated_at() to service_role;

drop trigger if exists guild_member_admin_vision_touch_updated_at
  on public.guild_member_admin_vision_state;
create trigger guild_member_admin_vision_touch_updated_at
before update on public.guild_member_admin_vision_state
for each row
execute function public.guild_member_admin_vision_touch_updated_at();

alter table public.guild_member_admin_vision_state enable row level security;
revoke all on table public.guild_member_admin_vision_state from anon, authenticated;
grant select, insert, update, delete on table public.guild_member_admin_vision_state to service_role;

drop policy if exists guild_member_admin_vision_service_role_all
  on public.guild_member_admin_vision_state;
create policy guild_member_admin_vision_service_role_all
on public.guild_member_admin_vision_state
for all
to service_role
using (true)
with check (true);

commit;
