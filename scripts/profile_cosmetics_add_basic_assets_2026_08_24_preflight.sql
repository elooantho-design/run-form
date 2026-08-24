-- Preflight read-only for adding Basic profile cosmetics assets on 2026-08-24.
-- No writes. Execute before scripts/profile_cosmetics_add_basic_assets_2026_08_24.sql.

with proposed(asset_key, display_name, asset_type, asset_url, sort_order, metadata) as (
  values
    (
      'basic_avatar_006',
      'Avatar 06',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_57_17.png',
      60,
      '{}'::jsonb
    ),
    (
      'basic_avatar_007',
      'Avatar 07',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_57_31.png',
      70,
      '{}'::jsonb
    ),
    (
      'basic_avatar_008',
      'Avatar 08',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_57_43.png',
      80,
      '{}'::jsonb
    ),
    (
      'basic_avatar_009',
      'Avatar 09',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_57_57.png',
      90,
      '{}'::jsonb
    ),
    (
      'basic_avatar_010',
      'Avatar 10',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_59_05.png',
      100,
      '{}'::jsonb
    ),
    (
      'basic_avatar_011',
      'Avatar 11',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_07_40.png',
      110,
      '{}'::jsonb
    ),
    (
      'basic_avatar_012',
      'Avatar 12',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_08_03.png',
      120,
      '{}'::jsonb
    ),
    (
      'basic_avatar_013',
      'Avatar 13',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_08_23.png',
      130,
      '{}'::jsonb
    ),
    (
      'basic_avatar_014',
      'Avatar 14',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_08_53.png',
      140,
      '{}'::jsonb
    ),
    (
      'basic_avatar_015',
      'Avatar 15',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_11_40.png',
      150,
      '{}'::jsonb
    ),
    (
      'basic_avatar_016',
      'Avatar 16',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_33_22.png',
      160,
      '{}'::jsonb
    ),
    (
      'basic_avatar_017',
      'Avatar 17',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_33_38.png',
      170,
      '{}'::jsonb
    ),
    (
      'basic_avatar_018',
      'Avatar 18',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_33_48.png',
      180,
      '{}'::jsonb
    ),
    (
      'basic_avatar_019',
      'Avatar 19',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_34_05.png',
      190,
      '{}'::jsonb
    ),
    (
      'basic_avatar_020',
      'Avatar 20',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_34_15.png',
      200,
      '{}'::jsonb
    ),
    (
      'basic_frame_006',
      'Cadre 06',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_50_55.png',
      160,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_007',
      'Cadre 07',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_51_06.png',
      170,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_008',
      'Cadre 08',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_51_15.png',
      180,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_009',
      'Cadre 09',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_51_23.png',
      190,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_010',
      'Cadre 10',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_51_37.png',
      200,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_011',
      'Cadre 11',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_13_37.png',
      210,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_012',
      'Cadre 12',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_15_39.png',
      220,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_013',
      'Cadre 13',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_15_48.png',
      230,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_014',
      'Cadre 14',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_15_59.png',
      240,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_015',
      'Cadre 15',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_16_09.png',
      250,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_016',
      'Cadre 16',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_39_46.png',
      260,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_017',
      'Cadre 17',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_40_59.png',
      270,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_018',
      'Cadre 18',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_41_48.png',
      280,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_019',
      'Cadre 19',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_43_20.png',
      290,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_020',
      'Cadre 20',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_52_53.png',
      300,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_021',
      'Cadre 21',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_53_08.png',
      310,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_022',
      'Cadre 22',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_53_22.png',
      320,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_023',
      'Cadre 23',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_53_36.png',
      330,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_024',
      'Cadre 24',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_53_56.png',
      340,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_025',
      'Cadre 25',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_54_14.png',
      350,
      '{"content_inset": 0.14}'::jsonb
    )
)
select
  'basic_collection' as check_name,
  collection.id as collection_id,
  collection.collection_key,
  collection.display_name,
  collection.is_public,
  collection.is_active
from public.portal_cosmetic_collections collection
where collection.collection_key = 'basic';

