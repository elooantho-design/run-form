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
  updated_at timestamptz not null default now(),
  suggested_creator_name text null
);

alter table public.pve_videos
  add column if not exists creator_id uuid null;

alter table public.pve_videos
  add column if not exists suggested_creator_name text null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pve_videos_creator_id_fkey'
  ) then
    alter table public.pve_videos
      add constraint pve_videos_creator_id_fkey
      foreign key (creator_id)
      references public.pve_creators(id)
      on delete set null;
  end if;
end $$;

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

create table if not exists public.pve_video_hero_alternatives (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.pve_contents(id) on delete cascade,
  video_id uuid not null references public.pve_videos(id) on delete cascade,
  required_champion_id bigint null references public.champions(id) on delete set null,
  required_champion_name text not null,
  alternative_champion_id bigint null references public.champions(id) on delete set null,
  alternative_champion_name text not null,
  sort_order integer not null default 9999,
  created_at timestamptz not null default now(),
  unique (video_id, required_champion_name, alternative_champion_name)
);

create index if not exists pve_contents_active_sort_idx
  on public.pve_contents (is_active, sort_order, name);

create index if not exists pve_contents_category_sort_idx
  on public.pve_contents (category_slug, category_sort_order, sort_order);

create index if not exists pve_content_stages_content_sort_idx
  on public.pve_content_stages (content_id, sort_order, stage_number);

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

create index if not exists pve_videos_content_created_idx
  on public.pve_videos (content_id, created_at desc);

create index if not exists pve_videos_creator_idx
  on public.pve_videos (creator_id);

create index if not exists pve_videos_suggested_creator_pending_idx
  on public.pve_videos (content_id, suggested_creator_name)
  where creator_id is null
    and suggested_creator_name is not null
    and btrim(suggested_creator_name) <> '';

create index if not exists pve_video_stages_content_stage_idx
  on public.pve_video_stages (content_id, stage_id);

create index if not exists pve_video_stages_video_idx
  on public.pve_video_stages (video_id);

create index if not exists pve_video_heroes_content_video_idx
  on public.pve_video_heroes (content_id, video_id, sort_order);

create index if not exists pve_video_heroes_champion_idx
  on public.pve_video_heroes (champion_id);

create index if not exists pve_video_hero_alternatives_video_required_idx
  on public.pve_video_hero_alternatives (video_id, required_champion_name, sort_order);

create index if not exists pve_video_hero_alternatives_alternative_idx
  on public.pve_video_hero_alternatives (alternative_champion_id);

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

revoke all on public.pve_creators from anon, authenticated;
revoke all on public.pve_videos from anon, authenticated;
revoke all on public.pve_video_stages from anon, authenticated;
revoke all on public.pve_video_heroes from anon, authenticated;
revoke all on public.pve_video_hero_alternatives from anon, authenticated;

grant select on public.pve_contents to anon, authenticated;
grant select on public.pve_content_stages to anon, authenticated;
grant select, insert, update, delete on public.pve_creators to service_role;
grant select, insert, update, delete on public.pve_videos to service_role;
grant select, insert, update, delete on public.pve_video_stages to service_role;
grant select, insert, update, delete on public.pve_video_heroes to service_role;
grant select, insert, update, delete on public.pve_video_hero_alternatives to service_role;

alter table public.pve_contents enable row level security;
alter table public.pve_content_stages enable row level security;
alter table public.pve_creators enable row level security;
alter table public.pve_videos enable row level security;
alter table public.pve_video_stages enable row level security;
alter table public.pve_video_heroes enable row level security;
alter table public.pve_video_hero_alternatives enable row level security;

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

drop policy if exists pve_creators_read on public.pve_creators;
drop policy if exists pve_creators_insert on public.pve_creators;
drop policy if exists pve_creators_update on public.pve_creators;
drop policy if exists pve_creators_delete on public.pve_creators;

drop policy if exists pve_videos_read on public.pve_videos;
drop policy if exists pve_videos_insert on public.pve_videos;
drop policy if exists pve_videos_update on public.pve_videos;
drop policy if exists pve_videos_delete on public.pve_videos;

