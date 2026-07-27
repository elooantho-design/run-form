-- Profils createurs PVE enrichis.
-- A executer apres les migrations PVE de base et pve_creators.
-- Migration additive, transactionnelle et idempotente.

begin;

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.pve_creators') is null then
    raise exception 'Table public.pve_creators introuvable. Execute d''abord la migration create_pve_library/add_pve_creators.';
  end if;

  if to_regclass('public.guild_members') is null then
    raise exception 'Table public.guild_members introuvable. Impossible de creer la liaison facultative createur -> compte.';
  end if;
end $$;

alter table public.pve_creators
  add column if not exists linked_member_id uuid null;

alter table public.pve_creators
  add column if not exists bio text null;

alter table public.pve_creators
  add column if not exists last_youtube_sync_at timestamptz null;

do $$
declare
  invalid_values text;
  duplicate_values text;
begin
  select string_agg(id::text, ', ')
    into invalid_values
  from public.pve_creators
  where bio is not null
    and char_length(bio) > 1000;

  if invalid_values is not null then
    raise exception 'pve_creators.bio depasse 1000 caracteres pour les ids: %', invalid_values;
  end if;

  select string_agg(linked_member_id::text, ', ')
    into duplicate_values
  from (
    select linked_member_id
    from public.pve_creators
    where linked_member_id is not null
    group by linked_member_id
    having count(*) > 1
  ) duplicates;

  if duplicate_values is not null then
    raise exception 'Plusieurs createurs sont deja lies au meme compte guild_members: %', duplicate_values;
  end if;

  select string_agg(pc.id::text || ' -> ' || pc.linked_member_id::text, ', ')
    into invalid_values
  from public.pve_creators pc
  left join public.guild_members gm on gm.id = pc.linked_member_id
  where pc.linked_member_id is not null
    and gm.id is null;

  if invalid_values is not null then
    raise exception 'Certains linked_member_id ne correspondent a aucun guild_members: %', invalid_values;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.pve_creators'::regclass
      and conname = 'pve_creators_linked_member_id_fkey'
  ) then
    alter table public.pve_creators
      add constraint pve_creators_linked_member_id_fkey
      foreign key (linked_member_id)
      references public.guild_members(id)
      on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.pve_creators'::regclass
      and conname = 'pve_creators_bio_length_chk'
  ) then
    alter table public.pve_creators
      add constraint pve_creators_bio_length_chk
      check (bio is null or char_length(bio) <= 1000);
  end if;
end $$;

create unique index if not exists pve_creators_linked_member_id_uidx
  on public.pve_creators (linked_member_id)
  where linked_member_id is not null;

