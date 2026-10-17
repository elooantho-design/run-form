begin;

-- Additive key: existing seasons and legacy reference objectives are not changed.
create unique index if not exists intersaison_survey_seasons_id_org_uidx
  on public.intersaison_survey_seasons (id, organization_id);

create table if not exists public.intersaison_survey_objective_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.portal_organizations(id),
  season_id uuid not null,
  purpose text not null default 'next' check (purpose in ('reference', 'next')),
  version_number integer not null check (version_number > 0),
  status text not null default 'draft' check (status in ('draft', 'validated', 'official', 'archived')),
  created_by_member_id uuid references public.guild_members(id) on delete set null,
  created_at timestamptz not null default now(),
  validated_by_member_id uuid references public.guild_members(id) on delete set null,
  validated_at timestamptz,
  official_at timestamptz,
  constraint survey_objective_version_season_org_fk foreign key (season_id, organization_id)
    references public.intersaison_survey_seasons(id, organization_id),
  constraint survey_objective_version_scope_unique unique (id, organization_id, season_id),
  constraint survey_objective_version_number_unique unique (season_id, purpose, version_number),
  constraint survey_objective_version_validation_check check (
    status not in ('validated', 'official') or validated_at is not null
  ),
  constraint survey_objective_version_official_check check (status <> 'official' or official_at is not null)
);

create table if not exists public.intersaison_survey_objective_items (
  version_id uuid not null,
  organization_id uuid not null,
  season_id uuid not null,
  guild_code text not null check (guild_code in ('G1','G2','G3','G4','G5','G6','G7')),
  objective_text text not null default '' check (char_length(objective_text) <= 600),
  primary key (version_id, guild_code),
  constraint survey_objective_item_version_org_fk foreign key (version_id, organization_id, season_id)
    references public.intersaison_survey_objective_versions(id, organization_id, season_id),
  constraint survey_objective_item_guild_org_fk foreign key (organization_id, guild_code)
    references public.portal_guilds(organization_id, guild_code)
);

create index if not exists intersaison_survey_objective_versions_latest_idx
  on public.intersaison_survey_objective_versions(organization_id, season_id, purpose, version_number desc);

-- One official set per season; older seasons retain their own published versions.
create unique index if not exists intersaison_survey_objective_versions_official_uidx
  on public.intersaison_survey_objective_versions(organization_id, season_id, purpose)
  where status = 'official';

