-- Additive, preview-only installation. No existing function is replaced.
-- No reset, Discord send, guild transfer or existing member update runs here.
begin;

create table public.gvg_ally_followup_state (
  defense_id uuid primary key references public.gvg_defense(id) on delete cascade,
  opened boolean not null default false,
  owner_member_id uuid references public.guild_members(id) on delete set null,
  owner_confirmed boolean not null default false,
  video_defense_id uuid references public.gvg_defense(id) on delete set null,
  revision bigint not null default 0,
  updated_by uuid references public.guild_members(id) on delete set null,
  updated_at timestamptz not null default clock_timestamp()
);
create table public.gvg_ally_provisional_assignments (
  member_id uuid primary key references public.guild_members(id) on delete cascade,
  portal_guild_id uuid not null references public.portal_guilds(id) on delete restrict,
  assignment text,
  created_at timestamptz not null default clock_timestamp()
);
alter table public.gvg_ally_followup_state enable row level security;
alter table public.gvg_ally_provisional_assignments enable row level security;
revoke all on public.gvg_ally_followup_state, public.gvg_ally_provisional_assignments from public, anon, authenticated, service_role;

create function public._gvg_ally_assignment(p_value text) returns text
language sql immutable set search_path=pg_catalog,public as $$
  select case when btrim(regexp_replace(coalesce(p_value,''),'\s+',' ','g')) ~* '^(B[1-4] Tour [1-5]|Bastion [1-4]|BB Tour [1-5]|BB Bastion)$'
    then initcap(btrim(regexp_replace(p_value,'\s+',' ','g'))) end
$$;

create function public._gvg_ally_position(p_defense public.gvg_defense) returns text
language sql immutable set search_path=pg_catalog,public as $$
  select case when p_defense.bastion between 1 and 4 then case
    when p_defense.type='fortress' then 'Bastion '||p_defense.bastion
    when p_defense.type='tower' and p_defense.tower between 1 and 5 then 'B'||p_defense.bastion||' Tour '||p_defense.tower end end
$$;

create function public._gvg_ally_signature(p_defense public.gvg_defense) returns text
language plpgsql immutable set search_path=pg_catalog,public as $$
declare h jsonb; champion text; position text; direction text; parts text[]:='{}'; positions text[]:='{}';
begin
  if p_defense.type not in ('tower','fortress') then return null; end if;
  if jsonb_typeof(p_defense.heroes) is distinct from 'array' then return null; end if;
  if jsonb_array_length(p_defense.heroes)<>5 then return null; end if;
  for h in select * from jsonb_array_elements(p_defense.heroes) loop
    champion:=regexp_replace(regexp_replace(lower(btrim(regexp_replace(normalize(coalesce(h->>'champion',h->>'name',''),NFD),U&'[\0300-\036f]','','g'))),'\d+$',''),'[^a-z0-9]','','g');
    position:=upper(btrim(coalesce(h->>'position','')));
    direction:=upper(btrim(coalesce(h->>'direction','')));
    direction:=case when direction in ('N','NORD','NORTH','UP') then 'N'
      when direction in ('S','SUD','SOUTH','DOWN') then 'S'
      when direction in ('E','EST','EAST','RIGHT',U&'\2192') then 'E'
      when direction in ('O','OUEST','W','WEST','LEFT',U&'\2190') then 'O'
      when direction=U&'\2191' then 'N' when direction=U&'\2193' then 'S' end;
    if champion='' or direction is null or position !~ '^[A-H]([1-9]|10|11)$'
      or (p_defense.type='tower' and (left(position,1)='H' or substring(position from 2)::integer>10))
      or position=any(positions) then return null; end if;
    positions:=array_append(positions,position);
    parts:=array_append(parts,position||':'||direction||':'||champion);
  end loop;
  return p_defense.type||':'||(select string_agg(v,'|' order by v collate "C") from unnest(parts) v);
end $$;

create function public._gvg_ally_roster_version(p_code text) returns text
language sql stable security definer set search_path=pg_catalog,public as $$
  select md5(coalesce(jsonb_agg(jsonb_build_array(m.id,m.guild_code,m.assignment,m.roster_status,m.role,
    m.community_access_type,m.personal_forum_post_url,m.watcher_name) order by m.id)::text,'[]'))
  from public.guild_members m where public._gvg_reset_code(m.guild_code)=p_code
$$;

create function public._gvg_ally_members(p_code text) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'watcher_name',m.watcher_name,'guild_code',m.guild_code,
    'assignment',m.assignment,'personal_forum_post_url',m.personal_forum_post_url) order by m.watcher_name,m.id),'[]'::jsonb)
  from public.guild_members m where public._gvg_reset_code(m.guild_code)=p_code
    and lower(btrim(coalesce(m.roster_status,'active')))='active'
    and lower(btrim(coalesce(m.community_access_type,'guild')))<>'community'
    and lower(btrim(coalesce(m.role,'member'))) not in ('community_member','content_creator','vip')
$$;

