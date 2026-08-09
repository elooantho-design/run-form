begin;

create table if not exists public.portal_guilds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.portal_organizations(id) on delete restrict,
  guild_code text not null,
  display_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint portal_guilds_code_not_blank check (btrim(guild_code) <> ''),
  constraint portal_guilds_display_not_blank check (btrim(display_name) <> ''),
  constraint portal_guilds_org_code_unique unique (organization_id, guild_code)
);

alter table public.portal_guilds enable row level security;

revoke all on table public.portal_guilds from anon, authenticated;
grant select, insert, update, delete on table public.portal_guilds to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'portal_guilds'
      and policyname = 'portal_guilds_service_role_all'
  ) then
    create policy portal_guilds_service_role_all
    on public.portal_guilds
    for all
    to service_role
    using (true)
    with check (true);
  end if;
end $$;

-- Temporary migration guard: guild_members and several current joins still identify
-- a guild by guild_code alone. This must be dropped after guild_members.portal_guild_id
-- becomes the source of truth everywhere.
create unique index if not exists portal_guilds_guild_code_temporary_unique_idx
  on public.portal_guilds (guild_code);

create index if not exists portal_guilds_organization_active_idx
  on public.portal_guilds (organization_id, is_active, guild_code);

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'portal_guilds_touch_updated_at'
      and tgrelid = 'public.portal_guilds'::regclass
  ) then
    create trigger portal_guilds_touch_updated_at
    before update on public.portal_guilds
    for each row
    execute function public.portal_touch_updated_at();
  end if;
end $$;

commit;
