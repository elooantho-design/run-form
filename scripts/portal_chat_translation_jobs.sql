BEGIN;

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.portal_chat_messages') is null then
    raise exception 'Table public.portal_chat_messages introuvable. Execute scripts/portal_chat.sql avant cette migration.';
  end if;

  if to_regclass('public.portal_chat_message_translations') is null then
    raise exception 'Table public.portal_chat_message_translations introuvable. Execute scripts/portal_chat.sql avant cette migration.';
  end if;
end $$;

create table if not exists public.portal_chat_translation_jobs (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.portal_chat_messages(id) on delete cascade,
  target_language text not null,
  source_hash text not null,
  provider text not null,
  model text not null default 'none',
  status text not null default 'pending',
  priority integer not null default 0,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  locked_at timestamptz null,
  locked_until timestamptz null,
  locked_by text null,
  available_at timestamptz null default now(),
  last_error text null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.portal_chat_translation_jobs
  add column if not exists message_id uuid,
  add column if not exists target_language text,
  add column if not exists source_hash text,
  add column if not exists provider text,
  add column if not exists model text not null default 'none',
  add column if not exists status text not null default 'pending',
  add column if not exists priority integer not null default 0,
  add column if not exists attempts integer not null default 0,
  add column if not exists max_attempts integer not null default 3,
  add column if not exists locked_at timestamptz null,
  add column if not exists locked_until timestamptz null,
  add column if not exists locked_by text null,
  add column if not exists available_at timestamptz null default now(),
  add column if not exists last_error text null,
  add column if not exists completed_at timestamptz null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from public.portal_chat_translation_jobs
    where message_id is null
      or target_language is null
      or length(trim(target_language)) = 0
      or source_hash is null
      or length(trim(source_hash)) = 0
      or provider is null
      or length(trim(provider)) = 0
      or model is null
      or length(trim(model)) = 0
  ) then
    raise exception 'portal_chat_translation_jobs contient des valeurs obligatoires NULL ou vides. Corrige les donnees avant migration.';
  end if;
end $$;

alter table public.portal_chat_translation_jobs
  alter column message_id set not null,
  alter column target_language set not null,
  alter column source_hash set not null,
  alter column provider set not null,
  alter column model set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'portal_chat_translation_jobs_message_id_fkey'
      and conrelid = 'public.portal_chat_translation_jobs'::regclass
  ) then
    alter table public.portal_chat_translation_jobs
      add constraint portal_chat_translation_jobs_message_id_fkey
      foreign key (message_id)
      references public.portal_chat_messages(id)
      on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'portal_chat_translation_jobs_status_check'
      and conrelid = 'public.portal_chat_translation_jobs'::regclass
  ) then
    alter table public.portal_chat_translation_jobs
      add constraint portal_chat_translation_jobs_status_check
      check (status in ('pending', 'processing', 'completed', 'failed'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'portal_chat_translation_jobs_attempts_check'
      and conrelid = 'public.portal_chat_translation_jobs'::regclass
  ) then
    alter table public.portal_chat_translation_jobs
      add constraint portal_chat_translation_jobs_attempts_check
      check (attempts >= 0 and max_attempts between 1 and 10);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'portal_chat_translation_jobs_language_check'
      and conrelid = 'public.portal_chat_translation_jobs'::regclass
  ) then
    alter table public.portal_chat_translation_jobs
      add constraint portal_chat_translation_jobs_language_check
      check (target_language ~ '^[a-z]{2,8}(-[a-z0-9]{2,8})*$');
  end if;
end $$;

create unique index if not exists portal_chat_translation_jobs_identity_uidx
  on public.portal_chat_translation_jobs(message_id, target_language, source_hash, provider, model);

create index if not exists portal_chat_translation_jobs_claim_idx
  on public.portal_chat_translation_jobs(status, priority desc, available_at asc, created_at asc)
  where status in ('pending', 'processing');

create index if not exists portal_chat_translation_jobs_message_idx
  on public.portal_chat_translation_jobs(message_id, target_language, source_hash);

create or replace function public.portal_chat_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists portal_chat_translation_jobs_updated_at on public.portal_chat_translation_jobs;
create trigger portal_chat_translation_jobs_updated_at
before update on public.portal_chat_translation_jobs
for each row
execute function public.portal_chat_set_updated_at();

create or replace function public.portal_chat_claim_translation_job(
  p_worker_id text,
  p_lock_seconds integer default 90
)
returns setof public.portal_chat_translation_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidate as (
    select id
    from public.portal_chat_translation_jobs
    where (
        status = 'pending'
        and coalesce(available_at, now()) <= now()
      )
      or (
        status = 'processing'
        and locked_until is not null
        and locked_until < now()
      )
    order by priority desc, created_at asc, id asc
    for update skip locked
    limit 1
  )
  update public.portal_chat_translation_jobs job
  set
    status = 'processing',
    attempts = job.attempts + 1,
    locked_at = now(),
    locked_until = now() + make_interval(secs => greatest(15, least(600, p_lock_seconds))),
    locked_by = nullif(trim(p_worker_id), ''),
    last_error = null,
    updated_at = now()
  from candidate
  where job.id = candidate.id
  returning job.*;
end;
$$;

revoke all on public.portal_chat_translation_jobs from public, anon, authenticated;
grant all on public.portal_chat_translation_jobs to service_role;

revoke all on function public.portal_chat_claim_translation_job(text, integer) from public, anon, authenticated;
grant execute on function public.portal_chat_claim_translation_job(text, integer) to service_role;

COMMIT;
