begin;

alter table public.guild_defenses
  add column if not exists organization_id uuid null references public.portal_organizations(id) on delete restrict,
  add column if not exists source_defense_id uuid null,
  add column if not exists source_guild_code text null,
  add column if not exists source_defense_name text null,
  add column if not exists imported_at timestamptz null;

alter table public.guild_members
  add column if not exists defense_1_id uuid null references public.guild_defenses(id) on delete set null,
  add column if not exists defense_2_id uuid null references public.guild_defenses(id) on delete set null;

update public.guild_defenses defense
set organization_id = guild.organization_id
from public.portal_guilds guild
where defense.organization_id is null
  and guild.guild_code = defense.guild_code;

do $$
declare
  v_unmapped integer;
begin
  select count(*) into v_unmapped
  from public.guild_defenses defense
  where defense.organization_id is null;

  if v_unmapped > 0 then
    raise exception 'Migration interrompue: % defense(s) sans organisation identifiable via portal_guilds.guild_code.', v_unmapped;
  end if;
end $$;

update public.guild_defenses copy
set
  source_guild_code = coalesce(copy.source_guild_code, source.guild_code),
  source_defense_name = coalesce(copy.source_defense_name, source.name),
  imported_at = coalesce(copy.imported_at, copy.created_at, now())
from public.guild_defenses source
where copy.source_defense_id = source.id
  and copy.source_defense_id is not null;

-- Imported copies must survive native deletion. Drop any legacy FK that could cascade or nullify source_defense_id.
do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select constraint.conname
    from pg_constraint constraint
    join pg_attribute attribute
      on attribute.attrelid = constraint.conrelid
     and attribute.attnum = any(constraint.conkey)
    where constraint.conrelid = 'public.guild_defenses'::regclass
      and constraint.contype = 'f'
      and attribute.attname = 'source_defense_id'
  loop
    execute format('alter table public.guild_defenses drop constraint if exists %I', constraint_row.conname);
  end loop;
end $$;

create index if not exists guild_defenses_org_guild_active_idx
  on public.guild_defenses (organization_id, guild_code, is_hidden, created_at);

create index if not exists guild_defenses_org_native_idx
  on public.guild_defenses (organization_id, guild_code, created_at)
  where source_defense_id is null and coalesce(is_hidden, false) = false;

create unique index if not exists guild_defenses_unique_active_import_idx
  on public.guild_defenses (guild_code, source_defense_id)
  where source_defense_id is not null and coalesce(is_hidden, false) = false;

create index if not exists guild_members_defense_1_id_idx
  on public.guild_members (defense_1_id)
  where defense_1_id is not null;

create index if not exists guild_members_defense_2_id_idx
  on public.guild_members (defense_2_id)
  where defense_2_id is not null;

create or replace function public.guild_defenses_set_organization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organization_id uuid;
  v_source public.guild_defenses%rowtype;
begin
  select guild.organization_id
    into v_organization_id
  from public.portal_guilds guild
  where guild.guild_code = new.guild_code
    and guild.is_active = true
  limit 1;

  if v_organization_id is null then
    raise exception 'Guilde inconnue ou inactive pour defense: %', new.guild_code;
  end if;

  new.organization_id := v_organization_id;

  if new.source_defense_id is not null then
    select *
      into v_source
    from public.guild_defenses
    where id = new.source_defense_id;

    if v_source.id is null then
      raise exception 'Defense source introuvable: %', new.source_defense_id;
    end if;

    if v_source.organization_id is distinct from v_organization_id then
      raise exception 'Import defense inter-organisation refuse.';
    end if;

    new.source_guild_code := coalesce(new.source_guild_code, v_source.guild_code);
    new.source_defense_name := coalesce(new.source_defense_name, v_source.name);
    new.imported_at := coalesce(new.imported_at, now());
  else
    new.source_guild_code := null;
    new.source_defense_name := null;
    new.imported_at := null;
  end if;

  return new;
end;
$$;

revoke all on function public.guild_defenses_set_organization() from public, anon, authenticated;
grant execute on function public.guild_defenses_set_organization() to service_role;

drop trigger if exists guild_defenses_set_organization_before_write on public.guild_defenses;
create trigger guild_defenses_set_organization_before_write
before insert or update of guild_code, source_defense_id, source_guild_code, source_defense_name, imported_at
on public.guild_defenses
for each row
execute function public.guild_defenses_set_organization();

