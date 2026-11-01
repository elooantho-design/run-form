-- Additive installation only. No publication, enqueue, backfill or Inter-saison mutation.
begin;

create table if not exists public.guild_survey_settings (
  singleton boolean primary key default true check(singleton),
  delivery_enabled boolean not null default false,
  public_portal_url text not null default 'https://run-form-tau.vercel.app/portal'
    check(public_portal_url ~ '^https://[^/?#]+/portal$')
);
insert into public.guild_survey_settings(singleton) values(true) on conflict do nothing;

create table if not exists public.guild_surveys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.portal_organizations(id),
  created_by_member_id uuid references public.guild_members(id) on delete set null,
  created_by_name text not null,
  created_by_rank integer not null check(created_by_rank in (1,2)),
  title text not null check(length(btrim(title)) between 1 and 160),
  introduction text not null default '' check(length(introduction)<=6000),
  questions jsonb not null check(jsonb_typeof(questions)='array'),
  target_guild_ids uuid[] not null check(cardinality(target_guild_ids)>0),
  deadline timestamptz,
  status text not null default 'draft' check(status in ('draft','open','closed')),
  revision integer not null default 1 check(revision>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  closed_at timestamptz,
  unique(id,organization_id)
);
create table if not exists public.guild_survey_recipients (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null,
  organization_id uuid not null,
  member_id uuid references public.guild_members(id) on delete set null,
  member_key uuid not null,
  owner_member_ids uuid[] not null,
  member_name_snapshot text not null,
  guild_code_snapshot text not null,
  linked_accounts integer not null check(linked_accounts>0),
  discord_user_id text,
  eligibility text not null check(eligibility in ('eligible','missing_discord','ambiguous_identity')),
  created_at timestamptz not null default now(),
  foreign key(survey_id,organization_id) references public.guild_surveys(id,organization_id),
  unique(survey_id,member_key), unique(id,survey_id,organization_id)
);
create table if not exists public.guild_survey_responses (
  recipient_id uuid primary key,
  survey_id uuid not null,
  organization_id uuid not null,
  answers jsonb not null check(jsonb_typeof(answers)='object'),
  version integer not null check(version>0),
  updated_at timestamptz not null default now(),
  foreign key(recipient_id,survey_id,organization_id) references public.guild_survey_recipients(id,survey_id,organization_id)
);
create table if not exists public.guild_survey_waves (
  id uuid primary key,
  survey_id uuid not null,
  organization_id uuid not null,
  kind text not null check(kind in ('initial','reminder')),
  created_by_member_id uuid not null,
  fingerprint text not null,
  dm_campaign_id uuid unique references public.guild_dm_campaigns(id),
  created_at timestamptz not null default now(),
  foreign key(survey_id,organization_id) references public.guild_surveys(id,organization_id),
  unique(id,survey_id,organization_id)
);
create unique index if not exists guild_survey_initial_wave_uidx on public.guild_survey_waves(survey_id) where kind='initial';
create table if not exists public.guild_survey_deliveries (
  id uuid primary key default gen_random_uuid(),
  wave_id uuid not null,
  recipient_id uuid not null,
  survey_id uuid not null,
  organization_id uuid not null,
  dm_recipient_id uuid not null unique references public.guild_dm_recipients(id),
  authorized_at timestamptz,
  foreign key(wave_id,survey_id,organization_id) references public.guild_survey_waves(id,survey_id,organization_id),
  foreign key(recipient_id,survey_id,organization_id) references public.guild_survey_recipients(id,survey_id,organization_id),
  unique(wave_id,recipient_id)
);
alter table public.guild_survey_deliveries add column if not exists authorized_at timestamptz;
create table if not exists public.guild_survey_delivery_events (
  id bigint generated always as identity primary key,
  delivery_id uuid not null references public.guild_survey_deliveries(id),
  old_state jsonb not null,
  new_state jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists guild_surveys_org_idx on public.guild_surveys(organization_id,created_at desc);
create index if not exists guild_survey_recipients_member_idx on public.guild_survey_recipients(member_key,survey_id);
create index if not exists guild_survey_delivery_recipient_idx on public.guild_survey_deliveries(recipient_id,wave_id);

create or replace function public._guild_survey_actor(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare m public.guild_members%rowtype; org uuid; count_org integer; rank integer;
begin
  select * into m from public.guild_members where id=p_actor;
  if m.id is null or coalesce(m.roster_status,'active')<>'active' or ((coalesce(m.community_access_type,'guild')='community' or lower(btrim(coalesce(m.role,''))) in ('community_member','content_creator','vip')) and lower(btrim(coalesce(m.community_status,'')))='inactive') then
    raise exception 'Session membre invalide.' using errcode='42501'; end if;
  rank:=case lower(btrim(m.role)) when 'leader' then 2 when 'admin' then 1 when 'administrateur' then 1 else 0 end;
  select count(*),min(g.organization_id::text)::uuid into count_org,org
    from public.portal_guilds g join public.portal_organizations o on o.id=g.organization_id and o.is_active
    where g.guild_code=m.guild_code and g.is_active;
  return jsonb_build_object('id',m.id,'name',m.watcher_name,'root',coalesce(m.primary_member_id,m.id),
    'rank',case when count_org=1 and coalesce(m.community_access_type,'guild')<>'community' and lower(btrim(coalesce(m.role,''))) not in ('community_member','content_creator','vip') then rank else 0 end,
    'org',case when count_org=1 then org else null end);
end $$;

create or replace function public._guild_survey_questions(p_questions jsonb)
returns void language plpgsql immutable security definer set search_path=public,pg_temp as $$
declare q jsonb; o jsonb; ids text[]:='{}'; option_ids text[];
begin
  if jsonb_typeof(p_questions) is distinct from 'array' or jsonb_array_length(p_questions) not between 1 and 20 then
    raise exception 'Entre 1 et 20 questions requises.' using errcode='22023'; end if;
  for q in select value from jsonb_array_elements(p_questions) loop
    if jsonb_typeof(q)<>'object' or jsonb_typeof(q->'id') is distinct from 'string' or jsonb_typeof(q->'label') is distinct from 'string'
      or coalesce(q->>'id','')!~'^[a-zA-Z0-9_-]{1,64}$' or q->>'id'=any(ids)
      or coalesce(q->>'type','') not in ('single','multiple','text')
      or jsonb_typeof(q->'required') is distinct from 'boolean' or length(btrim(coalesce(q->>'label',''))) not between 1 and 500 then
      raise exception 'Question invalide ou identifiant duplique.' using errcode='22023'; end if;
    ids:=array_append(ids,q->>'id'); option_ids:='{}';
    if jsonb_typeof(q->'options') is distinct from 'array' then raise exception 'Propositions invalides.' using errcode='22023'; end if;
    if q->>'type'='text' then
      if jsonb_array_length(q->'options')<>0 then raise exception 'Texte libre sans propositions.' using errcode='22023'; end if;
    else
      if jsonb_array_length(q->'options') not between 2 and 20 then raise exception 'Entre 2 et 20 propositions requises.' using errcode='22023'; end if;
      for o in select value from jsonb_array_elements(q->'options') loop
        if jsonb_typeof(o->'id') is distinct from 'string' or jsonb_typeof(o->'label') is distinct from 'string'
          or coalesce(o->>'id','')!~'^[a-zA-Z0-9_-]{1,64}$' or o->>'id'=any(option_ids)
          or length(btrim(coalesce(o->>'label',''))) not between 1 and 300 then
          raise exception 'Proposition invalide ou dupliquee.' using errcode='22023'; end if;
        option_ids:=array_append(option_ids,o->>'id');
      end loop;
    end if;
  end loop;
end $$;

create or replace function public._guild_survey_answers(p_questions jsonb,p_answers jsonb)
returns jsonb language plpgsql immutable security definer set search_path=public,pg_temp as $$
declare q jsonb; answer jsonb; item jsonb; allowed text[]; result jsonb:='{}';
begin
  if jsonb_typeof(p_answers) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_answers) k
    where not exists(select 1 from jsonb_array_elements(p_questions) question where question->>'id'=k)) then
    raise exception 'Reponses invalides.' using errcode='22023'; end if;
  for q in select value from jsonb_array_elements(p_questions) loop
    answer:=p_answers->(q->>'id');
    if answer is null or answer='null'::jsonb or answer='""'::jsonb or answer='[]'::jsonb then
      if (q->>'required')::boolean then raise exception 'Reponse obligatoire manquante.' using errcode='22023'; end if;
      continue;
    end if;
    select array_agg(o->>'id') into allowed from jsonb_array_elements(q->'options') o;
    if q->>'type'='text' then
      if jsonb_typeof(answer)<>'string' or length(answer#>>'{}')>4000 or ((q->>'required')::boolean and length(btrim(answer#>>'{}'))=0) then
        raise exception 'Texte libre invalide (4000 caracteres maximum).' using errcode='22023'; end if;
    elsif q->>'type'='single' then
      if jsonb_typeof(answer)<>'string' or not ((answer#>>'{}')=any(allowed)) then raise exception 'Choix unique invalide.' using errcode='22023'; end if;
    else
      if jsonb_typeof(answer)<>'array' or jsonb_array_length(answer)>cardinality(allowed) then raise exception 'Choix multiples invalides.' using errcode='22023'; end if;
      if (select count(*)<>count(distinct value) from jsonb_array_elements(answer)) then raise exception 'Choix multiples dupliques.' using errcode='22023'; end if;
      for item in select value from jsonb_array_elements(answer) loop
        if jsonb_typeof(item)<>'string' or not ((item#>>'{}')=any(allowed)) then raise exception 'Proposition inconnue.' using errcode='22023'; end if;
      end loop;
    end if;
    result:=result||jsonb_build_object(q->>'id',answer);
  end loop;
  return result;
end $$;

create or replace function public._guild_survey_roster(p_survey uuid)
returns table(member_key uuid,member_name_snapshot text,guild_code_snapshot text,owner_member_ids uuid[],linked_accounts integer,discord_user_id text,eligibility text)
language sql stable security definer set search_path=public,pg_temp as $$
  with c as(select * from public.guild_surveys where id=p_survey), base as(
    select m.*,coalesce(root.id,m.id) as root_id,coalesce(root.watcher_name,m.watcher_name) as root_name,
      case when root.id is not null then nullif(btrim(root.discord_id),'') else nullif(btrim(m.discord_id),'') end as discord,
      (m.primary_member_id is not null and (root.id is null or root.primary_member_id is not null
        or coalesce(root.roster_status,'active')<>'active' or coalesce(root.community_access_type,'guild')='community' or lower(btrim(coalesce(root.role,''))) in ('community_member','content_creator','vip')
        or (nullif(btrim(m.discord_id),'') is not null and nullif(btrim(root.discord_id),'') is not null and btrim(m.discord_id)<>btrim(root.discord_id))
        or not exists(select 1 from public.portal_guilds rg where rg.guild_code=root.guild_code and rg.organization_id=c.organization_id and rg.is_active)
        or exists(select 1 from public.portal_guilds other where other.guild_code=root.guild_code and other.organization_id<>c.organization_id and other.is_active))) as bad_root
    from c join public.portal_guilds g on g.id=any(c.target_guild_ids) and g.organization_id=c.organization_id and g.is_active
    join public.guild_members m on m.guild_code=g.guild_code and coalesce(m.roster_status,'active')='active'
      and coalesce(m.community_access_type,'guild')<>'community' and lower(btrim(coalesce(m.role,''))) not in ('community_member','content_creator','vip')
    left join public.guild_members root on root.id=m.primary_member_id
    where not exists(select 1 from public.portal_guilds other where other.guild_code=g.guild_code and other.organization_id<>c.organization_id and other.is_active)
  ), grouped as(
    select case when bool_or(bad_root) then min(id::text)::uuid else root_id end as member_key,
      min(root_name) as member_name_snapshot,
      coalesce(min(guild_code) filter(where id=root_id),min(guild_code)) as guild_code_snapshot,
      array_agg(id order by id)||array[root_id] as owner_member_ids,
      count(*)::integer as linked_accounts,
      max(discord) filter(where discord ~ '^[0-9]{15,25}$') as discord_user_id,
      bool_or(bad_root) or count(distinct discord) filter(where discord is not null)>1 as bad
    from base group by root_id
  )
  select g.member_key,g.member_name_snapshot,g.guild_code_snapshot,
    case when g.bad then array[g.member_key] else g.owner_member_ids end,g.linked_accounts,g.discord_user_id,
    case when g.bad or (g.discord_user_id is not null and (select count(*) from grouped x where x.discord_user_id=g.discord_user_id)>1)
      then 'ambiguous_identity' when g.discord_user_id is null then 'missing_discord' else 'eligible' end
  from grouped g order by g.member_key;
$$;

create or replace function public._guild_survey_recipient_state(p_survey uuid)
returns table(recipient_id uuid,category text,signature jsonb)
language sql stable security definer set search_path=public,pg_temp as $$
  select r.id,
    case when response.recipient_id is not null then 'responded'
      when r.eligibility<>'eligible' then r.eligibility
      when m.id is null or coalesce(m.roster_status,'active')<>'active' or coalesce(m.community_access_type,'guild')='community' or lower(btrim(coalesce(m.role,''))) in ('community_member','content_creator','vip')
        or not exists(select 1 from public.portal_guilds g where g.guild_code=m.guild_code and g.organization_id=r.organization_id and g.is_active)
        or not exists(select 1 from public.portal_organizations o where o.id=r.organization_id and o.is_active)
        or exists(select 1 from public.portal_guilds other where other.guild_code=m.guild_code and other.organization_id<>r.organization_id and other.is_active)
        then 'outside_organization'
      when btrim(coalesce(m.discord_id,''))<>r.discord_user_id or m.primary_member_id is not null then 'identity_changed'
      when exists(select 1 from public.guild_survey_deliveries sd join public.guild_dm_recipients pending on pending.id=sd.dm_recipient_id
        where sd.recipient_id=r.id and pending.status in ('queued','sending')) then 'pending'
      when latest.status='failed' and (coalesce(latest.last_error,'') !~* '^HTTP 429([ : -]|$)' or latest.last_error ~* 'DELIVERY_UNCERTAIN') then 'permanent_or_uncertain_failure'
      when latest.status='cancelled' then 'cancelled'
      when latest.created_at>now()-interval '1 hour' then 'recent_invitation'
      when latest.status in ('sent','confirmed') or (latest.status='failed' and latest.last_error ~* '^HTTP 429([ : -]|$)') then 'eligible'
      else 'not_delivered' end,
    jsonb_build_object('member',r.member_key,'discord',m.discord_id,'guild',m.guild_code,'responseVersion',response.version,
      'delivery',latest.dm_id,'status',latest.status,'error',latest.last_error,'attempts',latest.send_attempts,'createdAt',latest.created_at)
  from public.guild_survey_recipients r
  left join public.guild_members m on m.id=r.member_key
  left join public.guild_survey_responses response on response.recipient_id=r.id
  left join lateral(select d.id as dm_id,d.status,d.last_error,d.send_attempts,w.created_at
    from public.guild_survey_deliveries sd join public.guild_survey_waves w on w.id=sd.wave_id
    join public.guild_dm_recipients d on d.id=sd.dm_recipient_id
    where sd.recipient_id=r.id order by w.created_at desc,w.id desc limit 1) latest on true
  where r.survey_id=p_survey order by r.id;
$$;

create or replace function public._guild_survey_preview(p_survey uuid,p_kind text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c public.guild_surveys%rowtype; rows jsonb; states jsonb; ready boolean;
begin
  select * into strict c from public.guild_surveys where id=p_survey;
  if not exists(select 1 from public.portal_organizations o where o.id=c.organization_id and o.is_active)
    or exists(select 1 from unnest(c.target_guild_ids) target where not exists(select 1 from public.portal_guilds g
      where g.id=target and g.organization_id=c.organization_id and g.is_active
      and not exists(select 1 from public.portal_guilds other where other.guild_code=g.guild_code and other.organization_id<>c.organization_id and other.is_active))) then
    raise exception 'Le perimetre de guildes est inactif ou ambigu. Actualisez le sondage.' using errcode='40001';
  end if;
  if p_kind='initial' then
    select coalesce(jsonb_agg(to_jsonb(r) order by r.member_key),'[]') into rows from public._guild_survey_roster(p_survey) r;
    states:=rows;
  else
    select coalesce(jsonb_agg(jsonb_build_object('recipient_id',r.id,'member_key',r.member_key,'member_name_snapshot',r.member_name_snapshot,
      'guild_code_snapshot',r.guild_code_snapshot,'linked_accounts',r.linked_accounts,'eligibility',s.category) order by r.id),'[]'),
      coalesce(jsonb_agg(to_jsonb(s) order by s.recipient_id),'[]') into rows,states
      from public.guild_survey_recipients r join public._guild_survey_recipient_state(p_survey) s on s.recipient_id=r.id;
  end if;
  select delivery_enabled into ready from public.guild_survey_settings where singleton;
  return jsonb_build_object('kind',p_kind,'recipients',rows,'participants',jsonb_array_length(rows),
    'accounts',coalesce((select sum((r->>'linked_accounts')::integer) from jsonb_array_elements(rows) r),0),
    'eligible',(select count(*) from jsonb_array_elements(rows) r where r->>'eligibility'='eligible'),
    'excluded',(select count(*) from jsonb_array_elements(rows) r where r->>'eligibility'<>'eligible'),
    'exclusions',coalesce((select jsonb_object_agg(category,n) from(select r->>'eligibility' as category,count(*) as n
      from jsonb_array_elements(rows) r where r->>'eligibility'<>'eligible' group by 1) counts),'{}'::jsonb),
    'deliveryReady',coalesce(ready,false),
    'fingerprint',md5(jsonb_build_object('campaign',to_jsonb(c),'states',states,'ready',ready)::text));
end $$;

create or replace function public._guild_survey_detail(p_survey uuid,p_rank integer)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('campaign',to_jsonb(c)||jsonb_build_object('effective_status',case when c.status='open' and c.deadline<=now() then 'closed' else c.status end,
    'can_manage',p_rank>=c.created_by_rank),
   'recipients',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('response',case when a.recipient_id is null then null else to_jsonb(a) end,
     'delivery_status',case when latest.sent_at is not null then 'sent' when latest.status is null then r.eligibility else latest.status end,
     'last_error',latest.last_error) order by r.guild_code_snapshot,r.member_name_snapshot,r.id)
     from public.guild_survey_recipients r left join public.guild_survey_responses a on a.recipient_id=r.id
     left join lateral(select d.status,d.last_error,d.sent_at from public.guild_survey_deliveries sd join public.guild_survey_waves w on w.id=sd.wave_id
       join public.guild_dm_recipients d on d.id=sd.dm_recipient_id where sd.recipient_id=r.id order by w.created_at desc,w.id desc limit 1) latest on true
     where r.survey_id=c.id),'[]'),
   'waves',coalesce((select jsonb_agg(to_jsonb(w) order by w.created_at) from public.guild_survey_waves w where w.survey_id=c.id),'[]'))
 from public.guild_surveys c where c.id=p_survey;
$$;

create or replace function public.guild_survey_request(p_actor uuid,p_action text,p_survey uuid default null,p_expected integer default null,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor jsonb; org uuid; rank integer; c public.guild_surveys%rowtype; r public.guild_survey_recipients%rowtype;
  old_response public.guild_survey_responses%rowtype; wave public.guild_survey_waves%rowtype;
  target_ids uuid[]; preview jsonb; rows jsonb; item jsonb; response_answers jsonb;
  request_id uuid; dm_campaign uuid; dm_recipient uuid; kind text; queued integer:=0; portal_url text;
begin
  actor:=public._guild_survey_actor(p_actor); org:=(actor->>'org')::uuid; rank:=(actor->>'rank')::integer;
  if p_action in ('mine','answer-form','answer') then
    if p_action='mine' then
      return jsonb_build_object('surveys',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'deadline',s.deadline,
        'status',case when s.status='open' and s.deadline<=now() then 'closed' else s.status end,'responded',a.recipient_id is not null)
        order by s.created_at desc) from public.guild_surveys s join public.guild_survey_recipients rr on rr.survey_id=s.id
        left join public.guild_survey_responses a on a.recipient_id=rr.id
        where s.status<>'draft' and (p_actor=any(rr.owner_member_ids) or rr.member_key=(actor->>'root')::uuid)),'[]'));
    end if;
    if p_action='answer' then select * into c from public.guild_surveys where id=p_survey for share;
    else select * into c from public.guild_surveys where id=p_survey; end if;
    if c.id is null or c.status='draft' then raise exception 'Sondage introuvable.' using errcode='P0002'; end if;
    select * into r from public.guild_survey_recipients rr where rr.survey_id=c.id
      and (p_actor=any(rr.owner_member_ids) or rr.member_key=(actor->>'root')::uuid);
    if r.id is null then raise exception 'Vous ne faites pas partie des destinataires.' using errcode='42501'; end if;
    if p_action='answer' then select * into r from public.guild_survey_recipients where id=r.id for update; end if;
    select * into old_response from public.guild_survey_responses where recipient_id=r.id;
    if p_action='answer-form' then
      return jsonb_build_object('campaign',jsonb_build_object('id',c.id,'title',c.title,'introduction',c.introduction,'questions',c.questions,
        'deadline',c.deadline,'status',case when c.status='open' and c.deadline<=now() then 'closed' else c.status end),
        'recipient',jsonb_build_object('name',r.member_name_snapshot,'guild',r.guild_code_snapshot),'response',to_jsonb(old_response));
    end if;
    if c.status<>'open' or c.deadline<=clock_timestamp() then raise exception 'Ce sondage est cloture.' using errcode='22023'; end if;
    if p_expected is distinct from coalesce(old_response.version,0) then raise exception 'Votre reponse a change. Actualisez.' using errcode='40001'; end if;
    response_answers:=public._guild_survey_answers(c.questions,p_payload->'answers');
    insert into public.guild_survey_responses(recipient_id,survey_id,organization_id,answers,version)
      values(r.id,c.id,c.organization_id,response_answers,coalesce(old_response.version,0)+1)
      on conflict(recipient_id) do update set answers=excluded.answers,version=excluded.version,updated_at=now();
    update public.guild_dm_recipients d set status='cancelled',last_error='Sondage deja renseigne.',updated_at=now()
      where d.status in ('queued','sending') and exists(select 1 from public.guild_survey_deliveries sd where sd.dm_recipient_id=d.id and sd.recipient_id=r.id);
    return jsonb_build_object('saved',true,'version',coalesce(old_response.version,0)+1);
  end if;

  if rank<1 or org is null then raise exception 'Acces Leader ou Admin requis.' using errcode='42501'; end if;
  if p_action='list' then
    return jsonb_build_object('guilds',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'guild_code',g.guild_code,'display_name',g.display_name,
      'active_members',(select count(*) from public.guild_members m where m.guild_code=g.guild_code and coalesce(m.roster_status,'active')='active' and coalesce(m.community_access_type,'guild')<>'community' and lower(btrim(coalesce(m.role,''))) not in ('community_member','content_creator','vip')))
      order by g.guild_code) from public.portal_guilds g where g.organization_id=org and g.is_active
      and not exists(select 1 from public.portal_guilds other where other.guild_code=g.guild_code and other.organization_id<>org and other.is_active)),'[]'),
      'deliveryReady',coalesce((select delivery_enabled from public.guild_survey_settings where singleton),false),
      'surveys',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('effective_status',case when s.status='open' and s.deadline<=now() then 'closed' else s.status end,
        'can_manage',rank>=s.created_by_rank,'recipients_count',(select count(*) from public.guild_survey_recipients rr where rr.survey_id=s.id),
        'responses_count',(select count(*) from public.guild_survey_responses a where a.survey_id=s.id)) order by s.created_at desc)
        from(select * from public.guild_surveys where organization_id=org order by created_at desc limit 100) s),'[]'));
  end if;
  if p_action='save' and p_survey is null then
    perform public._guild_survey_questions(p_payload->'questions');
    select array_agg(distinct x::uuid) into target_ids from jsonb_array_elements_text(p_payload->'target_guild_ids') x;
    if cardinality(target_ids) is null or cardinality(target_ids)=0 or exists(select 1 from unnest(target_ids) target
      where not exists(select 1 from public.portal_guilds g where g.id=target and g.organization_id=org and g.is_active)) then
      raise exception 'Guildes non autorisees.' using errcode='42501'; end if;
    if nullif(p_payload->>'deadline','')::timestamptz<=now() then raise exception 'La date limite doit etre future.' using errcode='22023'; end if;
    insert into public.guild_surveys(organization_id,created_by_member_id,created_by_name,created_by_rank,title,introduction,questions,target_guild_ids,deadline)
      values(org,p_actor,coalesce(actor->>'name','Responsable'),rank,btrim(p_payload->>'title'),coalesce(p_payload->>'introduction',''),p_payload->'questions',target_ids,nullif(p_payload->>'deadline','')::timestamptz)
      returning * into c;
    return public._guild_survey_detail(c.id,rank);
  end if;
  if p_action in ('detail','preview','reminder-preview') then
    select * into c from public.guild_surveys where id=p_survey and organization_id=org;
  else select * into c from public.guild_surveys where id=p_survey and organization_id=org for update nowait; end if;
  if c.id is null then raise exception 'Sondage introuvable.' using errcode='P0002'; end if;
  if p_action='detail' then return public._guild_survey_detail(c.id,rank); end if;
  if rank<c.created_by_rank then raise exception 'Un Admin ne peut pas administrer le sondage d''un Leader.' using errcode='42501'; end if;
  if p_action='save' then
    if c.status<>'draft' then raise exception 'Les questions publiees sont figees.' using errcode='22023'; end if;
    if p_expected is distinct from c.revision then raise exception 'Le brouillon a change. Actualisez.' using errcode='40001'; end if;
    perform public._guild_survey_questions(p_payload->'questions');
    select array_agg(distinct x::uuid) into target_ids from jsonb_array_elements_text(p_payload->'target_guild_ids') x;
    if cardinality(target_ids) is null or cardinality(target_ids)=0 or exists(select 1 from unnest(target_ids) target
      where not exists(select 1 from public.portal_guilds g where g.id=target and g.organization_id=org and g.is_active)) then
      raise exception 'Guildes non autorisees.' using errcode='42501'; end if;
    if nullif(p_payload->>'deadline','')::timestamptz<=now() then raise exception 'La date limite doit etre future.' using errcode='22023'; end if;
    update public.guild_surveys set title=btrim(p_payload->>'title'),introduction=coalesce(p_payload->>'introduction',''),questions=p_payload->'questions',
      target_guild_ids=target_ids,deadline=nullif(p_payload->>'deadline','')::timestamptz,revision=revision+1,updated_at=now() where id=c.id;
    return public._guild_survey_detail(c.id,rank);
  end if;
  if p_action in ('preview','reminder-preview') then
    if (p_action='preview' and c.status<>'draft') or (p_action='reminder-preview' and (c.status<>'open' or c.deadline<=now())) then
      raise exception 'Etat du sondage incompatible.' using errcode='22023'; end if;
    return public._guild_survey_preview(c.id,case when p_action='preview' then 'initial' else 'reminder' end);
  end if;
  if p_action='close' then
    if p_payload->>'confirmed' is distinct from 'true' then raise exception 'Confirmation requise.' using errcode='22023'; end if;
    if c.status='draft' then raise exception 'Un brouillon ne peut pas etre cloture.' using errcode='22023'; end if;
    update public.guild_surveys set status='closed',closed_at=coalesce(closed_at,now()),updated_at=now() where id=c.id;
    update public.guild_dm_campaigns d set status='cancelled',updated_at=now()
      where exists(select 1 from public.guild_survey_waves w where w.dm_campaign_id=d.id and w.survey_id=c.id);
    update public.guild_dm_recipients d set status='cancelled',last_error='Sondage cloture.',updated_at=now()
      where d.status in ('queued','sending') and exists(select 1 from public.guild_survey_deliveries sd where sd.dm_recipient_id=d.id and sd.survey_id=c.id);
    return public._guild_survey_detail(c.id,rank);
  end if;
  if p_action not in ('publish','remind') then raise exception 'Action inconnue.' using errcode='22023'; end if;
  if p_payload->>'confirmed' is distinct from 'true' then raise exception 'Confirmation explicite requise.' using errcode='22023'; end if;
  request_id:=(p_payload->>'requestId')::uuid;
  if request_id is null then raise exception 'Identifiant de confirmation requis.' using errcode='22023'; end if;
  select * into wave from public.guild_survey_waves where id=request_id;
  kind:=case when p_action='publish' then 'initial' else 'reminder' end;
  if wave.id is not null then
    if wave.survey_id<>c.id or wave.organization_id<>org or wave.created_by_member_id<>p_actor or wave.kind<>kind then
      raise exception 'Confirmation deja utilisee.' using errcode='42501'; end if;
    return jsonb_build_object('queued',(select count(*) from public.guild_survey_deliveries where wave_id=wave.id),'idempotent',true,'surveyId',c.id);
  end if;
  if not coalesce((select delivery_enabled from public.guild_survey_settings where singleton),false) then
    raise exception 'Envoi indisponible : adaptation du worker non activee.' using errcode='22023'; end if;
  if (kind='initial' and c.status<>'draft') or (kind='reminder' and c.status<>'open') or c.deadline<=clock_timestamp() then
    raise exception 'Etat du sondage incompatible.' using errcode='22023'; end if;
  if exists(select 1 from unnest(c.target_guild_ids) target where not exists(select 1 from public.portal_guilds g
    where g.id=target and g.organization_id=org and g.is_active)) then raise exception 'Le perimetre de guildes a change.' using errcode='40001'; end if;
  preview:=public._guild_survey_preview(c.id,kind);
  if p_payload->>'fingerprint' is distinct from preview->>'fingerprint' then raise exception 'Les destinataires ont change. Refaire la previsualisation.' using errcode='40001'; end if;
  if kind='initial' then
    if (preview->>'participants')::integer=0 then raise exception 'Aucun participant actif.' using errcode='22023'; end if;
    insert into public.guild_survey_recipients(survey_id,organization_id,member_id,member_key,owner_member_ids,member_name_snapshot,guild_code_snapshot,linked_accounts,discord_user_id,eligibility)
      select c.id,org,rr.member_key,rr.member_key,rr.owner_member_ids,rr.member_name_snapshot,rr.guild_code_snapshot,rr.linked_accounts,rr.discord_user_id,rr.eligibility
      from public._guild_survey_roster(c.id) rr;
    update public.guild_surveys set status='open',published_at=now(),updated_at=now(),revision=revision+1 where id=c.id;
  elsif (preview->>'eligible')::integer=0 then raise exception 'Aucun non-repondant eligible.' using errcode='22023'; end if;
  select public_portal_url into portal_url from public.guild_survey_settings where singleton;
  if (preview->>'eligible')::integer>0 then
    insert into public.guild_dm_campaigns(organization_id,created_by_member_id,created_by_name,message,target_guild_codes,status,total_recipients,
      interaction_type,interaction_payload,is_test)
      values(org,p_actor,coalesce(actor->>'name','Responsable'),left('Sondage : '||c.title,200)||E'\n\n'||portal_url||'?guildSurvey='||c.id::text||
        E'\n\nConnectez-vous au portail pour repondre. Vous pouvez modifier votre reponse tant que le sondage est ouvert.',
        array(select guild_code from public.portal_guilds where id=any(c.target_guild_ids) and organization_id=org),
        'queued',(preview->>'eligible')::integer,'none',jsonb_build_object('kind','guild_survey_v1','surveyId',c.id,'waveId',request_id),false)
      returning id into dm_campaign;
  end if;
  insert into public.guild_survey_waves(id,survey_id,organization_id,kind,created_by_member_id,fingerprint,dm_campaign_id)
    values(request_id,c.id,org,kind,p_actor,preview->>'fingerprint',dm_campaign);
  for r in select rr.* from public.guild_survey_recipients rr where rr.survey_id=c.id and
    ((kind='initial' and rr.eligibility='eligible') or (kind='reminder' and exists(select 1 from public._guild_survey_recipient_state(c.id) s where s.recipient_id=rr.id and s.category='eligible'))) loop
    insert into public.guild_dm_recipients(campaign_id,organization_id,member_id,guild_code,member_name_snapshot,discord_user_id,status)
      values(dm_campaign,org,r.member_key,r.guild_code_snapshot,r.member_name_snapshot,r.discord_user_id,'queued') returning id into dm_recipient;
    insert into public.guild_survey_deliveries(wave_id,recipient_id,survey_id,organization_id,dm_recipient_id)
      values(request_id,r.id,c.id,org,dm_recipient);
    queued:=queued+1;
  end loop;
  return jsonb_build_object('queued',queued,'idempotent',false,'surveyId',c.id);
