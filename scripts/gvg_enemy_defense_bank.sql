begin;

create extension if not exists pgcrypto;

create table if not exists public.gvg_enemy_defenses (
  id uuid primary key default gen_random_uuid(),
  defense_fingerprint text not null,
  canonical_definition jsonb not null,
  map_type text not null default 'tower',
  heroes_count integer not null default 0,
  image_url text,
  image_storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gvg_enemy_defenses_fingerprint_unique unique (defense_fingerprint),
  constraint gvg_enemy_defenses_fingerprint_sha256 check (defense_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint gvg_enemy_defenses_map_type_check check (map_type in ('tower', 'fortress')),
  constraint gvg_enemy_defenses_heroes_count_check check (heroes_count >= 1)
);

create table if not exists public.gvg_enemy_defense_guild_stats (
  id uuid primary key default gen_random_uuid(),
  enemy_defense_id uuid not null references public.gvg_enemy_defenses(id) on delete cascade,
  organization_id uuid not null references public.portal_organizations(id) on delete restrict,
  portal_guild_id uuid not null references public.portal_guilds(id) on delete restrict,
  encounters integer not null default 0,
  opened integer not null default 0,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gvg_enemy_defense_guild_stats_unique unique (portal_guild_id, enemy_defense_id),
  constraint gvg_enemy_defense_guild_stats_counts_check check (
    encounters >= 0
    and opened >= 0
    and opened <= encounters
  )
);

create table if not exists public.gvg_enemy_defense_processed_resets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.portal_organizations(id) on delete restrict,
  portal_guild_id uuid not null references public.portal_guilds(id) on delete restrict,
  source_gvg_key text not null,
  technical_guild text not null,
  occurrence_count integer not null default 0,
  unique_defense_count integer not null default 0,
  inserted_canonical_count integer not null default 0,
  reused_canonical_count integer not null default 0,
  image_archived_count integer not null default 0,
  processed_at timestamptz not null default now(),
  constraint gvg_enemy_defense_processed_resets_unique unique (portal_guild_id, source_gvg_key),
  constraint gvg_enemy_defense_processed_resets_counts_check check (
    occurrence_count >= 0
    and unique_defense_count >= 0
    and inserted_canonical_count >= 0
    and reused_canonical_count >= 0
    and image_archived_count >= 0
  )
);

create index if not exists gvg_enemy_defenses_map_type_idx
  on public.gvg_enemy_defenses (map_type);

create index if not exists gvg_enemy_defense_guild_stats_org_idx
  on public.gvg_enemy_defense_guild_stats (organization_id, portal_guild_id, updated_at desc);

create index if not exists gvg_enemy_defense_guild_stats_defense_idx
  on public.gvg_enemy_defense_guild_stats (enemy_defense_id, organization_id);

create index if not exists gvg_enemy_defense_processed_resets_org_idx
  on public.gvg_enemy_defense_processed_resets (organization_id, portal_guild_id, processed_at desc);

alter table public.gvg_enemy_defenses enable row level security;
alter table public.gvg_enemy_defense_guild_stats enable row level security;
alter table public.gvg_enemy_defense_processed_resets enable row level security;

revoke all on table public.gvg_enemy_defenses from anon, authenticated;
revoke all on table public.gvg_enemy_defense_guild_stats from anon, authenticated;
revoke all on table public.gvg_enemy_defense_processed_resets from anon, authenticated;

grant select, insert, update, delete on table public.gvg_enemy_defenses to service_role;
grant select, insert, update, delete on table public.gvg_enemy_defense_guild_stats to service_role;
grant select, insert, update, delete on table public.gvg_enemy_defense_processed_resets to service_role;

drop policy if exists gvg_enemy_defenses_service_role_all on public.gvg_enemy_defenses;
create policy gvg_enemy_defenses_service_role_all
on public.gvg_enemy_defenses
for all
to service_role
using (true)
with check (true);

drop policy if exists gvg_enemy_defense_guild_stats_service_role_all on public.gvg_enemy_defense_guild_stats;
create policy gvg_enemy_defense_guild_stats_service_role_all
on public.gvg_enemy_defense_guild_stats
for all
to service_role
using (true)
with check (true);

drop policy if exists gvg_enemy_defense_processed_resets_service_role_all on public.gvg_enemy_defense_processed_resets;
create policy gvg_enemy_defense_processed_resets_service_role_all
on public.gvg_enemy_defense_processed_resets
for all
to service_role
using (true)
with check (true);

