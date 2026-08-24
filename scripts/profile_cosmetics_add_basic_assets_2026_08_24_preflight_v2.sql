-- Preflight V2 read-only for adding Basic profile cosmetics assets on 2026-08-24.
-- This script performs no writes.

with proposed_seed(asset_key, display_name, asset_type, file_name, sort_order, metadata) as (
  values
    ('basic_avatar_006', 'Avatar 06', 'avatar', 'ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_57_17.png', 60, '{}'::jsonb),
    ('basic_avatar_007', 'Avatar 07', 'avatar', 'ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_57_31.png', 70, '{}'::jsonb),
    ('basic_avatar_008', 'Avatar 08', 'avatar', 'ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_57_43.png', 80, '{}'::jsonb),
    ('basic_avatar_009', 'Avatar 09', 'avatar', 'ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_57_57.png', 90, '{}'::jsonb),
    ('basic_avatar_010', 'Avatar 10', 'avatar', 'ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_59_05.png', 100, '{}'::jsonb),
    ('basic_avatar_011', 'Avatar 11', 'avatar', 'ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_07_40.png', 110, '{}'::jsonb),
    ('basic_avatar_012', 'Avatar 12', 'avatar', 'ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_08_03.png', 120, '{}'::jsonb),
    ('basic_avatar_013', 'Avatar 13', 'avatar', 'ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_08_23.png', 130, '{}'::jsonb),
    ('basic_avatar_014', 'Avatar 14', 'avatar', 'ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_08_53.png', 140, '{}'::jsonb),
    ('basic_avatar_015', 'Avatar 15', 'avatar', 'ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_11_40.png', 150, '{}'::jsonb),
    ('basic_avatar_016', 'Avatar 16', 'avatar', 'ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_33_22.png', 160, '{}'::jsonb),
    ('basic_avatar_017', 'Avatar 17', 'avatar', 'ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_33_38.png', 170, '{}'::jsonb),
    ('basic_avatar_018', 'Avatar 18', 'avatar', 'ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_33_48.png', 180, '{}'::jsonb),
    ('basic_avatar_019', 'Avatar 19', 'avatar', 'ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_34_05.png', 190, '{}'::jsonb),
    ('basic_avatar_020', 'Avatar 20', 'avatar', 'ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_34_15.png', 200, '{}'::jsonb),
    ('basic_frame_006', 'Cadre 06', 'frame', 'ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_50_55.png', 160, '{"content_inset": 0.14}'::jsonb),
    ('basic_frame_007', 'Cadre 07', 'frame', 'ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_51_06.png', 170, '{"content_inset": 0.14}'::jsonb),
    ('basic_frame_008', 'Cadre 08', 'frame', 'ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_51_15.png', 180, '{"content_inset": 0.14}'::jsonb),
    ('basic_frame_009', 'Cadre 09', 'frame', 'ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_51_23.png', 190, '{"content_inset": 0.14}'::jsonb),
    ('basic_frame_010', 'Cadre 10', 'frame', 'ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_51_37.png', 200, '{"content_inset": 0.14}'::jsonb),
    ('basic_frame_011', 'Cadre 11', 'frame', 'ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_13_37.png', 210, '{"content_inset": 0.14}'::jsonb),
    ('basic_frame_012', 'Cadre 12', 'frame', 'ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_15_39.png', 220, '{"content_inset": 0.14}'::jsonb),
    ('basic_frame_013', 'Cadre 13', 'frame', 'ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_15_48.png', 230, '{"content_inset": 0.14}'::jsonb),
    ('basic_frame_014', 'Cadre 14', 'frame', 'ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_15_59.png', 240, '{"content_inset": 0.14}'::jsonb),
    ('basic_frame_015', 'Cadre 15', 'frame', 'ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_16_09.png', 250, '{"content_inset": 0.14}'::jsonb),
    ('basic_frame_016', 'Cadre 16', 'frame', 'ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_39_46.png', 260, '{"content_inset": 0.14}'::jsonb),
    ('basic_frame_017', 'Cadre 17', 'frame', 'ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_40_59.png', 270, '{"content_inset": 0.14}'::jsonb),
    ('basic_frame_018', 'Cadre 18', 'frame', 'ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_41_48.png', 280, '{"content_inset": 0.14}'::jsonb),
    ('basic_frame_019', 'Cadre 19', 'frame', 'ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_43_20.png', 290, '{"content_inset": 0.14}'::jsonb),
    ('basic_frame_020', 'Cadre 20', 'frame', 'ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_52_53.png', 300, '{"content_inset": 0.14}'::jsonb),
    ('basic_frame_021', 'Cadre 21', 'frame', 'ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_53_08.png', 310, '{"content_inset": 0.14}'::jsonb),
    ('basic_frame_022', 'Cadre 22', 'frame', 'ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_53_22.png', 320, '{"content_inset": 0.14}'::jsonb),
    ('basic_frame_023', 'Cadre 23', 'frame', 'ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_53_36.png', 330, '{"content_inset": 0.14}'::jsonb),
    ('basic_frame_024', 'Cadre 24', 'frame', 'ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_53_56.png', 340, '{"content_inset": 0.14}'::jsonb),
    ('basic_frame_025', 'Cadre 25', 'frame', 'ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_54_14.png', 350, '{"content_inset": 0.14}'::jsonb)
),
proposed as (
  select
    asset_key,
    display_name,
    asset_type,
    'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/' ||
      case when asset_type = 'avatar' then 'avatars' else 'frames' end ||
      '/' || file_name as asset_url,
    sort_order,
    metadata
  from proposed_seed
),
checks(check_name, expected_value, actual_value) as (
  select 'basic_collection_active_public_count', '1', count(*)::text
  from public.portal_cosmetic_collections
  where collection_key = 'basic'
    and is_public = true
    and is_active = true
  union all
  select 'proposed_total_rows', '35', count(*)::text from proposed
  union all
  select 'proposed_avatar_rows', '15', count(*)::text from proposed where asset_type = 'avatar'
  union all
  select 'proposed_frame_rows', '20', count(*)::text from proposed where asset_type = 'frame'
  union all
  select 'existing_catalog_total_before', '10', count(*)::text from public.portal_cosmetic_assets
  union all
  select 'existing_basic_active_public_before', '10', count(*)::text
  from public.portal_cosmetic_assets asset
  join public.portal_cosmetic_collections collection on collection.id = asset.collection_id
  where collection.collection_key = 'basic'
    and collection.is_public = true
    and collection.is_active = true
    and asset.is_active = true
  union all
  select 'existing_new_asset_keys_before', '0', count(*)::text
  from proposed
  join public.portal_cosmetic_assets asset on asset.asset_key = proposed.asset_key
  union all
  select 'existing_new_asset_urls_before', '0', count(*)::text
  from proposed
  join public.portal_cosmetic_assets asset on asset.asset_url = proposed.asset_url
  union all
  select 'proposed_duplicate_asset_keys', '0', count(*)::text
  from (
    select asset_key
    from proposed
    group by asset_key
    having count(*) > 1
  ) duplicate_key
  union all
  select 'proposed_duplicate_asset_urls', '0', count(*)::text
  from (
    select asset_url
    from proposed
    group by asset_url
    having count(*) > 1
  ) duplicate_url
  union all
  select 'proposed_non_vps_urls', '0', count(*)::text
  from proposed
  where asset_url !~ '^https://vps-aad12be0\.vps\.ovh\.net/assets/profile-cosmetics/(avatars|frames)/[^/]+\.png$'
  union all
  select 'proposed_new_frame_content_inset_014', '20', count(*)::text
  from proposed
  where asset_type = 'frame'
    and metadata = '{"content_inset": 0.14}'::jsonb
  union all
  select 'would_insert_rows_now', '35', count(*)::text
  from proposed
  cross join public.portal_cosmetic_collections collection
  where collection.collection_key = 'basic'
    and collection.is_public = true
    and collection.is_active = true
    and not exists (
      select 1
      from public.portal_cosmetic_assets asset
      where asset.asset_key = proposed.asset_key
    )
  union all
  select 'invalid_player_selections', '0', count(*)::text
  from public.portal_member_cosmetics selection
  left join public.portal_cosmetic_assets avatar on avatar.id = selection.selected_avatar_id
  left join public.portal_cosmetic_assets frame on frame.id = selection.selected_frame_id
  where (selection.selected_avatar_id is not null and avatar.id is null)
     or (selection.selected_frame_id is not null and frame.id is null)
)
select
  check_name,
  expected_value,
  actual_value,
  case when expected_value = actual_value then 'OK' else 'ERROR' end as status
from checks
order by check_name;
