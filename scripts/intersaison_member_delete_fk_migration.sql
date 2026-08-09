begin;

-- Preserve historical Inter-saison rows when a guild_members row is removed.
-- Assignments and notes keep their snapshots; only the nullable member FK is detached.

do $$
declare
  invalid_values text;
  existing_constraint_name text;
begin
  if to_regclass('public.guild_members') is null then
    raise exception 'Table public.guild_members introuvable.';
  end if;

  if to_regclass('public.intersaison_assignments') is null then
    raise exception 'Table public.intersaison_assignments introuvable.';
  end if;

  if to_regclass('public.intersaison_notes') is null then
    raise exception 'Table public.intersaison_notes introuvable.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'intersaison_assignments'
      and column_name = 'member_id'
  ) then
    raise exception 'Colonne public.intersaison_assignments.member_id introuvable.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'intersaison_notes'
      and column_name = 'created_by_member_id'
  ) then
    raise exception 'Colonne public.intersaison_notes.created_by_member_id introuvable.';
  end if;

  select string_agg(distinct assignment.member_id::text, ', ' order by assignment.member_id::text)
  into invalid_values
  from public.intersaison_assignments assignment
  left join public.guild_members member on member.id = assignment.member_id
  where assignment.member_id is not null
    and member.id is null;

  if invalid_values is not null then
    raise exception 'Impossible de creer la FK SET NULL: member_id orphelins dans intersaison_assignments: %', invalid_values;
  end if;

  select string_agg(distinct note.created_by_member_id::text, ', ' order by note.created_by_member_id::text)
  into invalid_values
  from public.intersaison_notes note
  left join public.guild_members member on member.id = note.created_by_member_id
  where note.created_by_member_id is not null
    and member.id is null;

  if invalid_values is not null then
    raise exception 'Impossible de creer la FK SET NULL: created_by_member_id orphelins dans intersaison_notes: %', invalid_values;
  end if;

  for existing_constraint_name in
    select constraint_info.conname
    from pg_constraint constraint_info
    where constraint_info.contype = 'f'
      and constraint_info.conrelid = 'public.intersaison_assignments'::regclass
      and constraint_info.confrelid = 'public.guild_members'::regclass
      and constraint_info.conkey = array[
        (
          select attribute_info.attnum
          from pg_attribute attribute_info
          where attribute_info.attrelid = 'public.intersaison_assignments'::regclass
            and attribute_info.attname = 'member_id'
        )
      ]::smallint[]
  loop
    execute format('alter table public.intersaison_assignments drop constraint %I', existing_constraint_name);
  end loop;

  for existing_constraint_name in
    select constraint_info.conname
    from pg_constraint constraint_info
    where constraint_info.contype = 'f'
      and constraint_info.conrelid = 'public.intersaison_notes'::regclass
      and constraint_info.confrelid = 'public.guild_members'::regclass
      and constraint_info.conkey = array[
        (
          select attribute_info.attnum
          from pg_attribute attribute_info
          where attribute_info.attrelid = 'public.intersaison_notes'::regclass
            and attribute_info.attname = 'created_by_member_id'
        )
      ]::smallint[]
  loop
    execute format('alter table public.intersaison_notes drop constraint %I', existing_constraint_name);
  end loop;
end $$;

alter table public.intersaison_assignments
  alter column member_id drop not null;

alter table public.intersaison_notes
  alter column created_by_member_id drop not null;

alter table public.intersaison_assignments
  add constraint intersaison_assignments_member_id_fkey
  foreign key (member_id)
  references public.guild_members(id)
  on delete set null;

alter table public.intersaison_notes
  add constraint intersaison_notes_created_by_member_id_fkey
  foreign key (created_by_member_id)
  references public.guild_members(id)
  on delete set null;

commit;
