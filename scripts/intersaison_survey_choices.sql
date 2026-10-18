begin;

alter table public.intersaison_survey_campaigns
  add column if not exists objective_version_id uuid references public.intersaison_survey_objective_versions(id),
  add column if not exists objective_snapshot jsonb not null default '{}'::jsonb;
alter table public.intersaison_survey_recipients add column if not exists member_key uuid;
alter table public.intersaison_survey_responses add column if not exists discord_interaction_id text;
create unique index if not exists intersaison_survey_response_interaction_uidx
  on public.intersaison_survey_responses(discord_interaction_id) where discord_interaction_id is not null;

create table if not exists public.intersaison_survey_placements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  season_id uuid not null,
  member_key uuid not null,
  member_id uuid references public.guild_members(id) on delete set null,
  member_name_snapshot text not null,
  action text not null check (action in ('set','remove')),
  guild_code text,
  revision integer not null check (revision > 0),
  actor_member_id uuid references public.guild_members(id) on delete set null,
  actor_name text not null,
  created_at timestamptz not null default now(),
  constraint intersaison_placement_season_org_fk foreign key (season_id, organization_id)
    references public.intersaison_survey_seasons(id, organization_id),
  constraint intersaison_placement_guild_org_fk foreign key (organization_id, guild_code)
    references public.portal_guilds(organization_id, guild_code),
  constraint intersaison_placement_action_check check (
    (action = 'set' and guild_code in ('G1','G2','G3','G4','G5','G6','G7') and guild_code is not null)
    or (action = 'remove' and guild_code is null)
  ),
  unique (season_id, member_key, revision)
);
create index if not exists intersaison_survey_placements_scope_idx
  on public.intersaison_survey_placements(organization_id, season_id, member_key, revision desc);
alter table public.intersaison_survey_placements enable row level security;
revoke all on public.intersaison_survey_placements from public, anon, authenticated, service_role;
grant select on public.intersaison_survey_placements to service_role;
drop policy if exists intersaison_placements_service_read on public.intersaison_survey_placements;
create policy intersaison_placements_service_read on public.intersaison_survey_placements
  for select to service_role using (true);