create or replace function public.archive_gvg_enemy_defense_bank(
  p_portal_guild_id uuid,
  p_source_gvg_key text,
  p_technical_guild text,
  p_defenses jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organization_id uuid;
  v_processed_id uuid;
  v_existing_processed public.gvg_enemy_defense_processed_resets%rowtype;
  v_duplicate_count integer := 0;
  v_unique_count integer := 0;
  v_occurrence_count integer := 0;
  v_opened_count integer := 0;
  v_inserted_count integer := 0;
  v_stats_count integer := 0;
  v_image_archived_count integer := 0;
begin
  if p_portal_guild_id is null then
    raise exception 'portal_guild_id is required';
  end if;

  if btrim(coalesce(p_source_gvg_key, '')) = '' then
    raise exception 'source_gvg_key is required';
  end if;

  if p_defenses is null or jsonb_typeof(p_defenses) <> 'array' then
    raise exception 'p_defenses must be a JSON array';
  end if;

  select guild.organization_id
  into v_organization_id
  from public.portal_guilds guild
  where guild.id = p_portal_guild_id
    and guild.is_active is true;

  if v_organization_id is null then
    raise exception 'active portal guild not found: %', p_portal_guild_id;
  end if;

  if jsonb_array_length(p_defenses) = 0 then
    return jsonb_build_object(
      'already_processed', false,
      'occurrences', 0,
      'unique_defenses', 0,
      'inserted_canonical', 0,
      'reused_canonical', 0,
      'stats_upserted', 0,
      'images_archived', 0
    );
  end if;

  create temporary table if not exists gvg_enemy_defense_archive_incoming (
    defense_fingerprint text not null,
    canonical_definition jsonb not null,
    map_type text not null,
    heroes_count integer not null,
    image_url text,
    image_storage_path text,
    encounters integer not null,
    opened integer not null,
    first_seen_at timestamptz,
    last_seen_at timestamptz,
    image_archived boolean not null default false
  ) on commit drop;

  truncate table gvg_enemy_defense_archive_incoming;

  insert into gvg_enemy_defense_archive_incoming (
    defense_fingerprint,
    canonical_definition,
    map_type,
    heroes_count,
    image_url,
    image_storage_path,
    encounters,
    opened,
    first_seen_at,
    last_seen_at,
    image_archived
  )
  select
    incoming.defense_fingerprint,
    incoming.canonical_definition,
    incoming.map_type,
    incoming.heroes_count,
    incoming.image_url,
    incoming.image_storage_path,
    incoming.encounters,
    incoming.opened,
    incoming.first_seen_at,
    incoming.last_seen_at,
    coalesce(incoming.image_archived, false)
  from jsonb_to_recordset(p_defenses) as incoming (
    defense_fingerprint text,
    canonical_definition jsonb,
    map_type text,
    heroes_count integer,
    image_url text,
    image_storage_path text,
    encounters integer,
    opened integer,
    first_seen_at timestamptz,
    last_seen_at timestamptz,
    image_archived boolean
  );

  select count(*)
  into v_duplicate_count
  from (
    select defense_fingerprint
    from gvg_enemy_defense_archive_incoming
    group by defense_fingerprint
    having count(*) > 1
  ) duplicates;

  if v_duplicate_count > 0 then
    raise exception 'duplicate defense_fingerprint in archive payload';
  end if;

  if exists (
    select 1
    from gvg_enemy_defense_archive_incoming
    where defense_fingerprint !~ '^[0-9a-f]{64}$'
      or map_type not in ('tower', 'fortress')
      or heroes_count < 1
      or encounters < 1
      or opened < 0
      or opened > encounters
  ) then
    raise exception 'invalid enemy defense archive payload';
  end if;

  insert into public.gvg_enemy_defense_processed_resets (
    organization_id,
    portal_guild_id,
    source_gvg_key,
    technical_guild
  )
  values (
    v_organization_id,
    p_portal_guild_id,
    p_source_gvg_key,
    coalesce(nullif(btrim(p_technical_guild), ''), 'UNKNOWN')
  )
  on conflict (portal_guild_id, source_gvg_key) do nothing
  returning id
  into v_processed_id;

  if v_processed_id is null then
    select *
    into v_existing_processed
    from public.gvg_enemy_defense_processed_resets
    where portal_guild_id = p_portal_guild_id
      and source_gvg_key = p_source_gvg_key;

    return jsonb_build_object(
      'already_processed', true,
      'processed_reset_id', v_existing_processed.id,
      'occurrences', coalesce(v_existing_processed.occurrence_count, 0),
      'unique_defenses', coalesce(v_existing_processed.unique_defense_count, 0),
      'inserted_canonical', 0,
      'reused_canonical', coalesce(v_existing_processed.unique_defense_count, 0),
      'stats_upserted', 0,
      'images_archived', 0
    );
  end if;

  select
    count(*),
    coalesce(sum(encounters), 0),
    coalesce(sum(opened), 0),
    coalesce(count(*) filter (where image_archived), 0)
  into
    v_unique_count,
    v_occurrence_count,
    v_opened_count,
    v_image_archived_count
  from gvg_enemy_defense_archive_incoming;

  insert into public.gvg_enemy_defenses (
    defense_fingerprint,
    canonical_definition,
    map_type,
    heroes_count,
    image_url,
    image_storage_path
  )
  select
    defense_fingerprint,
    canonical_definition,
    map_type,
    heroes_count,
    image_url,
    image_storage_path
  from gvg_enemy_defense_archive_incoming
  on conflict (defense_fingerprint) do nothing;

  get diagnostics v_inserted_count = row_count;

  update public.gvg_enemy_defenses canonical
  set
    image_url = coalesce(canonical.image_url, incoming.image_url),
    image_storage_path = coalesce(canonical.image_storage_path, incoming.image_storage_path),
    updated_at = now()
  from gvg_enemy_defense_archive_incoming incoming
  where canonical.defense_fingerprint = incoming.defense_fingerprint
    and (canonical.image_url is null or canonical.image_storage_path is null)
    and (incoming.image_url is not null or incoming.image_storage_path is not null);

  insert into public.gvg_enemy_defense_guild_stats (
    enemy_defense_id,
    organization_id,
    portal_guild_id,
    encounters,
    opened,
    first_seen_at,
    last_seen_at
  )
  select
    canonical.id,
    v_organization_id,
    p_portal_guild_id,
    incoming.encounters,
    incoming.opened,
    incoming.first_seen_at,
    incoming.last_seen_at
  from gvg_enemy_defense_archive_incoming incoming
  join public.gvg_enemy_defenses canonical
    on canonical.defense_fingerprint = incoming.defense_fingerprint
  on conflict (portal_guild_id, enemy_defense_id) do update
  set
    organization_id = excluded.organization_id,
    encounters = public.gvg_enemy_defense_guild_stats.encounters + excluded.encounters,
    opened = public.gvg_enemy_defense_guild_stats.opened + excluded.opened,
    first_seen_at = case
      when public.gvg_enemy_defense_guild_stats.first_seen_at is null then excluded.first_seen_at
      when excluded.first_seen_at is null then public.gvg_enemy_defense_guild_stats.first_seen_at
      else least(public.gvg_enemy_defense_guild_stats.first_seen_at, excluded.first_seen_at)
    end,
    last_seen_at = case
      when public.gvg_enemy_defense_guild_stats.last_seen_at is null then excluded.last_seen_at
      when excluded.last_seen_at is null then public.gvg_enemy_defense_guild_stats.last_seen_at
      else greatest(public.gvg_enemy_defense_guild_stats.last_seen_at, excluded.last_seen_at)
    end,
    updated_at = now();

  get diagnostics v_stats_count = row_count;

  update public.gvg_enemy_defense_processed_resets
  set
    occurrence_count = v_occurrence_count,
    unique_defense_count = v_unique_count,
    inserted_canonical_count = v_inserted_count,
    reused_canonical_count = greatest(v_unique_count - v_inserted_count, 0),
    image_archived_count = v_image_archived_count,
    processed_at = now()
  where id = v_processed_id;

  return jsonb_build_object(
    'already_processed', false,
    'processed_reset_id', v_processed_id,
    'occurrences', v_occurrence_count,
    'opened', v_opened_count,
    'unique_defenses', v_unique_count,
    'inserted_canonical', v_inserted_count,
    'reused_canonical', greatest(v_unique_count - v_inserted_count, 0),
    'stats_upserted', v_stats_count,
    'images_archived', v_image_archived_count
  );
end;
$$;

revoke all on function public.archive_gvg_enemy_defense_bank(uuid, text, text, jsonb) from public;
grant execute on function public.archive_gvg_enemy_defense_bank(uuid, text, text, jsonb) to service_role;

commit;
