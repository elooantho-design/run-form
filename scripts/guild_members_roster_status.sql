begin;

-- Durable competitive roster eligibility.
-- This is intentionally separate from Dashboard access, permissions, guild membership,
-- defense preparation status, assignment, and community account status.
alter table public.guild_members
  add column if not exists roster_status text;

update public.guild_members
set roster_status = 'active'
where roster_status is null;

alter table public.guild_members
  alter column roster_status set default 'active';

do $$
declare
  invalid_values text;
begin
  select string_agg(distinct roster_status, ', ' order by roster_status)
  into invalid_values
  from public.guild_members
  where roster_status not in ('active', 'non_roster', 'inactive');

  if invalid_values is not null then
    raise exception 'guild_members.roster_status contains invalid values: %', invalid_values;
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_info
    where constraint_info.conrelid = 'public.guild_members'::regclass
      and constraint_info.conname = 'guild_members_roster_status_check'
  ) then
    alter table public.guild_members
      add constraint guild_members_roster_status_check
      check (roster_status in ('active', 'non_roster', 'inactive'));
  end if;
end $$;

alter table public.guild_members
  alter column roster_status set not null;

comment on column public.guild_members.roster_status is
  'Durable competitive roster eligibility. active = eligible roster member, non_roster = account keeps Dashboard access but is excluded from automatic competitive roster, inactive = durable inactive roster state.';

-- No index is created yet. Current volumes do not justify it before the future
-- Inter-saison RPC starts filtering on roster_status. At that time, prefer an
-- index matching the real query shape, likely (guild_code, roster_status) or
-- the future portal_guild_id equivalent.

-- Future Inter-saison campaign creation must select members from:
--   correct organization
--   active portal guild
--   guild_members.roster_status = 'active'
-- This field must never be interpreted as a permission or access flag.

commit;
