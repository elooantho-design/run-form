begin;

-- Targeted seed for durable non-roster accounts.
-- Replace the UUID placeholders below with the exact ids returned by
-- scripts/guild_members_roster_status_preflight.sql before execution.
--
-- This seed intentionally targets only:
--   Kadichon -> non_roster
--   Moontoon -> non_roster
--
-- It does not touch Lilith, Lilith 2, Mokonou, or Xfix.
-- It does not change role, guild_code, permissions, status, assignment,
-- community_access_type, or community_status.

do $$
declare
  v_placeholder uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  v_kadichon_id uuid := '4806beaf-2530-4fbe-810c-8a7e7f7defcb'::uuid;
  v_moontoon_id uuid := '2a73b19f-63cd-4e75-bcab-5de7e0a0d4da'::uuid;
  invalid_targets text;
begin
  if v_kadichon_id = v_placeholder or v_moontoon_id = v_placeholder then
    raise exception 'Replace Kadichon and Moontoon UUID placeholders with exact guild_members.id values before running this seed.';
  end if;

  select string_agg(format('%s (%s)', target.expected_watcher_name, target.member_id), ', ')
  into invalid_targets
  from (
    values
      (v_kadichon_id, 'Kadichon'),
      (v_moontoon_id, 'Moontoon')
  ) as target(member_id, expected_watcher_name)
  left join public.guild_members member
    on member.id = target.member_id
   and lower(member.watcher_name) = lower(target.expected_watcher_name)
  where member.id is null;

  if invalid_targets is not null then
    raise exception 'Roster seed target id/name mismatch or missing member: %', invalid_targets;
  end if;

  update public.guild_members
  set roster_status = 'non_roster'
  where id in (v_kadichon_id, v_moontoon_id)
    and roster_status <> 'non_roster';
end $$;

commit;
