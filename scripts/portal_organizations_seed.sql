begin;

with upserted_organizations as (
  insert into public.portal_organizations (
    organization_key,
    display_name,
    organization_type,
    is_active
  )
  values
    ('paladin', 'Paladin', 'internal', true),
    ('mad', 'MAD', 'client', true),
    ('guildtest', 'Guild Test', 'test', true)
  on conflict (organization_key) do update
  set
    display_name = excluded.display_name,
    organization_type = excluded.organization_type,
    is_active = excluded.is_active,
    updated_at = now()
  returning id, organization_key
),
all_organizations as (
  select id, organization_key from upserted_organizations
  union
  select id, organization_key
  from public.portal_organizations
  where organization_key in ('paladin', 'mad', 'guildtest')
),
seed_guilds as (
  select organization_key, guild_code, display_name
  from (values
    ('paladin', 'G1', 'G1'),
    ('paladin', 'G2', 'G2'),
    ('paladin', 'G3', 'G3'),
    ('paladin', 'G4', 'G4'),
    ('paladin', 'G5', 'G5'),
    ('paladin', 'G6', 'G6'),
    ('paladin', 'G7', 'G7'),
    ('mad', 'MAD G1', 'MAD G1'),
    ('guildtest', 'GUILDTEST G1', 'Guild Test G1')
  ) as rows(organization_key, guild_code, display_name)
)
insert into public.portal_guilds (
  organization_id,
  guild_code,
  display_name,
  is_active
)
select
  org.id,
  seed.guild_code,
  seed.display_name,
  true
from seed_guilds seed
join all_organizations org on org.organization_key = seed.organization_key
on conflict (organization_id, guild_code) do update
set
  display_name = excluded.display_name,
  is_active = true,
  updated_at = now();

commit;
