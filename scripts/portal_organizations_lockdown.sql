begin;

revoke all on table public.portal_organizations from anon, authenticated;
grant all on table public.portal_organizations to service_role;
alter table public.portal_organizations enable row level security;

drop policy if exists portal_organizations_service_role_all on public.portal_organizations;
create policy portal_organizations_service_role_all
on public.portal_organizations
for all
to service_role
using (true)
with check (true);

commit;