drop policy if exists pve_video_stages_read on public.pve_video_stages;
drop policy if exists pve_video_stages_insert on public.pve_video_stages;
drop policy if exists pve_video_stages_delete on public.pve_video_stages;

drop policy if exists pve_video_heroes_read on public.pve_video_heroes;
drop policy if exists pve_video_heroes_insert on public.pve_video_heroes;
drop policy if exists pve_video_heroes_delete on public.pve_video_heroes;

drop policy if exists pve_video_hero_alternatives_read on public.pve_video_hero_alternatives;
drop policy if exists pve_video_hero_alternatives_insert on public.pve_video_hero_alternatives;
drop policy if exists pve_video_hero_alternatives_delete on public.pve_video_hero_alternatives;

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
      ('artifact-raid', 'Raid d''artefacts', 'Raid de materiaux d''artefacts', 30, 10, 'artifact-raid', 'Raid d''artefacts', 15),
      ('illusion-tower', 'Tour de l''Illusion', 'Tour de l''Illusion', 48, 10, 'illusion-tower', 'Tour de l''Illusion', 40),
      ('faction-trial-all', 'All', 'Épreuve de faction - All', 18, 10, 'faction-trial', 'Épreuve de faction', 18),
      ('faction-trial-nordiste', 'Nordiste', 'Épreuve de faction - Nordiste', 18, 20, 'faction-trial', 'Épreuve de faction', 18),
      ('faction-trial-arbiter-chaotic', 'Arbitre et chaotique', 'Épreuve de faction - Arbitre et chaotique', 18, 30, 'faction-trial', 'Épreuve de faction', 18),
      ('faction-trial-infernal', 'Infernal', 'Épreuve de faction - Infernal', 18, 40, 'faction-trial', 'Épreuve de faction', 18),
      ('faction-trial-perceur', 'Perceur', 'Épreuve de faction - Perceur', 18, 50, 'faction-trial', 'Épreuve de faction', 18),
      ('faction-trial-cultiste', 'Cultiste', 'Épreuve de faction - Cultiste', 18, 60, 'faction-trial', 'Épreuve de faction', 18),
      ('faction-trial-esoteriste', 'Ésotériste', 'Épreuve de faction - Ésotériste', 18, 70, 'faction-trial', 'Épreuve de faction', 18),
      ('faction-trial-sentinelle', 'Sentinelle', 'Épreuve de faction - Sentinelle', 18, 80, 'faction-trial', 'Épreuve de faction', 18),
      ('faction-trial-cauchemar', 'Cauchemar', 'Épreuve de faction - Cauchemar', 18, 90, 'faction-trial', 'Épreuve de faction', 18),
      ('dragon-chasm', 'Gouffre du dragon', 'Boss de guilde - Gouffre du dragon', 8, 10, 'guild-boss', 'Boss de guilde', 20),
      ('titan-ruins', 'Ruine de titan', 'Boss de guilde - Ruine de titan', 4, 20, 'guild-boss', 'Boss de guilde', 20),
      ('immortal-codex', 'Défi d''épreuve', 'Codex immortel - Défi d''épreuve', 8, 10, 'immortal-codex', 'Codex immortel', 30),
      ('immortal-codex-conquest', 'Défi de conquête', 'Codex immortel - Défi de conquête', 2, 20, 'immortal-codex', 'Codex immortel', 30),
      ('arena-anti-air', 'Antiaérien', 'Arène - Antiaérien', 1, 10, 'arena', 'Arène', 50),
      ('arena-zde', 'ZDE', 'Arène - ZDE', 1, 20, 'arena', 'Arène', 50),
      ('arena-single-target', 'Monocible', 'Arène - Monocible', 1, 30, 'arena', 'Arène', 50),
      ('campaign-normal', 'Normal', 'Campagne normale', 10, 10, 'campaign', 'Campagne', 60),
      ('campaign-hard', 'Difficile', 'Campagne difficile', 9, 20, 'campaign', 'Campagne', 60),
      ('campaign-expert', 'Expert', 'Campagne expert', 9, 30, 'campaign', 'Campagne', 60),
      ('malrik', 'Malrik', 'Pierres de Malrik', 1, 10, 'malrik', 'Malrik', 70),
      ('breche', 'Brèche', 'Brèche', 2, 10, 'breche', 'Brèche', 80),
      ('war-gallery', 'Galerie de guerre', 'Galerie de guerre', 1, 10, 'war-gallery', 'Galerie de guerre', 90),
      ('other', 'Autre', 'Autre', 1, 10, 'other', 'Autre', 100)
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
      ('titan-ruins', 4, 'Matrice 1 - Physique'),
      ('immortal-codex', 1, 'L''empereur de l''Inferno'),
      ('immortal-codex', 2, 'Juge de givre'),
      ('immortal-codex', 3, 'Conquérant'),
      ('immortal-codex', 4, 'Titan des friches'),
      ('immortal-codex', 5, 'Seigneur de Styx'),
      ('immortal-codex', 6, 'Maelström'),
      ('immortal-codex', 7, 'Cauchemar fantasmatique'),
      ('immortal-codex', 8, 'Mère des corbeaux'),
      ('immortal-codex-conquest', 1, 'Commandant de légion du cauchemar'),
      ('immortal-codex-conquest', 2, 'Eris Del de l''aube'),
      ('arena-anti-air', 1, 'Antiaérien'),
      ('arena-zde', 1, 'ZDE'),
      ('arena-single-target', 1, 'Monocible'),
      ('campaign-normal', 1, 'Chapitre 1'),
      ('campaign-normal', 2, 'Chapitre 2'),
      ('campaign-normal', 3, 'Chapitre 3'),
      ('campaign-normal', 4, 'Chapitre 4'),
      ('campaign-normal', 5, 'Chapitre 5'),
      ('campaign-normal', 6, 'Chapitre 6'),
      ('campaign-normal', 7, 'Chapitre 7'),
      ('campaign-normal', 8, 'Chapitre 8'),
      ('campaign-normal', 9, 'Chapitre 9'),
      ('campaign-normal', 10, 'Chapitre 10'),
      ('campaign-hard', 1, 'Chapitre 1'),
      ('campaign-hard', 2, 'Chapitre 2'),
      ('campaign-hard', 3, 'Chapitre 3'),
      ('campaign-hard', 4, 'Chapitre 4'),
      ('campaign-hard', 5, 'Chapitre 5'),
      ('campaign-hard', 6, 'Chapitre 6'),
      ('campaign-hard', 7, 'Chapitre 7'),
      ('campaign-hard', 8, 'Chapitre 8'),
      ('campaign-hard', 9, 'Chapitre 9'),
      ('campaign-expert', 1, 'Chapitre 1'),
      ('campaign-expert', 2, 'Chapitre 2'),
      ('campaign-expert', 3, 'Chapitre 3'),
      ('campaign-expert', 4, 'Chapitre 4'),
      ('campaign-expert', 5, 'Chapitre 5'),
      ('campaign-expert', 6, 'Chapitre 6'),
      ('campaign-expert', 7, 'Chapitre 7'),
      ('campaign-expert', 8, 'Chapitre 8'),
      ('campaign-expert', 9, 'Chapitre 9'),
      ('malrik', 1, 'Malrik'),
      ('breche', 1, 'Néant'),
      ('breche', 2, 'Épilogue'),
      ('war-gallery', 1, 'Galerie de guerre'),
      ('other', 1, 'Autre'),
      ('illusion-tower', 41, 'Chambre cachée 1'),
      ('illusion-tower', 42, 'Chambre cachée 2'),
      ('illusion-tower', 43, 'Chambre cachée 3'),
      ('illusion-tower', 44, 'Chambre cachée 4'),
      ('illusion-tower', 45, 'Chambre cachée 5'),
      ('illusion-tower', 46, 'Chambre cachée 6'),
      ('illusion-tower', 47, 'Chambre cachée 7'),
      ('illusion-tower', 48, 'Chambre cachée 8')
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