create function public.read_gvg_ally_followup(p_portal_guild_id uuid,p_actor_member_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare c jsonb; code text;
begin
  c:=public._gvg_reset_context(p_portal_guild_id,p_actor_member_id);
  code:=c->>'technical_guild';
  return jsonb_build_object('success',true,'version',1,'mode','preview_only','delivery_enabled',false,
    'roster_version',public._gvg_ally_roster_version(code),'members',public._gvg_ally_members(code),
    'defenses',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'guild',d.guild,'bastion',d.bastion,
      'type',d.type,'tower',d.tower,'team',d.team,'is_ally',d.is_ally,'heroes',d.heroes,
      'youtube_url',d.youtube_url,'record_status',d.record_status,'created_at',d.created_at) order by d.id),'[]'::jsonb)
      from public.gvg_defense d where d.guild=code and d.is_ally is true),
    'states',(select coalesce(jsonb_agg(to_jsonb(s) order by s.defense_id),'[]'::jsonb)
      from public.gvg_ally_followup_state s join public.gvg_defense d on d.id=s.defense_id where d.guild=code and d.is_ally is true),
    'provisional_member_ids',(select coalesce(jsonb_agg(p.member_id order by p.member_id),'[]'::jsonb)
      from public.gvg_ally_provisional_assignments p where p.portal_guild_id=p_portal_guild_id));
end $$;

-- An edit outside Pilotage also invalidates old recipient confirmations.
create function public._gvg_ally_invalidate_owner() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if row(old.assignment,old.guild_code,old.roster_status,old.role,old.community_access_type)
    is distinct from row(new.assignment,new.guild_code,new.roster_status,new.role,new.community_access_type) then
    update public.gvg_ally_followup_state s set owner_confirmed=false,revision=revision+1,updated_at=clock_timestamp()
      where s.owner_member_id=new.id or s.defense_id in (select d.id from public.gvg_defense d
        where d.is_ally is true and public._gvg_reset_code(d.guild) in (public._gvg_reset_code(old.guild_code),public._gvg_reset_code(new.guild_code))
          and lower(public._gvg_ally_position(d)) in (lower(public._gvg_ally_assignment(old.assignment)),lower(public._gvg_ally_assignment(new.assignment))));
    delete from public.gvg_ally_provisional_assignments where member_id=new.id;
  end if;
  return new;
end $$;
create trigger gvg_ally_invalidate_owner after update of assignment,guild_code,roster_status,role,community_access_type
  on public.guild_members for each row execute function public._gvg_ally_invalidate_owner();

