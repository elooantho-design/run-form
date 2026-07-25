begin;

create extension if not exists pgcrypto;

create or replace function public.portal_support_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.portal_support_payments (
  id uuid primary key default gen_random_uuid()
);

alter table public.portal_support_payments
  add column if not exists provider text not null default 'stripe',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists support_type text not null default 'one_time',
  add column if not exists amount_cents integer not null default 0,
  add column if not exists currency text not null default 'eur',
  add column if not exists status text not null default 'pending',
  add column if not exists paid_at timestamptz null,
  add column if not exists member_id uuid null,
  add column if not exists donor_public_name text null,
  add column if not exists donor_message text null,
  add column if not exists display_publicly boolean not null default false,
  add column if not exists anonymous boolean not null default true,
  add column if not exists stripe_checkout_session_id text null,
  add column if not exists stripe_payment_intent_id text null,
  add column if not exists stripe_invoice_id text null,
  add column if not exists stripe_subscription_id text null,
  add column if not exists stripe_customer_id text null,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if exists (
    select 1
    from public.portal_support_payments
    where provider is null
      or support_type is null
      or amount_cents is null
      or currency is null
      or status is null
      or display_publicly is null
      or anonymous is null
      or metadata is null
  ) then
    raise exception 'portal_support_payments contains null values in required columns.';
  end if;

  alter table public.portal_support_payments
    alter column provider set not null,
    alter column created_at set not null,
    alter column updated_at set not null,
    alter column support_type set not null,
    alter column amount_cents set not null,
    alter column currency set not null,
    alter column status set not null,
    alter column display_publicly set not null,
    alter column anonymous set not null,
    alter column metadata set not null;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'portal_support_payments_member_id_fkey'
  ) then
    alter table public.portal_support_payments
      add constraint portal_support_payments_member_id_fkey
      foreign key (member_id) references public.guild_members(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'portal_support_payments_provider_chk'
  ) then
    alter table public.portal_support_payments
      add constraint portal_support_payments_provider_chk
      check (provider = 'stripe');
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'portal_support_payments_support_type_chk'
  ) then
    alter table public.portal_support_payments
      add constraint portal_support_payments_support_type_chk
      check (support_type in ('one_time', 'monthly'));
  end if;

  alter table public.portal_support_payments
    drop constraint if exists portal_support_payments_amount_chk;

  alter table public.portal_support_payments
    add constraint portal_support_payments_amount_chk
    check (amount_cents >= 200);

  if not exists (
    select 1 from pg_constraint where conname = 'portal_support_payments_currency_chk'
  ) then
    alter table public.portal_support_payments
      add constraint portal_support_payments_currency_chk
      check (currency = 'eur');
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'portal_support_payments_status_chk'
  ) then
    alter table public.portal_support_payments
      add constraint portal_support_payments_status_chk
      check (status in ('pending', 'confirmed', 'failed', 'canceled', 'refunded', 'active'));
  end if;
end $$;

create unique index if not exists portal_support_payments_checkout_session_uidx
  on public.portal_support_payments (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create unique index if not exists portal_support_payments_payment_intent_uidx
  on public.portal_support_payments (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create unique index if not exists portal_support_payments_invoice_uidx
  on public.portal_support_payments (stripe_invoice_id)
  where stripe_invoice_id is not null;

create index if not exists portal_support_payments_status_paid_idx
  on public.portal_support_payments (status, paid_at desc);

create index if not exists portal_support_payments_member_idx
  on public.portal_support_payments (member_id, created_at desc);

create index if not exists portal_support_payments_subscription_idx
  on public.portal_support_payments (stripe_subscription_id)
  where stripe_subscription_id is not null;

create index if not exists portal_support_payments_public_idx
  on public.portal_support_payments (display_publicly, anonymous, paid_at desc)
  where status = 'confirmed';

drop trigger if exists portal_support_payments_touch_updated_at on public.portal_support_payments;
create trigger portal_support_payments_touch_updated_at
before update on public.portal_support_payments
for each row execute function public.portal_support_touch_updated_at();

create table if not exists public.portal_support_webhook_events (
  id uuid primary key default gen_random_uuid()
);

alter table public.portal_support_webhook_events
  add column if not exists provider text not null default 'stripe',
  add column if not exists event_id text not null,
  add column if not exists event_type text not null,
  add column if not exists status text not null default 'processing',
  add column if not exists received_at timestamptz not null default now(),
  add column if not exists processed_at timestamptz null,
  add column if not exists error text null,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if exists (
    select 1
    from public.portal_support_webhook_events
    where provider is null
      or nullif(trim(event_id), '') is null
      or nullif(trim(event_type), '') is null
      or status is null
      or received_at is null
      or metadata is null
  ) then
    raise exception 'portal_support_webhook_events contains invalid required values.';
  end if;

  alter table public.portal_support_webhook_events
    alter column provider set not null,
    alter column event_id set not null,
    alter column event_type set not null,
    alter column status set not null,
    alter column received_at set not null,
    alter column metadata set not null;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'portal_support_webhook_events_provider_chk'
  ) then
    alter table public.portal_support_webhook_events
      add constraint portal_support_webhook_events_provider_chk
      check (provider = 'stripe');
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'portal_support_webhook_events_status_chk'
  ) then
    alter table public.portal_support_webhook_events
      add constraint portal_support_webhook_events_status_chk
      check (status in ('processing', 'processed', 'failed', 'ignored'));
  end if;
end $$;

create unique index if not exists portal_support_webhook_events_provider_event_uidx
  on public.portal_support_webhook_events (provider, event_id);

create index if not exists portal_support_webhook_events_received_idx
  on public.portal_support_webhook_events (received_at desc);

alter table public.portal_support_payments enable row level security;
alter table public.portal_support_webhook_events enable row level security;

revoke all on public.portal_support_payments from anon, authenticated;
revoke all on public.portal_support_webhook_events from anon, authenticated;

grant select, insert, update, delete on public.portal_support_payments to service_role;
grant select, insert, update, delete on public.portal_support_webhook_events to service_role;

drop policy if exists portal_support_payments_service_role_all on public.portal_support_payments;
create policy portal_support_payments_service_role_all
on public.portal_support_payments
for all
to service_role
using (true)
with check (true);

drop policy if exists portal_support_webhook_events_service_role_all on public.portal_support_webhook_events;
create policy portal_support_webhook_events_service_role_all
on public.portal_support_webhook_events
for all
to service_role
using (true)
with check (true);

commit;
