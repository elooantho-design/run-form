-- Run after intersaison_plan_cycle.sql. Additive schema/function changes only.
-- Does not launch, close, enqueue, transfer, publish or change an existing answer.
begin;

create or replace function public.intersaison_active_guild_codes(p_org uuid)
returns text[] language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(array_agg(g.guild_code order by substring(g.guild_code from 2)::int),'{}')
  from public.portal_guilds g join public.portal_organizations o on o.id=g.organization_id
  where g.organization_id=p_org and g.is_active and o.is_active
    and lower(o.organization_key) in ('paladin','paladin_cluster')
    and g.guild_code ~ '^G([1-9]|1[0-9]|2[0-5])$'
$$;
create or replace function public.intersaison_active_guild_names(p_org uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_object_agg(g.guild_code,coalesce(p.guilds->g.guild_code->>'name',case g.guild_code
    when 'G1' then 'Legend' when 'G2' then 'Imperatores' when 'G3' then 'Loyalty' when 'G4' then 'Collegium'
    when 'G5' then 'Senatores' when 'G6' then 'Legacy' when 'G7' then 'Magistratus' else g.display_name end)),'{}')
  from public.portal_guilds g left join lateral(select guilds from public.intersaison_plan_cycles
    where organization_id=p_org order by created_at desc,season_id desc limit 1) p on true
  where g.organization_id=p_org and g.guild_code=any(public.intersaison_active_guild_codes(p_org))
$$;
revoke all on function public.intersaison_active_guild_codes(uuid),public.intersaison_active_guild_names(uuid)
  from public,anon,authenticated,service_role;

alter table public.intersaison_survey_campaigns add column if not exists guild_names jsonb not null default '{}';
create or replace function public.capture_intersaison_campaign_guild_names()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.intersaison_plan_cycles%rowtype; merged jsonb;
begin
  new.guild_names:=public.intersaison_active_guild_names(new.organization_id);
  if new.poll_number=2 and not new.is_test then
    select * into p from public.intersaison_plan_cycles where season_id=new.season_id and organization_id=new.organization_id for update;
    if p.season_id is not null then
      select jsonb_object_agg(g.key,case when new.objective_snapshot ? g.key then
        jsonb_set(g.value,'{objective}',new.objective_snapshot->g.key) else g.value end) into merged from jsonb_each(p.guilds) g;
      if merged is distinct from p.guilds then
        update public.intersaison_plan_cycles set guilds=merged,revision=revision+1 where season_id=p.season_id;
        insert into public.intersaison_plan_events(organization_id,season_id,revision,kind,subject,before_value,after_value,actor_member_id,actor_name)
          values(new.organization_id,new.season_id,p.revision+1,'objectives','official',p.guilds,merged,new.launched_by_member_id,coalesce(new.launched_by_name,'Admin'));
      end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.capture_intersaison_campaign_guild_names() from public,anon,authenticated,service_role;
drop trigger if exists intersaison_campaign_capture_guild_names on public.intersaison_survey_campaigns;
create trigger intersaison_campaign_capture_guild_names before insert on public.intersaison_survey_campaigns
  for each row execute function public.capture_intersaison_campaign_guild_names();

alter table public.intersaison_survey_objective_versions add column if not exists guild_codes text[] not null
  default array['G1','G2','G3','G4','G5','G6','G7'];
alter table public.intersaison_survey_objective_items drop constraint if exists intersaison_survey_objective_items_guild_code_check;
alter table public.intersaison_survey_objective_items add constraint intersaison_survey_objective_items_guild_code_check
  check(guild_code ~ '^G([1-9]|1[0-9]|2[0-5])$');

create or replace function public.capture_intersaison_objective_scope()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  new.guild_codes:=public.intersaison_active_guild_codes(new.organization_id);
  if cardinality(new.guild_codes)=0 then raise exception 'Aucune guilde Paladin active.'; end if;
  return new;
end $$;
revoke all on function public.capture_intersaison_objective_scope() from public,anon,authenticated,service_role;
drop trigger if exists intersaison_objective_capture_scope on public.intersaison_survey_objective_versions;
create trigger intersaison_objective_capture_scope before insert on public.intersaison_survey_objective_versions
  for each row execute function public.capture_intersaison_objective_scope();

