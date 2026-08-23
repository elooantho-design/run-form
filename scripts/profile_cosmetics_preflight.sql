begin transaction read only;

select
  table_schema,
  table_name,
  table_type
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'guild_members',
    'portal_cosmetic_collections',
    'portal_cosmetic_assets',
    'portal_member_cosmetics'
  )
order by table_name;

select
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'guild_members',
    'portal_cosmetic_collections',
    'portal_cosmetic_assets',
    'portal_member_cosmetics'
  )
order by table_name, ordinal_position;

select
  constraint_name,
  table_name,
  constraint_type
from information_schema.table_constraints
where table_schema = 'public'
  and table_name in (
    'portal_cosmetic_collections',
    'portal_cosmetic_assets',
    'portal_member_cosmetics'
  )
order by table_name, constraint_name;

select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd,
  qual,
  with_check
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
  'portal_touch_updated_at' as function_name,
  to_regprocedure('public.portal_touch_updated_at()') is not null as exists;

select
  'gen_random_uuid' as function_name,
  to_regprocedure('public.gen_random_uuid()') is not null as exists;

do $$
declare
  v_count integer;
begin
  if to_regclass('public.portal_cosmetic_collections') is null then
    raise notice 'portal_cosmetic_collections_absent=true';
  else
    execute $query$
      select count(*)
      from public.portal_cosmetic_collections
      where collection_key = 'basic'
    $query$
    into v_count;
    raise notice 'basic_collection_rows=%', v_count;
  end if;

  if to_regclass('public.portal_cosmetic_assets') is null then
    raise notice 'portal_cosmetic_assets_absent=true';
  else
    execute $query$
      select count(*)
      from public.portal_cosmetic_assets
      where asset_key in (
        'avatar_chatgpt_image_23_aout_2026_19_38_11',
        'avatar_chatgpt_image_23_aout_2026_19_38_19',
        'avatar_chatgpt_image_23_aout_2026_19_38_30',
        'avatar_chatgpt_image_23_aout_2026_19_38_53',
        'avatar_chatgpt_image_23_aout_2026_19_39_02',
        'frame_chatgpt_image_23_aout_2026_19_05_07',
        'frame_chatgpt_image_23_aout_2026_19_26_59',
        'frame_chatgpt_image_23_aout_2026_19_27_08',
        'frame_chatgpt_image_23_aout_2026_19_28_31',
        'frame_chatgpt_image_23_aout_2026_19_29_29'
      )
    $query$
    into v_count;
    raise notice 'seed_asset_key_collisions=%', v_count;
  end if;

  if to_regclass('public.portal_member_cosmetics') is null then
    raise notice 'portal_member_cosmetics_absent=true';
  else
    execute 'select count(*) from public.portal_member_cosmetics'
    into v_count;
    raise notice 'existing_member_cosmetic_rows=%', v_count;
  end if;
end;
$$;

commit;
