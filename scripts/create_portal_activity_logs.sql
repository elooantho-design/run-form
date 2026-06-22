create table if not exists public.portal_activity_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_member_id uuid null,
  actor_name text null,
  target_member_id uuid null,
  target_name text null,
  action_type text not null,
  entity_type text null,
  entity_id text null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists portal_activity_logs_created_at_idx
  on public.portal_activity_logs (created_at desc);

create index if not exists portal_activity_logs_actor_member_id_idx
  on public.portal_activity_logs (actor_member_id);

create index if not exists portal_activity_logs_target_member_id_idx
  on public.portal_activity_logs (target_member_id);

create index if not exists portal_activity_logs_action_type_idx
  on public.portal_activity_logs (action_type);
