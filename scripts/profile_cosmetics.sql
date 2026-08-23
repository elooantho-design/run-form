begin;

create or replace function public.profile_cosmetics_touch_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

revoke all on function public.profile_cosmetics_touch_updated_at() from public, anon, authenticated;
grant execute on function public.profile_cosmetics_touch_updated_at() to service_role;

create table if not exists public.portal_cosmetic_collections (
  id uuid primary key default gen_random_uuid(),
  collection_key text not null,
  display_name text not null,
  is_public boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint portal_cosmetic_collections_key_unique unique (collection_key),
  constraint portal_cosmetic_collections_key_format_check check (
    collection_key = lower(collection_key)
    and collection_key ~ '^[a-z0-9][a-z0-9_-]{1,63}$'
  ),
  constraint portal_cosmetic_collections_display_name_check check (length(btrim(display_name)) > 0)
);

create table if not exists public.portal_cosmetic_assets (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null
    references public.portal_cosmetic_collections(id)
    on delete restrict,
  asset_key text not null,
  display_name text not null,
  asset_type text not null,
  asset_url text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint portal_cosmetic_assets_key_unique unique (asset_key),
  constraint portal_cosmetic_assets_key_format_check check (
    asset_key = lower(asset_key)
    and asset_key ~ '^[a-z0-9][a-z0-9_-]{1,95}$'
  ),
  constraint portal_cosmetic_assets_display_name_check check (length(btrim(display_name)) > 0),
  constraint portal_cosmetic_assets_type_check check (asset_type in ('avatar', 'frame')),
  constraint portal_cosmetic_assets_url_check check (
    asset_url ~ '^https://vps-aad12be0\.vps\.ovh\.net/assets/profile-cosmetics/(avatars|frames)/[^/]+\.png$'
  ),
  constraint portal_cosmetic_assets_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.portal_member_cosmetics (
  member_id uuid primary key
    references public.guild_members(id)
    on delete cascade,
  selected_avatar_id uuid null
    references public.portal_cosmetic_assets(id)
    on delete set null,
  selected_frame_id uuid null
    references public.portal_cosmetic_assets(id)
    on delete set null,
  updated_at timestamptz not null default now(),
  constraint portal_member_cosmetics_frame_requires_avatar_check check (
    selected_frame_id is null or selected_avatar_id is not null
  ),
  constraint portal_member_cosmetics_distinct_assets_check check (
    selected_frame_id is null or selected_avatar_id is null or selected_frame_id <> selected_avatar_id
  )
);

create index if not exists portal_cosmetic_assets_collection_type_idx
  on public.portal_cosmetic_assets (collection_id, asset_type, is_active, sort_order);

create index if not exists portal_cosmetic_assets_type_active_idx
  on public.portal_cosmetic_assets (asset_type, is_active, sort_order);

create index if not exists portal_member_cosmetics_avatar_idx
  on public.portal_member_cosmetics (selected_avatar_id);

create index if not exists portal_member_cosmetics_frame_idx
  on public.portal_member_cosmetics (selected_frame_id);

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.portal_member_cosmetics'::regclass
      and tgname = 'portal_member_cosmetics_touch_updated_at'
  ) then
    create trigger portal_member_cosmetics_touch_updated_at
    before update on public.portal_member_cosmetics
    for each row
    execute function public.profile_cosmetics_touch_updated_at();
  end if;
end;
$$;

alter table public.portal_cosmetic_collections enable row level security;
alter table public.portal_cosmetic_assets enable row level security;
alter table public.portal_member_cosmetics enable row level security;

revoke all on table public.portal_cosmetic_collections from anon, authenticated;
revoke all on table public.portal_cosmetic_assets from anon, authenticated;
revoke all on table public.portal_member_cosmetics from anon, authenticated;

