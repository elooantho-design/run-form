begin;

do $$
begin
  if to_regclass('public.portal_support_payments') is null then
    raise exception 'public.portal_support_payments does not exist. Run scripts/portal_support.sql before lockdown.';
  end if;

  if to_regclass('public.portal_support_webhook_events') is null then
    raise exception 'public.portal_support_webhook_events does not exist. Run scripts/portal_support.sql before lockdown.';
  end if;
end $$;

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

do $$
begin
  if has_table_privilege('anon', 'public.portal_support_payments', 'select')
    or has_table_privilege('anon', 'public.portal_support_payments', 'insert')
    or has_table_privilege('anon', 'public.portal_support_payments', 'update')
    or has_table_privilege('anon', 'public.portal_support_payments', 'delete')
    or has_table_privilege('authenticated', 'public.portal_support_payments', 'select')
    or has_table_privilege('authenticated', 'public.portal_support_payments', 'insert')
    or has_table_privilege('authenticated', 'public.portal_support_payments', 'update')
    or has_table_privilege('authenticated', 'public.portal_support_payments', 'delete')
  then
    raise exception 'Unexpected anon/authenticated privilege remains on public.portal_support_payments.';
  end if;

  if has_table_privilege('anon', 'public.portal_support_webhook_events', 'select')
    or has_table_privilege('anon', 'public.portal_support_webhook_events', 'insert')
    or has_table_privilege('anon', 'public.portal_support_webhook_events', 'update')
    or has_table_privilege('anon', 'public.portal_support_webhook_events', 'delete')
    or has_table_privilege('authenticated', 'public.portal_support_webhook_events', 'select')
    or has_table_privilege('authenticated', 'public.portal_support_webhook_events', 'insert')
    or has_table_privilege('authenticated', 'public.portal_support_webhook_events', 'update')
    or has_table_privilege('authenticated', 'public.portal_support_webhook_events', 'delete')
  then
    raise exception 'Unexpected anon/authenticated privilege remains on public.portal_support_webhook_events.';
  end if;
end $$;

commit;
