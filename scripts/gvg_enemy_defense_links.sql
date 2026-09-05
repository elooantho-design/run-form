begin;

create extension if not exists pgcrypto with schema public;

alter table public.guild_defenses
  add column if not exists source_enemy_defense_id uuid null references public.gvg_enemy_defenses(id) on delete set null,
  add column if not exists source_enemy_defense_fingerprint text null,
  add column if not exists source_enemy_portal_guild_id uuid null references public.portal_guilds(id) on delete set null,
  add column if not exists source_enemy_label text null,
  add column if not exists source_enemy_imported_at timestamptz null;

alter table public.guild_defense_slots
  add column if not exists position text null,
  add column if not exists direction text null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.guild_defense_slots'::regclass
      and conname = 'guild_defense_slots_gvg_position_check'
  ) then
    alter table public.guild_defense_slots
      add constraint guild_defense_slots_gvg_position_check
      check (position is null or position ~ '^[A-Z][1-9][0-9]?$');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.guild_defense_slots'::regclass
      and conname = 'guild_defense_slots_gvg_direction_check'
  ) then
    alter table public.guild_defense_slots
      add constraint guild_defense_slots_gvg_direction_check
      check (direction is null or direction in ('N', 'S', 'E', 'O'));
  end if;
end $$;

create table if not exists public.gvg_enemy_defense_similarity_reviews (
  id uuid primary key default gen_random_uuid(),
  enemy_defense_id uuid not null references public.gvg_enemy_defenses(id) on delete cascade,
  local_defense_id uuid not null references public.guild_defenses(id) on delete cascade,
  organization_id uuid not null references public.portal_organizations(id) on delete restrict,
  local_portal_guild_id uuid null references public.portal_guilds(id) on delete restrict,
  local_guild_code text not null,
  status text not null default 'pending',
  reviewed_by_member_id uuid null references public.guild_members(id) on delete set null,
  reviewed_by_name text null,
  reviewed_at timestamptz null,
  enemy_identity_signature text not null,
  local_identity_signature text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gvg_enemy_defense_similarity_reviews_status_check
    check (status in ('pending', 'identical', 'different')),
  constraint gvg_enemy_defense_similarity_reviews_unique_pair
    unique (enemy_defense_id, local_defense_id)
);

create table if not exists public.gvg_enemy_defense_strat_availability (
  id uuid primary key default gen_random_uuid(),
  enemy_defense_id uuid not null references public.gvg_enemy_defenses(id) on delete cascade,
  organization_id uuid not null references public.portal_organizations(id) on delete cascade,
  portal_guild_id uuid not null references public.portal_guilds(id) on delete cascade,
  guild_code text not null,
  available_strat_count integer not null default 0,
  checked_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gvg_enemy_defense_strat_availability_count_check
    check (available_strat_count >= 0),
  constraint gvg_enemy_defense_strat_availability_unique
    unique (enemy_defense_id, portal_guild_id)
);

create index if not exists gvg_enemy_similarity_reviews_enemy_status_idx
  on public.gvg_enemy_defense_similarity_reviews (enemy_defense_id, status);

create index if not exists gvg_enemy_similarity_reviews_org_status_idx
  on public.gvg_enemy_defense_similarity_reviews (organization_id, status, updated_at desc);

create index if not exists gvg_enemy_similarity_reviews_local_idx
  on public.gvg_enemy_defense_similarity_reviews (local_defense_id);

create index if not exists gvg_enemy_similarity_reviews_local_guild_idx
  on public.gvg_enemy_defense_similarity_reviews (organization_id, local_guild_code, status);

create index if not exists gvg_enemy_similarity_reviews_signatures_idx
  on public.gvg_enemy_defense_similarity_reviews (enemy_identity_signature, local_identity_signature);

create index if not exists guild_defenses_source_enemy_idx
  on public.guild_defenses (source_enemy_defense_id)
  where source_enemy_defense_id is not null;

create index if not exists guild_defenses_source_enemy_fingerprint_idx
  on public.guild_defenses (source_enemy_defense_fingerprint)
  where source_enemy_defense_fingerprint is not null;

create index if not exists guild_defense_slots_position_direction_idx
  on public.guild_defense_slots (position, direction)
  where position is not null or direction is not null;

create index if not exists gvg_enemy_strat_availability_org_guild_idx
  on public.gvg_enemy_defense_strat_availability (organization_id, portal_guild_id, updated_at desc);

create index if not exists gvg_enemy_strat_availability_enemy_idx
  on public.gvg_enemy_defense_strat_availability (enemy_defense_id, portal_guild_id);

create or replace function public.gvg_enemy_defense_links_touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.gvg_enemy_defense_links_touch_updated_at() from public, anon, authenticated;
grant execute on function public.gvg_enemy_defense_links_touch_updated_at() to service_role;

drop trigger if exists gvg_enemy_similarity_reviews_touch_updated_at
  on public.gvg_enemy_defense_similarity_reviews;
create trigger gvg_enemy_similarity_reviews_touch_updated_at
before update on public.gvg_enemy_defense_similarity_reviews
for each row
execute function public.gvg_enemy_defense_links_touch_updated_at();

drop trigger if exists gvg_enemy_strat_availability_touch_updated_at
  on public.gvg_enemy_defense_strat_availability;
create trigger gvg_enemy_strat_availability_touch_updated_at
before update on public.gvg_enemy_defense_strat_availability
for each row
execute function public.gvg_enemy_defense_links_touch_updated_at();

alter table public.gvg_enemy_defense_similarity_reviews enable row level security;
alter table public.gvg_enemy_defense_strat_availability enable row level security;

revoke all on table public.gvg_enemy_defense_similarity_reviews from anon, authenticated;
revoke all on table public.gvg_enemy_defense_strat_availability from anon, authenticated;

grant select, insert, update, delete on table public.gvg_enemy_defense_similarity_reviews to service_role;
grant select, insert, update, delete on table public.gvg_enemy_defense_strat_availability to service_role;

drop policy if exists gvg_enemy_similarity_reviews_service_role_all
  on public.gvg_enemy_defense_similarity_reviews;
create policy gvg_enemy_similarity_reviews_service_role_all
on public.gvg_enemy_defense_similarity_reviews
for all
to service_role
using (true)
with check (true);

drop policy if exists gvg_enemy_strat_availability_service_role_all
  on public.gvg_enemy_defense_strat_availability;
create policy gvg_enemy_strat_availability_service_role_all
on public.gvg_enemy_defense_strat_availability
for all
to service_role
using (true)
with check (true);

comment on table public.gvg_enemy_defense_similarity_reviews
  is 'Human reviews for possible matches between seasonal enemy defenses and local guild defenses.';

comment on table public.gvg_enemy_defense_strat_availability
  is 'Per guild cached count of usable strats for enemy defense bank cards.';

comment on column public.guild_defenses.source_enemy_defense_id
  is 'Optional link to the canonical enemy defense that produced or matched this local defense. Set null on enemy purge.';

comment on column public.guild_defenses.source_enemy_defense_fingerprint
  is 'Persistent enemy defense fingerprint kept even if the seasonal canonical row is purged.';

comment on column public.guild_defense_slots.position
  is 'Optional GvG board position populated from validated/imported enemy defenses.';

comment on column public.guild_defense_slots.direction
  is 'Optional GvG direction populated from validated/imported enemy defenses.';

commit;
