-- Additive forecast metadata only. No survey, response, recipient or real role is updated.
begin;

create table if not exists public.intersaison_survey_forecast_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  season_id uuid not null,
  member_key uuid not null,
  member_id uuid references public.guild_members(id) on delete set null,
  member_name_snapshot text not null,
  forecast_role text not null,
  revision integer not null check (revision > 0),
  actor_member_id uuid references public.guild_members(id) on delete set null,
  actor_name text not null,
  created_at timestamptz not null default now(),
  constraint intersaison_forecast_role_value check (forecast_role in ('leader','officer','member')),
  constraint intersaison_forecast_role_season_org_fk foreign key (season_id, organization_id)
    references public.intersaison_survey_seasons(id, organization_id),
  constraint intersaison_forecast_role_revision_unique unique (season_id, member_key, revision)
);
create index if not exists intersaison_forecast_role_scope_idx
  on public.intersaison_survey_forecast_roles(organization_id, season_id, member_key, revision desc);
alter table public.intersaison_survey_forecast_roles enable row level security;
revoke all on public.intersaison_survey_forecast_roles from public, anon, authenticated, service_role;
grant select on public.intersaison_survey_forecast_roles to service_role;
drop policy if exists intersaison_forecast_roles_service_read on public.intersaison_survey_forecast_roles;
create policy intersaison_forecast_roles_service_read on public.intersaison_survey_forecast_roles
  for select to service_role using (true);

-- One transaction for the optional placement change and independent role history.
-- The existing placement RPC remains unchanged and is called only if its value changes.
create or replace function public.save_intersaison_survey_forecast_entry(
  p_org uuid,p_season uuid,p_actor uuid,p_member uuid,p_guild text,p_role text,
  p_expected_placement_revision integer,p_expected_role_revision integer
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_placement public.intersaison_survey_placements%rowtype;
  v_role public.intersaison_survey_forecast_roles%rowtype;
  v_member record; v_placement_id uuid; v_role_id uuid; v_actor_name text;
begin
  perform public.assert_intersaison_survey_choice_admin(p_org,p_actor);
  perform 1 from public.intersaison_survey_seasons where id=p_season and organization_id=p_org
    and status<>'finished' for update;
  if not found then raise exception 'Inter-saison active introuvable.'; end if;
  if p_role is null or p_role not in ('leader','officer','member') then raise exception 'Rôle prévisionnel invalide.'; end if;
  select * into v_member from public.intersaison_survey_choice_roster(p_org) where id=p_member;
  if v_member.id is null then raise exception 'Joueur hors des effectifs actifs Paladin.' using errcode='42501'; end if;
  if p_guild is not null and p_guild not in ('G1','G2','G3','G4','G5','G6','G7') then
    raise exception 'Guilde prévisionnelle invalide.' using errcode='42501';
  end if;
  select * into v_placement from public.intersaison_survey_placements
    where organization_id=p_org and season_id=p_season and member_key=p_member order by revision desc limit 1;
  select * into v_role from public.intersaison_survey_forecast_roles
    where organization_id=p_org and season_id=p_season and member_key=p_member order by revision desc limit 1;
  if p_expected_placement_revision is distinct from coalesce(v_placement.revision,0)
    or p_expected_role_revision is distinct from coalesce(v_role.revision,0) then
    raise exception 'Plan modifié par un autre administrateur. Actualise.';
  end if;
  if p_guild is distinct from (case when v_placement.action='set' then v_placement.guild_code end) then
    v_placement_id:=public.save_intersaison_survey_placement(p_org,p_season,p_actor,p_member,p_guild,p_expected_placement_revision);
  end if;
  if p_role is distinct from coalesce(v_role.forecast_role,'member') then
    select coalesce(watcher_name,'Admin') into v_actor_name from public.guild_members where id=p_actor;
    insert into public.intersaison_survey_forecast_roles(organization_id,season_id,member_key,member_id,
      member_name_snapshot,forecast_role,revision,actor_member_id,actor_name)
      values(p_org,p_season,p_member,p_member,v_member.watcher_name,p_role,coalesce(v_role.revision,0)+1,p_actor,v_actor_name)
      returning id into v_role_id;
  end if;
  return jsonb_build_object('placementId',v_placement_id,'roleId',v_role_id);
end;
$$;
revoke all on function public.save_intersaison_survey_forecast_entry(uuid,uuid,uuid,uuid,text,text,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.save_intersaison_survey_forecast_entry(uuid,uuid,uuid,uuid,text,text,integer,integer) to service_role;
commit;
