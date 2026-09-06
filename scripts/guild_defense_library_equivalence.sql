begin;

create extension if not exists pgcrypto with schema public;

create table if not exists public.guild_defense_library_similarity_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.portal_organizations(id) on delete cascade,
  left_defense_id uuid not null references public.guild_defenses(id) on delete cascade,
  right_defense_id uuid not null references public.guild_defenses(id) on delete cascade,
  status text not null default 'pending',
  reviewed_by_member_id uuid null references public.guild_members(id) on delete set null,
  reviewed_by_name text null,
  reviewed_at timestamptz null,
  left_identity_signature text not null,
  right_identity_signature text not null,
  similarity_signature text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guild_defense_library_similarity_reviews_distinct_pair_check
    check (left_defense_id <> right_defense_id),
  constraint guild_defense_library_similarity_reviews_ordered_pair_check
    check (left_defense_id::text < right_defense_id::text),
  constraint guild_defense_library_similarity_reviews_status_check
    check (status in ('pending', 'identical', 'different')),
  constraint guild_defense_library_similarity_reviews_unique_pair
    unique (left_defense_id, right_defense_id)
);

create index if not exists guild_defense_library_similarity_reviews_org_status_idx
  on public.guild_defense_library_similarity_reviews (organization_id, status, updated_at desc);

create index if not exists guild_defense_library_similarity_reviews_left_idx
  on public.guild_defense_library_similarity_reviews (left_defense_id);

create index if not exists guild_defense_library_similarity_reviews_right_idx
  on public.guild_defense_library_similarity_reviews (right_defense_id);

create index if not exists guild_defense_library_similarity_reviews_signature_idx
  on public.guild_defense_library_similarity_reviews (organization_id, similarity_signature, status);

create or replace function public.guild_defense_library_equivalence_touch_updated_at()
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

revoke all on function public.guild_defense_library_equivalence_touch_updated_at() from public, anon, authenticated;
grant execute on function public.guild_defense_library_equivalence_touch_updated_at() to service_role;

drop trigger if exists guild_defense_library_similarity_reviews_touch_updated_at
  on public.guild_defense_library_similarity_reviews;
create trigger guild_defense_library_similarity_reviews_touch_updated_at
before update on public.guild_defense_library_similarity_reviews
for each row
execute function public.guild_defense_library_equivalence_touch_updated_at();

alter table public.guild_defense_library_similarity_reviews enable row level security;

revoke all on table public.guild_defense_library_similarity_reviews from anon, authenticated;
grant select, insert, update, delete on table public.guild_defense_library_similarity_reviews to service_role;

drop policy if exists guild_defense_library_similarity_reviews_service_role_all
  on public.guild_defense_library_similarity_reviews;
create policy guild_defense_library_similarity_reviews_service_role_all
on public.guild_defense_library_similarity_reviews
for all
to service_role
using (true)
with check (true);

comment on table public.guild_defense_library_similarity_reviews
  is 'Human and automatic reviews for equivalent native/root defense models inside one Portal organization.';

comment on column public.guild_defense_library_similarity_reviews.left_defense_id
  is 'First native/root guild_defenses id in canonical lexical order.';

comment on column public.guild_defense_library_similarity_reviews.right_defense_id
  is 'Second native/root guild_defenses id in canonical lexical order.';

comment on column public.guild_defense_library_similarity_reviews.similarity_signature
  is 'Map type plus the unordered set of five heroes. Used only inside organization_id.';

commit;
