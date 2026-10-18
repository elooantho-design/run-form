-- Follow-up only. Run after intersaison_survey_choices.sql, after explicit approval.
-- Does not enqueue, resend, publish objectives, close campaigns or change responses.
begin;

do $$ begin
  if exists (select 1 from public.guild_dm_recipients d join public.guild_dm_campaigns c on c.id=d.campaign_id
    where c.interaction_type='intersaison_choice' and (d.member_id is null or exists (
      select 1 from public.intersaison_survey_recipients r where r.guild_dm_recipient_id=d.id
        and (r.member_id is distinct from d.member_id or r.organization_id<>d.organization_id)))) then
    raise exception 'Account-scoped recipient identity mismatch; audit before migration.';
  end if;
  if exists (select 1 from public.intersaison_survey_recipients where guild_dm_recipient_id is not null
    group by guild_dm_recipient_id having count(*)>1) then raise exception 'A DM recipient is shared by multiple survey accounts.'; end if;
end $$;

alter table public.guild_dm_recipients add column if not exists account_member_key uuid;
-- Immutable account identity, including when the mutable member FK is later cleared.
update public.guild_dm_recipients d set account_member_key=d.member_id
  from public.guild_dm_campaigns c where c.id=d.campaign_id and c.interaction_type='intersaison_choice'
    and d.account_member_key is null;
drop index if exists public.guild_dm_recipients_campaign_discord_uidx;
create unique index if not exists guild_dm_recipients_legacy_discord_uidx
  on public.guild_dm_recipients(campaign_id,discord_user_id) where account_member_key is null;
create unique index if not exists guild_dm_recipients_campaign_account_uidx
  on public.guild_dm_recipients(campaign_id,account_member_key) where account_member_key is not null;
create unique index if not exists intersaison_survey_recipient_dm_uidx
  on public.intersaison_survey_recipients(guild_dm_recipient_id) where guild_dm_recipient_id is not null;

create or replace function public.guard_guild_dm_account_identity()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_campaign public.guild_dm_campaigns%rowtype;
begin
  select * into strict v_campaign from public.guild_dm_campaigns where id=new.campaign_id;
  if new.organization_id<>v_campaign.organization_id then raise exception 'Recipient organization mismatch.'; end if;
  if tg_op='UPDATE' and (new.campaign_id<>old.campaign_id or new.account_member_key is distinct from old.account_member_key
    or (old.account_member_key is not null and new.member_id is not null and new.member_id<>old.account_member_key)) then
    raise exception 'Recipient account identity is immutable.';
  end if;
  if v_campaign.interaction_type='intersaison_choice' then
    if tg_op='INSERT' then new.account_member_key:=new.member_id; end if;
    if new.account_member_key is null or not exists (select 1 from public.portal_organizations
      where id=new.organization_id and is_active and organization_key in ('paladin','paladin_cluster')) then
      raise exception 'Paladin account identity required.';
    end if;
    if new.member_id is not null and not exists(select 1 from public.guild_members m join public.portal_guilds g on g.guild_code=m.guild_code
      where m.id=new.member_id and g.organization_id=new.organization_id and g.is_active
        and g.guild_code in ('G1','G2','G3','G4','G5','G6','G7')) then raise exception 'Account outside campaign organization.';end if;
  elsif new.account_member_key is not null then raise exception 'Classic campaigns must retain Discord identity uniqueness.';
  end if;
  return new;
end $$;
drop trigger if exists guild_dm_account_identity_guard on public.guild_dm_recipients;
create trigger guild_dm_account_identity_guard before insert or update on public.guild_dm_recipients
  for each row execute function public.guard_guild_dm_account_identity();

