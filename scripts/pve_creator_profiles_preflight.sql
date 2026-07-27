-- Preflight lecture seule - profils createurs PVE enrichis.
-- A executer avant scripts/pve_creator_profiles.sql.
-- Ce fichier ne contient aucune ecriture et supporte les tables/colonnes absentes.

select
  'required_tables' as check_name,
  to_regclass('public.pve_creators') is not null as pve_creators_exists,
  to_regclass('public.guild_members') is not null as guild_members_exists,
  to_regclass('public.pve_videos') is not null as pve_videos_exists,
  to_regclass('public.pve_creator_links') is not null as pve_creator_links_exists;

select
  'columns' as check_name,
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('pve_creators', 'guild_members', 'pve_videos', 'pve_creator_links')
  and column_name in (
    'id',
    'name',
    'creator_key',
    'channel_url',
    'avatar_url',
    'youtube_channel_id',
    'creator_id',
    'linked_member_id',
    'bio',
    'last_youtube_sync_at',
    'title',
    'url',
    'sort_order',
    'created_at',
    'updated_at'
  )
order by table_name, ordinal_position;

select
  'constraints' as check_name,
  n.nspname as schema_name,
  c.relname as table_name,
  con.conname as constraint_name,
  con.contype as constraint_type,
  pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('pve_creators', 'guild_members', 'pve_videos', 'pve_creator_links')
order by c.relname, con.conname;

select
  'indexes' as check_name,
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('pve_creators', 'guild_members', 'pve_videos', 'pve_creator_links')
order by tablename, indexname;

select
  'rls_status' as check_name,
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('pve_creators', 'guild_members', 'pve_videos', 'pve_creator_links')
  and c.relkind in ('r', 'p')
order by c.relname;

select
  'policies' as check_name,
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('pve_creators', 'guild_members', 'pve_videos', 'pve_creator_links')
order by tablename, policyname;

select
  'role_table_grants' as check_name,
  grantee,
  table_schema,
  table_name,
  privilege_type,
  is_grantable
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('pve_creators', 'guild_members', 'pve_videos', 'pve_creator_links')
order by table_name, grantee, privilege_type;

do $$
declare
  has_creators boolean := to_regclass('public.pve_creators') is not null;
  has_videos boolean := to_regclass('public.pve_videos') is not null;
  has_links boolean := to_regclass('public.pve_creator_links') is not null;
  has_creator_key boolean;
  has_youtube_channel_id boolean;
  has_channel_url boolean;
  has_video_creator_id boolean;
  has_linked_member_id boolean;
  has_bio boolean;
  creator_count bigint;
  diagnostic_value text;
