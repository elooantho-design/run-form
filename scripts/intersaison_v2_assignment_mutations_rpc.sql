begin;

create or replace function public.move_intersaison_assignment_for_organization(
  p_campaign_id uuid,
  p_organization_id uuid,
  p_assignment_id uuid,
  p_dashboard_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_campaign_id uuid;
  v_assignment public.intersaison_assignments%rowtype;
  v_dashboard public.intersaison_dashboards%rowtype;
  v_target_guild_id uuid;
begin
  if p_campaign_id is null or p_organization_id is null or p_assignment_id is null or p_dashboard_id is null then
    raise exception 'campaign_id, organization_id, assignment_id et dashboard_id sont obligatoires.';
  end if;

  select campaign.id
  into v_campaign_id
  from public.intersaison_campaigns campaign
  where campaign.id = p_campaign_id
    and campaign.organization_id = p_organization_id
    and campaign.status = 'active'
  for update;

  if not found then
    raise exception 'Campagne active introuvable pour cette organisation.';
  end if;

  select *
  into v_assignment
  from public.intersaison_assignments assignment
  where assignment.id = p_assignment_id
    and assignment.campaign_id = p_campaign_id
  for update;

  if not found then
    raise exception 'Assignation introuvable pour cette campagne.';
  end if;

  if v_assignment.organization_id is distinct from p_organization_id then
    raise exception 'Assignation hors organisation.';
  end if;

  select *
  into v_dashboard
  from public.intersaison_dashboards dashboard
  where dashboard.id = p_dashboard_id
    and dashboard.campaign_id = p_campaign_id
  for update;

  if not found then
    raise exception 'Dashboard cible introuvable pour cette campagne.';
  end if;

  if v_dashboard.organization_id is distinct from p_organization_id then
    raise exception 'Dashboard cible hors organisation.';
  end if;

  if v_dashboard.is_draft is true then
    if v_dashboard.code <> 'BROUILLON' then
      raise exception 'Le seul dashboard brouillon autorise est BROUILLON.';
    end if;

    update public.intersaison_assignments assignment
    set
      dashboard_id = v_dashboard.id,
      target_guild_code = null,
      is_manually_confirmed = true,
      updated_at = now()
    where assignment.id = v_assignment.id;

    return jsonb_build_object(
      'ok', true,
      'assignmentId', v_assignment.id,
      'dashboardId', v_dashboard.id,
      'targetGuildCode', null
    );
  end if;

  if v_dashboard.is_draft is not false or v_dashboard.code = 'BROUILLON' then
    raise exception 'Dashboard cible invalide.';
  end if;

  select guild.id
  into v_target_guild_id
  from public.portal_guilds guild
  where guild.organization_id = p_organization_id
    and guild.guild_code = v_dashboard.code
    and guild.is_active = true
  for update;

  if not found then
    raise exception 'Guilde cible hors organisation ou inactive.';
  end if;

  update public.intersaison_assignments assignment
  set
    dashboard_id = v_dashboard.id,
    target_guild_code = v_dashboard.code,
    is_manually_confirmed = true,
    updated_at = now()
  where assignment.id = v_assignment.id;

  return jsonb_build_object(
    'ok', true,
    'assignmentId', v_assignment.id,
    'dashboardId', v_dashboard.id,
    'targetGuildCode', v_dashboard.code
  );
end;
$function$;

create or replace function public.toggle_intersaison_assignment_confirmation_for_organization(
  p_campaign_id uuid,
  p_organization_id uuid,
  p_assignment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_campaign_id uuid;
  v_assignment public.intersaison_assignments%rowtype;
  v_next_confirmed boolean;
begin
  if p_campaign_id is null or p_organization_id is null or p_assignment_id is null then
    raise exception 'campaign_id, organization_id et assignment_id sont obligatoires.';
  end if;

  select campaign.id
  into v_campaign_id
  from public.intersaison_campaigns campaign
  where campaign.id = p_campaign_id
    and campaign.organization_id = p_organization_id
    and campaign.status = 'active'
  for update;

  if not found then
    raise exception 'Campagne active introuvable pour cette organisation.';
  end if;

  select *
  into v_assignment
  from public.intersaison_assignments assignment
  where assignment.id = p_assignment_id
    and assignment.campaign_id = p_campaign_id
  for update;

  if not found then
    raise exception 'Assignation introuvable pour cette campagne.';
  end if;

  if v_assignment.organization_id is distinct from p_organization_id then
    raise exception 'Assignation hors organisation.';
  end if;

  v_next_confirmed := not coalesce(v_assignment.is_manually_confirmed, false);

  update public.intersaison_assignments assignment
  set
    is_manually_confirmed = v_next_confirmed,
    updated_at = now()
  where assignment.id = v_assignment.id;

  return jsonb_build_object(
    'ok', true,
    'assignmentId', v_assignment.id,
    'isManuallyConfirmed', v_next_confirmed
  );
end;
$function$;

create or replace function public.save_intersaison_assignment_wishes_for_organization(
  p_campaign_id uuid,
  p_organization_id uuid,
  p_assignment_id uuid,
  p_wished_guild_codes text[] default array[]::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_campaign_id uuid;
  v_assignment public.intersaison_assignments%rowtype;
  v_wished_guild_codes text[];
  v_invalid_wished_guild_codes text;
begin
  if p_campaign_id is null or p_organization_id is null or p_assignment_id is null then
    raise exception 'campaign_id, organization_id et assignment_id sont obligatoires.';
  end if;

  select campaign.id
  into v_campaign_id
  from public.intersaison_campaigns campaign
  where campaign.id = p_campaign_id
    and campaign.organization_id = p_organization_id
    and campaign.status = 'active'
  for update;

  if not found then
    raise exception 'Campagne active introuvable pour cette organisation.';
  end if;

  select *
  into v_assignment
  from public.intersaison_assignments assignment
  where assignment.id = p_assignment_id
    and assignment.campaign_id = p_campaign_id
  for update;

  if not found then
    raise exception 'Assignation introuvable pour cette campagne.';
  end if;

  if v_assignment.organization_id is distinct from p_organization_id then
    raise exception 'Assignation hors organisation.';
  end if;

  perform 1
  from public.portal_guilds guild
  where guild.organization_id = p_organization_id
  order by guild.id
  for update;

  with requested as (
    select
      regexp_replace(btrim(wished.guild_code), '[[:space:]]+', ' ', 'g') as requested_code,
      min(wished.ordinality) as first_position
    from unnest(coalesce(p_wished_guild_codes, array[]::text[])) with ordinality as wished(guild_code, ordinality)
    where btrim(coalesce(wished.guild_code, '')) <> ''
    group by regexp_replace(btrim(wished.guild_code), '[[:space:]]+', ' ', 'g')
  )
  select string_agg(requested.requested_code, ', ' order by requested.requested_code)
  into v_invalid_wished_guild_codes
  from requested
  left join public.portal_guilds guild
    on guild.guild_code = requested.requested_code
   and guild.organization_id = p_organization_id
   and guild.is_active = true
  where guild.id is null;

  if v_invalid_wished_guild_codes is not null then
    raise exception 'Codes de guildes souhaites invalides ou hors organisation: %', v_invalid_wished_guild_codes;
  end if;

  with requested as (
    select
      regexp_replace(btrim(wished.guild_code), '[[:space:]]+', ' ', 'g') as requested_code,
      min(wished.ordinality) as first_position
    from unnest(coalesce(p_wished_guild_codes, array[]::text[])) with ordinality as wished(guild_code, ordinality)
    where btrim(coalesce(wished.guild_code, '')) <> ''
    group by regexp_replace(btrim(wished.guild_code), '[[:space:]]+', ' ', 'g')
  )
  select coalesce(array_agg(guild.guild_code order by requested.first_position), array[]::text[])
  into v_wished_guild_codes
  from requested
  join public.portal_guilds guild
    on guild.guild_code = requested.requested_code
     and guild.organization_id = p_organization_id
   and guild.is_active = true;

  update public.intersaison_assignments assignment
  set
    wished_guild_codes = v_wished_guild_codes,
    updated_at = now()
  where assignment.id = v_assignment.id;

  return jsonb_build_object(
    'ok', true,
    'assignmentId', v_assignment.id,
    'wishedGuildCodes', v_wished_guild_codes
  );
end;
$function$;

create or replace function public.save_intersaison_assignment_note_for_organization(
  p_campaign_id uuid,
  p_organization_id uuid,
  p_assignment_id uuid,
  p_note text,
  p_actor_member_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_campaign_id uuid;
  v_assignment public.intersaison_assignments%rowtype;
  v_note text;
  v_note_count integer;
  v_existing_note public.intersaison_notes%rowtype;
begin
  if p_campaign_id is null or p_organization_id is null or p_assignment_id is null or p_actor_member_id is null then
    raise exception 'campaign_id, organization_id, assignment_id et actor_member_id sont obligatoires.';
  end if;

  select campaign.id
  into v_campaign_id
  from public.intersaison_campaigns campaign
  where campaign.id = p_campaign_id
    and campaign.organization_id = p_organization_id
    and campaign.status = 'active'
  for update;

  if not found then
    raise exception 'Campagne active introuvable pour cette organisation.';
  end if;

  select *
  into v_assignment
  from public.intersaison_assignments assignment
  where assignment.id = p_assignment_id
    and assignment.campaign_id = p_campaign_id
  for update;

  if not found then
    raise exception 'Assignation introuvable pour cette campagne.';
  end if;

  if v_assignment.organization_id is distinct from p_organization_id then
    raise exception 'Assignation hors organisation.';
  end if;

  v_note := btrim(coalesce(p_note, ''));

  if char_length(v_note) > 4000 then
    raise exception 'Note trop longue.';
  end if;

  perform 1
  from public.intersaison_notes note
  where note.assignment_id = p_assignment_id
  order by note.id
  for update;

  select count(*)
  into v_note_count
  from public.intersaison_notes note
  where note.assignment_id = p_assignment_id;

  if v_note_count > 1 then
    raise exception 'Plusieurs notes existent pour cette assignation.';
  end if;

  if v_note = '' then
    delete from public.intersaison_notes note
    where note.assignment_id = p_assignment_id;

    return jsonb_build_object(
      'ok', true,
      'assignmentId', p_assignment_id,
      'hasNote', false
    );
  end if;

  if v_note_count = 1 then
    select *
    into v_existing_note
    from public.intersaison_notes note
    where note.assignment_id = p_assignment_id
    limit 1;

    update public.intersaison_notes note
    set
      note = v_note,
      updated_at = now()
    where note.id = v_existing_note.id;
  else
    insert into public.intersaison_notes (
      assignment_id,
      note,
      created_by_member_id
    )
    values (
      p_assignment_id,
      v_note,
      p_actor_member_id
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'assignmentId', p_assignment_id,
    'hasNote', true
  );
end;
$function$;

revoke all on function public.move_intersaison_assignment_for_organization(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.toggle_intersaison_assignment_confirmation_for_organization(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.save_intersaison_assignment_wishes_for_organization(uuid, uuid, uuid, text[]) from public, anon, authenticated;
revoke all on function public.save_intersaison_assignment_note_for_organization(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;

grant execute on function public.move_intersaison_assignment_for_organization(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.toggle_intersaison_assignment_confirmation_for_organization(uuid, uuid, uuid) to service_role;
grant execute on function public.save_intersaison_assignment_wishes_for_organization(uuid, uuid, uuid, text[]) to service_role;
grant execute on function public.save_intersaison_assignment_note_for_organization(uuid, uuid, uuid, text, uuid) to service_role;

commit;
