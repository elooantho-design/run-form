-- Additive installation only. No transfer, closure, DM or campaign is executed here.
begin;

create unique index if not exists portal_one_paladin_organization_idx on public.portal_organizations((true))
  where lower(organization_key) in ('paladin','paladin_cluster');

-- Bare G codes belong to Paladin; other organizations keep their existing prefixed codes.
do $$ begin
  if exists(select 1 from public.portal_guilds g join public.portal_organizations o on o.id=g.organization_id
    where g.guild_code ~ '^G([1-9]|1[0-9]|2[0-5])$' and lower(o.organization_key) not in ('paladin','paladin_cluster')) then
    raise exception 'Code G réservé utilisé par une autre organisation. Installation interrompue.';
  end if;
end $$;
create or replace function public.guard_paladin_guild_namespace()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.guild_code ~ '^G([1-9]|1[0-9]|2[0-5])$' and not exists(select 1 from public.portal_organizations
    where id=new.organization_id and lower(organization_key) in ('paladin','paladin_cluster')) then
    raise exception 'Code G réservé à Paladin.' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_paladin_guild_namespace() from public,anon,authenticated,service_role;
drop trigger if exists portal_guilds_paladin_namespace on public.portal_guilds;
create trigger portal_guilds_paladin_namespace before insert or update of guild_code,organization_id on public.portal_guilds
  for each row execute function public.guard_paladin_guild_namespace();

create table if not exists public.intersaison_plan_cycles (
  season_id uuid primary key references public.intersaison_survey_seasons(id) on delete cascade,
  organization_id uuid not null references public.portal_organizations(id),
  guilds jsonb not null check(jsonb_typeof(guilds)='object'),
  entries jsonb not null default '{}' check(jsonb_typeof(entries)='object'),
  reference_objectives jsonb not null default '{}',
  revision integer not null default 1 check(revision>0),
  applied_revision integer,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(organization_id,season_id)
);
create table if not exists public.intersaison_plan_applications (
  request_id uuid primary key,
  organization_id uuid not null,
  season_id uuid not null,
  actor_member_id uuid not null references public.guild_members(id),
  revision integer not null,
  fingerprint text not null,
  members jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  foreign key(organization_id,season_id) references public.intersaison_plan_cycles(organization_id,season_id) on delete cascade
);
-- Independent of survey-season FKs: objective memory survives removal of an old cycle.
create table if not exists public.intersaison_plan_objective_bank (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.portal_organizations(id),
  source_season_id uuid not null,
  revision integer not null,
  guilds jsonb not null,
  actor_member_id uuid references public.guild_members(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(organization_id,source_season_id,revision)
);
create index if not exists intersaison_plan_bank_latest_idx on public.intersaison_plan_objective_bank(organization_id,created_at desc,id);
create table if not exists public.intersaison_plan_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  season_id uuid not null,
  revision integer not null,
  kind text not null check(kind in ('guild','member','objectives')),
  subject text not null,
  before_value jsonb,
  after_value jsonb not null,
  actor_member_id uuid references public.guild_members(id) on delete set null,
  actor_name text not null,
  created_at timestamptz not null default now(),
  unique(season_id,revision),
  foreign key(organization_id,season_id) references public.intersaison_plan_cycles(organization_id,season_id) on delete cascade
);

