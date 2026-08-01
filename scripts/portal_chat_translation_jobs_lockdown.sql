BEGIN;

do $$
begin
  if to_regclass('public.portal_chat_translation_jobs') is null then
    raise exception 'Table public.portal_chat_translation_jobs introuvable. Execute portal_chat_translation_jobs.sql avant le lockdown.';
  end if;
end $$;

alter table public.portal_chat_translation_jobs enable row level security;

revoke all on public.portal_chat_translation_jobs from anon, authenticated;
grant all on public.portal_chat_translation_jobs to service_role;

drop policy if exists portal_chat_translation_jobs_service_role_all on public.portal_chat_translation_jobs;
create policy portal_chat_translation_jobs_service_role_all
  on public.portal_chat_translation_jobs
  for all
  to service_role
  using (true)
  with check (true);

revoke all on function public.portal_chat_claim_translation_job(text, integer) from public, anon, authenticated;
grant execute on function public.portal_chat_claim_translation_job(text, integer) to service_role;

COMMIT;
