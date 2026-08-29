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

do $$
declare
  v_duplicate_codes text;
begin
  select string_agg(format('%s (%s organisations)', duplicate.guild_code, duplicate.organization_count), ', ' order by duplicate.guild_code)
    into v_duplicate_codes
  from (
    select
      guild.guild_code,
      count(distinct guild.organization_id) as organization_count
    from public.portal_guilds guild
    group by guild.guild_code
    having count(distinct guild.organization_id) > 1
  ) duplicate;

  if v_duplicate_codes is not null then
    raise exception
      'Migration interrompue: portal_guilds.guild_code n''est pas globalement unique (%). Ajoute une cle guild_id/organization_id explicite avant cette migration.',
      v_duplicate_codes;
  end if;
end $$;

do $$
declare
  v_g2_organization_count integer;
  v_unexpected_legacy_count integer;
begin
  select count(distinct guild.organization_id)
    into v_g2_organization_count
  from public.portal_guilds guild
  where guild.guild_code = 'G2';

  if v_g2_organization_count <> 1 then
    raise exception 'Migration interrompue: la guilde historique G2 doit pointer vers exactement une organisation, trouve: %.', v_g2_organization_count;
  end if;

  select count(*)
    into v_unexpected_legacy_count
  from public.guild_defenses defense
  where defense.organization_id is null
    and defense.source_defense_id is null
    and (
      defense.guild_code is null
      or btrim(defense.guild_code) = ''
      or upper(defense.guild_code) <> 'G2'
    );

  if v_unexpected_legacy_count > 0 then
    raise exception
      'Migration interrompue: % defense(s) historique(s) ne sont pas marquees G2. Relance le preflight et corrige manuellement avant migration.',
      v_unexpected_legacy_count;
  end if;
end $$;

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
    raise exception 'Migration interrompue: % defense(s) sans organisation identifiable via guild_code unique.', v_unmapped;
  end if;
end $$;

update public.guild_defenses copy_defense
set
  source_guild_code = coalesce(copy_defense.source_guild_code, source_defense.guild_code),
  source_defense_name = coalesce(copy_defense.source_defense_name, source_defense.name),
  imported_at = coalesce(copy_defense.imported_at, copy_defense.created_at, now())
from public.guild_defenses source_defense
where copy_defense.source_defense_id = source_defense.id
  and copy_defense.source_defense_id is not null;

-- Imported copies must survive native deletion. Drop any legacy FK that could cascade or nullify source_defense_id.
do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select c.conname
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid
     and a.attnum = any(c.conkey)
    where c.conrelid = 'public.guild_defenses'::regclass
      and c.contype = 'f'
      and a.attname = 'source_defense_id'
  loop
    execute format('alter table public.guild_defenses drop constraint if exists %I', constraint_row.conname);
  end loop;
end $$;

create index if not exists guild_defenses_org_guild_active_idx
  on public.guild_defenses (organization_id, guild_code, is_hidden, created_at);

create index if not exists guild_defenses_org_native_idx
  on public.guild_defenses (organization_id, guild_code, created_at)
  where source_defense_id is null and coalesce(is_hidden, false) = false;

drop index if exists public.guild_defenses_unique_active_import_idx;
create unique index guild_defenses_unique_active_import_idx
  on public.guild_defenses (organization_id, guild_code, source_defense_id)
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
  v_target_organization_id uuid;
  v_matching_organizations integer;
  v_source public.guild_defenses%rowtype;
begin
  if btrim(coalesce(new.guild_code, '')) = '' then
    raise exception 'Guilde requise pour defense.';
  end if;

  if new.source_defense_id is not null then
    select *
      into v_source
    from public.guild_defenses
    where id = new.source_defense_id;

    if v_source.id is null then
      raise exception 'Defense source introuvable: %', new.source_defense_id;
    end if;

    if v_source.organization_id is null then
      raise exception 'Defense source sans organisation: %', new.source_defense_id;
    end if;

    if new.organization_id is null then
      new.organization_id := v_source.organization_id;
    elsif new.organization_id is distinct from v_source.organization_id then
      raise exception 'Import defense inter-organisation refuse.';
    end if;
  end if;

  if new.organization_id is not null then
    select guild.organization_id
      into v_target_organization_id
    from public.portal_guilds guild
    where guild.organization_id = new.organization_id
      and guild.guild_code = new.guild_code
      and guild.is_active = true;
  else
    select count(distinct guild.organization_id), min(guild.organization_id)
      into v_matching_organizations, v_target_organization_id
    from public.portal_guilds guild
    where guild.guild_code = new.guild_code
      and guild.is_active = true;

    if v_matching_organizations > 1 then
      raise exception 'Guilde ambigue sans organization_id explicite: %', new.guild_code;
    end if;

    new.organization_id := v_target_organization_id;
  end if;

  if v_target_organization_id is null then
    raise exception 'Guilde inconnue ou inactive pour defense: %', new.guild_code;
  end if;

  if new.organization_id is distinct from v_target_organization_id then
    raise exception 'Guilde % hors organisation cible.', new.guild_code;
  end if;

  if new.source_defense_id is not null then
    if v_source.organization_id is distinct from new.organization_id then
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
before insert or update of guild_code, organization_id, source_defense_id, source_guild_code, source_defense_name, imported_at
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

  p_target_guild_code := btrim(p_target_guild_code);

  select *
    into v_source
  from public.guild_defenses
  where id = p_source_defense_id
  for share;

  if v_source.id is null then
    raise exception 'Defense source introuvable.';
  end if;

  if v_source.organization_id is null then
    raise exception 'Defense source sans organisation.';
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
  where guild.organization_id = v_source.organization_id
    and guild.guild_code = p_target_guild_code
    and guild.is_active = true;

  if v_target_organization_id is null then
    raise exception 'Guilde cible inconnue, inactive ou hors organisation.';
  end if;

  if v_source.guild_code = p_target_guild_code then
    raise exception 'Cette defense est deja native dans la guilde cible.';
  end if;

  select id
    into v_existing
  from public.guild_defenses
  where organization_id = v_source.organization_id
    and guild_code = p_target_guild_code
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
    organization_id,
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
    v_source.organization_id,
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
  select v_copy_id, condition_row.champion_id, condition_row.min_awakening
  from public.guild_defense_conditions condition_row
  where condition_row.defense_id = v_source.id;

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

