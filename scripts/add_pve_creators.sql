-- Migration ciblee : systeme de createurs YouTube pour la bibliotheque PVE.
-- Etat attendu avant execution : les tables PVE principales existent deja.
-- Cette migration ne modifie aucune video existante et ne cree aucun createur.

create table if not exists public.pve_creators (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  creator_key text not null,
  channel_url text null,
  avatar_url text null,
  youtube_channel_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pve_creators
  add column if not exists youtube_channel_id text null;

alter table public.pve_videos
  add column if not exists creator_id uuid null;

alter table public.pve_videos
  add column if not exists suggested_creator_name text null;

create or replace function public.pve_creators_normalize()
returns trigger
language plpgsql
as $$
begin
  new.name = btrim(new.name);
  new.creator_key = lower(btrim(new.creator_key));
  new.channel_url = nullif(regexp_replace(btrim(coalesce(new.channel_url, '')), '/+$', ''), '');
  new.avatar_url = nullif(regexp_replace(btrim(coalesce(new.avatar_url, '')), '/+$', ''), '');
  new.youtube_channel_id = nullif(btrim(coalesce(new.youtube_channel_id, '')), '');
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists pve_creators_set_updated_at on public.pve_creators;
drop trigger if exists pve_creators_normalize on public.pve_creators;
create trigger pve_creators_normalize
  before insert or update on public.pve_creators
  for each row
  execute function public.pve_creators_normalize();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pve_creators_name_not_blank_chk'
      and conrelid = 'public.pve_creators'::regclass
  ) then
    alter table public.pve_creators
      add constraint pve_creators_name_not_blank_chk
      check (btrim(name) <> '');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pve_creators_creator_key_lowercase_chk'
      and conrelid = 'public.pve_creators'::regclass
  ) then
    alter table public.pve_creators
      add constraint pve_creators_creator_key_lowercase_chk
      check (creator_key = lower(btrim(creator_key)) and creator_key <> '');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pve_videos_creator_id_fkey'
      and conrelid = 'public.pve_videos'::regclass
  ) then
    alter table public.pve_videos
      add constraint pve_videos_creator_id_fkey
      foreign key (creator_id)
      references public.pve_creators(id)
      on delete set null;
  end if;
end $$;

create unique index if not exists pve_creators_creator_key_lower_idx
  on public.pve_creators (lower(creator_key));

create unique index if not exists pve_creators_channel_url_normalized_idx
  on public.pve_creators (
    lower(regexp_replace(regexp_replace(btrim(channel_url), '^https?://(www\.)?', '', 'i'), '/+$', ''))
  )
  where channel_url is not null and btrim(channel_url) <> '';

create unique index if not exists pve_creators_youtube_channel_id_idx
  on public.pve_creators (youtube_channel_id)
  where youtube_channel_id is not null and btrim(youtube_channel_id) <> '';

create index if not exists pve_videos_creator_idx
  on public.pve_videos (creator_id);

create index if not exists pve_videos_suggested_creator_pending_idx
  on public.pve_videos (content_id, suggested_creator_name)
  where creator_id is null
    and suggested_creator_name is not null
    and btrim(suggested_creator_name) <> '';

revoke insert, update, delete on public.pve_creators from anon, authenticated;
grant select on public.pve_creators to anon, authenticated;
grant select, insert, update, delete on public.pve_creators to service_role;

alter table public.pve_creators enable row level security;

drop policy if exists pve_creators_read on public.pve_creators;
create policy pve_creators_read
  on public.pve_creators
  for select
  to anon, authenticated
  using (true);

drop policy if exists pve_creators_insert on public.pve_creators;
drop policy if exists pve_creators_update on public.pve_creators;
drop policy if exists pve_creators_delete on public.pve_creators;
