begin;

do $$
begin
  if to_regclass('public.guild_members') is null then
    raise exception 'Table public.guild_members introuvable.';
  end if;
end $$;

create table if not exists public.portal_member_activity_state (
  member_id uuid primary key references public.guild_members(id) on delete cascade,
  last_seen_at timestamptz null,
  last_pb_update_at timestamptz null,
  last_demonic_update_at timestamptz null,
  last_hero_box_update_at timestamptz null,
  last_gvg_strat_view_at timestamptz null,
  last_gvg_strat_context_id text null,
  last_gvg_repro_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists portal_member_activity_state_last_seen_at_idx
  on public.portal_member_activity_state (last_seen_at desc);

create index if not exists portal_member_activity_state_gvg_strat_context_idx
  on public.portal_member_activity_state (last_gvg_strat_context_id);

create index if not exists portal_member_activity_state_updated_at_idx
  on public.portal_member_activity_state (updated_at desc);

alter table public.portal_member_activity_state enable row level security;

revoke all on table public.portal_member_activity_state from anon;
revoke all on table public.portal_member_activity_state from authenticated;
grant select, insert, update, delete on table public.portal_member_activity_state to service_role;

with log_backfill as (
  select
    member.id as member_id,
    max(log.created_at) filter (where log.actor_member_id = member.id) as last_seen_at,
    max(log.created_at) filter (
      where log.action_type in ('pb_update', 'pb_hero_update')
        and (log.target_member_id = member.id or log.actor_member_id = member.id)
    ) as last_pb_update_at,
    max(log.created_at) filter (
      where log.action_type = 'demon_monster_update'
        and (log.target_member_id = member.id or log.actor_member_id = member.id)
    ) as last_demonic_update_at,
    max(log.created_at) filter (
      where log.action_type in ('hero_box_update', 'hero_box_bulk_a5')
        and (log.target_member_id = member.id or log.actor_member_id = member.id)
    ) as last_hero_box_update_at
  from public.guild_members member
  left join public.portal_activity_logs log
    on log.actor_member_id = member.id
    or log.target_member_id = member.id
  where coalesce(member.guild_code, '') <> ''
    and coalesce(member.community_access_type, '') <> 'community'
    and coalesce(member.role, '') not in ('community_member', 'content_creator')
    and coalesce(member.roster_status, 'active') = 'active'
  group by member.id
),
repro_backfill as (
  select
    member_id,
    max(coalesce(updated_at, created_at)) as last_gvg_repro_at
  from public.gvg_repro
  where member_id is not null
  group by member_id
),
prepared as (
  select
    log_backfill.member_id,
    log_backfill.last_seen_at,
    log_backfill.last_pb_update_at,
    log_backfill.last_demonic_update_at,
    log_backfill.last_hero_box_update_at,
    null::timestamptz as last_gvg_strat_view_at,
    null::text as last_gvg_strat_context_id,
    repro_backfill.last_gvg_repro_at,
    now() as touched_at
  from log_backfill
  left join repro_backfill on repro_backfill.member_id = log_backfill.member_id
)
insert into public.portal_member_activity_state (
  member_id,
  last_seen_at,
  last_pb_update_at,
  last_demonic_update_at,
  last_hero_box_update_at,
  last_gvg_strat_view_at,
  last_gvg_strat_context_id,
  last_gvg_repro_at,
  updated_at
)
select
  member_id,
  last_seen_at,
  last_pb_update_at,
  last_demonic_update_at,
  last_hero_box_update_at,
  last_gvg_strat_view_at,
  last_gvg_strat_context_id,
  last_gvg_repro_at,
  touched_at
from prepared
on conflict (member_id) do update set
  last_seen_at = coalesce(greatest(portal_member_activity_state.last_seen_at, excluded.last_seen_at), portal_member_activity_state.last_seen_at, excluded.last_seen_at),
  last_pb_update_at = coalesce(greatest(portal_member_activity_state.last_pb_update_at, excluded.last_pb_update_at), portal_member_activity_state.last_pb_update_at, excluded.last_pb_update_at),
  last_demonic_update_at = coalesce(greatest(portal_member_activity_state.last_demonic_update_at, excluded.last_demonic_update_at), portal_member_activity_state.last_demonic_update_at, excluded.last_demonic_update_at),
  last_hero_box_update_at = coalesce(greatest(portal_member_activity_state.last_hero_box_update_at, excluded.last_hero_box_update_at), portal_member_activity_state.last_hero_box_update_at, excluded.last_hero_box_update_at),
  last_gvg_repro_at = coalesce(greatest(portal_member_activity_state.last_gvg_repro_at, excluded.last_gvg_repro_at), portal_member_activity_state.last_gvg_repro_at, excluded.last_gvg_repro_at),
  updated_at = excluded.updated_at;

commit;
