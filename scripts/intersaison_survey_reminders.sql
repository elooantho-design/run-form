-- Additive follow-up after intersaison_survey_accounts.sql. No backfill or enqueue.
begin;

-- Keep immutable org/account keys strict. A worker must still be able to record
-- a terminal failure after the account has left the organization's roster.
create or replace function public.guard_guild_dm_account_identity()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.guild_dm_campaigns%rowtype; validate_membership boolean;
begin
  select * into strict c from public.guild_dm_campaigns where id=new.campaign_id;
  if new.organization_id<>c.organization_id then raise exception 'Recipient organization mismatch.'; end if;
  if tg_op='UPDATE' and (new.campaign_id<>old.campaign_id or new.account_member_key is distinct from old.account_member_key
    or (old.account_member_key is not null and new.member_id is not null and new.member_id<>old.account_member_key)) then
    raise exception 'Recipient account identity is immutable.';
  end if;
  if c.interaction_type='intersaison_choice' then
    if tg_op='INSERT' then new.account_member_key:=new.member_id; end if;
    if new.account_member_key is null or not exists(select 1 from public.portal_organizations
      where id=new.organization_id and organization_key in ('paladin','paladin_cluster')) then
      raise exception 'Paladin account identity required.';
    end if;
    validate_membership:=tg_op='INSERT' or new.status in ('queued','sending','sent');
    if tg_op='UPDATE' then
      validate_membership:=validate_membership or new.member_id is distinct from old.member_id
        or new.discord_user_id is distinct from old.discord_user_id;
    end if;
    if validate_membership and (not exists(select 1 from public.portal_organizations where id=new.organization_id and is_active)
      or (new.member_id is not null and not exists(select 1 from public.guild_members m
        join public.portal_guilds g on g.guild_code=m.guild_code where m.id=new.member_id
          and g.organization_id=new.organization_id and g.is_active and g.guild_code in ('G1','G2','G3','G4','G5','G6','G7')))) then
      raise exception 'Account outside campaign organization.';
    end if;
  elsif new.account_member_key is not null then raise exception 'Classic campaigns must retain Discord identity uniqueness.';
  end if;
  return new;
end $$;