create or replace function public.assert_intersaison_survey_choice_admin(p_org uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_intersaison_objectives_admin(p_org, p_actor);
  if (select count(*) from public.portal_guilds where organization_id = p_org and is_active
    and guild_code in ('G1','G2','G3','G4','G5','G6','G7')) <> 7 then
    raise exception 'Les sept guildes Paladin actives sont requises.';
  end if;
  -- guild_members has a guild code, not an organization FK: ambiguity must fail closed.
  if exists (select 1 from public.portal_guilds where organization_id <> p_org and is_active
    and guild_code in ('G1','G2','G3','G4','G5','G6','G7')) then
    raise exception 'Code de guilde ambigu entre organisations.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.intersaison_survey_choice_roster(p_org uuid)
returns table(id uuid, watcher_name text, guild_code text, discord_id text, occurrences bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select m.id, m.watcher_name::text, m.guild_code::text, btrim(coalesce(m.discord_id,''))::text,
    count(*) over (partition by btrim(coalesce(m.discord_id,'')))
  from public.guild_members m
  join public.portal_guilds g on g.guild_code = m.guild_code and g.organization_id = p_org and g.is_active
  where m.guild_code in ('G1','G2','G3','G4','G5','G6','G7')
    and lower(coalesce(m.roster_status,'active')) = 'active'
    and lower(coalesce(m.community_access_type,'')) <> 'community';
$$;

create or replace function public.preview_intersaison_survey_two(p_org uuid, p_season uuid, p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_version public.intersaison_survey_objective_versions%rowtype;
  v_blockers text[] := '{}'; v_counts jsonb; v_fingerprint text; v_complete boolean;
begin
  perform public.assert_intersaison_survey_choice_admin(p_org, p_actor);
  if not exists (select 1 from public.intersaison_survey_seasons where id = p_season
    and organization_id = p_org and status <> 'finished') then raise exception 'Inter-saison active introuvable.'; end if;
  select * into v_version from public.intersaison_survey_objective_versions
    where organization_id = p_org and season_id = p_season and purpose = 'next' order by version_number desc limit 1;
  select count(*) = 7 and count(*) filter (where btrim(objective_text,E' \t\n\r') <> '') = 7 into v_complete
    from public.intersaison_survey_objective_items where version_id = v_version.id;
  if not v_complete or v_version.status is distinct from 'validated' then
    v_blockers := array_append(v_blockers,'Les sept objectifs doivent être enregistrés et validés.');
  end if;
  if not exists (select 1 from public.intersaison_survey_campaigns where season_id = p_season
    and organization_id = p_org and poll_number = 1 and not is_test and status = 'closed')
    or exists (select 1 from public.intersaison_survey_campaigns where season_id = p_season
    and organization_id = p_org and poll_number = 1 and not is_test and status in ('open','preparing')) then
    v_blockers := array_append(v_blockers,'Clôture d’abord le sondage n° 1, sans clôturer l’inter-saison.');
  end if;
  if exists (select 1 from public.intersaison_survey_campaigns where season_id = p_season
    and organization_id = p_org and poll_number = 2 and not is_test and status <> 'cancelled') then
    v_blockers := array_append(v_blockers,'Un sondage n° 2 officiel existe déjà pour cette saison.');
  end if;
  select jsonb_build_object('total',count(*),
    'missing',count(*) filter (where discord_id !~ '^[0-9]{15,22}$'),
    'duplicates',count(*) filter (where discord_id ~ '^[0-9]{15,22}$' and occurrences > 1),
    'distinctDiscordIds',count(distinct discord_id) filter (where discord_id ~ '^[0-9]{15,22}$'),
    'duplicateDiscordIds',count(distinct discord_id) filter (where discord_id ~ '^[0-9]{15,22}$' and occurrences > 1),
    'eligible',count(*) filter (where discord_id ~ '^[0-9]{15,22}$' and occurrences = 1)),
    md5(coalesce(jsonb_agg(jsonb_build_array(id,watcher_name,guild_code,discord_id) order by id)::text,'[]'))
    into v_counts, v_fingerprint from public.intersaison_survey_choice_roster(p_org);
  if (v_counts->>'eligible')::integer = 0 then v_blockers := array_append(v_blockers,'Aucun destinataire Discord éligible.'); end if;
  return jsonb_build_object('versionId',v_version.id,'versionNumber',v_version.version_number,
    'canTest',v_complete,'counts',v_counts,'rosterFingerprint',v_fingerprint,
    'canLaunch',cardinality(v_blockers) = 0,'blockers',to_jsonb(v_blockers));
end;
$$;

-- Private helper. The caller holds the season/campaign locks for the whole transaction.
create or replace function public.enqueue_intersaison_survey_members(p_campaign uuid, p_members uuid[])
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign public.intersaison_survey_campaigns%rowtype; v_member record;
  v_status text; v_error text; v_dm uuid; v_added integer := 0; v_queued integer := 0; v_existing integer := 0;
begin
  select * into strict v_campaign from public.intersaison_survey_campaigns where id = p_campaign;
  if v_campaign.status <> 'open' then raise exception 'Ce sondage n’est plus ouvert.'; end if;
  if (select count(*) from public.intersaison_survey_choice_roster(v_campaign.organization_id) where id = any(p_members))
    <> (select count(distinct m) from unnest(p_members) m) then
    raise exception 'Sélection hors des effectifs actifs Paladin.' using errcode = '42501';
  end if;
  for v_member in select * from public.intersaison_survey_choice_roster(v_campaign.organization_id)
    where id = any(p_members) order by id loop
    if exists (select 1 from public.intersaison_survey_recipients where survey_campaign_id = p_campaign
      and (member_id = v_member.id or member_key = v_member.id)) then
      v_existing := v_existing + 1; continue;
    end if;
    v_dm := null; v_error := null; v_status := 'queued';
    if v_member.discord_id !~ '^[0-9]{15,22}$' then
      v_status := 'missing_invalid'; v_error := 'ID Discord absent ou invalide.';
    elsif (not v_campaign.is_test and v_member.occurrences > 1) or exists (
      select 1 from public.guild_dm_recipients where campaign_id = v_campaign.guild_dm_campaign_id
        and discord_user_id = v_member.discord_id
    ) then
      v_status := 'excluded_duplicate'; v_error := 'ID Discord partagé ou déjà ciblé dans cette campagne.';
    end if;
    if v_status = 'queued' then
      insert into public.guild_dm_recipients(campaign_id,organization_id,member_id,guild_code,member_name_snapshot,discord_user_id,status)
        values(v_campaign.guild_dm_campaign_id,v_campaign.organization_id,v_member.id,v_member.guild_code,
          coalesce(nullif(v_member.watcher_name,''),'Joueur'),v_member.discord_id,'queued') returning id into v_dm;
      v_queued := v_queued + 1;
    end if;
    insert into public.intersaison_survey_recipients(survey_campaign_id,organization_id,member_id,member_key,
      guild_code_snapshot,member_name_snapshot,discord_user_id,guild_dm_recipient_id,delivery_status,last_error)
      values(p_campaign,v_campaign.organization_id,v_member.id,v_member.id,v_member.guild_code,
        coalesce(nullif(v_member.watcher_name,''),'Joueur'),v_member.discord_id,v_dm,v_status,v_error);
    v_added := v_added + 1;
  end loop;
  if v_added > 0 then
    update public.guild_dm_campaigns set
      status = case when v_queued > 0 then 'queued' else status end,
      total_recipients = (select count(*) from public.guild_dm_recipients where campaign_id = v_campaign.guild_dm_campaign_id),
      missing_discord_count = (select count(*) from public.intersaison_survey_recipients
        where survey_campaign_id = p_campaign and delivery_status in ('missing_invalid','excluded_duplicate')),
      updated_at = now() where id = v_campaign.guild_dm_campaign_id and organization_id = v_campaign.organization_id;
  end if;
  return jsonb_build_object('addedCount',v_added,'queuedCount',v_queued,'alreadyIncludedCount',v_existing);
end;
$$;

create or replace function public.launch_intersaison_survey_two(
  p_org uuid, p_season uuid, p_actor uuid, p_version uuid, p_fingerprint text, p_is_test boolean default false
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_preview jsonb; v_snapshot jsonb; v_actor public.guild_members%rowtype;
  v_dm uuid; v_campaign uuid; v_members uuid[]; v_queue jsonb;
begin
  perform public.assert_intersaison_survey_choice_admin(p_org, p_actor);
  perform 1 from public.intersaison_survey_seasons where id = p_season and organization_id = p_org
    and status <> 'finished' for update;
  if not found then raise exception 'Inter-saison active introuvable.'; end if;
  perform 1 from public.guild_members m join public.portal_guilds g on g.guild_code = m.guild_code
    where g.organization_id = p_org and g.is_active and m.guild_code in ('G1','G2','G3','G4','G5','G6','G7')
    for share of m,g;
  v_preview := public.preview_intersaison_survey_two(p_org,p_season,p_actor);
  if (v_preview->>'versionId')::uuid is distinct from p_version or not (v_preview->>'canTest')::boolean then
    raise exception 'Objectifs incomplets ou version obsolète. Recharge les objectifs.';
  end if;
  select * into strict v_actor from public.guild_members where id = p_actor;
  if not p_is_test then
    if not (v_preview->>'canLaunch')::boolean then raise exception '%',v_preview->'blockers'; end if;
    if p_fingerprint is distinct from v_preview->>'rosterFingerprint' then
      raise exception 'Les effectifs ont changé. Vérifie et confirme à nouveau le périmètre.';
    end if;
    select array_agg(id order by id) into v_members from public.intersaison_survey_choice_roster(p_org);
  else
    if not exists (select 1 from public.intersaison_survey_choice_roster(p_org)
      where id = p_actor and discord_id ~ '^[0-9]{15,22}$') then raise exception 'Ton compte n’a pas d’ID Discord valide dans les effectifs actifs.'; end if;
    v_members := array[p_actor];
  end if;
  select jsonb_object_agg(guild_code,objective_text) into v_snapshot
    from public.intersaison_survey_objective_items where version_id = p_version;
  insert into public.guild_dm_campaigns(organization_id,created_by_member_id,created_by_name,message,target_guild_codes,
    interaction_type,interaction_payload,is_test,status)
    values(p_org,p_actor,coalesce(v_actor.watcher_name,'Admin'),'Sondage 2 — Choix de guilde',
      array['G1','G2','G3','G4','G5','G6','G7'],'intersaison_choice',
      jsonb_build_object('pollNumber',2,'objectives',v_snapshot,'objectiveVersionId',p_version,'isTest',p_is_test),p_is_test,'queued')
    returning id into v_dm;
  insert into public.intersaison_survey_campaigns(season_id,organization_id,poll_number,guild_dm_campaign_id,status,
    title,message,target_guild_codes,launched_by_member_id,launched_by_name,launched_at,is_test,objective_version_id,objective_snapshot)
    values(p_season,p_org,2,v_dm,'open','Sondage 2 — Choix de guilde','Sondage 2 — Choix de guilde',
      array['G1','G2','G3','G4','G5','G6','G7'],p_actor,coalesce(v_actor.watcher_name,'Admin'),now(),p_is_test,p_version,v_snapshot)
    returning id into v_campaign;
  v_queue := public.enqueue_intersaison_survey_members(v_campaign,v_members);
  if p_is_test and (v_queue->>'queuedCount')::integer <> 1 then raise exception 'Le test doit cibler exactement ton compte.'; end if;
  if not p_is_test then
    update public.intersaison_survey_objective_versions set status = 'archived'
      where organization_id = p_org and purpose = 'next' and status = 'official';
    update public.intersaison_survey_objective_versions set status = 'official', official_at = now()
      where id = p_version and organization_id = p_org and status = 'validated';
    if not found then raise exception 'Validation des objectifs devenue obsolète.'; end if;
    update public.intersaison_survey_seasons set status = 'survey2_open' where id = p_season;
  end if;
  return jsonb_build_object('campaignId',v_campaign,'isTest',p_is_test) || v_queue;
end;
$$;

create or replace function public.add_intersaison_survey_members(p_org uuid,p_actor uuid,p_campaign uuid,p_members uuid[])
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_campaign public.intersaison_survey_campaigns%rowtype;
begin
  perform public.assert_intersaison_survey_choice_admin(p_org,p_actor);
  select * into strict v_campaign from public.intersaison_survey_campaigns where id = p_campaign and organization_id = p_org;
  perform 1 from public.intersaison_survey_seasons where id = v_campaign.season_id and organization_id = p_org
    and status <> 'finished' for update;
  if not found then raise exception 'Inter-saison clôturée.'; end if;
  select * into strict v_campaign from public.intersaison_survey_campaigns where id = p_campaign for update;
  if v_campaign.is_test or v_campaign.status <> 'open' or v_campaign.poll_number not in (1,2) then
    raise exception 'Ajout réservé à un sondage officiel ouvert.';
  end if;
  if cardinality(p_members) is null or cardinality(p_members) < 1 or cardinality(p_members) > 250 then
    raise exception 'Sélectionne entre un et 250 membres.';
  end if;
  perform 1 from public.guild_members where id = any(p_members) for share;
  return public.enqueue_intersaison_survey_members(p_campaign,p_members);
end;
$$;

create or replace function public.close_intersaison_survey(p_org uuid,p_actor uuid,p_campaign uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_campaign public.intersaison_survey_campaigns%rowtype;
begin
  perform public.assert_intersaison_survey_choice_admin(p_org,p_actor);
  select * into strict v_campaign from public.intersaison_survey_campaigns where id = p_campaign and organization_id = p_org;
  perform 1 from public.intersaison_survey_seasons where id = v_campaign.season_id and organization_id = p_org
    and status <> 'finished' for update;
  if not found then raise exception 'Inter-saison clôturée.'; end if;
  select * into strict v_campaign from public.intersaison_survey_campaigns where id = p_campaign for update;
  if v_campaign.is_test or v_campaign.status <> 'open' then raise exception 'Aucun sondage officiel ouvert à clôturer.'; end if;
  update public.intersaison_survey_campaigns set status = 'closed', closed_at = now() where id = p_campaign;
  update public.guild_dm_campaigns set status = 'cancelled' where id = v_campaign.guild_dm_campaign_id and organization_id = p_org;
  update public.guild_dm_recipients set status = 'cancelled' where campaign_id = v_campaign.guild_dm_campaign_id
    and organization_id = p_org and status in ('queued','sending','failed');
  update public.intersaison_survey_seasons set status = case v_campaign.poll_number
    when 1 then 'survey1_closed' else 'survey2_closed' end where id = v_campaign.season_id;
end;
$$;

create or replace function public.save_intersaison_survey_placement(
  p_org uuid,p_season uuid,p_actor uuid,p_member uuid,p_guild text,p_expected_revision integer
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_previous public.intersaison_survey_placements%rowtype; v_member record; v_id uuid; v_name text;
begin
  perform public.assert_intersaison_survey_choice_admin(p_org,p_actor);
  perform 1 from public.intersaison_survey_seasons where id = p_season and organization_id = p_org
    and status <> 'finished' for update;
  if not found then raise exception 'Inter-saison active introuvable.'; end if;
  select * into v_previous from public.intersaison_survey_placements where season_id = p_season
    and organization_id = p_org and member_key = p_member order by revision desc limit 1;
  if p_expected_revision is distinct from coalesce(v_previous.revision,0) then raise exception 'Placement modifié par un autre administrateur. Actualise.'; end if;
  select * into v_member from public.intersaison_survey_choice_roster(p_org) where id = p_member;
  if p_guild is not null and (p_guild not in ('G1','G2','G3','G4','G5','G6','G7') or v_member.id is null) then
    raise exception 'Placement hors des membres actifs Paladin.' using errcode = '42501';
  end if;
  if p_guild is null and v_previous.id is null then raise exception 'Aucun placement manuel à retirer.'; end if;
  select coalesce(watcher_name,'Admin') into v_name from public.guild_members where id = p_actor;
  insert into public.intersaison_survey_placements(organization_id,season_id,member_key,member_id,member_name_snapshot,
    action,guild_code,revision,actor_member_id,actor_name)
    values(p_org,p_season,p_member,coalesce(v_member.id,v_previous.member_id),coalesce(v_member.watcher_name,v_previous.member_name_snapshot,'Joueur'),
      case when p_guild is null then 'remove' else 'set' end,p_guild,coalesce(v_previous.revision,0)+1,p_actor,v_name)
    returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.submit_intersaison_survey_choice(
  p_dm_recipient_id uuid,p_discord_user_id text,p_interaction_id text,p_first_choice text,p_second_choice text,p_comment text
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_recipient public.intersaison_survey_recipients%rowtype;
  v_campaign public.intersaison_survey_campaigns%rowtype;
  v_dm public.guild_dm_recipients%rowtype; v_version integer; v_id uuid;
begin
  if p_first_choice is null or p_first_choice not in ('G1','G2','G3','G4','G5','G6','G7')
    or (nullif(p_second_choice,'') is not null and p_second_choice not in ('G1','G2','G3','G4','G5','G6','G7'))
    or p_first_choice = nullif(p_second_choice,'') then raise exception 'Choix de guildes invalides ou identiques.'; end if;
  if char_length(coalesce(p_comment,'')) > 1900 then raise exception 'Commentaire limité à 1900 caractères.'; end if;
  if coalesce(p_interaction_id,'') !~ '^[0-9]{15,22}$' then raise exception 'Interaction Discord invalide.'; end if;
  select * into strict v_recipient from public.intersaison_survey_recipients where guild_dm_recipient_id = p_dm_recipient_id;
  select * into strict v_campaign from public.intersaison_survey_campaigns where id = v_recipient.survey_campaign_id;
  perform 1 from public.intersaison_survey_seasons where id = v_campaign.season_id
    and organization_id = v_campaign.organization_id and status <> 'finished' for update;
  if not found then raise exception 'Inter-saison clôturée.'; end if;
  select * into strict v_campaign from public.intersaison_survey_campaigns where id = v_recipient.survey_campaign_id for update;
  select * into strict v_recipient from public.intersaison_survey_recipients where id = v_recipient.id for update;
  select * into strict v_dm from public.guild_dm_recipients where id = p_dm_recipient_id;
  if v_recipient.organization_id <> v_campaign.organization_id or v_dm.organization_id <> v_campaign.organization_id
    or v_dm.campaign_id <> v_campaign.guild_dm_campaign_id or v_campaign.poll_number <> 2
    or v_recipient.discord_user_id is distinct from p_discord_user_id or v_dm.discord_user_id is distinct from p_discord_user_id
    or p_discord_user_id !~ '^[0-9]{15,22}$' then
    raise exception 'Ce sondage est réservé au destinataire du message.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.guild_dm_campaigns where id = v_dm.campaign_id
    and organization_id = v_campaign.organization_id and interaction_type = 'intersaison_choice' and is_test = v_campaign.is_test) then
    raise exception 'Campagne Discord incohérente.';
  end if;
  if not exists (select 1 from public.portal_organizations o join public.intersaison_survey_objective_versions v
    on v.organization_id = o.id and v.season_id = v_campaign.season_id and v.id = v_campaign.objective_version_id
    where o.id = v_campaign.organization_id and o.is_active and o.organization_key in ('paladin','paladin_cluster')) then
    raise exception 'Organisation du sondage incohérente.' using errcode = '42501';
  end if;
  if v_campaign.status <> 'open' then raise exception 'Ce sondage n’est plus ouvert.'; end if;
  if exists (select 1 from public.intersaison_survey_responses where discord_interaction_id = p_interaction_id) then
    select id,response_version into v_id,v_version from public.intersaison_survey_responses
      where discord_interaction_id = p_interaction_id and survey_recipient_id = v_recipient.id;
    if v_id is null then raise exception 'Interaction déjà utilisée.'; end if;
    return jsonb_build_object('id',v_id,'version',v_version,'alreadySaved',true);
  end if;
  select coalesce(max(response_version),0)+1 into v_version from public.intersaison_survey_responses where survey_recipient_id = v_recipient.id;
  update public.intersaison_survey_responses set is_current = false where survey_recipient_id = v_recipient.id
    and organization_id = v_campaign.organization_id and is_current;
  insert into public.intersaison_survey_responses(survey_campaign_id,survey_recipient_id,organization_id,member_id,discord_user_id,
    poll_number,guild_code_snapshot,member_name_snapshot,first_choice_guild_code,second_choice_guild_code,comment_text,response_version,discord_interaction_id)
    values(v_campaign.id,v_recipient.id,v_campaign.organization_id,v_recipient.member_id,p_discord_user_id,2,
      v_recipient.guild_code_snapshot,v_recipient.member_name_snapshot,p_first_choice,nullif(p_second_choice,''),
      p_comment,v_version,p_interaction_id) returning id into v_id;
  update public.intersaison_survey_recipients set response_status = 'responded', delivery_status = 'confirmed',
    responded_at = now(),last_error = null where id = v_recipient.id;
  update public.guild_dm_recipients set status = 'confirmed',confirmed_at = coalesce(confirmed_at,now()),last_error = null
    where id = v_dm.id and organization_id = v_campaign.organization_id;
  update public.guild_dm_campaigns set confirmed_count = (
    select count(*) from public.guild_dm_recipients where campaign_id = v_dm.campaign_id
      and organization_id = v_campaign.organization_id and (status = 'confirmed' or confirmed_at is not null)
  ), updated_at = now() where id = v_dm.campaign_id and organization_id = v_campaign.organization_id;
  return jsonb_build_object('id',v_id,'version',v_version);
end;
$$;

create or replace function public.queue_intersaison_survey_reminders(p_org uuid,p_actor uuid,p_campaign uuid,p_recipient uuid default null)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_campaign public.intersaison_survey_campaigns%rowtype; v_row record; v_count integer := 0;
begin
  perform public.assert_intersaison_survey_choice_admin(p_org,p_actor);
  select * into strict v_campaign from public.intersaison_survey_campaigns where id = p_campaign and organization_id = p_org;
  perform 1 from public.intersaison_survey_seasons where id = v_campaign.season_id and organization_id = p_org and status <> 'finished' for update;
  if not found then raise exception 'Inter-saison clôturée.'; end if;
  select * into strict v_campaign from public.intersaison_survey_campaigns where id = p_campaign for update;
  if v_campaign.status <> 'open' or v_campaign.is_test then raise exception 'Relance réservée à un sondage officiel ouvert.'; end if;
  for v_row in select r.id,r.guild_dm_recipient_id from public.intersaison_survey_recipients r
    join public.guild_dm_recipients d on d.id = r.guild_dm_recipient_id and d.organization_id = p_org and d.campaign_id = v_campaign.guild_dm_campaign_id
    where r.survey_campaign_id = p_campaign and r.organization_id = p_org
      and (p_recipient is null or r.id = p_recipient) and r.responded_at is null and r.response_status <> 'responded'
      and d.status in ('sent','failed') and not exists (select 1 from public.intersaison_survey_responses s where s.survey_recipient_id = r.id and s.is_current)
    order by r.id for update of r,d loop
    update public.guild_dm_recipients set status = 'queued',reminder_count = reminder_count+1,last_error = null where id = v_row.guild_dm_recipient_id;
    update public.intersaison_survey_recipients set delivery_status = 'queued',reminder_count = reminder_count+1,last_reminder_at = now(),last_error = null where id = v_row.id;
    v_count := v_count+1;
  end loop;
  if v_count > 0 then update public.guild_dm_campaigns set status = 'queued' where id = v_campaign.guild_dm_campaign_id; end if;
  return v_count;
end;
$$;

create or replace function public.protect_intersaison_survey_choice_snapshot()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.poll_number = 2 and (new.objective_snapshot is distinct from old.objective_snapshot
    or new.objective_version_id is distinct from old.objective_version_id or new.organization_id <> old.organization_id
    or new.season_id <> old.season_id or new.is_test <> old.is_test or new.poll_number <> old.poll_number
    or new.guild_dm_campaign_id is distinct from old.guild_dm_campaign_id) then
    raise exception 'Le snapshot du sondage n° 2 est immuable.';
  end if;
  return new;
end;
$$;
drop trigger if exists intersaison_survey_choice_snapshot_immutable on public.intersaison_survey_campaigns;
create trigger intersaison_survey_choice_snapshot_immutable before update on public.intersaison_survey_campaigns
  for each row execute function public.protect_intersaison_survey_choice_snapshot();

-- Future seasons capture their reference once. Existing seasons are deliberately not backfilled.
create or replace function public.capture_intersaison_survey_reference_objectives()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_previous public.intersaison_survey_objective_versions%rowtype; v_reference uuid;
begin
  if not exists (select 1 from public.portal_organizations where id = new.organization_id
    and lower(organization_key) in ('paladin','paladin_cluster') and is_active) then return new; end if;
  select * into v_previous from public.intersaison_survey_objective_versions
    where organization_id = new.organization_id and season_id <> new.id and purpose = 'next' and status = 'official'
    order by official_at desc,id limit 1;
  if v_previous.id is null then return new; end if;
  insert into public.intersaison_survey_objective_versions(organization_id,season_id,purpose,version_number,status,
    created_by_member_id,validated_by_member_id,validated_at,official_at)
    values(new.organization_id,new.id,'reference',1,'official',new.created_by_member_id,
      v_previous.validated_by_member_id,v_previous.validated_at,v_previous.official_at) returning id into v_reference;
  insert into public.intersaison_survey_objective_items(version_id,organization_id,season_id,guild_code,objective_text)
    select v_reference,new.organization_id,new.id,guild_code,objective_text
      from public.intersaison_survey_objective_items where version_id = v_previous.id;
  return new;
end;
$$;
drop trigger if exists intersaison_survey_capture_reference on public.intersaison_survey_seasons;
create trigger intersaison_survey_capture_reference after insert on public.intersaison_survey_seasons
  for each row execute function public.capture_intersaison_survey_reference_objectives();

-- Only the Portal service and the existing bot may call these RPCs; no browser direct writes.
do $$ declare v_signature text; begin
  for v_signature in select unnest(array[
    'assert_intersaison_survey_choice_admin(uuid,uuid)','intersaison_survey_choice_roster(uuid)',
    'preview_intersaison_survey_two(uuid,uuid,uuid)','enqueue_intersaison_survey_members(uuid,uuid[])',
    'launch_intersaison_survey_two(uuid,uuid,uuid,uuid,text,boolean)','add_intersaison_survey_members(uuid,uuid,uuid,uuid[])',
    'close_intersaison_survey(uuid,uuid,uuid)','save_intersaison_survey_placement(uuid,uuid,uuid,uuid,text,integer)',
    'submit_intersaison_survey_choice(uuid,text,text,text,text,text)','queue_intersaison_survey_reminders(uuid,uuid,uuid,uuid)',
    'protect_intersaison_survey_choice_snapshot()','capture_intersaison_survey_reference_objectives()'
  ]) loop execute 'revoke all on function public.' || v_signature || ' from public,anon,authenticated,service_role'; end loop;
end $$;
grant execute on function public.preview_intersaison_survey_two(uuid,uuid,uuid) to service_role;
grant execute on function public.launch_intersaison_survey_two(uuid,uuid,uuid,uuid,text,boolean) to service_role;
grant execute on function public.add_intersaison_survey_members(uuid,uuid,uuid,uuid[]) to service_role;
grant execute on function public.close_intersaison_survey(uuid,uuid,uuid) to service_role;
grant execute on function public.save_intersaison_survey_placement(uuid,uuid,uuid,uuid,text,integer) to service_role;
grant execute on function public.submit_intersaison_survey_choice(uuid,text,text,text,text,text) to service_role;
grant execute on function public.queue_intersaison_survey_reminders(uuid,uuid,uuid,uuid) to service_role;

commit;