with proposed(asset_key, display_name, asset_type, asset_url, sort_order, metadata) as (
  values
    (
      'basic_avatar_006',
      'Avatar 06',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_57_17.png',
      60,
      '{}'::jsonb
    ),
    (
      'basic_avatar_007',
      'Avatar 07',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_57_31.png',
      70,
      '{}'::jsonb
    ),
    (
      'basic_avatar_008',
      'Avatar 08',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_57_43.png',
      80,
      '{}'::jsonb
    ),
    (
      'basic_avatar_009',
      'Avatar 09',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_57_57.png',
      90,
      '{}'::jsonb
    ),
    (
      'basic_avatar_010',
      'Avatar 10',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_59_05.png',
      100,
      '{}'::jsonb
    ),
    (
      'basic_avatar_011',
      'Avatar 11',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_07_40.png',
      110,
      '{}'::jsonb
    ),
    (
      'basic_avatar_012',
      'Avatar 12',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_08_03.png',
      120,
      '{}'::jsonb
    ),
    (
      'basic_avatar_013',
      'Avatar 13',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_08_23.png',
      130,
      '{}'::jsonb
    ),
    (
      'basic_avatar_014',
      'Avatar 14',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_08_53.png',
      140,
      '{}'::jsonb
    ),
    (
      'basic_avatar_015',
      'Avatar 15',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_11_40.png',
      150,
      '{}'::jsonb
    ),
    (
      'basic_avatar_016',
      'Avatar 16',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_33_22.png',
      160,
      '{}'::jsonb
    ),
    (
      'basic_avatar_017',
      'Avatar 17',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_33_38.png',
      170,
      '{}'::jsonb
    ),
    (
      'basic_avatar_018',
      'Avatar 18',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_33_48.png',
      180,
      '{}'::jsonb
    ),
    (
      'basic_avatar_019',
      'Avatar 19',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_34_05.png',
      190,
      '{}'::jsonb
    ),
    (
      'basic_avatar_020',
      'Avatar 20',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_34_15.png',
      200,
      '{}'::jsonb
    ),
    (
      'basic_frame_006',
      'Cadre 06',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_50_55.png',
      160,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_007',
      'Cadre 07',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_51_06.png',
      170,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_008',
      'Cadre 08',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_51_15.png',
      180,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_009',
      'Cadre 09',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_51_23.png',
      190,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_010',
      'Cadre 10',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_51_37.png',
      200,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_011',
      'Cadre 11',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_13_37.png',
      210,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_012',
      'Cadre 12',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_15_39.png',
      220,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_013',
      'Cadre 13',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_15_48.png',
      230,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_014',
      'Cadre 14',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_15_59.png',
      240,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_015',
      'Cadre 15',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_16_09.png',
      250,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_016',
      'Cadre 16',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_39_46.png',
      260,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_017',
      'Cadre 17',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_40_59.png',
      270,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_018',
      'Cadre 18',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_41_48.png',
      280,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_019',
      'Cadre 19',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_43_20.png',
      290,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_020',
      'Cadre 20',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_52_53.png',
      300,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_021',
      'Cadre 21',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_53_08.png',
      310,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_022',
      'Cadre 22',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_53_22.png',
      320,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_023',
      'Cadre 23',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_53_36.png',
      330,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_024',
      'Cadre 24',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_53_56.png',
      340,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_025',
      'Cadre 25',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_54_14.png',
      350,
      '{"content_inset": 0.14}'::jsonb
    )
)
select
  proposed.asset_key,
  proposed.display_name,
  proposed.asset_type,
  proposed.asset_url,
  exists (
    select 1
    from public.portal_cosmetic_assets existing
    where existing.asset_key = proposed.asset_key
  ) as collision_key,
  exists (
    select 1
    from public.portal_cosmetic_assets existing
    where existing.asset_url = proposed.asset_url
  ) as collision_url,
  proposed.asset_url !~ '^https://vps-aad12be0\.vps\.ovh\.net/assets/profile-cosmetics/(avatars|frames)/[^/]+\.png$' as non_vps_url
from proposed
order by proposed.asset_type, proposed.sort_order;

select
  asset_type,
  count(*) as active_count
from public.portal_cosmetic_assets
where is_active
  and asset_type in ('avatar', 'frame')
