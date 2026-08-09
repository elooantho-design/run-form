begin;

create table if not exists public.portal_organizations (
  id uuid primary key default gen_random_uuid(),
  organization_key text not null unique,
  display_name text not null,
  organization_type text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint portal_organizations_key_not_blank check (btrim(organization_key) <> ''),
  constraint portal_organizations_key_format check (organization_key = lower(organization_key) and organization_key ~ '^[a-z0-9][a-z0-9_-]*$'),
  constraint portal_organizations_display_not_blank check (btrim(display_name) <> ''),
  constraint portal_organizations_type_not_blank check (btrim(organization_type) <> '')
);

alter table public.portal_organizations enable row level security;

revoke all on table public.portal_organizations from anon, authenticated;
grant select, insert, update, delete on table public.portal_organizations to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'portal_organizations'
      and policyname = 'portal_organizations_service_role_all'
  ) then
    create policy portal_organizations_service_role_all
    on public.portal_organizations
    for all
    to service_role
    using (true)
    with check (true);
  end if;
end $$;

create index if not exists portal_organizations_type_active_idx
  on public.portal_organizations (organization_type, is_active);

create function public.portal_organizations_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.portal_organizations_touch_updated_at() from public, anon, authenticated;
grant execute on function public.portal_organizations_touch_updated_at() to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'portal_organizations_touch_updated_at'
      and tgrelid = 'public.portal_organizations'::regclass
  ) then
    create trigger portal_organizations_touch_updated_at
    before update on public.portal_organizations
    for each row
    execute function public.portal_organizations_touch_updated_at();
  end if;
end $$;

commit;