end $$;

create or replace function public.authorize_guild_survey_delivery(p_dm_recipient uuid,p_discord_user_id text)
returns jsonb language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare d public.guild_dm_recipients%rowtype; r public.guild_survey_recipients%rowtype; c public.guild_surveys%rowtype; m public.guild_members%rowtype; w public.guild_survey_waves%rowtype;
begin
  select * into d from public.guild_dm_recipients where id=p_dm_recipient;
  select rr.* into r from public.guild_survey_recipients rr join public.guild_survey_deliveries sd on sd.recipient_id=rr.id where sd.dm_recipient_id=d.id;
  select ww.* into w from public.guild_survey_waves ww join public.guild_survey_deliveries sd on sd.wave_id=ww.id where sd.dm_recipient_id=d.id;
  select * into c from public.guild_surveys where id=r.survey_id;
  select * into m from public.guild_members where id=r.member_key;
  if r.id is null or w.id is null or d.organization_id is distinct from c.organization_id or w.organization_id is distinct from c.organization_id
    or d.campaign_id is distinct from w.dm_campaign_id or d.member_id is distinct from r.member_key
    or c.status<>'open' or c.deadline<=clock_timestamp() or not coalesce((select delivery_enabled from public.guild_survey_settings where singleton),false)
    or r.eligibility<>'eligible' or d.status not in ('queued','sending') or d.send_attempts>5 or d.sent_at is not null
    or exists(select 1 from public.guild_survey_responses where recipient_id=r.id)
    or d.discord_user_id is distinct from r.discord_user_id or p_discord_user_id is distinct from r.discord_user_id
    or m.id is null or m.primary_member_id is not null or btrim(coalesce(m.discord_id,''))<>r.discord_user_id
    or coalesce(m.roster_status,'active')<>'active' or coalesce(m.community_access_type,'guild')='community' or lower(btrim(coalesce(m.role,''))) in ('community_member','content_creator','vip')
    or not exists(select 1 from public.portal_guilds g where g.guild_code=m.guild_code and g.organization_id=c.organization_id and g.is_active)
    or not exists(select 1 from public.portal_organizations o where o.id=c.organization_id and o.is_active)
    or exists(select 1 from public.portal_guilds other where other.guild_code=m.guild_code and other.organization_id<>c.organization_id and other.is_active)
    or not exists(select 1 from public.guild_dm_campaigns dc where dc.id=d.campaign_id and dc.organization_id=c.organization_id
      and dc.interaction_type='none' and dc.interaction_payload->>'kind'='guild_survey_v1'
      and dc.interaction_payload->>'surveyId'=c.id::text and dc.interaction_payload->>'waveId'=w.id::text
      and dc.status in ('queued','sending','partial')) then
    raise exception 'Livraison de sondage non autorisee (reponse, cloture ou identite modifiee).' using errcode='42501';
  end if;
  update public.guild_survey_deliveries set authorized_at=clock_timestamp() where dm_recipient_id=d.id;
  return jsonb_build_object('authorized',true,'surveyId',c.id,'waveId',w.id);