create or replace function public.import_guild_defense_snapshot(
  p_source_defense_id uuid,
  p_target_guild_code text,
  p_actor_member_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.guild_defenses%rowtype;
  v_target_organization_id uuid;
  v_existing uuid;
  v_copy_id uuid;
begin
  if p_source_defense_id is null or btrim(coalesce(p_target_guild_code, '')) = '' then
    raise exception 'Source et guilde cible requises.';
  end if;

  select *
    into v_source
  from public.guild_defenses
  where id = p_source_defense_id
  for share;

  if v_source.id is null then
    raise exception 'Defense source introuvable.';
  end if;

  if v_source.source_defense_id is not null then
    raise exception 'Seules les defenses natives peuvent etre importees depuis la bibliotheque.';
  end if;

  if coalesce(v_source.is_hidden, false) then
    raise exception 'Defense source masquee.';
  end if;

  select guild.organization_id
    into v_target_organization_id
  from public.portal_guilds guild
  where guild.guild_code = p_target_guild_code
    and guild.is_active = true
  limit 1;

  if v_target_organization_id is null then
    raise exception 'Guilde cible inconnue ou inactive.';
  end if;

  if v_target_organization_id is distinct from v_source.organization_id then
    raise exception 'Import defense inter-organisation refuse.';
  end if;

  if v_source.guild_code = p_target_guild_code then
    raise exception 'Cette defense est deja native dans la guilde cible.';
  end if;

  select id
    into v_existing
  from public.guild_defenses
  where guild_code = p_target_guild_code
    and source_defense_id = v_source.id
    and coalesce(is_hidden, false) = false
  limit 1;

  if v_existing is not null then
    raise exception 'Cette defense est deja importee dans la guilde cible.';
  end if;

  insert into public.guild_defenses (
    name,
    tier,
    type,
    faction,
    guild_code,
    is_global,
    is_hidden,
    source_defense_id,
    source_guild_code,
    source_defense_name,
    sort_order,
    image_url,
    created_at,
    imported_at
  )
  values (
    v_source.name,
    v_source.tier,
    v_source.type,
    v_source.faction,
    p_target_guild_code,
    false,
    false,
    v_source.id,
    v_source.guild_code,
    v_source.name,
    v_source.sort_order,
    v_source.image_url,
    now(),
    now()
  )
  returning id into v_copy_id;

  insert into public.guild_defense_slots (defense_id, champion_id, slot_index)
  select v_copy_id, slot.champion_id, slot.slot_index
  from public.guild_defense_slots slot
  where slot.defense_id = v_source.id
  order by slot.slot_index;

  insert into public.guild_defense_conditions (defense_id, champion_id, min_awakening)
  select v_copy_id, condition.champion_id, condition.min_awakening
  from public.guild_defense_conditions condition
  where condition.defense_id = v_source.id;

  insert into public.guild_defense_blocks (defense_id, block_type, content, sort_order)
  select v_copy_id, block.block_type, block.content, block.sort_order
  from public.guild_defense_blocks block
  where block.defense_id = v_source.id
  order by block.sort_order;

  return v_copy_id;
end;
$$;

revoke all on function public.import_guild_defense_snapshot(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.import_guild_defense_snapshot(uuid, text, uuid) to service_role;

with slot_matches as (
  select
    member.id as member_id,
    slot.slot_name,
    array_agg(defense.id order by defense.created_at) filter (where defense.id is not null) as matching_ids,
    count(defense.id) as matching_count
  from public.guild_members member
  cross join lateral (values
    ('defense_1_id', nullif(nullif(member.defense_1, '--'), '—')),
    ('defense_2_id', nullif(nullif(member.defense_2, '--'), '—'))
  ) as slot(slot_name, defense_name)
  left join public.guild_defenses defense
    on defense.name = slot.defense_name
   and defense.guild_code = member.guild_code
   and coalesce(defense.is_hidden, false) = false
  where slot.defense_name is not null
  group by member.id, slot.slot_name
),
member_slot_matches as (
  select
    member_id,
    max(matching_ids[1]) filter (where slot_name = 'defense_1_id' and matching_count = 1) as defense_1_id,
    max(matching_ids[1]) filter (where slot_name = 'defense_2_id' and matching_count = 1) as defense_2_id
  from slot_matches
  group by member_id
)
update public.guild_members member
set
  defense_1_id = coalesce(member_slot_matches.defense_1_id, member.defense_1_id),
  defense_2_id = coalesce(member_slot_matches.defense_2_id, member.defense_2_id)
from member_slot_matches
where member.id = member_slot_matches.member_id
  and (member_slot_matches.defense_1_id is not null or member_slot_matches.defense_2_id is not null);

commit;
