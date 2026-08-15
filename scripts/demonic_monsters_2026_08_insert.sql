begin;

do $$
begin
  if to_regclass('public.demonic_monsters') is null then
    raise exception 'Table public.demonic_monsters introuvable.';
  end if;

  if to_regclass('public.member_demonic_monsters') is null then
    raise exception 'Table public.member_demonic_monsters introuvable.';
  end if;

  if not exists (
    select 1
    from pg_index index_info
    join pg_class table_info
      on table_info.oid = index_info.indrelid
    join pg_namespace namespace_info
      on namespace_info.oid = table_info.relnamespace
    where namespace_info.nspname = 'public'
      and table_info.relname = 'demonic_monsters'
      and index_info.indisunique
      and index_info.indpred is null
      and (
        select array_agg(attribute.attname::text order by key_position.ordinality)
        from unnest(index_info.indkey) with ordinality as key_position(attnum, ordinality)
        join pg_attribute attribute
          on attribute.attrelid = table_info.oid
         and attribute.attnum = key_position.attnum
      ) = array['slug']
  ) then
    raise exception 'Aucun index ou contrainte unique sur public.demonic_monsters(slug). INSERT idempotent refuse.';
  end if;

  if exists (
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
    select 1
    from requested_monsters requested
    where not exists (
      select 1
      from public.demonic_monsters existing
      where existing.rarity = requested.rarity
    )
  ) then
    raise exception 'Une rarete demandee n existe pas encore dans public.demonic_monsters.';
  end if;

  if exists (
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
    select 1
    from requested_monsters requested
    join public.demonic_monsters existing
      on lower(existing.name) = lower(requested.name)
     and existing.slug <> requested.slug
  ) then
    raise exception 'Collision de nom detectee avec un slug different.';
  end if;

  if exists (
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
    select 1
    from requested_monsters requested
    join public.demonic_monsters existing
      on existing.slug = requested.slug
    where existing.name <> requested.name
       or existing.rarity <> requested.rarity
  ) then
    raise exception 'Collision de slug detectee avec un nom ou une rarete differente.';
  end if;
end $$;

with requested_monsters(name, slug, rarity, ordinal_position) as (
  values
    ('Décimeur', 'decimeur', 'epique', 1),
    ('Marcheur de pierre ruine', 'marcheurdepierreruine', 'epique', 2),
    ('Titan des friches', 'titandesfriches', 'mythique', 3),
    ('Envoûteur de sang', 'envouteurdesang', 'legendaire', 4),
    ('Garde Ecrasant', 'gardeecrasant', 'legendaire', 5),
    ('Ravageur de rochers', 'ravageurderochers', 'legendaire', 6),
    ('Cadavre explosif', 'cadavreexplosif', 'legendaire', 7),
    ('Golem géant', 'golemgeant', 'legendaire', 8)
),
sort_base as (
  select coalesce(max(sort_order), 0) as max_sort_order
  from public.demonic_monsters
)
insert into public.demonic_monsters (
  name,
  slug,
  rarity,
  sort_order,
  is_active
)
select
  requested.name,
  requested.slug,
  requested.rarity,
  sort_base.max_sort_order + requested.ordinal_position,
  true
from requested_monsters requested
cross join sort_base
on conflict (slug) do nothing;

commit;