create table if not exists public.pve_creator_links (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.pve_creators(id) on delete cascade,
  title text not null,
  url text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pve_creator_links
  add column if not exists id uuid default gen_random_uuid();

alter table public.pve_creator_links
  add column if not exists creator_id uuid;

alter table public.pve_creator_links
  add column if not exists title text;

alter table public.pve_creator_links
  add column if not exists url text;

alter table public.pve_creator_links
  add column if not exists sort_order integer default 0;

alter table public.pve_creator_links
  add column if not exists created_at timestamptz default now();

alter table public.pve_creator_links
  add column if not exists updated_at timestamptz default now();

do $$
declare
  invalid_values text;
  duplicate_values text;
begin
  select string_agg(coalesce(id::text, '<id-null>'), ', ')
    into invalid_values
  from public.pve_creator_links
  where id is null;

  if invalid_values is not null then
    raise exception 'pve_creator_links.id null pour les lignes: %', invalid_values;
  end if;

  select string_agg(id::text, ', ')
    into duplicate_values
  from (
    select id
    from public.pve_creator_links
    group by id
    having count(*) > 1
  ) duplicates;

  if duplicate_values is not null then
    raise exception 'pve_creator_links.id duplique pour les ids: %', duplicate_values;
  end if;

  select string_agg(id::text, ', ')
    into invalid_values
  from public.pve_creator_links
  where creator_id is null;

  if invalid_values is not null then
    raise exception 'pve_creator_links.creator_id null pour les ids: %', invalid_values;
  end if;

  select string_agg(pcl.id::text || ' -> ' || pcl.creator_id::text, ', ')
    into invalid_values
  from public.pve_creator_links pcl
  left join public.pve_creators pc on pc.id = pcl.creator_id
  where pc.id is null;

  if invalid_values is not null then
    raise exception 'pve_creator_links.creator_id orphelin pour les lignes: %', invalid_values;
  end if;

  select string_agg(id::text, ', ')
    into invalid_values
  from public.pve_creator_links
  where title is null
    or btrim(title) = ''
    or char_length(title) > 80;

  if invalid_values is not null then
    raise exception 'pve_creator_links.title invalide pour les ids: %', invalid_values;
  end if;

  select string_agg(id::text, ', ')
    into invalid_values
  from public.pve_creator_links
  where url is null
    or btrim(url) = ''
    or char_length(url) > 2048;

  if invalid_values is not null then
    raise exception 'pve_creator_links.url invalide pour les ids: %', invalid_values;
  end if;

  select string_agg(id::text, ', ')
    into invalid_values
  from public.pve_creator_links
  where sort_order is null
    or sort_order < 0;

  if invalid_values is not null then
    raise exception 'pve_creator_links.sort_order invalide pour les ids: %', invalid_values;
  end if;

  select string_agg(id::text, ', ')
    into invalid_values
  from public.pve_creator_links
  where created_at is null
    or updated_at is null;

  if invalid_values is not null then
    raise exception 'pve_creator_links.created_at/updated_at null pour les ids: %', invalid_values;
  end if;
end $$;

alter table public.pve_creator_links
  alter column id set default gen_random_uuid(),
  alter column id set not null,
  alter column creator_id set not null,
  alter column title set not null,
  alter column url set not null,
  alter column sort_order set default 0,
  alter column sort_order set not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.pve_creator_links'::regclass
      and contype = 'p'
  ) then
    alter table public.pve_creator_links
      add constraint pve_creator_links_pkey
      primary key (id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.pve_creator_links'::regclass
      and conname = 'pve_creator_links_creator_id_fkey'
  ) then
    alter table public.pve_creator_links
      add constraint pve_creator_links_creator_id_fkey
      foreign key (creator_id)
      references public.pve_creators(id)
      on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.pve_creator_links'::regclass
      and conname = 'pve_creator_links_title_not_blank_chk'
  ) then
    alter table public.pve_creator_links
      add constraint pve_creator_links_title_not_blank_chk
      check (btrim(title) <> '' and char_length(title) <= 80);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.pve_creator_links'::regclass
      and conname = 'pve_creator_links_url_not_blank_chk'
  ) then
    alter table public.pve_creator_links
      add constraint pve_creator_links_url_not_blank_chk
      check (btrim(url) <> '' and char_length(url) <= 2048);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.pve_creator_links'::regclass
      and conname = 'pve_creator_links_sort_order_chk'
  ) then
    alter table public.pve_creator_links
      add constraint pve_creator_links_sort_order_chk
      check (sort_order >= 0);
  end if;
end $$;

create index if not exists pve_creator_links_creator_sort_idx
  on public.pve_creator_links (creator_id, sort_order, created_at);

create index if not exists pve_creator_links_creator_id_idx
  on public.pve_creator_links (creator_id);

create or replace function public.pve_creator_links_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists pve_creator_links_touch_updated_at on public.pve_creator_links;
create trigger pve_creator_links_touch_updated_at
  before update on public.pve_creator_links
  for each row
  execute function public.pve_creator_links_touch_updated_at();

alter table public.pve_creator_links enable row level security;

revoke all on table public.pve_creator_links from anon, authenticated;
grant select, insert, update, delete on table public.pve_creator_links to service_role;

drop policy if exists pve_creator_links_service_role_all on public.pve_creator_links;
create policy pve_creator_links_service_role_all
  on public.pve_creator_links
  for all
  to service_role
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

commit;
