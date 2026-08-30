begin;

create extension if not exists pgcrypto;

create table if not exists public.portal_organization_capabilities (
  organization_id uuid not null references public.portal_organizations(id) on delete cascade,
  capability_key text not null,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by_member_id uuid null references public.guild_members(id) on delete set null,
  updated_by_name text null,
  primary key (organization_id, capability_key),
  constraint portal_organization_capabilities_key_check
    check (capability_key in ('discord_log_reminders', 'discord_defense_dm'))
);

create index if not exists portal_organization_capabilities_key_idx
  on public.portal_organization_capabilities (capability_key, enabled);

alter table public.portal_organization_capabilities enable row level security;
revoke all on table public.portal_organization_capabilities from anon, authenticated;
grant select, insert, update, delete on table public.portal_organization_capabilities to service_role;

drop policy if exists portal_organization_capabilities_service_role_all
  on public.portal_organization_capabilities;
create policy portal_organization_capabilities_service_role_all
on public.portal_organization_capabilities
for all
to service_role
using (true)
with check (true);

create table if not exists public.portal_member_reminders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.portal_organizations(id) on delete cascade,
  guild_code text not null,
  member_id uuid not null references public.guild_members(id) on delete cascade,
  reminder_type text not null,
  sent_by_member_id uuid null references public.guild_members(id) on delete set null,
  sent_by_name text not null,
  discord_user_id text not null,
  message text not null,
  status text not null default 'pending',
  error_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint portal_member_reminders_type_check
    check (reminder_type in ('site_presence', 'pb', 'demonic', 'hero_box')),
  constraint portal_member_reminders_status_check
    check (status in ('pending', 'success', 'failed')),
  constraint portal_member_reminders_guild_code_not_blank
    check (btrim(guild_code) <> ''),
  constraint portal_member_reminders_discord_id_not_blank
    check (btrim(discord_user_id) <> ''),
  constraint portal_member_reminders_message_not_blank
    check (btrim(message) <> '')
);

create index if not exists portal_member_reminders_org_member_type_created_idx
  on public.portal_member_reminders (organization_id, member_id, reminder_type, created_at desc);

create index if not exists portal_member_reminders_latest_success_idx
  on public.portal_member_reminders (organization_id, member_id, reminder_type, created_at desc)
  where status = 'success';

create index if not exists portal_member_reminders_guild_created_idx
  on public.portal_member_reminders (organization_id, guild_code, created_at desc);

alter table public.portal_member_reminders enable row level security;
revoke all on table public.portal_member_reminders from anon, authenticated;
grant select, insert, update, delete on table public.portal_member_reminders to service_role;

drop policy if exists portal_member_reminders_service_role_all
  on public.portal_member_reminders;
create policy portal_member_reminders_service_role_all
on public.portal_member_reminders
for all
to service_role
using (true)
with check (true);

with capability_seed as (
  select
    org.id as organization_id,
    capability.capability_key,
    org.organization_key = 'paladin' as enabled
  from public.portal_organizations org
  cross join (
    values
      ('discord_log_reminders'),
      ('discord_defense_dm')
  ) as capability(capability_key)
  where org.organization_key in ('paladin', 'mad')
)
insert into public.portal_organization_capabilities (
  organization_id,
  capability_key,
  enabled,
  updated_at,
  updated_by_name
)
select
  organization_id,
  capability_key,
  enabled,
  now(),
  'migration'
from capability_seed
on conflict (organization_id, capability_key) do nothing;

update public.portal_organization_capabilities capability
set
  enabled = true,
  updated_at = now(),
  updated_by_name = 'migration'
from public.portal_organizations org
where org.id = capability.organization_id
  and org.organization_key = 'paladin'
  and capability.capability_key in ('discord_log_reminders', 'discord_defense_dm')
  and capability.enabled is distinct from true;

commit;