create or replace function public.assert_intersaison_plan_admin(p_org uuid,p_actor uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not exists(select 1 from public.guild_members m join public.portal_guilds g on g.guild_code=m.guild_code
    join public.portal_organizations o on o.id=g.organization_id
    where m.id=p_actor and g.organization_id=p_org and g.is_active and o.is_active
      and lower(o.organization_key) in ('paladin','paladin_cluster')
      and lower(btrim(m.role)) in ('admin','administrateur','leader')) then
    raise exception 'Administration Paladin hors organisation.' using errcode='42501';
  end if;
end $$;

create or replace function public.initialize_intersaison_plan_cycle()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_guilds jsonb; v_reference jsonb;
begin
  if not exists(select 1 from public.portal_organizations where id=new.organization_id and is_active
    and lower(organization_key) in ('paladin','paladin_cluster')) then return new; end if;
  select coalesce(jsonb_object_agg(g.guild_code,jsonb_build_object('name',case g.guild_code
    when 'G1' then 'Legend' when 'G2' then 'Imperatores' when 'G3' then 'Loyalty'
    when 'G4' then 'Collegium' when 'G5' then 'Senatores' when 'G6' then 'Legacy'
    when 'G7' then 'Magistratus' else g.display_name end,
    'objective',coalesce(c.objective_snapshot->>g.guild_code,''),'existingId',g.id,'capacity',30)),'{}')
    into v_guilds from public.portal_guilds g left join lateral(select objective_snapshot from public.intersaison_survey_campaigns
      where season_id=new.id and organization_id=new.organization_id and poll_number=2 and not is_test and status<>'cancelled'
      order by created_at desc limit 1) c on true
    where g.organization_id=new.organization_id and g.is_active;
  select guilds into v_reference from public.intersaison_plan_objective_bank where organization_id=new.organization_id
    order by created_at desc,revision desc,id desc limit 1;
  insert into public.intersaison_plan_cycles(season_id,organization_id,guilds,reference_objectives)
    values(new.id,new.organization_id,v_guilds,coalesce(v_reference,'{}')) on conflict(season_id) do nothing;
  return new;
end $$;
drop trigger if exists intersaison_plan_initialize on public.intersaison_survey_seasons;
create trigger intersaison_plan_initialize after insert on public.intersaison_survey_seasons
  for each row execute function public.initialize_intersaison_plan_cycle();

-- Seed technical plan documents only; preserve every existing source row.
do $$ declare s record; begin
  for s in select season_row.* from public.intersaison_survey_seasons season_row where season_row.status<>'finished' and exists(
    select 1 from public.portal_organizations o where o.id=season_row.organization_id and lower(o.organization_key) in ('paladin','paladin_cluster')) loop
    -- Create a technical plan document without updating the source season.
    insert into public.intersaison_plan_cycles(season_id,organization_id,guilds)
      select s.id,s.organization_id,coalesce(jsonb_object_agg(g.guild_code,jsonb_build_object('name',case g.guild_code
        when 'G1' then 'Legend' when 'G2' then 'Imperatores' when 'G3' then 'Loyalty' when 'G4' then 'Collegium'
        when 'G5' then 'Senatores' when 'G6' then 'Legacy' when 'G7' then 'Magistratus' else g.display_name end,
        'objective',coalesce(c.objective_snapshot->>g.guild_code,''),'existingId',g.id,'capacity',30)),'{}')
      from public.portal_guilds g left join lateral(select objective_snapshot from public.intersaison_survey_campaigns
        where season_id=s.id and organization_id=s.organization_id and poll_number=2 and not is_test and status<>'cancelled'
        order by created_at desc limit 1) c on true where g.organization_id=s.organization_id and g.is_active
      on conflict(season_id) do nothing;
  end loop;
end $$;

create or replace function public.intersaison_plan_members(p_org uuid,p_season uuid)
returns setof public.guild_members language sql stable security definer set search_path=public,pg_temp as $$
  select m.* from public.guild_members m where
  -- A current foreign guild always overrides any historical Paladin association.
  not exists(select 1 from public.portal_guilds foreign_g where foreign_g.guild_code=m.guild_code and foreign_g.organization_id<>p_org)
  and (
    exists(select 1 from public.portal_guilds g where g.organization_id=p_org and g.guild_code=m.guild_code and g.is_active
      and coalesce(m.roster_status,'active')='active' and coalesce(m.community_access_type,'')<>'community')
    or (m.guild_code is null and (m.community_access_type='community' or m.role='community_member')
      and not exists(select 1 from public.intersaison_assignments a where a.member_id=m.id and a.organization_id<>p_org)
      and not exists(select 1 from public.intersaison_survey_recipients r where r.member_id=m.id and r.organization_id<>p_org)
      and not exists(select 1 from public.intersaison_plan_applications a where a.organization_id<>p_org and a.members ? m.id::text)
      and (
      exists(select 1 from public.intersaison_survey_recipients r join public.intersaison_survey_campaigns c on c.id=r.survey_campaign_id
        where r.member_id=m.id and r.organization_id=p_org and c.organization_id=p_org and not c.is_test)
      or exists(select 1 from public.intersaison_assignments a where a.member_id=m.id and a.organization_id=p_org)
      or exists(select 1 from public.intersaison_plan_applications a where a.organization_id=p_org and a.members ? m.id::text)
    ))
  )
$$;

create or replace function public.read_intersaison_plan(p_org uuid,p_actor uuid,p_season uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare plan public.intersaison_plan_cycles%rowtype; campaign uuid; members jsonb; recipients jsonb; responses jsonb; placements jsonb; roles jsonb;
begin
  perform public.assert_intersaison_plan_admin(p_org,p_actor);
  select p.* into plan from public.intersaison_plan_cycles p where p.organization_id=p_org
    and (p_season is null or p.season_id=p_season) order by p.created_at desc,p.season_id desc limit 1;
  if plan.season_id is null then return null; end if;
  select id into campaign from public.intersaison_survey_campaigns where organization_id=p_org and season_id=plan.season_id
    and poll_number=2 and not is_test and status<>'cancelled' order by created_at desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'watcher_name',m.watcher_name,'guild_code',m.guild_code,
    'discord_id',m.discord_id,'primary_member_id',m.primary_member_id,'role',m.role,'roster_status',m.roster_status,
    'community_access_type',m.community_access_type) order by m.id),'[]') into members
    from public.intersaison_plan_members(p_org,plan.season_id) m;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') into recipients from public.intersaison_survey_recipients r
    where organization_id=p_org and survey_campaign_id=campaign;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') into responses from public.intersaison_survey_responses r
    where organization_id=p_org and survey_campaign_id=campaign and poll_number=2 and is_current;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.member_key,p.revision),'[]') into placements from public.intersaison_survey_placements p
    where organization_id=p_org and season_id=plan.season_id;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.member_key,r.revision),'[]') into roles from public.intersaison_survey_forecast_roles r
    where organization_id=p_org and season_id=plan.season_id;
  return jsonb_build_object('plan',to_jsonb(plan),'members',members,'recipients',recipients,'responses',responses,'placements',placements,'roles',roles,
    'events',(select coalesce(jsonb_agg(to_jsonb(e) order by revision),'[]') from public.intersaison_plan_events e
      where organization_id=p_org and season_id=plan.season_id));
