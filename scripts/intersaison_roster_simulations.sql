-- Additive, isolated simulator. No writes to members, surveys, plans or Discord.
begin;

create table if not exists public.intersaison_roster_simulations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.portal_organizations(id),
  name text not null check (length(btrim(name)) between 1 and 160),
  status text not null default 'draft' check (status in ('draft','applied','archived')),
  created_by uuid not null,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision > 0),
  initial_guilds jsonb not null,
  guilds jsonb not null,
  visible_guilds uuid[] not null,
  unique (id, organization_id)
);
create table if not exists public.intersaison_roster_entries (
  simulation_id uuid not null,
  organization_id uuid not null,
  member_id uuid not null,
  origin jsonb not null,
  initial_guild_id uuid,
  target_guild_id uuid,
  added_at timestamptz not null default now(),
  added_kind text not null check (added_kind in ('initial','sync','manual')),
  primary key (simulation_id, member_id),
  foreign key (simulation_id, organization_id) references public.intersaison_roster_simulations(id, organization_id)
);
create table if not exists public.intersaison_roster_events (
  id bigint generated always as identity primary key,
  simulation_id uuid not null,
  organization_id uuid not null,
  revision integer not null,
  actor_id uuid not null,
  actor_name text not null,
  kind text not null,
  before_value jsonb not null default '[]',
  after_value jsonb not null default '[]',
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  unique (simulation_id, revision),
  foreign key (simulation_id, organization_id) references public.intersaison_roster_simulations(id, organization_id)
);
create index if not exists roster_simulations_org_idx on public.intersaison_roster_simulations(organization_id, created_at desc);

create or replace function public._roster_simulation_actor(p_actor uuid)
returns uuid language plpgsql stable security definer set search_path=public,pg_temp as $$
declare org uuid; n integer;
begin
  select count(*), min(o.id::text)::uuid into n, org
  from public.guild_members m
  join public.portal_guilds g on g.guild_code=m.guild_code and g.is_active
  join public.portal_organizations o on o.id=g.organization_id and o.is_active
  where m.id=p_actor and coalesce(m.roster_status,'active')='active'
    and lower(btrim(coalesce(m.role,''))) in ('leader','admin','administrateur')
    and coalesce(m.community_access_type,'guild')<>'community'
    and lower(o.organization_key) in ('paladin','paladin_cluster')
    and not exists (select 1 from public.portal_guilds other where other.guild_code=g.guild_code and other.id<>g.id);
  if n<>1 then raise exception 'Administration Paladin requise.' using errcode='42501'; end if;
  return org;
end $$;

create or replace function public._roster_simulation_guilds(p_org uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'code',g.guild_code,'name',g.display_name,
    'capacity',case
      when coalesce(to_jsonb(g)->>'capacity',to_jsonb(g)->>'max_members','') ~ '^[1-9][0-9]{0,3}$'
      then coalesce(to_jsonb(g)->>'capacity',to_jsonb(g)->>'max_members')::integer
      else 30 end) order by g.guild_code),'[]')
  from public.portal_guilds g where g.organization_id=p_org and g.is_active
    and not exists (select 1 from public.portal_guilds other where other.guild_code=g.guild_code and other.id<>g.id);
$$;

-- Scope by the guild catalog, never by a G1-G9 list or Discord ID.
create or replace function public._roster_simulation_members(p_org uuid)
returns table (id uuid, name text, guild_id uuid, guild_code text, community boolean, primary_member_id uuid, fingerprint text)
language sql stable security definer set search_path=public,pg_temp as $$
  with guilds as (
    select g.* from public.portal_guilds g where g.organization_id=p_org and g.is_active
      and not exists (select 1 from public.portal_guilds other where other.guild_code=g.guild_code and other.id<>g.id)
  ), foreign_accounts as (
    select member_id::text as id from public.intersaison_assignments where organization_id<>p_org
    union select member_id::text from public.intersaison_survey_recipients where organization_id<>p_org
    union select k from public.intersaison_plan_applications a cross join lateral
      jsonb_object_keys(case when jsonb_typeof(a.members)='object' then a.members else '{}' end) k where a.organization_id<>p_org
    union select member_key::text from public.guild_survey_recipients where organization_id<>p_org
    union select unnest(owner_member_ids)::text from public.guild_survey_recipients where organization_id<>p_org
  ), candidates as (
    select m.*, g.id as scoped_guild,
      (coalesce(m.community_access_type,'guild')='community'
        or lower(btrim(coalesce(m.role,''))) in ('community_member','content_creator','vip')) as is_community
    from public.guild_members m left join guilds g on g.guild_code=m.guild_code
  )
  select m.id, m.watcher_name, case when m.is_community then null else m.scoped_guild end,
    case when m.is_community then null else m.guild_code end, m.is_community, m.primary_member_id,
    md5(jsonb_build_array(m.guild_code,m.role,m.roster_status,m.community_access_type,
      m.primary_member_id,m.discord_id,root.guild_code,root.primary_member_id,root.discord_id)::text)
  from candidates m left join public.guild_members root on root.id=m.primary_member_id
  where ((not m.is_community and m.scoped_guild is not null and coalesce(m.roster_status,'active')='active')
      or (m.is_community and nullif(btrim(m.guild_code),'') is null
        and not exists(select 1 from foreign_accounts f where f.id=m.id::text)))
    and (m.primary_member_id is null or (root.id is not null and root.id<>m.id and root.primary_member_id is null
      and ((exists(select 1 from guilds g where g.guild_code=root.guild_code)
          and coalesce(root.roster_status,'active')='active' and coalesce(root.community_access_type,'guild')<>'community'
          and lower(btrim(coalesce(root.role,''))) not in ('community_member','content_creator','vip'))
        or (nullif(btrim(root.guild_code),'') is null and not exists(select 1 from foreign_accounts f where f.id=root.id::text)
          and (root.community_access_type='community'
          or lower(btrim(coalesce(root.role,''))) in ('community_member','content_creator','vip'))))));
