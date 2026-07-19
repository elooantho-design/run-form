create table if not exists public.pve_contents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by_member_id uuid null,
  created_by_name text null,
  slug text not null unique,
  name text not null,
  description text null,
  stage_count integer not null default 0,
  sort_order integer not null default 9999,
  is_active boolean not null default true
);

alter table public.pve_contents
  add column if not exists category_slug text not null default 'gear-raid';

alter table public.pve_contents
  add column if not exists category_name text not null default 'Raid d''equipement';

alter table public.pve_contents
  add column if not exists category_sort_order integer not null default 10;

create table if not exists public.pve_content_stages (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.pve_contents(id) on delete cascade,
  stage_number integer not null,
  name text null,
  sort_order integer not null default 9999,
  created_at timestamptz not null default now(),
  unique (content_id, stage_number)
);

create table if not exists public.pve_videos (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.pve_contents(id) on delete cascade,
  youtube_url text not null,
  youtube_video_id text not null,
  title text not null,
  notes text null,
  created_by_member_id uuid null,
  created_by_name text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pve_video_stages (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.pve_contents(id) on delete cascade,
  video_id uuid not null references public.pve_videos(id) on delete cascade,
  stage_id uuid not null references public.pve_content_stages(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (video_id, stage_id)
);

create table if not exists public.pve_video_heroes (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.pve_contents(id) on delete cascade,
  video_id uuid not null references public.pve_videos(id) on delete cascade,
  champion_id bigint null references public.champions(id) on delete set null,
  champion_name text not null,
  sort_order integer not null default 9999,
  created_at timestamptz not null default now(),
  unique (video_id, champion_name)
);

create index if not exists pve_contents_active_sort_idx
  on public.pve_contents (is_active, sort_order, name);

create index if not exists pve_contents_category_sort_idx
  on public.pve_contents (category_slug, category_sort_order, sort_order);

create index if not exists pve_content_stages_content_sort_idx
  on public.pve_content_stages (content_id, sort_order, stage_number);

create index if not exists pve_videos_content_created_idx
  on public.pve_videos (content_id, created_at desc);

create index if not exists pve_video_stages_content_stage_idx
  on public.pve_video_stages (content_id, stage_id);

create index if not exists pve_video_stages_video_idx
  on public.pve_video_stages (video_id);

create index if not exists pve_video_heroes_content_video_idx
  on public.pve_video_heroes (content_id, video_id, sort_order);

create index if not exists pve_video_heroes_champion_idx
  on public.pve_video_heroes (champion_id);

grant select on public.pve_contents to anon, authenticated;
grant select on public.pve_content_stages to anon, authenticated;
grant select, insert, update, delete on public.pve_videos to anon, authenticated;
grant select, insert, delete on public.pve_video_stages to anon, authenticated;
grant select, insert, delete on public.pve_video_heroes to anon, authenticated;

alter table public.pve_contents enable row level security;
alter table public.pve_content_stages enable row level security;
alter table public.pve_videos enable row level security;
alter table public.pve_video_stages enable row level security;
alter table public.pve_video_heroes enable row level security;

drop policy if exists pve_contents_read on public.pve_contents;
create policy pve_contents_read
  on public.pve_contents
  for select
  to anon, authenticated
  using (is_active = true);

drop policy if exists pve_content_stages_read on public.pve_content_stages;
create policy pve_content_stages_read
  on public.pve_content_stages
  for select
  to anon, authenticated
  using (true);

drop policy if exists pve_videos_read on public.pve_videos;
create policy pve_videos_read
  on public.pve_videos
  for select
  to anon, authenticated
  using (true);

drop policy if exists pve_videos_insert on public.pve_videos;
create policy pve_videos_insert
  on public.pve_videos
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists pve_videos_update on public.pve_videos;
create policy pve_videos_update
  on public.pve_videos
  for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists pve_videos_delete on public.pve_videos;
create policy pve_videos_delete
  on public.pve_videos
  for delete
  to anon, authenticated
  using (true);

drop policy if exists pve_video_stages_read on public.pve_video_stages;
create policy pve_video_stages_read
  on public.pve_video_stages
  for select
  to anon, authenticated
  using (true);

drop policy if exists pve_video_stages_insert on public.pve_video_stages;
create policy pve_video_stages_insert
  on public.pve_video_stages
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists pve_video_stages_delete on public.pve_video_stages;
create policy pve_video_stages_delete
  on public.pve_video_stages
  for delete
  to anon, authenticated
  using (true);

drop policy if exists pve_video_heroes_read on public.pve_video_heroes;
create policy pve_video_heroes_read
  on public.pve_video_heroes
  for select
  to anon, authenticated
  using (true);

drop policy if exists pve_video_heroes_insert on public.pve_video_heroes;
create policy pve_video_heroes_insert
  on public.pve_video_heroes
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists pve_video_heroes_delete on public.pve_video_heroes;
create policy pve_video_heroes_delete
  on public.pve_video_heroes
  for delete
  to anon, authenticated
  using (true);

with seed_contents as (
  select *
  from (
    values
      ('gr1', 'GR1', 'Raid d''equipement 1', 24, 10, 'gear-raid', 'Raid d''equipement', 10),
      ('gr2', 'GR2', 'Raid d''equipement 2', 24, 20, 'gear-raid', 'Raid d''equipement', 10),
      ('gr3', 'GR3', 'Raid d''equipement 3', 24, 30, 'gear-raid', 'Raid d''equipement', 10),
      ('donjon1', 'Donjon 1', 'Donjon d''equipement 1', 13, 40, 'gear-raid', 'Raid d''equipement', 10),
      ('donjon2', 'Donjon 2', 'Donjon d''equipement 2', 13, 50, 'gear-raid', 'Raid d''equipement', 10),
      ('donjon3', 'Donjon 3', 'Donjon d''equipement 3', 13, 60, 'gear-raid', 'Raid d''equipement', 10),
      ('dragon-chasm', 'Gouffre du dragon', 'Boss de guilde - Gouffre du dragon', 8, 10, 'guild-boss', 'Boss de guilde', 20),
      ('titan-ruins', 'Ruine de titan', 'Boss de guilde - Ruine de titan', 4, 20, 'guild-boss', 'Boss de guilde', 20)
  ) as value_rows(slug, name, description, stage_count, sort_order, category_slug, category_name, category_sort_order)
),
upserted_contents as (
  insert into public.pve_contents (
    slug,
    name,
    description,
    stage_count,
    sort_order,
    category_slug,
    category_name,
    category_sort_order,
    is_active
  )
  select
    seed_contents.slug,
    seed_contents.name,
    seed_contents.description,
    seed_contents.stage_count,
    seed_contents.sort_order,
    seed_contents.category_slug,
    seed_contents.category_name,
    seed_contents.category_sort_order,
    true
  from seed_contents
  on conflict (slug) do update
    set
      name = excluded.name,
      description = excluded.description,
      stage_count = greatest(public.pve_contents.stage_count, excluded.stage_count),
      sort_order = excluded.sort_order,
      category_slug = excluded.category_slug,
      category_name = excluded.category_name,
      category_sort_order = excluded.category_sort_order,
      is_active = true
  returning id, slug, stage_count
),
stage_labels as (
  select *
  from (
    values
      ('dragon-chasm', 1, 'Facile'),
      ('dragon-chasm', 2, 'Normal'),
      ('dragon-chasm', 3, 'Difficile'),
      ('dragon-chasm', 4, 'Cauchemar 1'),
      ('dragon-chasm', 5, 'Cauchemar 2'),
      ('dragon-chasm', 6, 'Cauchemar 3'),
      ('dragon-chasm', 7, 'Cauchemar 4'),
      ('dragon-chasm', 8, 'Abyss 1'),
      ('titan-ruins', 1, 'Apocalypse 1'),
      ('titan-ruins', 2, 'Apocalypse 2'),
      ('titan-ruins', 3, 'Matrice 1 - Magique'),
      ('titan-ruins', 4, 'Matrice 1 - Physique')
  ) as value_rows(slug, stage_number, stage_name)
)
insert into public.pve_content_stages (
  content_id,
  stage_number,
  name,
  sort_order
)
select
  upserted_contents.id,
  generated_stage.stage_number,
  coalesce(stage_labels.stage_name, 'Niveau ' || generated_stage.stage_number),
  generated_stage.stage_number
from upserted_contents
cross join lateral generate_series(1, upserted_contents.stage_count) as generated_stage(stage_number)
left join stage_labels
  on stage_labels.slug = upserted_contents.slug
 and stage_labels.stage_number = generated_stage.stage_number
on conflict (content_id, stage_number) do update
  set
    name = excluded.name,
    sort_order = excluded.sort_order;