create or replace function public.assert_intersaison_survey_choice_admin(p_org uuid,p_actor uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.assert_intersaison_plan_admin(p_org,p_actor);
  if cardinality(public.intersaison_active_guild_codes(p_org))=0 then raise exception 'Aucune guilde Paladin active.'; end if;
end $$;

create or replace function public.check_intersaison_objective_version()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v public.intersaison_survey_objective_versions%rowtype; n int; complete int;
begin
  select * into strict v from public.intersaison_survey_objective_versions where id=new.id;
  select count(*),count(*) filter(where btrim(objective_text,E' \t\n\r')<>'') into n,complete
    from public.intersaison_survey_objective_items where version_id=v.id;
  if n<>cardinality(v.guild_codes) or exists(select 1 from public.intersaison_survey_objective_items
    where version_id=v.id and not guild_code=any(v.guild_codes)) then raise exception 'Objectifs incomplets pour le périmètre de cette version.'; end if;
  if v.status in ('validated','official') and complete<>n then raise exception 'Renseigner tous les objectifs.'; end if;
  return new;
end $$;

-- Preserve every installed account/reminder safety rule. Only replace the enumerated
-- seven-code scope in these exact functions; unknown definitions abort the transaction.
do $$
declare f text; d text; original text; parameter text; literals text:='(''G1'',''G2'',''G3'',''G4'',''G5'',''G6'',''G7'')';
begin
  foreach f in array array['assert_intersaison_objectives_admin','intersaison_survey_choice_roster',
    'save_intersaison_survey_objectives_draft','validate_intersaison_survey_objectives_draft',
    'preview_intersaison_survey_two','launch_intersaison_survey_two','intersaison_choice_account_identity',
    'guard_guild_dm_account_identity','intersaison_survey_two_reminder_state','preview_intersaison_survey_two_reminders',
    'queue_intersaison_survey_two_reminders','submit_intersaison_survey_choice'] loop
    select pg_get_functiondef(p.oid) into strict original from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=f;
    d:=original;
    if f in ('assert_intersaison_objectives_admin','save_intersaison_survey_objectives_draft','validate_intersaison_survey_objectives_draft') then
      parameter:='p_organization_id';
    elsif f='guard_guild_dm_account_identity' then parameter:='new.organization_id';
    else parameter:='p_org'; end if;
    if f='submit_intersaison_survey_choice' then
      d:=replace(d,'p_first_choice not in '||literals,$x$p_first_choice !~ '^G([1-9]|1[0-9]|2[0-5])$'$x$);
      d:=replace(d,'p_second_choice not in '||literals,$x$p_second_choice !~ '^G([1-9]|1[0-9]|2[0-5])$'$x$);
      if position('Choix absent des objectifs envoyés.' in d)=0 then
        d:=replace(d,$x$if v_campaign.status <> 'open' then$x$,
          $x$if not v_campaign.objective_snapshot ? p_first_choice or (nullif(p_second_choice,'') is not null
            and not v_campaign.objective_snapshot ? p_second_choice) then raise exception 'Choix absent des objectifs envoyés.'; end if;
          if v_campaign.status <> 'open' then$x$);
      end if;
      if position('Choix absent des objectifs envoyés.' in d)=0 then raise exception 'Submit definition changed: review required.'; end if;
    elsif f='preview_intersaison_survey_two_reminders' then
      d:=replace(d,'jsonb_build_array'||literals,'to_jsonb(c.target_guild_codes)');
    else
      d:=replace(d,'not in '||literals,'<> all(public.intersaison_active_guild_codes('||parameter||'))');
      d:=replace(d,'in '||literals,'= any(public.intersaison_active_guild_codes('||parameter||'))');
    end if;
    if f='save_intersaison_survey_objectives_draft' then
      d:=replace(d,'<> 7','<> cardinality(public.intersaison_active_guild_codes(p_organization_id))');
    elsif f='validate_intersaison_survey_objectives_draft' then
      d:=replace(d,'<> 7','<> (select cardinality(guild_codes) from public.intersaison_survey_objective_versions where id=p_version_id)');
    elsif f='preview_intersaison_survey_two' then
      -- Latest installed definition is the account-aware version from survey_accounts.
      if position('intersaison_choice_account_identity' in d)=0 then raise exception 'Account-aware preview migration missing.'; end if;
      d:=replace(d,'count(*)=7','count(*)=cardinality(v_version.guild_codes)');
      d:=replace(d,$x$<>'')=7$x$,$x$<>'')=cardinality(v_version.guild_codes)$x$);
      if position('Version scope must match' in d)=0 then
        d:=replace(d,'if not complete or',
          $x$-- Version scope must match the current guild catalog for a new launch.
          complete:=coalesce(complete,false) and v_version.guild_codes @> public.intersaison_active_guild_codes(p_org)
            and cardinality(v_version.guild_codes)=cardinality(public.intersaison_active_guild_codes(p_org));
          if (select coalesce(sum(char_length(guild_code)+3+char_length(public.intersaison_active_guild_names(p_org)->>guild_code)
            +char_length(btrim(objective_text))),0)+100 from public.intersaison_survey_objective_items where version_id=v_version.id)>6000 then
            complete:=false; blockers:=array_append(blockers,'Le message dépasse la limite Discord de 6000 caractères.'); end if;
          if not complete or$x$);
      end if;
    elsif f='launch_intersaison_survey_two' then
      d:=replace(d,$x$array['G1','G2','G3','G4','G5','G6','G7']$x$,
        '(select array_agg(key order by substring(key from 2)::int) from jsonb_object_keys(v_snapshot) key)');
      d:=replace(d,$x$'pollNumber',2,'objectives',v_snapshot,$x$,
        $x$'pollNumber',2,'guildNames',public.intersaison_active_guild_names(p_org),'objectives',v_snapshot,$x$);
    end if;
    if d=original and position('intersaison_active_guild_' in d)=0 and f<>'submit_intersaison_survey_choice'
      and not(f='preview_intersaison_survey_two_reminders' and position('to_jsonb(c.target_guild_codes)' in d)>0)
      and not(f='validate_intersaison_survey_objectives_draft' and position('cardinality(guild_codes)' in d)>0) then
      raise exception 'Unrecognized function scope for %; review required.',f;
    end if;
    if position(literals in d)>0 or d ~ $x$'G1'[[:space:]]*,[[:space:]]*'G2'$x$
      or (f in ('save_intersaison_survey_objectives_draft','validate_intersaison_survey_objectives_draft') and d ~ '<>[[:space:]]*7([^0-9]|$)')
      or (f='preview_intersaison_survey_two' and d ~ '=[[:space:]]*7[[:space:]]+(and|into)') then
      raise exception 'Unconverted scope in %.',f;
    end if;
    execute d;
  end loop;
