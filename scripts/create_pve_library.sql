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

create index if not exists pve_content_stages_content_sort_idx
  on public.pve_content_stages (content_id, sort_order, stage_number);

create index if not exists pve_videos_content_created_idx
  on public.pve_videos (content_id, created_at desc);

create index if not exists pve_video_stages_content_stage_idx
  on public.pve_video_stages (content_id, stage_id);

create index if not exists pve_video_stages_video_idx
  on public.pve_video_stages (video_id);

with inserted_content as (
  insert into public.pve_contents (
    slug,
    name,
    description,
    stage_count,
    sort_order,
    is_active
  )
  values (
    'gr1',
    'GR1',
    'Gear Raid 1',
    24,
    10,
    true
  )
  on conflict (slug) do update
    set
      name = excluded.name,
      description = excluded.description,
      stage_count = greatest(public.pve_contents.stage_count, excluded.stage_count),
      sort_order = least(public.pve_contents.sort_order, excluded.sort_order),
      is_active = true
  returning id
)
insert into public.pve_content_stages (
  content_id,
  stage_number,
  name,
  sort_order
)
select
  inserted_content.id,
  stage_number,
  'Niveau ' || stage_number,
  stage_number
from inserted_content
cross join generate_series(1, 24) as stage_number
on conflict (content_id, stage_number) do update
  set
    name = excluded.name,
    sort_order = excluded.sort_order;