create table if not exists public.intersaison_survey_reminder_batches (
  id uuid primary key,
  organization_id uuid not null references public.portal_organizations(id),
  survey_campaign_id uuid not null references public.intersaison_survey_campaigns(id),
  actor_member_id uuid not null,
  actor_snapshot jsonb not null,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{32}$'),
  queued_count integer not null check (queued_count >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.intersaison_survey_delivery_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.portal_organizations(id),
  survey_campaign_id uuid not null,
  survey_recipient_id uuid not null,
  dm_recipient_id uuid not null,
  reminder_count integer not null check (reminder_count >= 0),
  old_snapshot jsonb not null,
  new_snapshot jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists intersaison_survey_delivery_events_recipient_idx
  on public.intersaison_survey_delivery_events(dm_recipient_id,created_at,id);

-- Events deliberately have no S/C/D FKs: the worker holds D while this BEFORE
-- trigger runs; FK KEY SHARE on S/C would deadlock with existing C/S -> D RPCs.
-- Plain MVCC reads validate insert scope without locking those parent rows.
create or replace function public.guard_intersaison_reminder_record()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.intersaison_survey_campaigns%rowtype; s public.intersaison_survey_recipients%rowtype;
begin
  if tg_op <> 'INSERT' then raise exception 'Reminder history is append-only.'; end if;
  select * into strict c from public.intersaison_survey_campaigns where id=new.survey_campaign_id;
  if c.organization_id<>new.organization_id or c.poll_number<>2 or c.is_test
    or not exists(select 1 from public.intersaison_survey_seasons where id=c.season_id and organization_id=new.organization_id)
    or not exists(select 1 from public.portal_organizations where id=new.organization_id and is_active
      and organization_key in ('paladin','paladin_cluster'))
    or not exists(select 1 from public.guild_dm_campaigns where id=c.guild_dm_campaign_id
      and organization_id=new.organization_id and not is_test and interaction_type='intersaison_choice') then
    raise exception 'Reminder history campaign/organization mismatch.';
  end if;
  if tg_table_name='intersaison_survey_delivery_events' then
    select * into strict s from public.intersaison_survey_recipients where id=new.survey_recipient_id;
    if s.organization_id<>new.organization_id or s.survey_campaign_id<>c.id
      or s.guild_dm_recipient_id is distinct from new.dm_recipient_id
      or not exists(select 1 from public.guild_dm_recipients where id=new.dm_recipient_id
        and organization_id=new.organization_id and campaign_id=c.guild_dm_campaign_id) then
      raise exception 'Reminder history recipient/organization mismatch.';
    end if;
  elsif new.actor_snapshot->>'id' is distinct from new.actor_member_id::text then
    raise exception 'Reminder actor snapshot mismatch.';
  end if;
  return new;
end $$;

drop trigger if exists intersaison_reminder_batch_guard on public.intersaison_survey_reminder_batches;
create trigger intersaison_reminder_batch_guard before insert or update or delete
  on public.intersaison_survey_reminder_batches for each row execute function public.guard_intersaison_reminder_record();
drop trigger if exists intersaison_delivery_event_guard on public.intersaison_survey_delivery_events;
create trigger intersaison_delivery_event_guard before insert or update or delete
  on public.intersaison_survey_delivery_events for each row execute function public.guard_intersaison_reminder_record();
drop trigger if exists intersaison_reminder_batch_no_truncate on public.intersaison_survey_reminder_batches;
create trigger intersaison_reminder_batch_no_truncate before truncate
  on public.intersaison_survey_reminder_batches for each statement execute function public.guard_intersaison_reminder_record();
drop trigger if exists intersaison_delivery_event_no_truncate on public.intersaison_survey_delivery_events;
create trigger intersaison_delivery_event_no_truncate before truncate
  on public.intersaison_survey_delivery_events for each statement execute function public.guard_intersaison_reminder_record();

create or replace function public.audit_intersaison_survey_two_delivery()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.intersaison_survey_recipients%rowtype; c public.intersaison_survey_campaigns%rowtype;
  answer_at timestamptz; delivered jsonb;
begin
  -- Never affect poll 1, acknowledgements or technical tests, including unlinked DMs.
  select sc.* into c from public.intersaison_survey_campaigns sc
    join public.guild_dm_campaigns dc on dc.id=sc.guild_dm_campaign_id and dc.organization_id=sc.organization_id
    where sc.guild_dm_campaign_id=old.campaign_id and sc.organization_id=old.organization_id
      and sc.poll_number=2 and not sc.is_test and not dc.is_test and dc.interaction_type='intersaison_choice';
  if not found then return new; end if;
  select * into s from public.intersaison_survey_recipients where guild_dm_recipient_id=old.id;
  if s.id is null or s.survey_campaign_id<>c.id or s.organization_id<>c.organization_id
    or new.organization_id<>c.organization_id or new.campaign_id<>c.guild_dm_campaign_id then
    raise exception 'Official poll 2 delivery scope mismatch.';
  end if;
  select min(responded_at) into answer_at from public.intersaison_survey_responses
    where survey_recipient_id=s.id and survey_campaign_id=c.id and organization_id=c.organization_id
      and poll_number=2 and is_current;
  if old.status='confirmed' or old.confirmed_at is not null or s.responded_at is not null
    or s.response_status='responded' or answer_at is not null then
    new.status:='confirmed';
    new.confirmed_at:=coalesce(old.confirmed_at,s.responded_at,answer_at,new.confirmed_at,now());
  end if;
  -- Record the actual new Discord ID after the confirmation guard, before restoring
  -- the initial ID on the live row. These snapshots contain delivery data, not answers.
  delivered:=to_jsonb(new);
  if row(old.status,old.reminder_count,old.send_attempts,old.discord_message_id,old.last_error,
      old.sent_at,old.last_sent_at,old.last_attempt_at,old.confirmed_at)
    is distinct from row(new.status,new.reminder_count,new.send_attempts,new.discord_message_id,new.last_error,
      new.sent_at,new.last_sent_at,new.last_attempt_at,new.confirmed_at) then
    insert into public.intersaison_survey_delivery_events(organization_id,survey_campaign_id,survey_recipient_id,
      dm_recipient_id,reminder_count,old_snapshot,new_snapshot)
      values(c.organization_id,c.id,s.id,old.id,new.reminder_count,to_jsonb(old),delivered);
  end if;
  if old.discord_message_id is not null then new.discord_message_id:=old.discord_message_id; end if;
  return new;
end $$;
drop trigger if exists intersaison_survey_two_delivery_audit on public.guild_dm_recipients;
create trigger intersaison_survey_two_delivery_audit before update on public.guild_dm_recipients
  for each row execute function public.audit_intersaison_survey_two_delivery();

-- One classification implementation for both the preview and the locked queue.
-- Every survey recipient is included, even when its org/link/identity is corrupt.
create or replace function public.intersaison_survey_two_reminder_state(p_org uuid,p_campaign uuid)
returns table(recipient_id uuid,dm_recipient_id uuid,category text,signature jsonb)
language sql stable security definer set search_path=public,pg_temp as $$
  with source as (
    select s, d, m, c,
      public.intersaison_choice_account_identity(p_org,coalesce(s.member_key,s.member_id)) as identity,
      exists(select 1 from public.intersaison_survey_responses x where x.survey_recipient_id=s.id
        and x.survey_campaign_id=s.survey_campaign_id and x.organization_id=p_org and x.poll_number=2 and x.is_current) as answered,
      exists(select 1 from public.guild_members mm join public.portal_guilds g on g.guild_code=mm.guild_code
        join public.portal_organizations o on o.id=g.organization_id
        where mm.id=coalesce(s.member_key,s.member_id) and g.organization_id=p_org and g.is_active and o.is_active
          and o.organization_key in ('paladin','paladin_cluster') and mm.guild_code in ('G1','G2','G3','G4','G5','G6','G7')
          and lower(coalesce(mm.roster_status,'active'))='active' and lower(coalesce(mm.community_access_type,''))<>'community') as active
    from public.intersaison_survey_recipients s
    join public.intersaison_survey_campaigns c on c.id=s.survey_campaign_id
    left join public.guild_dm_recipients d on d.id=s.guild_dm_recipient_id
    left join public.guild_members m on m.id=coalesce(s.member_key,s.member_id)
    where s.survey_campaign_id=p_campaign
  )
  select (s).id,(d).id,
    case
      when (s).responded_at is not null or (s).response_status='responded' or answered then 'responded'
      when (s).delivery_status in ('excluded_duplicate','missing_invalid','not_included','cancelled') or (d).status='cancelled' then 'excluded'
      when (d).status in ('queued','sending') then 'pending'
      when (d).status='failed' or (s).delivery_status='failed'
        or nullif(btrim((d).last_error),'') is not null or nullif(btrim((s).last_error),'') is not null then 'failed'
      when not active then 'inactive'
      when (s).organization_id<>p_org or (s).member_id is null
        or (s).member_id is distinct from coalesce((s).member_key,(s).member_id)
        or not coalesce((identity->>'eligible')::boolean,false)
        or (d).id is null or (d).organization_id<>p_org or (d).campaign_id is distinct from (c).guild_dm_campaign_id
        or (d).account_member_key is distinct from (s).member_id or (d).member_id is distinct from (s).member_id
        or (s).discord_user_id is distinct from (d).discord_user_id
        or (d).discord_user_id is distinct from identity->>'discordId'
        or coalesce((d).discord_user_id,'') !~ '^[0-9]{15,22}$'
        or (d).confirmed_at is not null or (d).status='confirmed' or (s).delivery_status='confirmed' then 'invalid'
      when (d).status='sent' and (d).sent_at is not null and nullif(btrim((d).discord_message_id),'') is not null then 'eligible'
      else 'invalid'
    end,
    jsonb_build_object('survey',to_jsonb(s)-array['updated_at','last_reminder_at'],
      'dm',to_jsonb(d)-array['updated_at','last_attempt_at','last_sent_at'],
      'identity',identity,'member',jsonb_build_array((m).id,(m).primary_member_id,(m).discord_id,(m).guild_code,
        (m).roster_status,(m).community_access_type),'answered',answered)
  from source order by (s).id;
$$;

create or replace function public.preview_intersaison_survey_two_reminders(p_org uuid,p_actor uuid,p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp set timezone='UTC' as $$
declare c public.intersaison_survey_campaigns%rowtype; season public.intersaison_survey_seasons%rowtype;
  dc public.guild_dm_campaigns%rowtype; blockers text[]:='{}'; counts jsonb; fingerprint text; states jsonb;
begin
  perform public.assert_intersaison_survey_choice_admin(p_org,p_actor);
  select * into strict c from public.intersaison_survey_campaigns where id=p_campaign and organization_id=p_org;
  select * into season from public.intersaison_survey_seasons where id=c.season_id and organization_id=p_org;
  select * into dc from public.guild_dm_campaigns where id=c.guild_dm_campaign_id and organization_id=p_org;
  if c.poll_number<>2 or c.is_test or c.status<>'open' then blockers:=array_append(blockers,'Sondage 2 officiel ouvert requis.'); end if;
  if season.id is null or season.status='finished' or not exists(select 1 from public.intersaison_survey_seasons
    where id=season.id and organization_id=p_org and status<>'finished') then
    blockers:=array_append(blockers,'Saison courante non terminee requise.'); end if;
  if dc.id is null or dc.is_test or dc.interaction_type<>'intersaison_choice' or dc.status='cancelled' then
    blockers:=array_append(blockers,'Campagne Discord officielle incoherente ou annulee.'); end if;
  select jsonb_build_object('total',count(*),'nonRespondents',count(*) filter(where category<>'responded'),
      'eligible',count(*) filter(where category='eligible'),'responded',count(*) filter(where category='responded'),
      'pending',count(*) filter(where category='pending'),'excluded',count(*) filter(where category='excluded'),
      'failed',count(*) filter(where category='failed'),'invalid',count(*) filter(where category='invalid'),
      'inactive',count(*) filter(where category='inactive')),
    coalesce(jsonb_agg(jsonb_build_array(recipient_id,category,signature) order by recipient_id),'[]'::jsonb)
    into counts,states from public.intersaison_survey_two_reminder_state(p_org,p_campaign);
  if exists(select 1 from public.guild_dm_recipients where campaign_id=c.guild_dm_campaign_id and status in ('queued','sending')) then
    blockers:=array_append(blockers,'Une vague est deja en attente ou en cours.'); end if;
  -- Content, IDs and versions, not just counts: an edited answer invalidates consent.
  fingerprint:=md5(jsonb_build_object('campaign',to_jsonb(c)-'updated_at','season',to_jsonb(season)-'updated_at',
    'dmCampaign',to_jsonb(dc)-array['updated_at','sent_count','confirmed_count','failed_count','sent_at'],
    'recipients',states,'allDmRecipients',(select coalesce(jsonb_agg(to_jsonb(d)-array['updated_at','last_attempt_at','last_sent_at'] order by d.id),'[]')
      from public.guild_dm_recipients d where d.campaign_id=c.guild_dm_campaign_id),
    'responses',(select coalesce(jsonb_agg(to_jsonb(x)-'created_at' order by x.id),'[]')
      from public.intersaison_survey_responses x where x.survey_campaign_id=c.id
        or x.survey_recipient_id in (select id from public.intersaison_survey_recipients where survey_campaign_id=c.id)))::text);
  return jsonb_build_object('campaignId',c.id,'fingerprint',fingerprint,
    'canQueue',cardinality(blockers)=0 and (counts->>'eligible')::integer>0,'counts',counts,
    'scopeGuilds',jsonb_build_array('G1','G2','G3','G4','G5','G6','G7'),'blockers',to_jsonb(blockers));
end $$;

-- Unlike the old JS read/compute/write, this cannot overwrite a newer queue
-- with stale counters. Do not lock recipients here (queue locks them first).
create or replace function public.refresh_intersaison_choice_delivery_counters(p_campaign uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.guild_dm_campaigns%rowtype; n record;
begin
  select * into strict c from public.guild_dm_campaigns where id=p_campaign for update;
  if c.interaction_type<>'intersaison_choice'
    or not exists(select 1 from public.portal_organizations where id=c.organization_id and is_active
      and organization_key in ('paladin','paladin_cluster'))
    or not exists(select 1 from public.intersaison_survey_campaigns s
      join public.intersaison_survey_seasons season on season.id=s.season_id and season.organization_id=s.organization_id
      where s.guild_dm_campaign_id=c.id and s.organization_id=c.organization_id and s.poll_number=2 and s.is_test=c.is_test)
    or exists(select 1 from public.guild_dm_recipients where campaign_id=c.id and organization_id<>c.organization_id) then
    raise exception 'Campagne choice ou organisation incoherente.';
  end if;
  select count(*)::integer as total,
    count(*) filter(where status in ('sent','confirmed') or sent_at is not null)::integer as sent,
    count(*) filter(where status='confirmed' or confirmed_at is not null)::integer as confirmed,
    count(*) filter(where status='failed')::integer as failed,
    count(*) filter(where status='queued')::integer as queued,
    count(*) filter(where status='sending')::integer as sending,min(sent_at) as first_sent
    into n from public.guild_dm_recipients where campaign_id=c.id and organization_id=c.organization_id;
  update public.guild_dm_campaigns set total_recipients=n.total,sent_count=n.sent,confirmed_count=n.confirmed,failed_count=n.failed,
    sent_at=coalesce(c.sent_at,n.first_sent),updated_at=now(),status=case
      when c.status='cancelled' then 'cancelled' when n.sending>0 then 'sending' when n.queued>0 then 'queued'
      when n.failed>0 then 'partial' else 'completed' end where id=c.id;
end $$;

-- The cumulative send_attempts is historical; only this wave's durable claims
-- consume its 429 retry budget. This read does not authorize another send.
create or replace function public.intersaison_choice_delivery_attempts(p_dm_recipient uuid,p_reminder integer)
returns integer language plpgsql stable security definer set search_path=public,pg_temp as $$
declare d public.guild_dm_recipients%rowtype; s public.intersaison_survey_recipients%rowtype;
  c public.intersaison_survey_campaigns%rowtype; identity jsonb; attempts integer;
begin
  select * into d from public.guild_dm_recipients where id=p_dm_recipient;
  select * into s from public.intersaison_survey_recipients where guild_dm_recipient_id=d.id;
  select * into c from public.intersaison_survey_campaigns where id=s.survey_campaign_id;
  identity:=public.intersaison_choice_account_identity(d.organization_id,coalesce(s.member_key,s.member_id));
  if d.id is null or s.id is null or c.id is null or p_reminder is null or p_reminder<=0
    or d.reminder_count<>p_reminder or c.poll_number<>2 or c.is_test
    or s.organization_id<>d.organization_id or c.organization_id<>d.organization_id
    or c.guild_dm_campaign_id is distinct from d.campaign_id
    or s.member_id is null or s.member_id is distinct from coalesce(s.member_key,s.member_id)
    or d.account_member_key is distinct from s.member_id or d.member_id is distinct from s.member_id
    or s.discord_user_id is distinct from d.discord_user_id or d.discord_user_id is distinct from identity->>'discordId'
    or coalesce(d.discord_user_id,'') !~ '^[0-9]{15,22}$' or not coalesce((identity->>'eligible')::boolean,false)
    or not exists(select 1 from public.intersaison_survey_seasons where id=c.season_id and organization_id=c.organization_id)
    or not exists(select 1 from public.guild_dm_campaigns where id=d.campaign_id and organization_id=c.organization_id
      and not is_test and interaction_type='intersaison_choice') then
    raise exception 'Compte, organisation, campagne ou sequence de rappel non autorise.' using errcode='42501';
  end if;
  select count(*)::integer into attempts from public.intersaison_survey_delivery_events e
    where e.dm_recipient_id=d.id and e.survey_recipient_id=s.id and e.survey_campaign_id=c.id and e.organization_id=c.organization_id
      and e.reminder_count=p_reminder and e.old_snapshot->>'reminder_count'=p_reminder::text
      and e.new_snapshot->>'reminder_count'=p_reminder::text
      and e.old_snapshot->>'status'='queued' and e.new_snapshot->>'status'='sending'
      and e.new_snapshot->'send_attempts' is distinct from e.old_snapshot->'send_attempts';
  return attempts;
end $$;

create or replace function public.queue_intersaison_survey_two_reminders(
  p_org uuid,p_actor uuid,p_campaign uuid,p_fingerprint text,p_request uuid,p_confirmed boolean
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.intersaison_survey_campaigns%rowtype; batch public.intersaison_survey_reminder_batches%rowtype;
  preview jsonb; r record; n integer:=0; actor jsonb;
begin
  perform public.assert_intersaison_survey_choice_admin(p_org,p_actor);
  if p_request is null then raise exception 'Request ID requis.'; end if;
  -- Serialize request keys globally, including conflicting actors/campaigns/orgs.
  perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
  select * into batch from public.intersaison_survey_reminder_batches where id=p_request;
  if found then
    if batch.organization_id<>p_org or batch.actor_member_id<>p_actor or batch.survey_campaign_id<>p_campaign then
      raise exception 'Request ID deja utilise par une autre organisation, campagne ou acteur.';
    end if;
    return jsonb_build_object('queuedCount',batch.queued_count,'batchId',batch.id,'alreadyQueued',true);
  end if;
  if p_confirmed is distinct from true then raise exception 'Confirmation explicite requise apres previsualisation.'; end if;
  select * into strict c from public.intersaison_survey_campaigns where id=p_campaign and organization_id=p_org;
  perform 1 from public.intersaison_survey_seasons where id=c.season_id and organization_id=p_org for update;
  perform 1 from public.intersaison_survey_campaigns where id=c.id for update;
  perform 1 from public.intersaison_survey_recipients where survey_campaign_id=c.id order by id for update;
  perform 1 from public.guild_dm_recipients where campaign_id=c.guild_dm_campaign_id or id in
    (select guild_dm_recipient_id from public.intersaison_survey_recipients where survey_campaign_id=c.id) order by id for update;
  perform 1 from public.guild_dm_campaigns where id=c.guild_dm_campaign_id for update;
  -- The existing linked-account trigger locks secondary -> principal, not UUID
  -- order. Never wait here while holding C/S/D, even for guild/org reference rows.
  begin
    perform 1 from public.guild_members m where m.id in
      (select gm.id from public.guild_members gm join public.portal_guilds g on g.guild_code=gm.guild_code where g.organization_id=p_org)
      or m.id in (select coalesce(member_key,member_id) from public.intersaison_survey_recipients where survey_campaign_id=c.id)
      or m.id in (select gm.primary_member_id from public.guild_members gm join public.intersaison_survey_recipients s
        on gm.id=coalesce(s.member_key,s.member_id) where s.survey_campaign_id=c.id)
      order by m.id for share nowait;
    perform 1 from public.portal_guilds where organization_id=p_org or guild_code in ('G1','G2','G3','G4','G5','G6','G7') order by id for share nowait;
    perform 1 from public.portal_organizations where id=p_org for share nowait;
  exception when lock_not_available then
    raise exception 'Effectifs ou organisation en cours de modification : actualiser la previsualisation avant confirmation.' using errcode='55P03';
  end;
  preview:=public.preview_intersaison_survey_two_reminders(p_org,p_actor,p_campaign);
  if p_fingerprint is distinct from preview->>'fingerprint' then
    raise exception 'Etat ou reponse modifie : actualiser la previsualisation avant confirmation.';
  end if;
  if not (preview->>'canQueue')::boolean then raise exception 'Relance impossible : %',preview->'blockers'; end if;
  for r in select * from public.intersaison_survey_two_reminder_state(p_org,p_campaign)
    where category='eligible' order by recipient_id loop
    update public.guild_dm_recipients set status='queued',reminder_count=reminder_count+1 where id=r.dm_recipient_id;
    update public.intersaison_survey_recipients set delivery_status='queued',reminder_count=reminder_count+1,
      last_reminder_at=now() where id=r.recipient_id;
    n:=n+1;
  end loop;
  update public.guild_dm_campaigns set status='queued' where id=c.guild_dm_campaign_id and organization_id=p_org;
  select jsonb_build_object('id',id,'name',watcher_name,'guildCode',guild_code,'role',role) into actor from public.guild_members where id=p_actor;
  insert into public.intersaison_survey_reminder_batches(id,organization_id,survey_campaign_id,actor_member_id,actor_snapshot,fingerprint,queued_count)
    values(p_request,p_org,p_campaign,p_actor,actor,p_fingerprint,n);
  return jsonb_build_object('queuedCount',n,'batchId',p_request,'alreadyQueued',false);
end $$;

-- Keep the exact installed implementation for poll 1, but make it private. A
-- second migration run must not rename the wrapper over that implementation.
do $$ begin
  if to_regprocedure('public.queue_intersaison_survey_reminders_legacy_private(uuid,uuid,uuid,uuid)') is null then
    alter function public.queue_intersaison_survey_reminders(uuid,uuid,uuid,uuid)
      rename to queue_intersaison_survey_reminders_legacy_private;
  end if;
end $$;
create or replace function public.queue_intersaison_survey_reminders(p_org uuid,p_actor uuid,p_campaign uuid,p_recipient uuid default null)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare poll integer;
begin
  perform public.assert_intersaison_survey_choice_admin(p_org,p_actor);
  select poll_number into strict poll from public.intersaison_survey_campaigns where id=p_campaign and organization_id=p_org;
  if poll=2 then raise exception 'Sondage 2 : previsualisation puis confirmation via queue_intersaison_survey_two_reminders requises.'; end if;
  return public.queue_intersaison_survey_reminders_legacy_private(p_org,p_actor,p_campaign,p_recipient);
end $$;

alter table public.intersaison_survey_reminder_batches enable row level security;
alter table public.intersaison_survey_delivery_events enable row level security;
revoke all on public.intersaison_survey_reminder_batches,public.intersaison_survey_delivery_events from public,anon,authenticated,service_role;
grant select on public.intersaison_survey_reminder_batches,public.intersaison_survey_delivery_events to service_role;
drop policy if exists intersaison_reminder_batches_service_read on public.intersaison_survey_reminder_batches;
create policy intersaison_reminder_batches_service_read on public.intersaison_survey_reminder_batches for select to service_role using(true);
drop policy if exists intersaison_delivery_events_service_read on public.intersaison_survey_delivery_events;
create policy intersaison_delivery_events_service_read on public.intersaison_survey_delivery_events for select to service_role using(true);

do $$ declare signature text; begin
  foreach signature in array array['guard_intersaison_reminder_record()','audit_intersaison_survey_two_delivery()',
    'intersaison_survey_two_reminder_state(uuid,uuid)','preview_intersaison_survey_two_reminders(uuid,uuid,uuid)',
    'queue_intersaison_survey_two_reminders(uuid,uuid,uuid,text,uuid,boolean)',
    'refresh_intersaison_choice_delivery_counters(uuid)','intersaison_choice_delivery_attempts(uuid,integer)',
    'queue_intersaison_survey_reminders(uuid,uuid,uuid,uuid)','queue_intersaison_survey_reminders_legacy_private(uuid,uuid,uuid,uuid)'] loop
    execute 'revoke all on function public.'||signature||' from public,anon,authenticated,service_role';
  end loop;
end $$;
grant execute on function public.preview_intersaison_survey_two_reminders(uuid,uuid,uuid) to service_role;
grant execute on function public.queue_intersaison_survey_two_reminders(uuid,uuid,uuid,text,uuid,boolean) to service_role;
grant execute on function public.refresh_intersaison_choice_delivery_counters(uuid) to service_role;
grant execute on function public.intersaison_choice_delivery_attempts(uuid,integer) to service_role;
grant execute on function public.queue_intersaison_survey_reminders(uuid,uuid,uuid,uuid) to service_role;
commit;
