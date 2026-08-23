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
  collection_key,
  display_name,
  is_public,
  is_active,
  sort_order
from public.portal_cosmetic_collections
where collection_key = 'basic';

select
  asset_type,
  count(*) as asset_count,
  count(*) filter (where is_active) as active_count
from public.portal_cosmetic_assets asset
join public.portal_cosmetic_collections collection
  on collection.id = asset.collection_id
where collection.collection_key = 'basic'
group by asset_type
order by asset_type;

select
  asset.asset_key,
  asset.display_name,
  asset.asset_type,
  asset.asset_url,
  asset.is_active,
  collection.collection_key,
  collection.is_public,
  asset.metadata
from public.portal_cosmetic_assets asset
join public.portal_cosmetic_collections collection
  on collection.id = asset.collection_id
where collection.collection_key = 'basic'
order by asset.asset_type, asset.sort_order, asset.asset_key;

select
  relname as table_name,
  relrowsecurity as rls_enabled,
  relforcerowsecurity as force_rls
from pg_class
where oid in (
  'public.portal_cosmetic_collections'::regclass,
  'public.portal_cosmetic_assets'::regclass,
  'public.portal_member_cosmetics'::regclass
)
order by relname;

select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
    'portal_cosmetic_collections',
    'portal_cosmetic_assets',
    'portal_member_cosmetics'
  )
order by tablename, policyname;

select
  grantee,
  table_name,
  privilege_type
from information_schema.table_privileges
where table_schema = 'public'
  and table_name in (
    'portal_cosmetic_collections',
    'portal_cosmetic_assets',
    'portal_member_cosmetics'
  )
order by table_name, grantee, privilege_type;

select
  selected.member_id,
  selected.selected_avatar_id,
  avatar.asset_type as selected_avatar_type,
  selected.selected_frame_id,
  frame.asset_type as selected_frame_type,
  selected.updated_at
from public.portal_member_cosmetics selected
left join public.portal_cosmetic_assets avatar
  on avatar.id = selected.selected_avatar_id
left join public.portal_cosmetic_assets frame
  on frame.id = selected.selected_frame_id
where (selected.selected_avatar_id is not null and avatar.asset_type is distinct from 'avatar')
   or (selected.selected_frame_id is not null and frame.asset_type is distinct from 'frame');

commit;