end $$;

create or replace function public.save_intersaison_plan(p_org uuid,p_actor uuid,p_season uuid,p_revision integer,p_kind text,p_data jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare plan public.intersaison_plan_cycles%rowtype; code text; member public.guild_members%rowtype; entry jsonb; previous jsonb; subject text;
begin
  perform public.assert_intersaison_plan_admin(p_org,p_actor);
  perform 1 from public.intersaison_survey_seasons where id=p_season and organization_id=p_org and status<>'finished' for update;
  if not found then raise exception 'Inter-saison clôturée.'; end if;
  select * into strict plan from public.intersaison_plan_cycles where organization_id=p_org and season_id=p_season for update;
  if plan.closed_at is not null or plan.revision<>p_revision then raise exception 'Plan modifié ou clôturé. Actualise.'; end if;
  if p_kind='guild' then
    code:=p_data->>'code';
    if code is null then
      select 'G'||n into code from generate_series(1,25) n where not plan.guilds ? ('G'||n)
        and not exists(select 1 from public.portal_guilds where guild_code='G'||n) order by n limit 1;
    end if;
    if code is null or code !~ '^G([1-9]|1[0-9]|2[0-5])$' or
      (not plan.guilds ? code and exists(select 1 from public.portal_guilds where guild_code=code)) then raise exception 'Code de guilde indisponible.'; end if;
    if length(btrim(coalesce(p_data->>'name','')))=0 or length(p_data->>'name')>80
      or length(btrim(coalesce(p_data->>'objective','')))=0 or length(p_data->>'objective')>600 then
      raise exception 'Nom (80 caractères) et objectifs (600 caractères) obligatoires.'; end if;
    entry:=jsonb_build_object('name',btrim(p_data->>'name'),'objective',p_data->>'objective',
      'existingId',plan.guilds->code->'existingId','capacity',30);
    previous:=plan.guilds->code; subject:=code;
    plan.guilds:=jsonb_set(plan.guilds,array[code],entry,true);
  elsif p_kind='member' then
    select * into member from public.intersaison_plan_members(p_org,p_season) where id=(p_data->>'memberId')::uuid;
    if member.id is null then raise exception 'Compte hors du périmètre Paladin vérifiable.' using errcode='42501'; end if;
    code:=nullif(p_data->>'guildCode','');
    if code is not null and not plan.guilds ? code then raise exception 'Guilde absente du plan.'; end if;
    if coalesce(p_data->>'forecastRole','member') not in ('member','officer','leader') then raise exception 'Rôle prévisionnel invalide.'; end if;
    entry:=jsonb_build_object('guildCode',code,'forecastRole',coalesce(p_data->>'forecastRole','member'),
      'actorId',p_actor,'actorName',(select watcher_name from public.guild_members where id=p_actor),'at',now());
    previous:=plan.entries->member.id::text; subject:=member.id::text;
    plan.entries:=jsonb_set(plan.entries,array[member.id::text],entry,true);
  else raise exception 'Modification de plan inconnue.'; end if;
  insert into public.intersaison_plan_events(organization_id,season_id,revision,kind,subject,before_value,after_value,actor_member_id,actor_name)
    values(p_org,p_season,plan.revision+1,p_kind,subject,previous,entry,p_actor,
      coalesce((select watcher_name from public.guild_members where id=p_actor),'Admin'));
  update public.intersaison_plan_cycles set guilds=plan.guilds,entries=plan.entries,revision=revision+1
    where season_id=p_season and organization_id=p_org;
end $$;

-- Authoritative effective targets. Shared by preview and application.
create or replace function public.intersaison_plan_targets(p_org uuid,p_season uuid)
returns table(member_id uuid,member_name text,current_guild text,target_guild text,member_role text,community boolean)
language sql stable security definer set search_path=public,pg_temp as $$
  with plan as(select * from public.intersaison_plan_cycles where organization_id=p_org and season_id=p_season),
  campaign as(select id from public.intersaison_survey_campaigns where season_id=p_season and organization_id=p_org
    and poll_number=2 and not is_test and status<>'cancelled' order by created_at desc limit 1),
  latest as(select distinct on(member_key) member_key,case when action='set' then guild_code end as guild_code
    from public.intersaison_survey_placements where organization_id=p_org and season_id=p_season order by member_key,revision desc)
  select m.id,m.watcher_name,m.guild_code,
    case when plan.entries ? m.id::text then coalesce(nullif(plan.entries->m.id::text->>'guildCode',''),answer.first_choice_guild_code)
      else coalesce(latest.guild_code,answer.first_choice_guild_code) end,
    m.role,(m.guild_code is null or coalesce(m.community_access_type,'')='community' or coalesce(m.role,'')='community_member')
  from plan cross join public.intersaison_plan_members(p_org,p_season) m
  left join latest on latest.member_key=m.id
  left join public.intersaison_survey_recipients r on r.survey_campaign_id=(select id from campaign)
    and r.organization_id=p_org and coalesce(r.member_key,r.member_id)=m.id
  left join public.intersaison_survey_responses answer on answer.survey_recipient_id=r.id and answer.is_current
    and answer.survey_campaign_id=r.survey_campaign_id and answer.organization_id=p_org and answer.poll_number=2
  where (m.guild_code is not null and coalesce(m.roster_status,'active')='active' and coalesce(m.community_access_type,'')<>'community')
    or plan.entries ? m.id::text or r.id is not null or latest.member_key is not null
$$;

create or replace function public.preview_intersaison_plan(p_org uuid,p_actor uuid,p_season uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare plan public.intersaison_plan_cycles%rowtype; targets jsonb; changes jsonb; blockers jsonb:='[]'; creations jsonb; renames jsonb;
begin
  perform public.assert_intersaison_plan_admin(p_org,p_actor);
  select * into strict plan from public.intersaison_plan_cycles where season_id=p_season and organization_id=p_org;
  if plan.closed_at is not null or exists(select 1 from public.intersaison_survey_seasons where id=p_season and status='finished') then
    blockers:=blockers||jsonb_build_array('Inter-saison clôturée.'); end if;
  if exists(select 1 from public.intersaison_survey_campaigns where season_id=p_season and organization_id=p_org and not is_test and status in ('open','preparing')) then
    blockers:=blockers||jsonb_build_array('Clôturer les sondages officiels avant les transferts.'); end if;
  if exists(select 1 from public.guild_dm_recipients d join public.intersaison_survey_campaigns c
    on c.guild_dm_campaign_id=d.campaign_id and c.organization_id=d.organization_id
    where c.season_id=p_season and c.organization_id=p_org and d.status in ('queued','sending')) then
    blockers:=blockers||jsonb_build_array('Attendre la fin des envois Discord de cette Inter-saison.'); end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by member_id),'[]') into targets from public.intersaison_plan_targets(p_org,p_season) t;
  if exists(select 1 from public.intersaison_plan_targets(p_org,p_season) group by member_id having count(*)<>1) then
    blockers:=blockers||jsonb_build_array('Plusieurs affectations pour un même compte. Vérification nécessaire.'); end if;
  if exists(select 1 from jsonb_each(plan.guilds) g where length(btrim(coalesce(g.value->>'objective','')))=0) then
    blockers:=blockers||jsonb_build_array('Renseigner les objectifs de toutes les guildes du plan.'); end if;
  if exists(select 1 from public.intersaison_plan_targets(p_org,p_season) where target_guild is not null and not plan.guilds ? target_guild) then
    blockers:=blockers||jsonb_build_array('Affectation vers une guilde absente du plan.'); end if;
  if exists(select 1 from public.intersaison_plan_targets(p_org,p_season) where target_guild is not null group by target_guild having count(*)>30) then
    blockers:=blockers||jsonb_build_array('Une guilde dépasse sa capacité de 30 comptes.'); end if;
  if exists(select 1 from public.intersaison_plan_targets(p_org,p_season) where target_guild is null and not community
    and lower(member_role) in ('admin','administrateur','leader')) then
    blockers:=blockers||jsonb_build_array('Un admin ou leader reste sans affectation.'); end if;
  if exists(select 1 from public.intersaison_plan_targets(p_org,p_season) where target_guild is not null and community
    and lower(coalesce(member_role,'')) not in ('member','community_member')) then
    blockers:=blockers||jsonb_build_array('Un compte communautaire privilégié nécessite une gestion de rôle explicite.'); end if;
  if exists(select 1 from jsonb_each(plan.guilds) g join public.portal_guilds p on p.guild_code=g.key
    where p.organization_id<>p_org or not p.is_active or (g.value->>'existingId' is null and p.id is not null)) then
    blockers:=blockers||jsonb_build_array('Code de guilde occupé ou configuration modifiée.'); end if;
  if exists(select 1 from jsonb_each(plan.guilds) g where g.value->>'existingId' is not null and not exists(
    select 1 from public.portal_guilds p where p.id=(g.value->>'existingId')::uuid and p.guild_code=g.key and p.organization_id=p_org and p.is_active)) then
    blockers:=blockers||jsonb_build_array('Identité d’une guilde réelle modifiée ou introuvable.'); end if;
  -- An unavailable tracked player must never silently disappear from the operation.
  if exists(select 1 from jsonb_object_keys(plan.entries) e where not exists(select 1 from public.intersaison_plan_members(p_org,p_season) m where m.id::text=e)) then
    blockers:=blockers||jsonb_build_array('Un compte placé a quitté le périmètre autorisé.'); end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by member_id),'[]') into changes from public.intersaison_plan_targets(p_org,p_season) t
    where (target_guild is not null and (current_guild is distinct from target_guild or community))
      or (target_guild is null and not community);
  select coalesce(jsonb_agg(jsonb_build_object('code',key,'name',value->>'name') order by key),'[]') into creations
    from jsonb_each(plan.guilds) where value->>'existingId' is null;
  select coalesce(jsonb_agg(jsonb_build_object('code',g.key,'before',p.display_name,'after',g.value->>'name') order by g.key),'[]') into renames
    from jsonb_each(plan.guilds) g join public.portal_guilds p on p.id=(g.value->>'existingId')::uuid and p.organization_id=p_org
    where p.display_name is distinct from g.value->>'name';
  return jsonb_build_object('seasonId',p_season,'revision',plan.revision,'blockers',blockers,'canApply',jsonb_array_length(blockers)=0,
    'changes',changes,'creations',creations,'renames',renames,'members',targets,
    'fingerprint',md5(jsonb_build_array(to_jsonb(plan),targets,
      (select coalesce(jsonb_agg(jsonb_build_array(g.id,g.guild_code,g.organization_id,g.is_active,g.display_name) order by g.id),'[]')
        from public.portal_guilds g where g.organization_id=p_org or plan.guilds ? g.guild_code))::text));
