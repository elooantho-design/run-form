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

with seed_contents as (
  select *
  from (
    values
      ('gr1', 'GR1', 'Raid d''equipement 1', 24, 10),
      ('gr2', 'GR2', 'Raid d''equipement 2', 24, 20),
      ('gr3', 'GR3', 'Raid d''equipement 3', 24, 30)
  ) as value_rows(slug, name, description, stage_count, sort_order)
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
    'gear-raid',
    'Raid d''equipement',
    10,
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
)
insert into public.pve_content_stages (
  content_id,
  stage_number,
  name,
  sort_order
)
select
  upserted_contents.id,
  stage_number,
  'Niveau ' || stage_number,
  stage_number
from upserted_contents
cross join lateral generate_series(1, upserted_contents.stage_count) as stage_number
on conflict (content_id, stage_number) do update
  set
    name = excluded.name,
    sort_order = excluded.sort_order;