group by asset_type
order by asset_type;

with proposed(asset_key, display_name, asset_type, asset_url, sort_order, metadata) as (
  values
    (
      'basic_avatar_006',
      'Avatar 06',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_57_17.png',
      60,
      '{}'::jsonb
    ),
    (
      'basic_avatar_007',
      'Avatar 07',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_57_31.png',
      70,
      '{}'::jsonb
    ),
    (
      'basic_avatar_008',
      'Avatar 08',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_57_43.png',
      80,
      '{}'::jsonb
    ),
    (
      'basic_avatar_009',
      'Avatar 09',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_57_57.png',
      90,
      '{}'::jsonb
    ),
    (
      'basic_avatar_010',
      'Avatar 10',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_59_05.png',
      100,
      '{}'::jsonb
    ),
    (
      'basic_avatar_011',
      'Avatar 11',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_07_40.png',
      110,
      '{}'::jsonb
    ),
    (
      'basic_avatar_012',
      'Avatar 12',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_08_03.png',
      120,
      '{}'::jsonb
    ),
    (
      'basic_avatar_013',
      'Avatar 13',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_08_23.png',
      130,
      '{}'::jsonb
    ),
    (
      'basic_avatar_014',
      'Avatar 14',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_08_53.png',
      140,
      '{}'::jsonb
    ),
    (
      'basic_avatar_015',
      'Avatar 15',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_11_40.png',
      150,
      '{}'::jsonb
    ),
    (
      'basic_avatar_016',
      'Avatar 16',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_33_22.png',
      160,
      '{}'::jsonb
    ),
    (
      'basic_avatar_017',
      'Avatar 17',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_33_38.png',
      170,
      '{}'::jsonb
    ),
    (
      'basic_avatar_018',
      'Avatar 18',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_33_48.png',
      180,
      '{}'::jsonb
    ),
    (
      'basic_avatar_019',
      'Avatar 19',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_34_05.png',
      190,
      '{}'::jsonb
    ),
    (
      'basic_avatar_020',
      'Avatar 20',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_34_15.png',
      200,
      '{}'::jsonb
    ),
    (
      'basic_frame_006',
      'Cadre 06',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_50_55.png',
      160,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_007',
      'Cadre 07',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_51_06.png',
      170,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_008',
      'Cadre 08',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_51_15.png',
      180,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_009',
      'Cadre 09',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_51_23.png',
      190,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_010',
      'Cadre 10',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_51_37.png',
      200,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_011',
      'Cadre 11',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_13_37.png',
      210,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_012',
      'Cadre 12',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_15_39.png',
      220,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_013',
      'Cadre 13',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_15_48.png',
      230,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_014',
      'Cadre 14',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_15_59.png',
      240,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_015',
      'Cadre 15',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_16_09.png',
      250,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_016',
      'Cadre 16',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_39_46.png',
      260,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_017',
      'Cadre 17',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_40_59.png',
      270,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_018',
      'Cadre 18',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_41_48.png',
      280,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_019',
      'Cadre 19',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_43_20.png',
      290,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_020',
      'Cadre 20',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_52_53.png',
      300,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_021',
      'Cadre 21',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_53_08.png',
      310,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_022',
      'Cadre 22',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_53_22.png',
      320,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_023',
      'Cadre 23',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_53_36.png',
      330,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_024',
      'Cadre 24',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_53_56.png',
      340,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_025',
      'Cadre 25',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_54_14.png',
      350,
      '{"content_inset": 0.14}'::jsonb
    )
)
select
  'asset_key_collisions' as check_name,
  proposed.asset_key,
  existing.id,
  existing.display_name as existing_display_name,
  existing.asset_type as existing_asset_type,
  existing.asset_url as existing_asset_url
from proposed
join public.portal_cosmetic_assets existing
  on existing.asset_key = proposed.asset_key
order by proposed.asset_key;

