-- Lockdown RLS - profils createurs PVE enrichis.
-- Optionnel si scripts/pve_creator_profiles.sql a deja ete execute tel quel,
-- car la migration principale applique deja ces droits sur pve_creator_links.
-- Ce fichier est idempotent et ne modifie aucune donnee.

begin;

do $$
begin
  if to_regclass('public.pve_creators') is null then
    raise exception 'Table public.pve_creators introuvable. Execute d''abord scripts/add_pve_creators.sql.';
  end if;

  if to_regclass('public.pve_creator_links') is null then
    raise exception 'Table public.pve_creator_links introuvable. Execute d''abord scripts/pve_creator_profiles.sql.';
  end if;
end $$;

revoke all on table public.pve_creators from anon, authenticated;
grant select on table public.pve_creators to anon, authenticated;
grant select, insert, update, delete on table public.pve_creators to service_role;

alter table public.pve_creator_links enable row level security;

revoke all on table public.pve_creator_links from anon, authenticated;
grant select, insert, update, delete on table public.pve_creator_links to service_role;

drop policy if exists pve_creator_links_service_role_all on public.pve_creator_links;
create policy pve_creator_links_service_role_all
  on public.pve_creator_links
  for all
  to service_role
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

commit;