create or replace function public.assert_intersaison_objectives_admin(p_organization_id uuid, p_actor_member_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (
    select 1 from public.guild_members m
    join public.portal_guilds g on g.guild_code = m.guild_code and g.organization_id = p_organization_id and g.is_active
    join public.portal_organizations o on o.id = g.organization_id and o.is_active
    where m.id = p_actor_member_id
      and lower(btrim(m.role)) in ('admin', 'administrateur', 'leader')
      and lower(o.organization_key) in ('paladin', 'paladin_cluster')
      and m.guild_code in ('G1','G2','G3','G4','G5','G6','G7')
  ) then
    raise exception 'Admin Paladin hors organisation ou non autorise.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.check_intersaison_objective_version()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_version public.intersaison_survey_objective_versions%rowtype;
  v_count integer;
  v_complete integer;
begin
  select * into strict v_version from public.intersaison_survey_objective_versions where id = new.id;
  select count(*), count(*) filter (where btrim(objective_text, E' \t\n\r') <> '')
    into v_count, v_complete
  from public.intersaison_survey_objective_items where version_id = new.id;
  if v_count <> 7 then
    raise exception 'Une version doit contenir exactement les sept guildes.';
  end if;
  if v_version.status in ('validated', 'official') and v_complete <> 7 then
    raise exception 'Les sept objectifs sont obligatoires pour valider ou publier.';
  end if;
  return new;
end;
$$;

drop trigger if exists intersaison_objective_version_complete on public.intersaison_survey_objective_versions;
create constraint trigger intersaison_objective_version_complete
after insert or update on public.intersaison_survey_objective_versions
deferrable initially deferred for each row execute function public.check_intersaison_objective_version();

create or replace function public.save_intersaison_survey_objectives_draft(
  p_organization_id uuid, p_season_id uuid, p_actor_member_id uuid,
  p_objectives jsonb, p_expected_version integer
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_previous public.intersaison_survey_objective_versions%rowtype;
  v_previous_objectives jsonb;
  v_id uuid;
  v_count integer;
begin
  perform public.assert_intersaison_objectives_admin(p_organization_id, p_actor_member_id);
  perform 1 from public.intersaison_survey_seasons
    where id = p_season_id and organization_id = p_organization_id and status <> 'finished' for update;
  if not found then raise exception 'Inter-saison active introuvable.'; end if;

  if jsonb_typeof(p_objectives) is distinct from 'object' then raise exception 'Objectifs invalides.'; end if;
  if (select count(*) from jsonb_object_keys(p_objectives)) <> 7 or exists (
    select 1 from jsonb_each(p_objectives) x
    where x.key not in ('G1','G2','G3','G4','G5','G6','G7')
      or jsonb_typeof(x.value) <> 'string' or char_length(x.value #>> '{}') > 600
  ) then raise exception 'Sept objectifs texte, 600 caracteres maximum par guilde.'; end if;

  select count(*) into v_count from public.portal_guilds
    where organization_id = p_organization_id and is_active and guild_code in ('G1','G2','G3','G4','G5','G6','G7');
  if v_count <> 7 then raise exception 'Les sept guildes Paladin actives sont requises.'; end if;

  select * into v_previous from public.intersaison_survey_objective_versions
    where organization_id = p_organization_id and season_id = p_season_id and purpose = 'next'
    order by version_number desc limit 1;
  if p_expected_version is null or p_expected_version <> coalesce(v_previous.version_number, 0) then
    raise exception 'Une autre sauvegarde a eu lieu. Actualise avant de reessayer.';
  end if;
  if v_previous.status in ('official', 'archived') then raise exception 'Les objectifs publies sont figes.'; end if;
  if v_previous.id is not null then
    select jsonb_object_agg(guild_code, objective_text) into v_previous_objectives
      from public.intersaison_survey_objective_items where version_id = v_previous.id;
    if v_previous_objectives = p_objectives then return v_previous.id; end if;
  end if;

  insert into public.intersaison_survey_objective_versions
    (organization_id, season_id, purpose, version_number, status, created_by_member_id)
    values (p_organization_id, p_season_id, 'next', coalesce(v_previous.version_number, 0) + 1, 'draft', p_actor_member_id)
    returning id into v_id;
  insert into public.intersaison_survey_objective_items(version_id, organization_id, season_id, guild_code, objective_text)
    select v_id, p_organization_id, p_season_id, key, value from jsonb_each_text(p_objectives);
  return v_id;
end;
$$;

create or replace function public.validate_intersaison_survey_objectives_draft(
  p_organization_id uuid, p_season_id uuid, p_actor_member_id uuid, p_version_id uuid
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_latest uuid; v_count integer;
begin
  perform public.assert_intersaison_objectives_admin(p_organization_id, p_actor_member_id);
  perform 1 from public.intersaison_survey_seasons
    where id = p_season_id and organization_id = p_organization_id and status <> 'finished' for update;
  if not found then raise exception 'Inter-saison active introuvable.'; end if;
  select id into v_latest from public.intersaison_survey_objective_versions
    where season_id = p_season_id and organization_id = p_organization_id and purpose = 'next'
    order by version_number desc limit 1;
  if v_latest is null or v_latest <> p_version_id then raise exception 'Version obsolete. Actualise les objectifs.'; end if;
  select count(*) into v_count from public.intersaison_survey_objective_items
    where version_id = p_version_id and btrim(objective_text, E' \t\n\r') <> '';
  if v_count <> 7 then raise exception 'Renseigne les sept objectifs avant validation.'; end if;
  update public.intersaison_survey_objective_versions
    set status = 'validated', validated_at = now(), validated_by_member_id = p_actor_member_id
    where id = p_version_id and status = 'draft';
  if not found and not exists (
    select 1 from public.intersaison_survey_objective_versions where id = p_version_id and status = 'validated'
  ) then raise exception 'Cette version ne peut pas etre validee.'; end if;
  return p_version_id;
end;
$$;

alter table public.intersaison_survey_objective_versions enable row level security;
alter table public.intersaison_survey_objective_items enable row level security;
revoke all on public.intersaison_survey_objective_versions, public.intersaison_survey_objective_items from public, anon, authenticated, service_role;
grant select on public.intersaison_survey_objective_versions, public.intersaison_survey_objective_items to service_role;
drop policy if exists survey_objective_versions_service_read on public.intersaison_survey_objective_versions;
create policy survey_objective_versions_service_read on public.intersaison_survey_objective_versions for select to service_role using (true);
drop policy if exists survey_objective_items_service_read on public.intersaison_survey_objective_items;
create policy survey_objective_items_service_read on public.intersaison_survey_objective_items for select to service_role using (true);

revoke all on function public.assert_intersaison_objectives_admin(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.check_intersaison_objective_version() from public, anon, authenticated, service_role;
revoke all on function public.save_intersaison_survey_objectives_draft(uuid, uuid, uuid, jsonb, integer) from public, anon, authenticated;
revoke all on function public.validate_intersaison_survey_objectives_draft(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.save_intersaison_survey_objectives_draft(uuid, uuid, uuid, jsonb, integer) to service_role;
grant execute on function public.validate_intersaison_survey_objectives_draft(uuid, uuid, uuid, uuid) to service_role;

comment on table public.intersaison_survey_objective_versions is
  'Versioned reference/next objectives. Saving always appends a draft; validation never publishes or sends a DM. Future publication must be atomic with survey 2 launch.';
commit;
