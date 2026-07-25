begin;

-- Final Portal security hardening migration.
-- Idempotent by design: safe to re-run.
-- The whole migration runs in one transaction: any error rolls everything back.
-- Do not remove public read access from public.champions here because the retired root page
-- still has a direct public read path for champion names.

create extension if not exists pgcrypto;

create or replace function public.portal_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.portal_normalize_key(value text)
returns text
language sql
immutable
as $$
  select nullif(
    trim(both '-' from regexp_replace(lower(coalesce(value, '')), '[^a-z0-9]+', '-', 'g')),
    ''
  );
$$;

create or replace function public.portal_normalize_url(value text)
returns text
language sql
immutable
as $$
  with cleaned as (
    select nullif(btrim(coalesce(value, '')), '') as raw_url
  ),
  without_query as (
    select regexp_replace(raw_url, '[?#].*$', '') as raw_url
    from cleaned
    where raw_url is not null
  ),
  without_protocol as (
    select regexp_replace(raw_url, '^[a-z][a-z0-9+.-]*://', '', 'i') as raw_url
    from without_query
  ),
  url_parts as (
    select
      lower(split_part(raw_url, '/', 1)) as host,
      nullif(substr(raw_url, length(split_part(raw_url, '/', 1)) + 2), '') as path
    from without_protocol
  ),
  normalized as (
    select
      case
        when host in ('www.youtube.com', 'youtube.com', 'm.youtube.com') then 'youtube.com'
        else regexp_replace(host, '^www\.', '')
      end as host,
      regexp_replace(coalesce(path, ''), '/+$', '') as path
    from url_parts
  )
  select nullif(
    case
      when path = '' then host
      else host || '/' || path
    end,
    ''
  )
  from normalized;
$$;

-- Community columns used by Portal sessions and community accounts.
alter table public.guild_members
  add column if not exists password_change_required boolean not null default false,
  add column if not exists preferred_language text null,
  add column if not exists community_access_type text null,
  add column if not exists community_status text null;

alter table public.guild_members
  alter column password_change_required set default false;

do $$
declare
  invalid_values text;
begin
  select string_agg(id::text, ', ')
    into invalid_values
  from (
    select id
    from public.guild_members
    where password_change_required is null
    limit 20
  ) offenders;

  if invalid_values is not null then
    raise exception 'guild_members.password_change_required has null values. Fix these member ids before running migration: %', invalid_values;
  end if;
end $$;

alter table public.guild_members
  alter column password_change_required set not null;

create table if not exists public.portal_community_access_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  discord_contact text not null,
  preferred_language text null,
  guild_name text null,
  message text null,
  status text not null default 'pending',
  handled_at timestamptz null,
  handled_by_member_id uuid null,
  handled_by_name text null,
  created_member_id uuid null,
  metadata jsonb not null default '{}'::jsonb
);

alter table public.portal_community_access_requests
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists discord_contact text,
  add column if not exists preferred_language text,
  add column if not exists guild_name text,
  add column if not exists message text,
  add column if not exists status text not null default 'pending',
  add column if not exists handled_at timestamptz,
  add column if not exists handled_by_member_id uuid,
  add column if not exists handled_by_name text,
  add column if not exists created_member_id uuid,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.portal_community_access_requests
  alter column created_at set default now(),
  alter column updated_at set default now(),
  alter column status set default 'pending',
  alter column metadata set default '{}'::jsonb;

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
  add column if not exists name text,
  add column if not exists creator_key text,
  add column if not exists channel_url text,
  add column if not exists avatar_url text,
  add column if not exists youtube_channel_id text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.pve_creators
  alter column created_at set default now(),
  alter column updated_at set default now();

alter table public.pve_videos
  add column if not exists creator_id uuid,
  add column if not exists suggested_creator_name text,
  add column if not exists youtube_channel_id text;

-- Stop before indexes and permission changes if existing data is incompatible.
do $$
declare
  invalid_values text;
  duplicate_values text;