end $$;

-- New cycles use the permanent objective bank, never a mutable forecast or an old answer.
create or replace function public.capture_intersaison_survey_reference_objectives()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare bank jsonb; version_id uuid;
begin
  select guilds into bank from public.intersaison_plan_objective_bank where organization_id=new.organization_id
    order by created_at desc,revision desc,id desc limit 1;
  if bank is null then return new; end if;
  insert into public.intersaison_survey_objective_versions(organization_id,season_id,purpose,version_number,status,created_by_member_id)
    values(new.organization_id,new.id,'reference',1,'draft',new.created_by_member_id) returning id into version_id;
  insert into public.intersaison_survey_objective_items(version_id,organization_id,season_id,guild_code,objective_text)
    select version_id,new.organization_id,new.id,code,coalesce(bank->code->>'objective','')
      from unnest(public.intersaison_active_guild_codes(new.organization_id)) code;
  return new;
end $$;

-- Old placement endpoints cannot bypass versioning or the cycle lock.
create or replace function public.guard_legacy_intersaison_plan_write()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if exists(select 1 from public.intersaison_plan_cycles where season_id=new.season_id and organization_id=new.organization_id) then
    raise exception 'Plan versionné actif : actualiser le dashboard avant modification.';
  end if;
  return new;
end $$;
revoke all on function public.guard_legacy_intersaison_plan_write() from public,anon,authenticated,service_role;
drop trigger if exists intersaison_plan_legacy_guard on public.intersaison_survey_placements;
create trigger intersaison_plan_legacy_guard before insert or update on public.intersaison_survey_placements
  for each row execute function public.guard_legacy_intersaison_plan_write();
drop trigger if exists intersaison_plan_legacy_guard on public.intersaison_survey_forecast_roles;
create trigger intersaison_plan_legacy_guard before insert or update on public.intersaison_survey_forecast_roles
  for each row execute function public.guard_legacy_intersaison_plan_write();
notify pgrst,'reload schema';
commit;