begin
  if not has_creators then
    raise notice 'SKIP data checks: public.pve_creators introuvable.';
    return;
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'pve_creators' and column_name = 'creator_key'
  ) into has_creator_key;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'pve_creators' and column_name = 'youtube_channel_id'
  ) into has_youtube_channel_id;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'pve_creators' and column_name = 'channel_url'
  ) into has_channel_url;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'pve_creators' and column_name = 'linked_member_id'
  ) into has_linked_member_id;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'pve_creators' and column_name = 'bio'
  ) into has_bio;

  execute 'select count(*) from public.pve_creators' into creator_count;
  raise notice 'pve_creators_count=%', creator_count;

  if has_videos then
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'pve_videos' and column_name = 'creator_id'
    ) into has_video_creator_id;

    if has_video_creator_id then
      execute $sql$
        select coalesce(
          string_agg(creator_name || ':' || linked_video_count::text, ', ' order by linked_video_count desc, creator_name asc),
          '<aucune video liee>'
        )
        from (
          select pc.name as creator_name, count(pv.id) as linked_video_count
          from public.pve_creators pc
          left join public.pve_videos pv on pv.creator_id = pc.id
          group by pc.id, pc.name
        ) counts
      $sql$ into diagnostic_value;
      raise notice 'pve_videos_by_creator=%', diagnostic_value;
    else
      raise notice 'SKIP pve_videos_by_creator: public.pve_videos.creator_id introuvable.';
    end if;
  else
    raise notice 'SKIP pve_videos_by_creator: public.pve_videos introuvable.';
  end if;

  if has_creator_key then
    execute $sql$
      select string_agg(duplicate_value || ' (' || duplicate_count::text || ') -> ' || creator_ids, '; ')
      from (
        select lower(creator_key) as duplicate_value, count(*) as duplicate_count, string_agg(id::text, ', ' order by id::text) as creator_ids
        from public.pve_creators
        where creator_key is not null and btrim(creator_key) <> ''
        group by lower(creator_key)
        having count(*) > 1
      ) duplicates
    $sql$ into diagnostic_value;
    raise notice 'duplicate_creator_key_lower=%', coalesce(diagnostic_value, '<aucun>');
  end if;

  if has_youtube_channel_id then
    execute $sql$
      select string_agg(duplicate_value || ' (' || duplicate_count::text || ') -> ' || creator_ids, '; ')
      from (
        select youtube_channel_id as duplicate_value, count(*) as duplicate_count, string_agg(id::text, ', ' order by id::text) as creator_ids
        from public.pve_creators
        where youtube_channel_id is not null and btrim(youtube_channel_id) <> ''
        group by youtube_channel_id
        having count(*) > 1
      ) duplicates
    $sql$ into diagnostic_value;
    raise notice 'duplicate_youtube_channel_id=%', coalesce(diagnostic_value, '<aucun>');
  end if;

  if has_channel_url then
    execute $sql$
      select string_agg(duplicate_value || ' (' || duplicate_count::text || ') -> ' || creator_ids, '; ')
      from (
        select regexp_replace(regexp_replace(regexp_replace(lower(btrim(channel_url)), '^https?://', ''), '^www\.', ''), '/+$', '') as duplicate_value,
          count(*) as duplicate_count,
          string_agg(id::text, ', ' order by id::text) as creator_ids
        from public.pve_creators
        where channel_url is not null and btrim(channel_url) <> ''
        group by regexp_replace(regexp_replace(regexp_replace(lower(btrim(channel_url)), '^https?://', ''), '^www\.', ''), '/+$', '')
        having count(*) > 1
      ) duplicates
    $sql$ into diagnostic_value;
    raise notice 'duplicate_channel_url_normalized=%', coalesce(diagnostic_value, '<aucun>');
  end if;

  if has_linked_member_id then
    execute $sql$
      select string_agg(linked_member_id::text || ' (' || linked_count::text || ') -> ' || creator_ids, '; ')
      from (
        select linked_member_id, count(*) as linked_count, string_agg(id::text, ', ' order by id::text) as creator_ids
        from public.pve_creators
        where linked_member_id is not null
        group by linked_member_id
        having count(*) > 1
      ) duplicates
    $sql$ into diagnostic_value;
    raise notice 'duplicate_linked_member_id=%', coalesce(diagnostic_value, '<aucun>');

    execute $sql$
      select string_agg(pc.id::text || ' -> ' || pc.linked_member_id::text, '; ')
      from public.pve_creators pc
      left join public.guild_members gm on gm.id = pc.linked_member_id
      where pc.linked_member_id is not null and gm.id is null
    $sql$ into diagnostic_value;
    raise notice 'orphan_linked_member_id=%', coalesce(diagnostic_value, '<aucun>');
  else
    raise notice 'linked_member_id pas encore present.';
  end if;

  if has_bio then
    execute $sql$
      select string_agg(id::text || ':' || char_length(bio)::text, ', ')
      from public.pve_creators
      where bio is not null and char_length(bio) > 1000
    $sql$ into diagnostic_value;
    raise notice 'bio_over_1000=%', coalesce(diagnostic_value, '<aucun>');
  else
    raise notice 'bio pas encore presente.';
  end if;

  if has_links then
    execute $sql$
      select string_agg(id::text, ', ')
      from public.pve_creator_links
      where id is null
        or creator_id is null
        or title is null
        or btrim(title) = ''
        or char_length(title) > 80
        or url is null
        or btrim(url) = ''
        or char_length(url) > 2048
        or sort_order is null
        or sort_order < 0
        or created_at is null
        or updated_at is null
    $sql$ into diagnostic_value;
    raise notice 'pve_creator_links_invalid_rows=%', coalesce(diagnostic_value, '<aucun>');

    execute $sql$
      select string_agg(creator_id::text || ':' || link_count::text, ', ' order by link_count desc, creator_id::text)
      from (
        select creator_id, count(*) as link_count
        from public.pve_creator_links
        group by creator_id
      ) counts
    $sql$ into diagnostic_value;
    raise notice 'pve_creator_links_count_by_creator=%', coalesce(diagnostic_value, '<aucun lien>');
  else
    raise notice 'pve_creator_links pas encore presente.';
  end if;
end $$;