with proposed(asset_key, display_name, asset_type, asset_url, sort_order, metadata) as (
  values
    (
      'basic_avatar_006',
      'Avatar 06',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_57_17.png',
      60,
      '{}'::jsonb
    ),
    (
      'basic_avatar_007',
      'Avatar 07',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_57_31.png',
      70,
      '{}'::jsonb
    ),
    (
      'basic_avatar_008',
      'Avatar 08',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_57_43.png',
      80,
      '{}'::jsonb
    ),
    (
      'basic_avatar_009',
      'Avatar 09',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_57_57.png',
      90,
      '{}'::jsonb
    ),
    (
      'basic_avatar_010',
      'Avatar 10',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_59_05.png',
      100,
      '{}'::jsonb
    ),
    (
      'basic_avatar_011',
      'Avatar 11',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_07_40.png',
      110,
      '{}'::jsonb
    ),
    (
      'basic_avatar_012',
      'Avatar 12',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_08_03.png',
      120,
      '{}'::jsonb
    ),
    (
      'basic_avatar_013',
      'Avatar 13',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_08_23.png',
      130,
      '{}'::jsonb
    ),
    (
      'basic_avatar_014',
      'Avatar 14',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_08_53.png',
      140,
      '{}'::jsonb
    ),
    (
      'basic_avatar_015',
      'Avatar 15',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_11_40.png',
      150,
      '{}'::jsonb
    ),
    (
      'basic_avatar_016',
      'Avatar 16',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_33_22.png',
      160,
      '{}'::jsonb
    ),
    (
      'basic_avatar_017',
      'Avatar 17',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_33_38.png',
      170,
      '{}'::jsonb
    ),
    (
      'basic_avatar_018',
      'Avatar 18',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_33_48.png',
      180,
      '{}'::jsonb
    ),
    (
      'basic_avatar_019',
      'Avatar 19',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_34_05.png',
      190,
      '{}'::jsonb
    ),
    (
      'basic_avatar_020',
      'Avatar 20',
      'avatar',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_34_15.png',
      200,
      '{}'::jsonb
    ),
    (
      'basic_frame_006',
      'Cadre 06',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_50_55.png',
      160,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_007',
      'Cadre 07',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_51_06.png',
      170,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_008',
      'Cadre 08',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_51_15.png',
      180,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_009',
      'Cadre 09',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_51_23.png',
      190,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_010',
      'Cadre 10',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2010_51_37.png',
      200,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_011',
      'Cadre 11',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_13_37.png',
      210,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_012',
      'Cadre 12',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_15_39.png',
      220,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_013',
      'Cadre 13',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_15_48.png',
      230,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_014',
      'Cadre 14',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_15_59.png',
      240,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_015',
      'Cadre 15',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_16_09.png',
      250,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_016',
      'Cadre 16',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_39_46.png',
      260,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_017',
      'Cadre 17',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_40_59.png',
      270,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_018',
      'Cadre 18',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_41_48.png',
      280,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_019',
      'Cadre 19',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_43_20.png',
      290,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_020',
      'Cadre 20',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_52_53.png',
      300,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_021',
      'Cadre 21',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_53_08.png',
      310,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_022',
      'Cadre 22',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_53_22.png',
      320,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_023',
      'Cadre 23',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_53_36.png',
      330,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_024',
      'Cadre 24',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_53_56.png',
      340,
      '{"content_inset": 0.14}'::jsonb
    ),
    (
      'basic_frame_025',
      'Cadre 25',
      'frame',
      'https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/ChatGPT%20Image%2024%20ao%C3%BBt%202026%2C%2011_54_14.png',
      350,
      '{"content_inset": 0.14}'::jsonb
    )
)
select
  'asset_url_collisions' as check_name,
  proposed.asset_key,
  proposed.asset_url,
  existing.id,
  existing.asset_key as existing_asset_key,
  existing.display_name as existing_display_name
from proposed
join public.portal_cosmetic_assets existing
  on existing.asset_url = proposed.asset_url
order by proposed.asset_url;

select
  'non_vps_catalog_urls' as check_name,
  id,
  asset_key,
  asset_type,
  asset_url
from public.portal_cosmetic_assets
where asset_url !~ '^https://vps-aad12be0\.vps\.ovh\.net/assets/profile-cosmetics/(avatars|frames)/[^/]+\.png$'
order by asset_type, sort_order, asset_key;