begin
  select string_agg(id::text, ', ')
    into invalid_values
  from (
    select id
    from public.portal_community_access_requests
    where discord_contact is null
       or btrim(discord_contact) = ''
    limit 20
  ) offenders;

  if invalid_values is not null then
    raise exception 'portal_community_access_requests.discord_contact has null or blank values. Fix these request ids before running migration: %', invalid_values;
  end if;

  select string_agg(coalesce(status, '<null>'), ', ')
    into invalid_values
  from (
    select distinct status
    from public.portal_community_access_requests
    where status is null
       or status not in ('pending', 'accepted', 'refused')
    limit 20
  ) offenders;

  if invalid_values is not null then
    raise exception 'portal_community_access_requests.status has unsupported values. Fix these statuses before running migration: %', invalid_values;
  end if;

  select string_agg(discord_contact_value || ' (' || duplicate_count || ')', ', ')
    into duplicate_values
  from (
    select lower(btrim(discord_contact)) as discord_contact_value, count(*) as duplicate_count
    from public.portal_community_access_requests
    where status = 'pending'
      and discord_contact is not null
      and btrim(discord_contact) <> ''
    group by lower(btrim(discord_contact))
    having count(*) > 1
    limit 20
  ) duplicates;

  if duplicate_values is not null then
    raise exception 'portal_community_access_requests has duplicate pending discord_contact values: %', duplicate_values;
  end if;

  select string_agg(id::text, ', ')
    into invalid_values
  from (
    select id
    from public.portal_community_access_requests
    where metadata is null
    limit 20
  ) offenders;

  if invalid_values is not null then
    raise exception 'portal_community_access_requests.metadata has null values. Fix these request ids before running migration: %', invalid_values;
  end if;

  select string_agg(id::text, ', ')
    into invalid_values
  from (
    select id
    from public.pve_creators
    where name is null
       or btrim(name) = ''
    limit 20
  ) offenders;

  if invalid_values is not null then
    raise exception 'pve_creators.name has null or blank values. Fix these creator ids before running migration: %', invalid_values;
  end if;

  select string_agg(id::text, ', ')
    into invalid_values
  from (
    select id
    from public.pve_creators
    where creator_key is null
       or btrim(creator_key) = ''
    limit 20
  ) offenders;

  if invalid_values is not null then
    raise exception 'pve_creators.creator_key has null or blank values. Fix these creator ids before running migration: %', invalid_values;
  end if;

  select string_agg(id::text || ':' || creator_key, ', ')
    into invalid_values
  from (
    select id, creator_key
    from public.pve_creators
    where creator_key is not null
      and creator_key <> public.portal_normalize_key(creator_key)
    limit 20
  ) offenders;

  if invalid_values is not null then
    raise exception 'pve_creators.creator_key has non-normalized values. Fix these id:key pairs before running migration: %', invalid_values;
  end if;

  select string_agg(creator_key_value || ' (' || duplicate_count || ')', ', ')
    into duplicate_values
  from (
    select lower(creator_key) as creator_key_value, count(*) as duplicate_count
    from public.pve_creators
    where creator_key is not null
      and btrim(creator_key) <> ''
    group by lower(creator_key)
    having count(*) > 1
    limit 20
  ) duplicates;

  if duplicate_values is not null then
    raise exception 'pve_creators has duplicate lower(creator_key) values: %', duplicate_values;
  end if;

  select string_agg(channel_url_value || ' (' || duplicate_count || ')', ', ')
    into duplicate_values
  from (
    select public.portal_normalize_url(channel_url) as channel_url_value, count(*) as duplicate_count
    from public.pve_creators
    where public.portal_normalize_url(channel_url) is not null
    group by public.portal_normalize_url(channel_url)
    having count(*) > 1
    limit 20
  ) duplicates;

  if duplicate_values is not null then
    raise exception 'pve_creators has duplicate normalized channel_url values: %', duplicate_values;
  end if;

  select string_agg(youtube_channel_id_value || ' (' || duplicate_count || ')', ', ')
    into duplicate_values
  from (
    select btrim(youtube_channel_id) as youtube_channel_id_value, count(*) as duplicate_count
    from public.pve_creators
    where nullif(btrim(coalesce(youtube_channel_id, '')), '') is not null
    group by btrim(youtube_channel_id)
    having count(*) > 1
    limit 20
  ) duplicates;

  if duplicate_values is not null then
    raise exception 'pve_creators has duplicate youtube_channel_id values: %', duplicate_values;
  end if;
end $$;

alter table public.portal_community_access_requests
  alter column created_at set not null,
  alter column updated_at set not null,
  alter column discord_contact set not null,
  alter column status set not null,
  alter column metadata set not null;

alter table public.pve_creators
  alter column name set not null,
  alter column creator_key set not null,
  alter column created_at set not null,
  alter column updated_at set not null;

create or replace function public.pve_creators_normalize()
returns trigger
language plpgsql
as $$
begin
  new.name = btrim(coalesce(new.name, ''));

  if new.creator_key is null or btrim(new.creator_key) = '' then
    new.creator_key = public.portal_normalize_key(new.name);
  else
    new.creator_key = public.portal_normalize_key(new.creator_key);
  end if;

  new.channel_url = public.portal_normalize_url(new.channel_url);
  new.avatar_url = nullif(btrim(coalesce(new.avatar_url, '')), '');
  new.youtube_channel_id = nullif(btrim(coalesce(new.youtube_channel_id, '')), '');
  new.updated_at = now();

  return new;
end;
$$;

