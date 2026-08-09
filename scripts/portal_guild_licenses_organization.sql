begin;

alter table public.portal_guild_licenses
  add column if not exists organization_id uuid null references public.portal_organizations(id) on delete set null;

create index if not exists portal_guild_licenses_organization_idx
  on public.portal_guild_licenses (organization_id);

update public.portal_guild_licenses license
set
  organization_id = org.id,
  updated_at = now()
from public.portal_organizations org
where license.organization_id is null
  and lower(license.guild_space_key) = org.organization_key
  and org.organization_key in ('mad', 'guildtest');

commit;
