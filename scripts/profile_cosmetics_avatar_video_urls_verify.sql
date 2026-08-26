begin transaction read only;

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
  'all_existing_assets_allowed' as check_name,
  count(*)::text as expected_value,
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
  )::text as actual_value,
  case
    when count(*) = count(*) filter (
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
    ) then 'OK'
    else 'ERROR'
  end as status
from public.portal_cosmetic_assets

union all

select
  sample.check_name,
  sample.expected_allowed::text,
  result.actual_allowed::text,
  case when result.actual_allowed = sample.expected_allowed then 'OK' else 'ERROR' end
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