end $$;

create or replace function public.guard_guild_survey_delivery()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare sd public.guild_survey_deliveries%rowtype; answer_exists boolean; c public.guild_surveys%rowtype;
begin
  select * into sd from public.guild_survey_deliveries where dm_recipient_id=old.id;
  if sd.id is null then if tg_op='DELETE' then return old; else return new; end if; end if;
  if tg_op='DELETE' then raise exception 'Historique de sondage conserve.' using errcode='42501'; end if;
  if new.status='sending' and old.status='queued' and (sd.authorized_at is null or sd.authorized_at<clock_timestamp()-interval '30 seconds') then
    raise exception 'Worker de sondage non autorise ou autorisation expiree.' using errcode='42501'; end if;
  if row(new.campaign_id,new.organization_id,new.member_id,new.discord_user_id,new.guild_code,new.member_name_snapshot)
    is distinct from row(old.campaign_id,old.organization_id,old.member_id,old.discord_user_id,old.guild_code,old.member_name_snapshot) then
    raise exception 'Identite de livraison immuable.' using errcode='42501'; end if;
  if new.status='queued' and old.status not in ('queued','sending') then
    raise exception 'Utilisez la previsualisation des relances du sondage.' using errcode='42501'; end if;
  select * into c from public.guild_surveys where id=sd.survey_id;
  select exists(select 1 from public.guild_survey_responses where recipient_id=sd.recipient_id) into answer_exists;
  if (answer_exists or c.status<>'open' or c.deadline<=clock_timestamp() or old.status='cancelled')
    and new.status in ('queued','sending','sent','failed') then new.status:='cancelled'; end if;
  if new.status='queued' and new.send_attempts>=5 then new.status:='failed'; new.last_error:='HTTP 429 : budget de tentatives epuise.'; end if;
  if old.sent_at is not null then
    new.sent_at:=old.sent_at; new.discord_message_id:=old.discord_message_id;
    if new.status in ('queued','sending') then raise exception 'Invitation deja transmise.' using errcode='42501'; end if;
  end if;
  insert into public.guild_survey_delivery_events(delivery_id,old_state,new_state) values(sd.id,to_jsonb(old),to_jsonb(new));
  return new;
