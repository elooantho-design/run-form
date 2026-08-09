-- Read-only preflight before widening intersaison_assignments.assignment_source.
-- This script does not mutate data.

select
  'assignment_source_constraints' as section,
  constraint_info.conname as constraint_name,
  pg_get_constraintdef(constraint_info.oid) as constraint_definition
from pg_constraint constraint_info
where constraint_info.conrelid = 'public.intersaison_assignments'::regclass
  and constraint_info.contype = 'c'
  and pg_get_constraintdef(constraint_info.oid) ilike '%assignment_source%'
order by constraint_info.conname;

select
  'assignment_source_distribution' as section,
  coalesce(assignment.assignment_source, '<NULL>') as assignment_source,
  count(*) as row_count
from public.intersaison_assignments assignment
group by coalesce(assignment.assignment_source, '<NULL>')
order by assignment_source;

select
  'assignment_source_invalid_for_future_check' as section,
  coalesce(assignment.assignment_source, '<NULL>') as assignment_source,
  count(*) as row_count
from public.intersaison_assignments assignment
where assignment.assignment_source is null
   or assignment.assignment_source not in ('poll', 'manual', 'draft_fallback', 'guild_member')
group by coalesce(assignment.assignment_source, '<NULL>')
order by assignment_source;
