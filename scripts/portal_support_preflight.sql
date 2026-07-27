-- Read-only preflight for the Portal support Stripe schema.
-- This script intentionally performs no DDL and no DML.

select
  table_schema,
  table_name,
  column_name,
  ordinal_position,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('portal_support_payments', 'portal_support_webhook_events')
order by table_name, ordinal_position;

select
  n.nspname as table_schema,
  t.relname as table_name,
  c.conname as constraint_name,
  c.contype as constraint_type,
  pg_get_constraintdef(c.oid) as definition,
  c.convalidated as is_validated
from pg_constraint c
join pg_class t on t.oid = c.conrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public'
  and t.relname in ('portal_support_payments', 'portal_support_webhook_events')
order by t.relname, c.conname;

select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('portal_support_payments', 'portal_support_webhook_events')
order by tablename, policyname;

select
  table_schema,
  table_name,
  grantee,
  privilege_type,
  is_grantable
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('portal_support_payments', 'portal_support_webhook_events')
  and grantee in ('anon', 'authenticated', 'service_role')
order by table_name, grantee, privilege_type;

do $$
declare
  has_payments boolean := to_regclass('public.portal_support_payments') is not null;
  has_amount_cents boolean;
  has_amount_refunded_cents boolean;
  has_livemode boolean;
  has_status boolean;
  has_checkout_session boolean;
  sql text;
  row_data record;
begin
  if not has_payments then
    raise notice 'public.portal_support_payments does not exist yet. Payment compatibility check skipped.';
    return;
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'portal_support_payments'
      and column_name = 'amount_cents'
  ) into has_amount_cents;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'portal_support_payments'
      and column_name = 'amount_refunded_cents'
  ) into has_amount_refunded_cents;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'portal_support_payments'
      and column_name = 'livemode'
  ) into has_livemode;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'portal_support_payments'
      and column_name = 'status'
  ) into has_status;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'portal_support_payments'
      and column_name = 'stripe_checkout_session_id'
  ) into has_checkout_session;

  if not has_amount_cents then
    raise notice 'public.portal_support_payments.amount_cents is missing. Future amount constraint cannot be checked on historical payments.';
    return;
  end if;

  sql := format(
    'select id, amount_cents, %s as amount_refunded_cents, %s as status, %s as livemode, %s as stripe_checkout_session_id
     from public.portal_support_payments
     where amount_cents is null
        or amount_cents < 200
        or %s is null
        or %s < 0
        or %s > amount_cents',
    case when has_amount_refunded_cents then 'amount_refunded_cents' else '0::integer' end,
    case when has_status then 'status' else 'null::text' end,
    case when has_livemode then 'livemode' else 'false::boolean' end,
    case when has_checkout_session then 'stripe_checkout_session_id' else 'null::text' end,
    case when has_amount_refunded_cents then 'amount_refunded_cents' else '0::integer' end,
    case when has_amount_refunded_cents then 'amount_refunded_cents' else '0::integer' end,
    case when has_amount_refunded_cents then 'amount_refunded_cents' else '0::integer' end
  );

  for row_data in execute sql loop
    raise notice 'Incompatible payment row: id %, amount_cents %, amount_refunded_cents %, status %, livemode %, checkout_session %',
      row_data.id,
      row_data.amount_cents,
      row_data.amount_refunded_cents,
      row_data.status,
      row_data.livemode,
      row_data.stripe_checkout_session_id;
  end loop;
end $$;

do $$
declare
  row_data record;
begin
  if to_regclass('public.portal_support_webhook_events') is null then
    raise notice 'public.portal_support_webhook_events does not exist yet. Webhook duplicate check skipped.';
    return;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'portal_support_webhook_events'
      and column_name = 'provider'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'portal_support_webhook_events'
      and column_name = 'event_id'
  ) then
    raise notice 'provider or event_id is missing on public.portal_support_webhook_events. Webhook duplicate check skipped.';
    return;
  end if;

  for row_data in execute
    'select provider, event_id, count(*) as row_count
     from public.portal_support_webhook_events
     group by provider, event_id
     having count(*) > 1'
  loop
    raise notice 'Duplicate webhook event: provider %, event_id %, count %',
      row_data.provider,
      row_data.event_id,
      row_data.row_count;
  end loop;
end $$;

do $$
declare
  checked_column text;
  row_data record;
begin
  if to_regclass('public.portal_support_payments') is null then
    raise notice 'public.portal_support_payments does not exist yet. Stripe payment duplicate checks skipped.';
    return;
  end if;

  foreach checked_column in array array['stripe_checkout_session_id', 'stripe_payment_intent_id', 'stripe_invoice_id']
  loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'portal_support_payments'
        and information_schema.columns.column_name = checked_column
    ) then
      raise notice 'public.portal_support_payments.% is missing. Duplicate check skipped for this column.', checked_column;
    else
      for row_data in execute format(
        'select %1$I as stripe_id, count(*) as row_count
         from public.portal_support_payments
         where %1$I is not null
         group by %1$I
         having count(*) > 1',
        checked_column
      )
      loop
        raise notice 'Duplicate payment Stripe id in column %: value %, count %',
          checked_column,
          row_data.stripe_id,
          row_data.row_count;
      end loop;
    end if;
  end loop;
end $$;

do $$
declare
  has_payments_livemode boolean;
  has_events_livemode boolean;
  test_count bigint;
  live_count bigint;
begin
  if to_regclass('public.portal_support_payments') is not null then
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'portal_support_payments'
        and column_name = 'livemode'
    ) into has_payments_livemode;

    if has_payments_livemode then
      execute 'select count(*) from public.portal_support_payments where livemode = false' into test_count;
      execute 'select count(*) from public.portal_support_payments where livemode = true' into live_count;
      raise notice 'portal_support_payments volumetry: Test %, Live %', test_count, live_count;
    else
      raise notice 'public.portal_support_payments.livemode is missing. Payment Test/Live volumetry skipped.';
    end if;
  end if;

  if to_regclass('public.portal_support_webhook_events') is not null then
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'portal_support_webhook_events'
        and column_name = 'livemode'
    ) into has_events_livemode;

    if has_events_livemode then
      execute 'select count(*) from public.portal_support_webhook_events where livemode = false' into test_count;
      execute 'select count(*) from public.portal_support_webhook_events where livemode = true' into live_count;
      raise notice 'portal_support_webhook_events volumetry: Test %, Live %', test_count, live_count;
    else
      raise notice 'public.portal_support_webhook_events.livemode is missing. Webhook Test/Live volumetry skipped.';
    end if;
  end if;
end $$;