end $$;

create or replace function public.apply_intersaison_plan(p_org uuid,p_actor uuid,p_season uuid,p_fingerprint text,p_request uuid,p_confirmed boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare plan public.intersaison_plan_cycles%rowtype; preview jsonb; prior public.intersaison_plan_applications%rowtype;
  g record; t record; new_id uuid; result jsonb; transferred integer:=0; converted integer:=0; created integer:=0;
begin
  perform public.assert_intersaison_plan_admin(p_org,p_actor);
  if p_confirmed is not true or p_request is null then raise exception 'Confirmation explicite requise.'; end if;
  perform 1 from public.intersaison_survey_seasons where id=p_season and organization_id=p_org for update;
  select * into strict plan from public.intersaison_plan_cycles where season_id=p_season and organization_id=p_org for update;
  select * into prior from public.intersaison_plan_applications where request_id=p_request;
  if found then
    if prior.organization_id<>p_org or prior.season_id<>p_season or prior.fingerprint<>p_fingerprint or prior.actor_member_id<>p_actor then
      raise exception 'Clé de confirmation déjà utilisée.'; end if;
    return prior.result||jsonb_build_object('alreadyApplied',true);
  end if;
  -- Serialize against roster changes and concurrent creation of a guild code.
  lock table public.portal_guilds in share row exclusive mode;
  lock table public.guild_members in share row exclusive mode;
  preview:=public.preview_intersaison_plan(p_org,p_actor,p_season);
  if not (preview->>'canApply')::boolean or preview->>'fingerprint' is distinct from p_fingerprint then
    raise exception 'Prévisualisation périmée ou bloquée. Actualise avant de confirmer.'; end if;
  for g in select key,value from jsonb_each(plan.guilds) order by key loop
    if g.value->>'existingId' is null then
      insert into public.portal_guilds(organization_id,guild_code,display_name,is_active) values(p_org,g.key,g.value->>'name',true) returning id into new_id;
      plan.guilds:=jsonb_set(plan.guilds,array[g.key,'existingId'],to_jsonb(new_id)); created:=created+1;
    else
      update public.portal_guilds set display_name=g.value->>'name' where id=(g.value->>'existingId')::uuid
        and organization_id=p_org and display_name is distinct from g.value->>'name';
    end if;
  end loop;
  for t in select * from public.intersaison_plan_targets(p_org,p_season) loop
    if t.target_guild is not null and (t.current_guild is distinct from t.target_guild or t.community) then
      update public.guild_members set guild_code=t.target_guild,roster_status='active',
        role=case when t.community then 'member' else role end,
        community_access_type=case when t.community then null else community_access_type end,
        community_status=case when t.community then 'inactive' else community_status end,
        assignment=case when t.community then null else assignment end,
        status=case when t.community then U&'\00C0 faire' else status end where id=t.member_id;
      transferred:=transferred+1;
    elsif t.target_guild is null and not t.community then
      update public.guild_members set guild_code=null,role='community_member',roster_status='inactive',
        community_access_type='community',community_status='active',assignment=U&'Communaut\00E9',status='Actif' where id=t.member_id;
      converted:=converted+1;
    end if;
  end loop;
  update public.intersaison_plan_cycles set guilds=plan.guilds,applied_revision=revision where season_id=p_season;
  insert into public.intersaison_plan_objective_bank(organization_id,source_season_id,revision,guilds,actor_member_id)
    values(p_org,p_season,plan.revision,plan.guilds,p_actor) on conflict(organization_id,source_season_id,revision) do nothing;
  result:=jsonb_build_object('transferred',transferred,'community',converted,'createdGuilds',created,'revision',plan.revision,'alreadyApplied',false);
  insert into public.intersaison_plan_applications(request_id,organization_id,season_id,actor_member_id,revision,fingerprint,members,result)
    values(p_request,p_org,p_season,p_actor,plan.revision,p_fingerprint,
      (select coalesce(jsonb_object_agg(x->>'member_id',x),'{}') from jsonb_array_elements(preview->'members') x),result);
  return result;
end $$;

create or replace function public.close_intersaison_plan(p_org uuid,p_actor uuid,p_season uuid,p_fingerprint text,p_confirmed boolean)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.intersaison_plan_cycles%rowtype; preview jsonb;
begin
  perform public.assert_intersaison_plan_admin(p_org,p_actor);
  if p_confirmed is not true then raise exception 'Confirmation explicite requise.'; end if;
  perform 1 from public.intersaison_survey_seasons where id=p_season and organization_id=p_org for update;
  select * into strict p from public.intersaison_plan_cycles where season_id=p_season and organization_id=p_org for update;
  if p.closed_at is not null then return; end if;
  lock table public.portal_guilds in share row exclusive mode;
  lock table public.guild_members in share row exclusive mode;
  preview:=public.preview_intersaison_plan(p_org,p_actor,p_season);
  if p.applied_revision is distinct from p.revision or preview->>'fingerprint' is distinct from p_fingerprint
    or not (preview->>'canApply')::boolean or jsonb_array_length(preview->'changes')<>0 or jsonb_array_length(preview->'creations')<>0
    or jsonb_array_length(preview->'renames')<>0 then
    raise exception 'Appliquer le dernier plan et vérifier les effectifs avant de clôturer.'; end if;
  update public.intersaison_plan_cycles set closed_at=now() where season_id=p_season;
  update public.intersaison_survey_seasons set status='finished' where id=p_season and organization_id=p_org;
end $$;

create or replace function public.prepare_next_intersaison_plan(p_org uuid,p_actor uuid,p_season uuid,p_confirmed boolean)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.intersaison_plan_cycles%rowtype; next_id uuid;
begin
  perform public.assert_intersaison_plan_admin(p_org,p_actor);
  if p_confirmed is not true then raise exception 'Confirmation explicite requise.'; end if;
  perform 1 from public.portal_organizations where id=p_org for update;
  select * into strict p from public.intersaison_plan_cycles where season_id=p_season and organization_id=p_org for update;
  if p.closed_at is null then raise exception 'Clôturer cette Inter-saison avant le nouveau cycle.'; end if;
  if exists(select 1 from public.intersaison_survey_seasons where organization_id=p_org and status<>'finished') then
    raise exception 'Un nouveau cycle existe déjà. Actualise.'; end if;
  -- No DM, campaign or recipient is created. Old records become inaccessible through the active-cycle UI.
  insert into public.intersaison_survey_seasons(organization_id,label,status,created_by_member_id,created_by_name)
    values(p_org,'Inter-saison '||to_char(now(),'YYYY-MM-DD HH24:MI'),'survey1_preparing',p_actor,
      (select watcher_name from public.guild_members where id=p_actor)) returning id into next_id;
  return next_id;
end $$;

do $$ declare t text; f record; begin
  foreach t in array array['intersaison_plan_cycles','intersaison_plan_applications','intersaison_plan_objective_bank','intersaison_plan_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to service_role',t);
    execute format('drop policy if exists plan_service_read on public.%I',t);
    execute format('create policy plan_service_read on public.%I for select to service_role using(true)',t);
  end loop;
  for f in select oid::regprocedure as signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in
    ('assert_intersaison_plan_admin','initialize_intersaison_plan_cycle','intersaison_plan_members','read_intersaison_plan',
     'save_intersaison_plan','intersaison_plan_targets','preview_intersaison_plan','apply_intersaison_plan','close_intersaison_plan','prepare_next_intersaison_plan') loop
    execute 'revoke all on function '||f.signature||' from public,anon,authenticated,service_role';
    if f.proname in ('read_intersaison_plan','save_intersaison_plan','preview_intersaison_plan','apply_intersaison_plan','close_intersaison_plan','prepare_next_intersaison_plan') then
      execute 'grant execute on function '||f.signature||' to service_role';
    end if;
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
