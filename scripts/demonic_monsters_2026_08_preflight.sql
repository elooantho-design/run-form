-- Preflight read-only pour l'ajout de 8 monstres demoniaques.
-- Aucune ecriture, aucun verrou, aucune mutation.

with requested_monsters(name, slug, rarity) as (
  values
    ('Décimeur', 'decimeur', 'epique'),
    ('Marcheur de pierre ruine', 'marcheurdepierreruine', 'epique'),
    ('Titan des friches', 'titandesfriches', 'mythique'),
    ('Envoûteur de sang', 'envouteurdesang', 'legendaire'),
    ('Garde Ecrasant', 'gardeecrasant', 'legendaire'),
    ('Ravageur de rochers', 'ravageurderochers', 'legendaire'),
    ('Cadavre explosif', 'cadavreexplosif', 'legendaire'),
    ('Golem géant', 'golemgeant', 'legendaire')
)
select
  'requested_monsters' as check_name,
  *
from requested_monsters
order by rarity, name;

select
  table_name,
  column_name,
  ordinal_position,
  data_type,
  udt_name,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('demonic_monsters', 'member_demonic_monsters')
order by table_name, ordinal_position;

select
  conrelid::regclass::text as table_name,
  conname as constraint_name,
  contype as constraint_type,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where connamespace = 'public'::regnamespace
  and conrelid in (
    'public.demonic_monsters'::regclass,
    'public.member_demonic_monsters'::regclass
  )
order by table_name, constraint_name;

select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('demonic_monsters', 'member_demonic_monsters')
order by tablename, indexname;

select
  rarity,
  count(*) as monster_count,
  count(*) filter (where is_active) as active_count,
  min(sort_order) as min_sort_order,
  max(sort_order) as max_sort_order
from public.demonic_monsters
group by rarity
order by rarity;

with requested_monsters(name, slug, rarity) as (
  values
    ('Décimeur', 'decimeur', 'epique'),
    ('Marcheur de pierre ruine', 'marcheurdepierreruine', 'epique'),
    ('Titan des friches', 'titandesfriches', 'mythique'),
    ('Envoûteur de sang', 'envouteurdesang', 'legendaire'),
    ('Garde Ecrasant', 'gardeecrasant', 'legendaire'),
    ('Ravageur de rochers', 'ravageurderochers', 'legendaire'),
    ('Cadavre explosif', 'cadavreexplosif', 'legendaire'),
    ('Golem géant', 'golemgeant', 'legendaire')
),
current_rarities as (
  select distinct rarity
  from public.demonic_monsters
)
select
  requested.rarity,
  exists (
    select 1
    from current_rarities current
    where current.rarity = requested.rarity
  ) as rarity_already_used
from requested_monsters requested
group by requested.rarity
order by requested.rarity;

with requested_monsters(name, slug, rarity) as (
  values
    ('Décimeur', 'decimeur', 'epique'),
    ('Marcheur de pierre ruine', 'marcheurdepierreruine', 'epique'),
    ('Titan des friches', 'titandesfriches', 'mythique'),
    ('Envoûteur de sang', 'envouteurdesang', 'legendaire'),
    ('Garde Ecrasant', 'gardeecrasant', 'legendaire'),
    ('Ravageur de rochers', 'ravageurderochers', 'legendaire'),
    ('Cadavre explosif', 'cadavreexplosif', 'legendaire'),
    ('Golem géant', 'golemgeant', 'legendaire')
)
select
  requested.name,
  requested.slug,
  requested.rarity,
  name_match.id as existing_name_id,
  name_match.name as existing_name,
  name_match.slug as existing_name_slug,
  name_match.rarity as existing_name_rarity,
  slug_match.id as existing_slug_id,
  slug_match.name as existing_slug_name,
  slug_match.slug as existing_slug,
  slug_match.rarity as existing_slug_rarity
from requested_monsters requested
left join public.demonic_monsters name_match
  on lower(name_match.name) = lower(requested.name)
left join public.demonic_monsters slug_match
  on slug_match.slug = requested.slug
order by requested.name;

select
  count(*) as total_monsters,
  count(*) filter (where is_active) as active_monsters,
  count(*) filter (where image_url is not null and btrim(image_url) <> '') as monsters_with_image_url,
  count(*) filter (where image_url is null or btrim(image_url) = '') as monsters_using_slug_fallback
from public.demonic_monsters;

select
  count(*) as level_rows,
  count(distinct member_id) as members_with_levels,
  count(distinct monster_id) as monsters_with_levels,
  min(level) as min_level,
  max(level) as max_level,
  count(*) filter (where monster_id is null) as rows_without_monster_id
from public.member_demonic_monsters;

select
  levels.monster_id,
  monsters.slug,
  monsters.name,
  count(*) as level_rows
from public.member_demonic_monsters levels
left join public.demonic_monsters monsters
  on monsters.id = levels.monster_id
where monsters.id is null
group by levels.monster_id, monsters.slug, monsters.name
order by level_rows desc, levels.monster_id;