drop trigger if exists pve_creators_normalize_before_write on public.pve_creators;
create trigger pve_creators_normalize_before_write
  before insert or update on public.pve_creators
  for each row
  execute function public.pve_creators_normalize();

drop trigger if exists portal_community_access_requests_touch_updated_at
  on public.portal_community_access_requests;
create trigger portal_community_access_requests_touch_updated_at
  before update on public.portal_community_access_requests
  for each row
  execute function public.portal_touch_updated_at();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'portal_community_access_requests_status_check'
      and conrelid = 'public.portal_community_access_requests'::regclass
  ) then
    alter table public.portal_community_access_requests
      add constraint portal_community_access_requests_status_check
      check (status in ('pending', 'accepted', 'refused'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'portal_community_access_requests_handled_by_member_id_fkey'
      and conrelid = 'public.portal_community_access_requests'::regclass
  ) then
    alter table public.portal_community_access_requests
      add constraint portal_community_access_requests_handled_by_member_id_fkey
      foreign key (handled_by_member_id)
      references public.guild_members(id)
      on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'portal_community_access_requests_created_member_id_fkey'
      and conrelid = 'public.portal_community_access_requests'::regclass
  ) then
    alter table public.portal_community_access_requests
      add constraint portal_community_access_requests_created_member_id_fkey
      foreign key (created_member_id)
      references public.guild_members(id)
      on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'pve_creators_name_not_blank'
      and conrelid = 'public.pve_creators'::regclass
  ) then
    alter table public.pve_creators
      add constraint pve_creators_name_not_blank
      check (btrim(name) <> '');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'pve_creators_creator_key_not_blank'
      and conrelid = 'public.pve_creators'::regclass
  ) then
    alter table public.pve_creators
      add constraint pve_creators_creator_key_not_blank
      check (btrim(creator_key) <> '');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'pve_creators_creator_key_lowercase'
      and conrelid = 'public.pve_creators'::regclass
  ) then
    alter table public.pve_creators
      add constraint pve_creators_creator_key_lowercase
      check (creator_key = lower(creator_key));
  end if;

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

create index if not exists portal_community_access_requests_status_created_idx
  on public.portal_community_access_requests (status, created_at desc);

create index if not exists portal_community_access_requests_discord_contact_idx
  on public.portal_community_access_requests (lower(discord_contact));

create unique index if not exists portal_community_access_requests_pending_contact_unique_idx
  on public.portal_community_access_requests (lower(btrim(discord_contact)))
  where status = 'pending';

create unique index if not exists pve_creators_creator_key_unique_idx
  on public.pve_creators (lower(creator_key));

drop index if exists public.pve_creators_channel_url_unique_idx;
create unique index pve_creators_channel_url_unique_idx
  on public.pve_creators (public.portal_normalize_url(channel_url))
  where public.portal_normalize_url(channel_url) is not null;

create unique index if not exists pve_creators_youtube_channel_id_unique_idx
  on public.pve_creators (youtube_channel_id)
  where youtube_channel_id is not null;

create index if not exists pve_videos_creator_id_idx
  on public.pve_videos (creator_id);

create index if not exists pve_video_stages_video_id_idx
  on public.pve_video_stages (video_id);

create index if not exists pve_video_stages_stage_id_idx
  on public.pve_video_stages (stage_id);

create index if not exists pve_video_heroes_video_id_idx
  on public.pve_video_heroes (video_id);

create index if not exists pve_video_heroes_champion_id_idx
  on public.pve_video_heroes (champion_id);

do $$
begin
  if to_regclass('public.pve_video_hero_alternatives') is null then
    return;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'pve_video_hero_alternatives'
      and column_name = 'video_hero_id'
  ) then
    execute 'create index if not exists pve_video_hero_alternatives_hero_link_idx on public.pve_video_hero_alternatives (video_hero_id)';
  elsif exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'pve_video_hero_alternatives'
      and column_name = 'pve_video_hero_id'
  ) then
    execute 'create index if not exists pve_video_hero_alternatives_hero_link_idx on public.pve_video_hero_alternatives (pve_video_hero_id)';
  elsif exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'pve_video_hero_alternatives'
      and column_name = 'video_id'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'pve_video_hero_alternatives'
      and column_name = 'required_champion_id'
  ) then
    execute 'create index if not exists pve_video_hero_alternatives_hero_link_idx on public.pve_video_hero_alternatives (video_id, required_champion_id)';
  elsif exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'pve_video_hero_alternatives'
      and column_name = 'video_id'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'pve_video_hero_alternatives'
      and column_name = 'required_champion_name'
  ) then
    execute 'create index if not exists pve_video_hero_alternatives_hero_link_idx on public.pve_video_hero_alternatives (video_id, required_champion_name)';
  end if;
end $$;

commit;
