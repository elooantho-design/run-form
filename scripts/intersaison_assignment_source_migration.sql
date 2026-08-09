begin;

-- Widen the assignment_source CHECK to support V2 assignments seeded from
-- guild_members at campaign creation. Existing assignments are not modified.
do $$
declare
  invalid_values text;
begin
  select string_agg(source_value || ' (' || row_count::text || ')', ', ' order by source_value)
  into invalid_values
  from (
    select
      coalesce(assignment_source, '<NULL>') as source_value,
      count(*) as row_count
    from public.intersaison_assignments
    where assignment_source is null
       or assignment_source not in ('poll', 'manual', 'draft_fallback', 'guild_member')
    group by coalesce(assignment_source, '<NULL>')
  ) invalid_sources;

  if invalid_values is not null then
    raise exception 'intersaison_assignments.assignment_source contains values incompatible with the widened check: %', invalid_values;
  end if;
end;
$$;

alter table public.intersaison_assignments
  drop constraint if exists intersaison_assignments_assignment_source_check;

alter table public.intersaison_assignments
  add constraint intersaison_assignments_assignment_source_check
  check (assignment_source in ('poll', 'manual', 'draft_fallback', 'guild_member'));

comment on constraint intersaison_assignments_assignment_source_check on public.intersaison_assignments is
  'Allowed assignment origins: poll, manual, draft_fallback, guild_member. guild_member is used by Inter-saison V2 for roster-seeded assignments initially placed in BROUILLON.';

commit;