grant select, insert, update, delete on table public.portal_cosmetic_collections to service_role;
grant select, insert, update, delete on table public.portal_cosmetic_assets to service_role;
grant select, insert, update, delete on table public.portal_member_cosmetics to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'portal_cosmetic_collections'
      and policyname = 'portal_cosmetic_collections_service_role_all'
  ) then
    execute 'create policy portal_cosmetic_collections_service_role_all on public.portal_cosmetic_collections for all to service_role using (true) with check (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'portal_cosmetic_assets'
      and policyname = 'portal_cosmetic_assets_service_role_all'
  ) then
    execute 'create policy portal_cosmetic_assets_service_role_all on public.portal_cosmetic_assets for all to service_role using (true) with check (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'portal_member_cosmetics'
      and policyname = 'portal_member_cosmetics_service_role_all'
  ) then
    execute 'create policy portal_member_cosmetics_service_role_all on public.portal_member_cosmetics for all to service_role using (true) with check (true)';
  end if;
end;
$$;

insert into public.portal_cosmetic_collections (
  collection_key,
  display_name,
  is_public,
  is_active,
  sort_order
)
values (
  'basic',
  'Basique',
  true,
  true,
  10
)
on conflict (collection_key) do update
set
  display_name = excluded.display_name,
  is_public = true,
  is_active = true,
  sort_order = excluded.sort_order;

with basic as (
  select id
  from public.portal_cosmetic_collections
  where collection_key = 'basic'
)
insert into public.portal_cosmetic_assets (
  collection_id,
  asset_key,
  display_name,
  asset_type,
  asset_url,
  is_active,
  sort_order,
  metadata
)
select
  basic.id,
  asset.asset_key,
  asset.display_name,
  asset.asset_type,
  asset.asset_url,
  true,
  asset.sort_order,
  asset.metadata
from basic
cross join (
  values
    (
      'avatar_chatgpt_image_23_aout_2026_19_38_11',
      'Avatar 1',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2023%20ao%C3%BBt%202026%2C%2019_38_11.png',
      10,
      '{}'::jsonb
    ),
    (
      'avatar_chatgpt_image_23_aout_2026_19_38_19',
      'Avatar 2',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2023%20ao%C3%BBt%202026%2C%2019_38_19.png',
      20,
      '{}'::jsonb
    ),
    (
      'avatar_chatgpt_image_23_aout_2026_19_38_30',
      'Avatar 3',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2023%20ao%C3%BBt%202026%2C%2019_38_30.png',
      30,
      '{}'::jsonb
    ),
    (
      'avatar_chatgpt_image_23_aout_2026_19_38_53',
      'Avatar 4',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2023%20ao%C3%BBt%202026%2C%2019_38_53.png',
      40,
      '{}'::jsonb
    ),
    (
      'avatar_chatgpt_image_23_aout_2026_19_39_02',
      'Avatar 5',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2023%20ao%C3%BBt%202026%2C%2019_39_02.png',
      50,
      '{}'::jsonb
    ),
    (
      'frame_chatgpt_image_23_aout_2026_19_05_07',
      'Cadre 1',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2023%20ao%C3%BBt%202026%2C%2019_05_07.png',
      110,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'frame_chatgpt_image_23_aout_2026_19_26_59',
      'Cadre 2',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2023%20ao%C3%BBt%202026%2C%2019_26_59.png',
      120,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'frame_chatgpt_image_23_aout_2026_19_27_08',
      'Cadre 3',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2023%20ao%C3%BBt%202026%2C%2019_27_08.png',
      130,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'frame_chatgpt_image_23_aout_2026_19_28_31',
      'Cadre 4',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2023%20ao%C3%BBt%202026%2C%2019_28_31.png',
      140,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'frame_chatgpt_image_23_aout_2026_19_29_29',
      'Cadre 5',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2023%20ao%C3%BBt%202026%2C%2019_29_29.png',
      150,
      '{"content_inset": 0.14}'::jsonb
    )
) as asset(asset_key, display_name, asset_type, asset_url, sort_order, metadata)
on conflict (asset_key) do update
set
  display_name = excluded.display_name,
  asset_type = excluded.asset_type,
  asset_url = excluded.asset_url,
  sort_order = excluded.sort_order,
  metadata = excluded.metadata;

commit;
