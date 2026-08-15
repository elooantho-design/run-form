begin;

alter table public.intersaison_assignments
  add column if not exists intersaison_role text;

comment on column public.intersaison_assignments.intersaison_role is
  'Preparation-only Inter-saison role for this assignment. Does not affect guild_members.role or dashboard permissions.';

do $$
begin
  if exists (
    select 1
    from public.intersaison_assignments assignment
    where assignment.intersaison_role is not null
      and assignment.intersaison_role not in ('member', 'officer', 'leader')
  ) then
    raise exception 'Valeurs intersaison_role incompatibles presentes dans intersaison_assignments.';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_info
    where constraint_info.conrelid = 'public.intersaison_assignments'::regclass
      and constraint_info.conname = 'intersaison_assignments_intersaison_role_check'
  ) then
    alter table public.intersaison_assignments
      add constraint intersaison_assignments_intersaison_role_check
      check (
        intersaison_role is null
        or intersaison_role in ('member', 'officer', 'leader')
      );
  end if;
end $$;

alter table public.intersaison_assignments
  alter column intersaison_role set default 'member';

update public.intersaison_assignments assignment
set
  intersaison_role = 'member',
  updated_at = now()
from public.intersaison_campaigns campaign
where assignment.campaign_id = campaign.id
  and campaign.status = 'active'
  and assignment.intersaison_role is null;

create or replace function public.save_intersaison_assignment_role_for_organization(
  p_campaign_id uuid,
  p_organization_id uuid,
  p_assignment_id uuid,
  p_intersaison_role text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_campaign_id uuid;
  v_assignment public.intersaison_assignments%rowtype;
  v_intersaison_role text;
begin
  if p_campaign_id is null or p_organization_id is null or p_assignment_id is null then
    raise exception 'campaign_id, organization_id et assignment_id sont obligatoires.';
  end if;

  v_intersaison_role := lower(btrim(coalesce(p_intersaison_role, '')));

  if v_intersaison_role not in ('member', 'officer', 'leader') then
    raise exception 'Role intersaison invalide.';
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

  update public.intersaison_assignments assignment
  set
    intersaison_role = v_intersaison_role,
    updated_at = now()
  where assignment.id = v_assignment.id;

  return jsonb_build_object(
    'ok', true,
    'assignmentId', v_assignment.id,
    'intersaisonRole', v_intersaison_role
  );
end;
$function$;

revoke all on function public.save_intersaison_assignment_role_for_organization(uuid, uuid, uuid, text)
from public, anon, authenticated;

grant execute on function public.save_intersaison_assignment_role_for_organization(uuid, uuid, uuid, text)
to service_role;

commit;
