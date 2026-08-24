-- Verification V2 for Basic profile cosmetics assets added on 2026-08-24.
-- Returns one consolidated OK/ERROR result set.

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
found as (
  select
    proposed.asset_key as proposed_asset_key,
    proposed.asset_type as proposed_asset_type,
    proposed.asset_url as proposed_asset_url,
    proposed.metadata as proposed_metadata,
    asset.id,
    asset.asset_key,
    asset.asset_type,
    asset.asset_url,
    asset.is_active,
    asset.metadata,
    collection.collection_key,
    collection.is_public,
    collection.is_active as collection_is_active
  from proposed
  left join public.portal_cosmetic_assets asset on asset.asset_key = proposed.asset_key
  left join public.portal_cosmetic_collections collection on collection.id = asset.collection_id
),
checks(check_name, expected_value, actual_value) as (
  select 'total_catalog', '45', count(*)::text from public.portal_cosmetic_assets
  union all
  select 'basic_active_public', '45', count(*)::text
  from public.portal_cosmetic_assets asset
  join public.portal_cosmetic_collections collection on collection.id = asset.collection_id
  where collection.collection_key = 'basic'
    and collection.is_public = true
    and collection.is_active = true
    and asset.is_active = true
  union all
  select 'avatars', '20', count(*)::text
  from public.portal_cosmetic_assets asset
  join public.portal_cosmetic_collections collection on collection.id = asset.collection_id
  where collection.collection_key = 'basic'
    and collection.is_public = true
    and collection.is_active = true
    and asset.is_active = true
    and asset.asset_type = 'avatar'
  union all
  select 'frames', '25', count(*)::text
  from public.portal_cosmetic_assets asset
  join public.portal_cosmetic_collections collection on collection.id = asset.collection_id
  where collection.collection_key = 'basic'
    and collection.is_public = true
    and collection.is_active = true
    and asset.is_active = true
    and asset.asset_type = 'frame'
  union all
  select 'new_avatars', '15', count(*)::text
  from found
  where id is not null
    and asset_type = 'avatar'
  union all
  select 'new_frames', '20', count(*)::text
  from found
  where id is not null
    and asset_type = 'frame'
  union all
  select 'new_assets_basic_active_public', '35', count(*)::text
  from found
  where id is not null
    and collection_key = 'basic'
    and is_public = true
    and collection_is_active = true
    and is_active = true
  union all
  select 'new_assets_vps_urls_correct', '35', count(*)::text
  from found
  where id is not null
    and asset_url = proposed_asset_url
    and asset_url ~ '^https://vps-aad12be0\.vps\.ovh\.net/assets/profile-cosmetics/(avatars|frames)/[^/]+\.png$'
  union all
  select 'new_frames_content_inset_014', '20', count(*)::text
  from found
  where id is not null
    and proposed_asset_type = 'frame'
    and metadata = '{"content_inset": 0.14}'::jsonb
  union all
  select 'missing_new_ids', '0', count(*)::text
  from found
  where id is null
  union all
  select 'duplicate_new_asset_keys', '0', count(*)::text
  from (
    select asset.asset_key
    from public.portal_cosmetic_assets asset
    join proposed on proposed.asset_key = asset.asset_key
    group by asset.asset_key
    having count(*) > 1
  ) duplicate_key
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
