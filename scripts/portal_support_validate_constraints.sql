begin;

do $$
begin
  if to_regclass('public.portal_support_payments') is null then
    raise exception 'public.portal_support_payments does not exist. Run scripts/portal_support.sql first.';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'portal_support_payments_amount_chk'
      and conrelid = 'public.portal_support_payments'::regclass
  ) then
    raise exception 'Constraint portal_support_payments_amount_chk does not exist. Run scripts/portal_support.sql first.';
  end if;

  if exists (
    select 1
    from public.portal_support_payments
    where amount_cents is null
      or amount_cents < 200
      or amount_refunded_cents is null
      or amount_refunded_cents < 0
      or amount_refunded_cents > amount_cents
  ) then
    raise exception 'Historical rows violate portal_support_payments_amount_chk. Resolve them explicitly before validating the constraint.';
  end if;
end $$;

alter table public.portal_support_payments
  validate constraint portal_support_payments_amount_chk;

commit;
