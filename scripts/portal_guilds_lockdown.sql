begin;

revoke all on table public.portal_guilds from anon, authenticated;
grant all on table public.portal_guilds to service_role;
alter table public.portal_guilds enable row level security;

drop policy if exists portal_guilds_service_role_all on public.portal_guilds;
create policy portal_guilds_service_role_all
on public.portal_guilds
for all
to service_role
using (true)
with check (true);

commit;