end $$;
drop trigger if exists guild_survey_delivery_guard on public.guild_dm_recipients;
create trigger guild_survey_delivery_guard before update or delete on public.guild_dm_recipients
  for each row execute function public.guard_guild_survey_delivery();

create or replace function public.guard_guild_survey_dm_campaign()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.guild_surveys%rowtype;
begin
  select s.* into c from public.guild_surveys s join public.guild_survey_waves w on w.survey_id=s.id where w.dm_campaign_id=old.id;
  if c.id is null then if tg_op='DELETE' then return old; else return new; end if; end if;
  if tg_op='DELETE' then raise exception 'Historique de sondage conserve.' using errcode='42501'; end if;
  if row(new.organization_id,new.message,new.interaction_type,new.interaction_payload,new.target_guild_codes,new.is_test)
    is distinct from row(old.organization_id,old.message,old.interaction_type,old.interaction_payload,old.target_guild_codes,old.is_test) then
    raise exception 'Campagne technique du sondage immuable.' using errcode='42501'; end if;
  if c.status<>'open' or c.deadline<=clock_timestamp() then new.status:='cancelled'; end if;
  return new;
end $$;
drop trigger if exists guild_survey_dm_campaign_guard on public.guild_dm_campaigns;
create trigger guild_survey_dm_campaign_guard before update or delete on public.guild_dm_campaigns
  for each row execute function public.guard_guild_survey_dm_campaign();

do $$ declare t text; f record; begin
  foreach t in array array['guild_survey_settings','guild_surveys','guild_survey_recipients','guild_survey_responses','guild_survey_waves','guild_survey_deliveries','guild_survey_delivery_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
  end loop;
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (p.proname like '\_guild\_survey\_%' escape '\' or p.proname in
      ('guild_survey_request','authorize_guild_survey_delivery','guard_guild_survey_delivery','guard_guild_survey_dm_campaign')) loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  end loop;
end $$;
grant execute on function public.guild_survey_request(uuid,text,uuid,integer,jsonb) to service_role;
grant execute on function public.authorize_guild_survey_delivery(uuid,text) to service_role;
commit;