$$;

create or replace function public._roster_simulation_detail(p_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('simulation',to_jsonb(s),'activeGuilds',public._roster_simulation_guilds(s.organization_id),
    'entries',coalesce((select jsonb_agg(jsonb_build_object('memberId',e.member_id,'origin',e.origin,
      'initialGuildId',e.initial_guild_id,'targetGuildId',e.target_guild_id,'addedKind',e.added_kind,
      'current',case when m.id is null then null else to_jsonb(m) end,
      'conflict',case when m.id is null then 'Compte absent, inactif ou hors perimetre'
        when m.fingerprint<>e.origin->>'fingerprint' then 'Situation reelle modifiee'
        when e.target_guild_id is not null and not exists(select 1 from public.portal_guilds g
          where g.id=e.target_guild_id and g.organization_id=s.organization_id and g.is_active)
          then 'Guilde de destination inactive' else null end) order by e.member_id)
      from public.intersaison_roster_entries e left join public._roster_simulation_members(s.organization_id) m on m.id=e.member_id
      where e.simulation_id=s.id),'[]'),
    'events',coalesce((select jsonb_agg(to_jsonb(v) order by v.revision desc) from public.intersaison_roster_events v where v.simulation_id=s.id),'[]'),
    'canApply',false,'applicationUnavailable','Application reelle non disponible dans cette premiere version.')
  from public.intersaison_roster_simulations s where s.id=p_id;
$$;

create or replace function public.roster_simulation_request(p_actor uuid,p_action text,p_simulation uuid default null,
  p_expected integer default null,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare org uuid; actor_name text; s public.intersaison_roster_simulations%rowtype;
  catalog jsonb; previous jsonb:='[]'; following jsonb:='[]'; event public.intersaison_roster_events%rowtype;
  ids uuid[]; destination uuid; n integer; extra jsonb; q text;
begin
  org:=public._roster_simulation_actor(p_actor);
  select watcher_name into actor_name from public.guild_members where id=p_actor;
  catalog:=public._roster_simulation_guilds(org);
  if p_action='list' then
    return jsonb_build_object('guilds',catalog,'simulations',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from public.intersaison_roster_simulations x where x.organization_id=org),'[]'));
  end if;
  if p_action='search' then
    q:=lower(btrim(coalesce(p_payload->>'query','')));
    if length(q)<1 or length(q)>100 then return jsonb_build_object('results','[]'::jsonb); end if;
    return jsonb_build_object('results',coalesce((select jsonb_agg(to_jsonb(m)) from (
      select * from public._roster_simulation_members(org) where starts_with(lower(name),q) order by lower(name),id limit 40
    )m),'[]'));
  end if;
  if p_action not in ('create','detail','sync','move','restore','undo','reset','add','rename','visibility','archive') then
    raise exception 'Action de simulation inconnue.' using errcode='22023'; end if;
  if p_action='create' then
    if p_simulation is null or jsonb_typeof(p_payload->'name') is distinct from 'string'
      or length(btrim(p_payload->>'name')) not between 1 and 160 then
      raise exception 'Nom de simulation requis (160 caracteres maximum).' using errcode='22023'; end if;
    insert into public.intersaison_roster_simulations(id,organization_id,name,created_by,created_by_name,initial_guilds,guilds,visible_guilds)
      values(p_simulation,org,btrim(p_payload->>'name'),p_actor,actor_name,catalog,catalog,
        array(select (g->>'id')::uuid from jsonb_array_elements(catalog)g)) on conflict(id) do nothing;
    get diagnostics n=row_count;
    select * into s from public.intersaison_roster_simulations where id=p_simulation and organization_id=org for update nowait;
    if s.id is null or s.created_by<>p_actor then raise exception 'Simulation introuvable.' using errcode='P0002'; end if;
    if n=1 then
      insert into public.intersaison_roster_entries(simulation_id,organization_id,member_id,origin,initial_guild_id,target_guild_id,added_kind)
        select s.id,org,m.id,to_jsonb(m),m.guild_id,m.guild_id,'initial' from public._roster_simulation_members(org)m where not m.community;
      insert into public.intersaison_roster_events(simulation_id,organization_id,revision,actor_id,actor_name,kind)
        values(s.id,org,1,p_actor,actor_name,'create');
    end if;
    return public._roster_simulation_detail(s.id);
  end if;
  if p_action='detail' then
    if not exists(select 1 from public.intersaison_roster_simulations where id=p_simulation and organization_id=org) then
      raise exception 'Simulation introuvable.' using errcode='P0002'; end if;
    return public._roster_simulation_detail(p_simulation);
  end if;
  select * into s from public.intersaison_roster_simulations where id=p_simulation and organization_id=org for update nowait;
  if s.id is null then raise exception 'Simulation introuvable.' using errcode='P0002'; end if;
  if p_action='sync' and s.status<>'draft' then return public._roster_simulation_detail(s.id); end if;
  if s.status<>'draft' then raise exception 'Simulation en lecture seule.' using errcode='40001'; end if;
  if p_action<>'sync' and p_expected is distinct from s.revision then
    raise exception 'La simulation a change. Actualisez avant de recommencer.' using errcode='40001'; end if;

  if p_action='sync' then
    with inserted as (
      insert into public.intersaison_roster_entries(simulation_id,organization_id,member_id,origin,initial_guild_id,target_guild_id,added_kind)
        select s.id,org,m.id,to_jsonb(m),m.guild_id,m.guild_id,'sync' from public._roster_simulation_members(org)m
        where not m.community on conflict(simulation_id,member_id) do nothing returning member_id
    ) select coalesce(jsonb_agg(member_id),'[]') into following from inserted;
    select coalesce(jsonb_agg(g),'[]') into extra from jsonb_array_elements(catalog)g
      where not exists(select 1 from jsonb_array_elements(s.guilds)old where old->>'id'=g->>'id');
    if following='[]' and extra='[]' then return public._roster_simulation_detail(s.id); end if;
    update public.intersaison_roster_simulations set guilds=s.guilds||extra,
      visible_guilds=s.visible_guilds||array(select (g->>'id')::uuid from jsonb_array_elements(extra)g) where id=s.id;
  elsif p_action in ('move','restore') then
    if jsonb_typeof(p_payload->'members') is distinct from 'array' or jsonb_array_length(p_payload->'members') not between 1 and 1000 then
      raise exception 'Selection de comptes requise.' using errcode='22023'; end if;
    ids:=array(select jsonb_array_elements_text(p_payload->'members')::uuid);
    if cardinality(ids)<>(select count(distinct x) from unnest(ids)x) or exists(select 1 from unnest(ids)i
      where not exists(select 1 from public.intersaison_roster_entries e where e.simulation_id=s.id and e.member_id=i)) then
      raise exception 'Selection invalide ou dupliquee.' using errcode='22023'; end if;
    destination:=(p_payload->>'destination')::uuid;
    if p_action='move' and destination is not null and not exists(select 1 from jsonb_array_elements(catalog)g where (g->>'id')::uuid=destination) then
      raise exception 'Destination non autorisee.' using errcode='42501'; end if;
    if p_action='move' and exists(select 1 from unnest(ids)i where not exists(select 1 from public._roster_simulation_members(org)m where m.id=i)) then
      raise exception 'Compte absent ou hors perimetre. Consulter les ecarts.' using errcode='40001'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('memberId',member_id,'target',target_guild_id)),'[]') into previous
      from public.intersaison_roster_entries where simulation_id=s.id and member_id=any(ids);
    update public.intersaison_roster_entries set target_guild_id=case when p_action='restore' then initial_guild_id else destination end
      where simulation_id=s.id and member_id=any(ids);
    select jsonb_agg(jsonb_build_object('memberId',member_id,'target',target_guild_id)) into following
      from public.intersaison_roster_entries where simulation_id=s.id and member_id=any(ids);
  elsif p_action='add' then
    if not exists(select 1 from public._roster_simulation_members(org) where id=(p_payload->>'memberId')::uuid) then
      raise exception 'Compte non autorise.' using errcode='42501'; end if;
    if exists(select 1 from public.intersaison_roster_entries where simulation_id=s.id and member_id=(p_payload->>'memberId')::uuid) then
      return public._roster_simulation_detail(s.id); end if;
    insert into public.intersaison_roster_entries(simulation_id,organization_id,member_id,origin,initial_guild_id,target_guild_id,added_kind)
      select s.id,org,m.id,to_jsonb(m),m.guild_id,m.guild_id,'manual' from public._roster_simulation_members(org)m where m.id=(p_payload->>'memberId')::uuid;
    following:=jsonb_build_array(jsonb_build_object('memberId',p_payload->>'memberId'));
  elsif p_action='reset' then
    if p_payload->'confirmed' is distinct from 'true'::jsonb then raise exception 'Confirmation requise.' using errcode='22023'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('memberId',member_id,'target',target_guild_id)),'[]') into previous
      from public.intersaison_roster_entries where simulation_id=s.id;
    update public.intersaison_roster_entries set target_guild_id=initial_guild_id where simulation_id=s.id;
  elsif p_action='undo' then
    select * into event from public.intersaison_roster_events where simulation_id=s.id and kind in ('move','restore','reset','add')
      and undone_at is null order by revision desc limit 1 for update;
    if event.id is null then raise exception 'Aucune operation a annuler.' using errcode='22023'; end if;
    if event.kind='add' then
      delete from public.intersaison_roster_entries where simulation_id=s.id
        and member_id in (select (v->>'memberId')::uuid from jsonb_array_elements(event.after_value)v);
    else
      update public.intersaison_roster_entries e set target_guild_id=(v->>'target')::uuid
        from jsonb_array_elements(event.before_value)v where e.simulation_id=s.id and e.member_id=(v->>'memberId')::uuid;
    end if;
    update public.intersaison_roster_events set undone_at=clock_timestamp() where id=event.id;
    previous:=jsonb_build_object('eventId',event.id,'kind',event.kind);
  elsif p_action='rename' then
    if jsonb_typeof(p_payload->'name') is distinct from 'string' or length(btrim(p_payload->>'name')) not between 1 and 160 then
      raise exception 'Nom invalide.' using errcode='22023'; end if;
    previous:=to_jsonb(s.name); following:=p_payload->'name';
    update public.intersaison_roster_simulations set name=btrim(p_payload->>'name') where id=s.id;
  elsif p_action='visibility' then
    if jsonb_typeof(p_payload->'guilds') is distinct from 'array' then raise exception 'Guildes invalides.' using errcode='22023'; end if;
    ids:=array(select jsonb_array_elements_text(p_payload->'guilds')::uuid);
    if cardinality(ids)<>(select count(distinct x) from unnest(ids)x) or exists(select 1 from unnest(ids)i
      where not exists(select 1 from jsonb_array_elements(s.guilds)g where (g->>'id')::uuid=i)) then
      raise exception 'Guildes invalides.' using errcode='22023'; end if;
    previous:=to_jsonb(s.visible_guilds); following:=to_jsonb(ids);
    update public.intersaison_roster_simulations set visible_guilds=ids where id=s.id;
  elsif p_action='archive' then
    if p_payload->'confirmed' is distinct from 'true'::jsonb then raise exception 'Confirmation requise.' using errcode='22023'; end if;
    update public.intersaison_roster_simulations set status='archived' where id=s.id;
  end if;
  update public.intersaison_roster_simulations set revision=revision+1,updated_at=clock_timestamp() where id=s.id;
  insert into public.intersaison_roster_events(simulation_id,organization_id,revision,actor_id,actor_name,kind,before_value,after_value)
    values(s.id,org,s.revision+1,p_actor,actor_name,p_action,previous,following);
  return public._roster_simulation_detail(s.id);
end $$;

do $$ declare t text; f regprocedure; begin
  foreach t in array array['intersaison_roster_simulations','intersaison_roster_entries','intersaison_roster_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
  end loop;
  revoke all on sequence public.intersaison_roster_events_id_seq from public,anon,authenticated,service_role;
  for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace
    and proname in ('_roster_simulation_actor','_roster_simulation_guilds','_roster_simulation_members','_roster_simulation_detail','roster_simulation_request') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
  end loop;
end $$;
grant execute on function public.roster_simulation_request(uuid,text,uuid,integer,jsonb) to service_role;
commit;
