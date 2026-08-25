begin;

create table if not exists public.portal_cosmetic_unlock_tiers (
  id uuid primary key default gen_random_uuid(),
  tier_type text not null,
  threshold_value integer not null,
  display_name text not null,
  public_description text null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint portal_cosmetic_unlock_tiers_type_check
    check (tier_type in ('support_total', 'monthly_loyalty')),
  constraint portal_cosmetic_unlock_tiers_threshold_check
    check (threshold_value > 0),
  constraint portal_cosmetic_unlock_tiers_display_name_check
    check (length(btrim(display_name)) > 0),
  constraint portal_cosmetic_unlock_tiers_type_threshold_unique
    unique (tier_type, threshold_value)
);

create table if not exists public.portal_cosmetic_access_rules (
  asset_id uuid primary key
    references public.portal_cosmetic_assets(id)
    on delete cascade,
  access_type text not null default 'basic',
  tier_id uuid null
    references public.portal_cosmetic_unlock_tiers(id)
    on delete restrict,
  public_unlock_title text null,
  public_unlock_description text null,
  updated_by_member_id uuid null
    references public.guild_members(id)
    on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint portal_cosmetic_access_rules_type_check
    check (access_type in ('basic', 'tier', 'manual')),
  constraint portal_cosmetic_access_rules_tier_check
    check (
      (access_type = 'tier' and tier_id is not null)
      or (access_type in ('basic', 'manual') and tier_id is null)
    )
);

create table if not exists public.portal_member_cosmetic_grants (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null
    references public.guild_members(id)
    on delete cascade,
  asset_id uuid not null
    references public.portal_cosmetic_assets(id)
    on delete restrict,
  grant_title text not null,
  grant_description text null,
  granted_by_member_id uuid null
    references public.guild_members(id)
    on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  constraint portal_member_cosmetic_grants_title_check
    check (length(btrim(grant_title)) > 0),
  constraint portal_member_cosmetic_grants_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create index if not exists portal_cosmetic_unlock_tiers_sort_idx
  on public.portal_cosmetic_unlock_tiers (tier_type, is_active, sort_order, threshold_value);

create index if not exists portal_cosmetic_access_rules_access_idx
  on public.portal_cosmetic_access_rules (access_type, tier_id);

create index if not exists portal_member_cosmetic_grants_member_idx
  on public.portal_member_cosmetic_grants (member_id, revoked_at, granted_at desc);

create index if not exists portal_member_cosmetic_grants_asset_idx
  on public.portal_member_cosmetic_grants (asset_id, revoked_at, granted_at desc);

create unique index if not exists portal_member_cosmetic_grants_active_uidx
  on public.portal_member_cosmetic_grants (member_id, asset_id)
  where revoked_at is null;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.portal_cosmetic_unlock_tiers'::regclass
      and tgname = 'portal_cosmetic_unlock_tiers_touch_updated_at'
  ) then
    create trigger portal_cosmetic_unlock_tiers_touch_updated_at
    before update on public.portal_cosmetic_unlock_tiers
    for each row
    execute function public.profile_cosmetics_touch_updated_at();
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.portal_cosmetic_access_rules'::regclass
      and tgname = 'portal_cosmetic_access_rules_touch_updated_at'
  ) then
    create trigger portal_cosmetic_access_rules_touch_updated_at
    before update on public.portal_cosmetic_access_rules
    for each row
    execute function public.profile_cosmetics_touch_updated_at();
  end if;
end;
$$;

alter table public.portal_cosmetic_unlock_tiers enable row level security;
alter table public.portal_cosmetic_access_rules enable row level security;
alter table public.portal_member_cosmetic_grants enable row level security;

revoke all on table public.portal_cosmetic_unlock_tiers from anon, authenticated;
revoke all on table public.portal_cosmetic_access_rules from anon, authenticated;
revoke all on table public.portal_member_cosmetic_grants from anon, authenticated;

grant select, insert, update, delete on table public.portal_cosmetic_unlock_tiers to service_role;
grant select, insert, update, delete on table public.portal_cosmetic_access_rules to service_role;
grant select, insert, update, delete on table public.portal_member_cosmetic_grants to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'portal_cosmetic_unlock_tiers'
      and policyname = 'portal_cosmetic_unlock_tiers_service_role_all'
  ) then
    execute 'create policy portal_cosmetic_unlock_tiers_service_role_all on public.portal_cosmetic_unlock_tiers for all to service_role using (true) with check (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'portal_cosmetic_access_rules'
      and policyname = 'portal_cosmetic_access_rules_service_role_all'
  ) then
    execute 'create policy portal_cosmetic_access_rules_service_role_all on public.portal_cosmetic_access_rules for all to service_role using (true) with check (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'portal_member_cosmetic_grants'
      and policyname = 'portal_member_cosmetic_grants_service_role_all'
  ) then
    execute 'create policy portal_member_cosmetic_grants_service_role_all on public.portal_member_cosmetic_grants for all to service_role using (true) with check (true)';
  end if;
end;
$$;

insert into public.portal_cosmetic_access_rules (
  asset_id,
  access_type,
  tier_id,
  public_unlock_title,
  public_unlock_description,
  updated_by_member_id
)
select
  asset.id,
  'basic',
  null,
  null,
  null,
  null
from public.portal_cosmetic_assets asset
where not exists (
  select 1
  from public.portal_cosmetic_access_rules rule
  where rule.asset_id = asset.id
);

commit;