create function public.save_gvg_ally_followup(p_portal_guild_id uuid,p_actor_member_id uuid,p_defense_id uuid,
  p_action text,p_value jsonb,p_expected_revision bigint,p_roster_version text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare c jsonb; code text; d public.gvg_defense%rowtype; s public.gvg_ally_followup_state%rowtype;
  chosen public.guild_members%rowtype; previous public.guild_members%rowtype;
  target text; former text; fallback text; members jsonb; candidates uuid[]; changed uuid[]:='{}'; confirmed uuid;
begin
  c:=public._gvg_reset_context(p_portal_guild_id,p_actor_member_id); code:=c->>'technical_guild';
  if p_action not in ('opened','owner','video') then raise exception 'Action alliee invalide' using errcode='22023'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('gvg-reset-guild:'||p_portal_guild_id::text,0)) then
    raise exception 'Une operation GvG est en cours' using errcode='55P03'; end if;
  if exists(select 1 from public.gvg_reset_operations where portal_guild_id=p_portal_guild_id and state in ('prepared','committed')) then
    raise exception 'Reset GvG en cours : affectations gelees' using errcode='55P03'; end if;
  perform 1 from public.guild_members where public._gvg_reset_code(guild_code)=code order by id for update;
  if p_roster_version is distinct from public._gvg_ally_roster_version(code) then
    raise exception 'Les affectations ont change. Actualisez avant de confirmer' using errcode='40001'; end if;
  select * into d from public.gvg_defense where id=p_defense_id and guild=code and is_ally is true for update;
  if not found then raise exception 'Defense alliee introuvable dans cette guilde' using errcode='42501'; end if;
  target:=public._gvg_ally_position(d);
  if target is null then raise exception 'Emplacement non pris en charge' using errcode='22023'; end if;
  insert into public.gvg_ally_followup_state(defense_id) values(d.id) on conflict do nothing;
  select * into s from public.gvg_ally_followup_state where defense_id=d.id for update;
  if p_expected_revision is distinct from s.revision then raise exception 'Cette defense a change. Actualisez' using errcode='40001'; end if;
  members:=public._gvg_ally_members(code);
  select array_agg((m->>'id')::uuid) into candidates from jsonb_array_elements(members) m
    where lower(public._gvg_ally_assignment(m->>'assignment'))=lower(target);
  if p_action='owner' then
    if coalesce(array_length(candidates,1),0)>1 then raise exception 'Plusieurs joueurs occupent cet emplacement. Corrigez Gestion des guildes' using errcode='22023'; end if;
    select * into chosen from public.guild_members where id=(p_value->>'member_id')::uuid
      and id in (select (m->>'id')::uuid from jsonb_array_elements(members) m);
    if not found then raise exception 'Joueur actif de cette guilde requis' using errcode='42501'; end if;
    if candidates[1] is not null then select * into previous from public.guild_members where id=candidates[1]; end if;
    former:=public._gvg_ally_assignment(chosen.assignment);
    if previous.id is distinct from chosen.id then
      if former is not null and exists(select 1 from jsonb_array_elements(members) m where (m->>'id')::uuid<>chosen.id
        and lower(public._gvg_ally_assignment(m->>'assignment'))=lower(former)) then
        raise exception 'Ancien emplacement ambigu : aucun echange effectue' using errcode='22023'; end if;
      if former is null and previous.id is not null then
        select slot into fallback from (
          select 'B'||b||' Tour '||t as slot from generate_series(1,4) b cross join generate_series(1,5) t
          union all select 'Bastion '||b from generate_series(1,4) b
          union all select 'BB Tour '||t from generate_series(1,5) t
          union all select 'BB Bastion') slots
          where lower(slot)<>lower(target) and not exists(select 1 from jsonb_array_elements(members) m
            where lower(public._gvg_ally_assignment(m->>'assignment'))=lower(slot)) order by slot limit 1;
      end if;
      update public.guild_members set assignment=target where id=chosen.id;
      changed:=array_append(changed,chosen.id);
      if previous.id is not null then
        update public.guild_members set assignment=coalesce(former,fallback) where id=previous.id;
        changed:=array_append(changed,previous.id);
        if former is null then
          insert into public.gvg_ally_provisional_assignments(member_id,portal_guild_id,assignment)
            values(previous.id,p_portal_guild_id,fallback) on conflict(member_id) do update set assignment=excluded.assignment,created_at=clock_timestamp();
        else
          insert into public.gvg_ally_followup_state(defense_id,owner_member_id,owner_confirmed,updated_by)
            select x.id,previous.id,true,p_actor_member_id from public.gvg_defense x
              where x.guild=code and x.is_ally is true and lower(public._gvg_ally_position(x))=lower(former)
            on conflict(defense_id) do update set owner_member_id=excluded.owner_member_id,owner_confirmed=true,
              revision=gvg_ally_followup_state.revision+1,updated_by=p_actor_member_id,updated_at=clock_timestamp();
        end if;
      end if;
    end if;
    delete from public.gvg_ally_provisional_assignments where member_id=chosen.id;
    insert into public.gvg_ally_followup_state(defense_id,owner_member_id,owner_confirmed,updated_by)
      select x.id,chosen.id,true,p_actor_member_id from public.gvg_defense x
        where x.guild=code and x.is_ally is true and lower(public._gvg_ally_position(x))=lower(target)
      on conflict(defense_id) do update set owner_member_id=excluded.owner_member_id,owner_confirmed=true,
        revision=gvg_ally_followup_state.revision+1,updated_by=p_actor_member_id,updated_at=clock_timestamp();
  elsif p_action='opened' then
    if jsonb_typeof(p_value->'opened') is distinct from 'boolean' then raise exception 'Statut ouvert booleen requis' using errcode='22023'; end if;
    if array_length(candidates,1)=1 and not exists(select 1 from public.gvg_ally_provisional_assignments where member_id=candidates[1]) then
      confirmed:=candidates[1];
    end if;
    -- Clicking Opened confirms the owner shown on that exact roster revision.
    update public.gvg_ally_followup_state set opened=(p_value->>'opened')::boolean,
      owner_member_id=confirmed,owner_confirmed=(confirmed is not null),revision=revision+1,
      updated_by=p_actor_member_id,updated_at=clock_timestamp() where defense_id=d.id;
  else
    if p_value->>'video_defense_id' is not null and not exists(select 1 from public.gvg_defense x
      where x.id=(p_value->>'video_defense_id')::uuid and x.guild=code and x.is_ally is true
        and public._gvg_ally_signature(x)=public._gvg_ally_signature(d)) then
      raise exception 'Video hors guilde ou mauvais type de carte' using errcode='42501'; end if;
    update public.gvg_ally_followup_state set video_defense_id=(p_value->>'video_defense_id')::uuid,
      revision=revision+1,updated_by=p_actor_member_id,updated_at=clock_timestamp() where defense_id=d.id;
  end if;
  return public.read_gvg_ally_followup(p_portal_guild_id,p_actor_member_id)||jsonb_build_object('changed_member_ids',to_jsonb(changed));
end $$;

revoke all on function public._gvg_ally_assignment(text),public._gvg_ally_position(public.gvg_defense),
  public._gvg_ally_signature(public.gvg_defense),
  public._gvg_ally_roster_version(text),public._gvg_ally_members(text),public._gvg_ally_invalidate_owner(),
  public.read_gvg_ally_followup(uuid,uuid),public.save_gvg_ally_followup(uuid,uuid,uuid,text,jsonb,bigint,text)
  from public,anon,authenticated,service_role;
grant execute on function public.read_gvg_ally_followup(uuid,uuid),
  public.save_gvg_ally_followup(uuid,uuid,uuid,text,jsonb,bigint,text) to service_role;
commit;
