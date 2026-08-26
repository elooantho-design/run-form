begin transaction read only;

select
  table_name,
  table_type
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'portal_cosmetic_collections',
    'portal_cosmetic_assets',
    'portal_member_cosmetics'
  )
order by table_name;

select
  constraint_name,
  constraint_type
from information_schema.table_constraints
where table_schema = 'public'
  and table_name = 'portal_cosmetic_assets'
  and constraint_name = 'portal_cosmetic_assets_url_check';

select
  constraint_.conname as constraint_name,
  pg_get_constraintdef(constraint_.oid) as constraint_definition
from pg_constraint constraint_
join pg_class table_
  on table_.oid = constraint_.conrelid
join pg_namespace namespace_
  on namespace_.oid = table_.relnamespace
where namespace_.nspname = 'public'
  and table_.relname = 'portal_cosmetic_assets'
  and constraint_.conname = 'portal_cosmetic_assets_url_check';

select
  count(*) as total_assets,
  count(*) filter (
    where (
      asset_type = 'avatar'
      and (
        asset_url ~ '^https://vps-aad12be0\.vps\.ovh\.net/assets/profile-cosmetics/avatars/[^/]+\.png$'
        or asset_url ~ '^https://vps-aad12be0\.vps\.ovh\.net/assets/profile-cosmetics/avatar-videos/[^/]+\.(mp4|webm)$'
      )
    )
    or (
      asset_type = 'frame'
      and asset_url ~ '^https://vps-aad12be0\.vps\.ovh\.net/assets/profile-cosmetics/frames/[^/]+\.png$'
    )
  ) as valid_with_new_constraint,
  count(*) filter (
    where not (
      (
        asset_type = 'avatar'
        and (
          asset_url ~ '^https://vps-aad12be0\.vps\.ovh\.net/assets/profile-cosmetics/avatars/[^/]+\.png$'
          or asset_url ~ '^https://vps-aad12be0\.vps\.ovh\.net/assets/profile-cosmetics/avatar-videos/[^/]+\.(mp4|webm)$'
        )
      )
      or (
        asset_type = 'frame'
        and asset_url ~ '^https://vps-aad12be0\.vps\.ovh\.net/assets/profile-cosmetics/frames/[^/]+\.png$'
      )
    )
  ) as invalid_with_new_constraint
from public.portal_cosmetic_assets;

select
  id,
  asset_key,
  display_name,
  asset_type,
  asset_url
from public.portal_cosmetic_assets
where not (
  (
    asset_type = 'avatar'
    and (
      asset_url ~ '^https://vps-aad12be0\.vps\.ovh\.net/assets/profile-cosmetics/avatars/[^/]+\.png$'
      or asset_url ~ '^https://vps-aad12be0\.vps\.ovh\.net/assets/profile-cosmetics/avatar-videos/[^/]+\.(mp4|webm)$'
    )
  )
  or (
    asset_type = 'frame'
    and asset_url ~ '^https://vps-aad12be0\.vps\.ovh\.net/assets/profile-cosmetics/frames/[^/]+\.png$'
  )
)
order by asset_type, sort_order, asset_key;

select *
from (
  values
    ('avatar_png_allowed', 'avatar', 'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/test.png', true),
    ('frame_png_allowed', 'frame', 'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/test.png', true),
    ('avatar_video_mp4_allowed', 'avatar', 'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatar-videos/test.mp4', true),
    ('avatar_video_webm_allowed', 'avatar', 'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatar-videos/test.webm', true),
    ('avatar_video_mov_refused', 'avatar', 'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatar-videos/test.mov', false),
    ('external_domain_refused', 'avatar', 'https://example.com/assets/profile-cosmetics/avatar-videos/test.mp4', false)
) as sample(check_name, asset_type, asset_url, expected_allowed)
cross join lateral (
  select (
    (
      sample.asset_type = 'avatar'
      and (
        sample.asset_url ~ '^https://vps-aad12be0\.vps\.ovh\.net/assets/profile-cosmetics/avatars/[^/]+\.png$'
        or sample.asset_url ~ '^https://vps-aad12be0\.vps\.ovh\.net/assets/profile-cosmetics/avatar-videos/[^/]+\.(mp4|webm)$'
      )
    )
    or (
      sample.asset_type = 'frame'
      and sample.asset_url ~ '^https://vps-aad12be0\.vps\.ovh\.net/assets/profile-cosmetics/frames/[^/]+\.png$'
    )
  ) as actual_allowed
) result
order by check_name;

commit;