create or replace function public.intersaison_choice_account_identity(p_org uuid,p_member uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare m public.guild_members%rowtype; root public.guild_members%rowtype; d text; reason text; family jsonb;
begin
  select * into m from public.guild_members where id=p_member;
  if m.id is null or not exists (select 1 from public.portal_guilds g join public.portal_organizations o on o.id=g.organization_id
    where g.guild_code=m.guild_code and g.organization_id=p_org and g.is_active and o.is_active
      and o.organization_key in ('paladin','paladin_cluster') and g.guild_code in ('G1','G2','G3','G4','G5','G6','G7'))
    or exists (select 1 from public.portal_guilds where guild_code=m.guild_code and organization_id<>p_org and is_active)
    or lower(coalesce(m.roster_status,'active'))<>'active' or lower(coalesce(m.community_access_type,''))='community' then
    return jsonb_build_object('eligible',false,'reason','Compte hors des effectifs actifs Paladin.','discordId','');
  end if;
  select * into root from public.guild_members where id=coalesce(m.primary_member_id,m.id);
  if root.id is null or root.primary_member_id is not null or exists (select 1 from public.portal_guilds
    where guild_code=root.guild_code and organization_id<>p_org and is_active) or not exists (select 1 from public.portal_guilds
    where guild_code=root.guild_code and organization_id=p_org and is_active
      and guild_code in ('G1','G2','G3','G4','G5','G6','G7')) then
    return jsonb_build_object('eligible',false,'reason','Rattachement principal absent, cyclique ou hors organisation.',
      'discordId','','accountName',m.watcher_name,'guildCode',m.guild_code,'linkedAccounts','[]'::jsonb);
  end if;
  d:=btrim(coalesce(root.discord_id,''));
  if reason is null and d !~ '^[0-9]{15,22}$' then reason:='ID Discord du propriétaire absent ou invalide.'; end if;
  if reason is null and m.primary_member_id is not null and btrim(coalesce(m.discord_id,'')) not in ('',d) then
    reason:='Discord ID du secondaire différent de celui du principal. Corriger le rattachement.';
  end if;
  if reason is null and exists (
    select 1 from public.guild_members x left join public.guild_members px on px.id=x.primary_member_id
    join public.portal_guilds g on g.guild_code=x.guild_code and g.organization_id=p_org and g.is_active
    where x.guild_code in ('G1','G2','G3','G4','G5','G6','G7')
      and lower(coalesce(x.roster_status,'active'))='active' and lower(coalesce(x.community_access_type,''))<>'community'
      and (btrim(coalesce(x.discord_id,''))=d or btrim(coalesce(px.discord_id,''))=d)
      and (coalesce(x.primary_member_id,x.id)<>root.id or px.primary_member_id is not null
        or (x.primary_member_id is not null and btrim(coalesce(x.discord_id,'')) not in ('',d)))
  ) then reason:='Discord ID partagé par des comptes sans rattachement commun vérifié. Corriger dans Gestion guilde.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('memberId',x.id,'name',x.watcher_name,'guildCode',x.guild_code) order by x.id),'[]')
    into family from public.guild_members x join public.portal_guilds g on g.guild_code=x.guild_code and g.organization_id=p_org and g.is_active
    where x.id=root.id or x.primary_member_id=root.id;
  return jsonb_build_object('eligible',reason is null,'reason',coalesce(reason,'Rattachement vérifié.'),'discordId',d,
    'primaryMemberId',root.id,'primaryName',root.watcher_name,'accountName',m.watcher_name,'guildCode',m.guild_code,'linkedAccounts',family);
end $$;

create or replace function public.preview_intersaison_survey_two(p_org uuid,p_season uuid,p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_version public.intersaison_survey_objective_versions%rowtype; blockers text[]:='{}'; counts jsonb; fingerprint text; complete boolean;
begin
  perform public.assert_intersaison_survey_choice_admin(p_org,p_actor);
  if not exists(select 1 from public.intersaison_survey_seasons where id=p_season and organization_id=p_org and status<>'finished') then
    raise exception 'Inter-saison active introuvable.'; end if;
  select * into v_version from public.intersaison_survey_objective_versions where organization_id=p_org and season_id=p_season
    and purpose='next' order by version_number desc limit 1;
  select count(*)=7 and count(*) filter(where btrim(objective_text,E' \t\n\r')<>'')=7 into complete
    from public.intersaison_survey_objective_items where version_id=v_version.id;
  if not complete or v_version.status is distinct from 'validated' then blockers:=array_append(blockers,'Les sept objectifs doivent être enregistrés et validés.'); end if;
  if not exists(select 1 from public.intersaison_survey_campaigns where season_id=p_season and organization_id=p_org
    and poll_number=1 and not is_test and status='closed') or exists(select 1 from public.intersaison_survey_campaigns
    where season_id=p_season and organization_id=p_org and poll_number=1 and not is_test and status in ('open','preparing')) then
    blockers:=array_append(blockers,'Clôture d’abord le sondage n° 1, sans clôturer l’inter-saison.'); end if;
  if exists(select 1 from public.intersaison_survey_campaigns where season_id=p_season and organization_id=p_org
    and poll_number=2 and not is_test and status<>'cancelled') then blockers:=array_append(blockers,'Un sondage n° 2 officiel existe déjà pour cette saison.'); end if;
  with identities as (select r.*,public.intersaison_choice_account_identity(p_org,r.id) as identity
    from public.intersaison_survey_choice_roster(p_org) r)
  select jsonb_build_object('total',count(*),
    'missing',count(*) filter(where identity->>'discordId' !~ '^[0-9]{15,22}$'),
    'duplicates',count(*) filter(where identity->>'discordId' ~ '^[0-9]{15,22}$' and not (identity->>'eligible')::boolean),
    'distinctDiscordIds',count(distinct identity->>'discordId') filter(where identity->>'discordId' ~ '^[0-9]{15,22}$'),
    'duplicateDiscordIds',count(distinct identity->>'discordId') filter(where identity->>'discordId' ~ '^[0-9]{15,22}$' and not (identity->>'eligible')::boolean),
    'eligible',count(*) filter(where (identity->>'eligible')::boolean)),
    md5(coalesce(jsonb_agg(jsonb_build_array(id,watcher_name,guild_code,identity) order by id)::text,'[]')) into counts,fingerprint from identities;
  if (counts->>'eligible')::integer=0 then blockers:=array_append(blockers,'Aucun destinataire Discord éligible.'); end if;
  return jsonb_build_object('versionId',v_version.id,'versionNumber',v_version.version_number,'canTest',complete,
    'counts',counts,'rosterFingerprint',fingerprint,'canLaunch',cardinality(blockers)=0,'blockers',to_jsonb(blockers));
end $$;

create or replace function public.enqueue_intersaison_survey_members(p_campaign uuid,p_members uuid[])
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.intersaison_survey_campaigns%rowtype; m record; identity jsonb; d text; state text; err text; dm uuid;
  added integer:=0; queued integer:=0; existing integer:=0;
begin
  select * into strict c from public.intersaison_survey_campaigns where id=p_campaign;
  if c.status<>'open' then raise exception 'Ce sondage n’est plus ouvert.'; end if;
  if (select count(*) from public.intersaison_survey_choice_roster(c.organization_id) where id=any(p_members))
    <>(select count(distinct x) from unnest(p_members) x) then raise exception 'Sélection hors des effectifs actifs Paladin.' using errcode='42501'; end if;
  for m in select * from public.intersaison_survey_choice_roster(c.organization_id) where id=any(p_members) order by id loop
    if exists(select 1 from public.intersaison_survey_recipients where survey_campaign_id=p_campaign and (member_id=m.id or member_key=m.id)) then
      existing:=existing+1; continue; end if;
    state:='queued';err:=null;dm:=null;d:=m.discord_id;
    if c.poll_number=2 then
      identity:=public.intersaison_choice_account_identity(c.organization_id,m.id);d:=identity->>'discordId';
      if not (identity->>'eligible')::boolean then
        state:=case when d ~ '^[0-9]{15,22}$' then 'excluded_duplicate' else 'missing_invalid' end;err:=identity->>'reason';end if;
    elsif d !~ '^[0-9]{15,22}$' then state:='missing_invalid';err:='ID Discord absent ou invalide.';
    elsif (not c.is_test and m.occurrences>1) or exists(select 1 from public.guild_dm_recipients where campaign_id=c.guild_dm_campaign_id and discord_user_id=d) then
      state:='excluded_duplicate';err:='ID Discord partagé ou déjà ciblé dans cette campagne.';
    end if;
    if state='queued' then
      insert into public.guild_dm_recipients(campaign_id,organization_id,member_id,guild_code,member_name_snapshot,discord_user_id,status)
        values(c.guild_dm_campaign_id,c.organization_id,m.id,m.guild_code,coalesce(nullif(m.watcher_name,''),'Joueur'),d,'queued') returning id into dm;
      queued:=queued+1;
    end if;
    insert into public.intersaison_survey_recipients(survey_campaign_id,organization_id,member_id,member_key,guild_code_snapshot,member_name_snapshot,
      discord_user_id,guild_dm_recipient_id,delivery_status,last_error) values(p_campaign,c.organization_id,m.id,m.id,m.guild_code,
        coalesce(nullif(m.watcher_name,''),'Joueur'),d,dm,state,err);added:=added+1;
  end loop;
  if added>0 then update public.guild_dm_campaigns set status=case when queued>0 then 'queued' else status end,
    total_recipients=(select count(*) from public.guild_dm_recipients where campaign_id=c.guild_dm_campaign_id),
    missing_discord_count=(select count(*) from public.intersaison_survey_recipients where survey_campaign_id=p_campaign
      and delivery_status in ('missing_invalid','excluded_duplicate')),updated_at=now() where id=c.guild_dm_campaign_id and organization_id=c.organization_id;end if;
  return jsonb_build_object('addedCount',added,'queuedCount',queued,'alreadyIncludedCount',existing);
end $$;

create or replace function public.inspect_intersaison_choice_recipient(p_org uuid,p_actor uuid,p_recipient uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare r public.intersaison_survey_recipients%rowtype;c public.intersaison_survey_campaigns%rowtype;d public.guild_dm_recipients%rowtype;
 identity jsonb;blocker text;fingerprint text;
begin
  perform public.assert_intersaison_survey_choice_admin(p_org,p_actor);
  select * into strict r from public.intersaison_survey_recipients where id=p_recipient and organization_id=p_org;
  select * into strict c from public.intersaison_survey_campaigns where id=r.survey_campaign_id and organization_id=p_org and poll_number=2 and not is_test;
  select * into d from public.guild_dm_recipients where id=r.guild_dm_recipient_id and organization_id=p_org and campaign_id=c.guild_dm_campaign_id;
  identity:=public.intersaison_choice_account_identity(p_org,coalesce(r.member_key,r.member_id));
  if c.status<>'open' or not exists(select 1 from public.intersaison_survey_seasons where id=c.season_id and organization_id=p_org and status<>'finished') then blocker:='Sondage fermé.';
  elsif r.member_id is null or coalesce(r.member_key,r.member_id)<>r.member_id then blocker:='Compte logique incohérent ou supprimé.';
  elsif r.responded_at is not null or r.response_status='responded' or exists(select 1 from public.intersaison_survey_responses where survey_recipient_id=r.id and is_current) then blocker:='Ce compte a déjà répondu.';
  elsif not (identity->>'eligible')::boolean then blocker:=identity->>'reason';
  elsif r.guild_dm_recipient_id is not null and d.id is null then blocker:='Destinataire Discord incohérent.';
  elsif d.id is not null and d.account_member_key is distinct from r.member_id then blocker:='Le destinataire Discord appartient à un autre compte de jeu.';
  elsif d.sent_at is not null or d.discord_message_id is not null or d.confirmed_at is not null or d.status in ('sent','confirmed') then blocker:='Ce compte a déjà reçu son message. Utiliser uniquement un rappel explicite.';
  elsif d.status in ('queued','sending') then blocker:='Ce compte est déjà en file ou en cours d’envoi.';
  elsif d.send_attempts>=5 then blocker:='Limite de cinq tentatives atteinte. Audit technique nécessaire.';
  elsif coalesce(d.last_error,'') like '%DELIVERY_UNCERTAIN%' then blocker:='Envoi incertain : vérifier le MP, ne pas renvoyer.';
  end if;
  fingerprint:=md5(jsonb_build_array(r.id,identity,d.id,d.status,d.send_attempts,d.last_error)::text);
  return (identity-'discordId') || jsonb_build_object('canRetry',blocker is null,'blockReason',blocker,
    'fingerprint',fingerprint,'lastError',coalesce(d.last_error,r.last_error,''),'sendAttempts',coalesce(d.send_attempts,0));
end $$;

create or replace function public.requeue_intersaison_choice_recipient(p_org uuid,p_actor uuid,p_recipient uuid,p_fingerprint text,p_confirmed boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.intersaison_survey_recipients%rowtype;c public.intersaison_survey_campaigns%rowtype;identity jsonb;inspection jsonb;dm uuid;
begin
  perform public.assert_intersaison_survey_choice_admin(p_org,p_actor);
  if p_confirmed is distinct from true then raise exception 'Confirmation individuelle requise.';end if;
  select * into strict r from public.intersaison_survey_recipients where id=p_recipient and organization_id=p_org;
  select * into strict c from public.intersaison_survey_campaigns where id=r.survey_campaign_id and organization_id=p_org and poll_number=2 and not is_test;
  perform 1 from public.intersaison_survey_seasons where id=c.season_id and organization_id=p_org for update;
  perform 1 from public.intersaison_survey_campaigns where id=c.id for update;
  select * into strict r from public.intersaison_survey_recipients where id=p_recipient for update;
  perform 1 from public.guild_dm_recipients where id=r.guild_dm_recipient_id for update;
  perform 1 from public.guild_members m join public.portal_guilds g on g.guild_code=m.guild_code
    where g.organization_id=p_org and g.is_active for share of m,g;
  inspection:=public.inspect_intersaison_choice_recipient(p_org,p_actor,p_recipient);
  if not (inspection->>'canRetry')::boolean then raise exception '%',inspection->>'blockReason';end if;
  if p_fingerprint is distinct from inspection->>'fingerprint' then raise exception 'Rattachement ou statut modifié. Vérifier à nouveau.';end if;
  identity:=public.intersaison_choice_account_identity(p_org,coalesce(r.member_key,r.member_id));
  dm:=r.guild_dm_recipient_id;
  if dm is null then
    insert into public.guild_dm_recipients(campaign_id,organization_id,member_id,guild_code,member_name_snapshot,discord_user_id,status)
      values(c.guild_dm_campaign_id,p_org,r.member_id,r.guild_code_snapshot,r.member_name_snapshot,identity->>'discordId','queued') returning id into dm;
  else
    update public.guild_dm_recipients set status='queued',discord_user_id=identity->>'discordId',last_error=null,updated_at=now() where id=dm;
  end if;
  update public.intersaison_survey_recipients set guild_dm_recipient_id=dm,discord_user_id=identity->>'discordId',delivery_status='queued',last_error=null,updated_at=now() where id=r.id;
  update public.guild_dm_campaigns set status='queued',total_recipients=(select count(*) from public.guild_dm_recipients where campaign_id=c.guild_dm_campaign_id),
    missing_discord_count=(select count(*) from public.intersaison_survey_recipients where survey_campaign_id=c.id
      and delivery_status in ('missing_invalid','excluded_duplicate')),updated_at=now() where id=c.guild_dm_campaign_id;
  return jsonb_build_object('queuedCount',1,'recipientId',r.id);
end $$;

create or replace function public.check_intersaison_choice_delivery(p_dm_recipient uuid)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare d public.guild_dm_recipients%rowtype;r public.intersaison_survey_recipients%rowtype;c public.intersaison_survey_campaigns%rowtype;identity jsonb;
begin
  select * into strict d from public.guild_dm_recipients where id=p_dm_recipient;
  select * into strict r from public.intersaison_survey_recipients where guild_dm_recipient_id=d.id;
  select * into strict c from public.intersaison_survey_campaigns where id=r.survey_campaign_id;
  identity:=public.intersaison_choice_account_identity(c.organization_id,coalesce(r.member_key,r.member_id));
  if c.poll_number<>2 or c.status<>'open' or not exists(select 1 from public.intersaison_survey_seasons where id=c.season_id and status<>'finished')
    or c.organization_id<>r.organization_id or c.organization_id<>d.organization_id or c.guild_dm_campaign_id<>d.campaign_id
    or r.member_id is distinct from d.account_member_key or r.discord_user_id is distinct from d.discord_user_id
    or d.discord_user_id is distinct from identity->>'discordId' or not (identity->>'eligible')::boolean
    or r.responded_at is not null or d.status<>'sending' or (d.reminder_count=0 and (d.sent_at is not null or d.discord_message_id is not null))
    or exists(select 1 from public.intersaison_survey_responses where survey_recipient_id=r.id and is_current)
    or not exists(select 1 from public.guild_dm_campaigns where id=d.campaign_id and interaction_type='intersaison_choice' and is_test=c.is_test
      and status in ('queued','sending','partial')) then raise exception 'Compte, propriétaire, campagne ou statut non autorisé pour cet envoi.';end if;
  return true;
end $$;

create or replace function public.guard_intersaison_choice_response_account()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.intersaison_survey_recipients%rowtype;d public.guild_dm_recipients%rowtype;identity jsonb;
begin
  if new.poll_number<>2 then return new;end if;
  select * into strict r from public.intersaison_survey_recipients where id=new.survey_recipient_id;
  select * into strict d from public.guild_dm_recipients where id=r.guild_dm_recipient_id;
  identity:=public.intersaison_choice_account_identity(new.organization_id,coalesce(r.member_key,r.member_id));
  if new.survey_campaign_id<>r.survey_campaign_id or new.organization_id<>r.organization_id or new.organization_id<>d.organization_id
    or new.member_id is distinct from r.member_id or new.member_id is distinct from d.account_member_key
    or new.discord_user_id is distinct from d.discord_user_id or new.discord_user_id is distinct from identity->>'discordId'
    or not (identity->>'eligible')::boolean then raise exception 'Réponse non autorisée pour ce compte de jeu.' using errcode='42501';end if;
  return new;
end $$;
drop trigger if exists intersaison_choice_response_account on public.intersaison_survey_responses;
create trigger intersaison_choice_response_account before insert on public.intersaison_survey_responses
  for each row execute function public.guard_intersaison_choice_response_account();

-- Failed survey-2 deliveries require the individual recovery confirmation, not a bulk reminder.
create or replace function public.queue_intersaison_survey_reminders(p_org uuid,p_actor uuid,p_campaign uuid,p_recipient uuid default null)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.intersaison_survey_campaigns%rowtype;r record;n integer:=0;
begin
  perform public.assert_intersaison_survey_choice_admin(p_org,p_actor);
  select * into strict c from public.intersaison_survey_campaigns where id=p_campaign and organization_id=p_org;
  perform 1 from public.intersaison_survey_seasons where id=c.season_id and organization_id=p_org and status<>'finished' for update;
  if not found then raise exception 'Inter-saison clôturée.';end if;
  select * into strict c from public.intersaison_survey_campaigns where id=p_campaign for update;
  if c.status<>'open' or c.is_test then raise exception 'Relance réservée à un sondage officiel ouvert.';end if;
  for r in select s.id,s.guild_dm_recipient_id from public.intersaison_survey_recipients s
    join public.guild_dm_recipients d on d.id=s.guild_dm_recipient_id and d.organization_id=p_org and d.campaign_id=c.guild_dm_campaign_id
    where s.survey_campaign_id=p_campaign and s.organization_id=p_org and (p_recipient is null or s.id=p_recipient)
      and s.responded_at is null and s.response_status<>'responded' and d.status in ('sent','failed')
      and not exists(select 1 from public.intersaison_survey_responses x where x.survey_recipient_id=s.id and x.is_current)
      and (c.poll_number<>2 or (d.status='sent' and d.sent_at is not null and d.account_member_key=s.member_id
        and d.discord_user_id=s.discord_user_id and (public.intersaison_choice_account_identity(p_org,s.member_id)->>'eligible')::boolean
        and d.discord_user_id=public.intersaison_choice_account_identity(p_org,s.member_id)->>'discordId'))
    order by s.id for update of s,d loop
    update public.guild_dm_recipients set status='queued',reminder_count=reminder_count+1,last_error=null where id=r.guild_dm_recipient_id;
    update public.intersaison_survey_recipients set delivery_status='queued',reminder_count=reminder_count+1,last_reminder_at=now(),last_error=null where id=r.id;
    n:=n+1;
  end loop;
  if n>0 then update public.guild_dm_campaigns set status='queued' where id=c.guild_dm_campaign_id;end if;
  return n;
end $$;

do $$ declare signature text;begin
  foreach signature in array array['guard_guild_dm_account_identity()','intersaison_choice_account_identity(uuid,uuid)',
    'inspect_intersaison_choice_recipient(uuid,uuid,uuid)','requeue_intersaison_choice_recipient(uuid,uuid,uuid,text,boolean)',
    'check_intersaison_choice_delivery(uuid)','guard_intersaison_choice_response_account()'] loop
    execute 'revoke all on function public.'||signature||' from public,anon,authenticated,service_role';end loop;
end $$;
grant execute on function public.inspect_intersaison_choice_recipient(uuid,uuid,uuid) to service_role;
grant execute on function public.requeue_intersaison_choice_recipient(uuid,uuid,uuid,text,boolean) to service_role;
grant execute on function public.check_intersaison_choice_delivery(uuid) to service_role;
commit;