do $$
declare
  v_legacy_organization_id uuid;
  v_unresolved_assignments integer;
  import_candidate record;
  v_copy_id uuid;
begin
  select guild.organization_id
    into v_legacy_organization_id
  from public.portal_guilds guild
  where guild.guild_code = 'G2';

  with member_defenses as (
    select
      member.id as member_id,
      member.guild_code as target_guild_code,
      slot.defense_name
    from public.guild_members member
    cross join lateral (values
      (nullif(nullif(member.defense_1, '--'), '—')),
      (nullif(nullif(member.defense_2, '--'), '—'))
    ) as slot(defense_name)
    join public.portal_guilds target_guild
      on target_guild.guild_code = member.guild_code
     and target_guild.organization_id = v_legacy_organization_id
    where slot.defense_name is not null
      and member.guild_code <> 'G2'
  ),
  source_matches as (
    select
      member_defenses.member_id,
      member_defenses.target_guild_code,
      member_defenses.defense_name,
      count(source_defense.id) as matching_sources
    from member_defenses
    left join public.guild_defenses source_defense
      on source_defense.guild_code = 'G2'
     and source_defense.organization_id = v_legacy_organization_id
     and source_defense.name = member_defenses.defense_name
     and source_defense.source_defense_id is null
     and coalesce(source_defense.is_hidden, false) = false
    group by member_defenses.member_id, member_defenses.target_guild_code, member_defenses.defense_name
  )
  select count(*)
    into v_unresolved_assignments
  from source_matches
  where matching_sources <> 1;

  if v_unresolved_assignments > 0 then
    raise exception
      'Migration interrompue: % attribution(s) historiques hors G2 ne correspondent pas a une unique defense native G2.',
      v_unresolved_assignments;
  end if;

  for import_candidate in
    with source_by_name as (
      select
        source_defense.name,
        min(source_defense.id) as source_defense_id
      from public.guild_defenses source_defense
      where source_defense.guild_code = 'G2'
        and source_defense.organization_id = v_legacy_organization_id
        and source_defense.source_defense_id is null
        and coalesce(source_defense.is_hidden, false) = false
      group by source_defense.name
      having count(*) = 1
    ),
    requested_imports as (
      select distinct
        member.guild_code as target_guild_code,
        source_by_name.source_defense_id
      from public.guild_members member
      cross join lateral (values
        (nullif(nullif(member.defense_1, '--'), '—')),
        (nullif(nullif(member.defense_2, '--'), '—'))
      ) as slot(defense_name)
      join public.portal_guilds target_guild
        on target_guild.guild_code = member.guild_code
       and target_guild.organization_id = v_legacy_organization_id
      join source_by_name on source_by_name.name = slot.defense_name
      where slot.defense_name is not null
        and member.guild_code <> 'G2'
    )
    select requested_imports.*
    from requested_imports
    where not exists (
      select 1
      from public.guild_defenses existing_copy
      where existing_copy.organization_id = v_legacy_organization_id
        and existing_copy.guild_code = requested_imports.target_guild_code
        and existing_copy.source_defense_id = requested_imports.source_defense_id
        and coalesce(existing_copy.is_hidden, false) = false
    )
    order by requested_imports.target_guild_code, requested_imports.source_defense_id
  loop
    v_copy_id := public.import_guild_defense_snapshot(
      import_candidate.source_defense_id,
      import_candidate.target_guild_code,
      null
    );
  end loop;
end $$;

with slot_matches as (
  select
    member.id as member_id,
    slot.slot_name,
    array_agg(defense.id order by defense.created_at) filter (where defense.id is not null) as matching_ids,
    count(defense.id) as matching_count
  from public.guild_members member
  join public.portal_guilds member_guild
    on member_guild.guild_code = member.guild_code
  cross join lateral (values
    ('defense_1_id', nullif(nullif(member.defense_1, '--'), '—')),
    ('defense_2_id', nullif(nullif(member.defense_2, '--'), '—'))
  ) as slot(slot_name, defense_name)
  left join public.guild_defenses defense
    on defense.name = slot.defense_name
   and defense.guild_code = member.guild_code
   and defense.organization_id = member_guild.organization_id
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
