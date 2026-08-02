begin;

do $$
begin
  if to_regclass('public.portal_chat_message_attachments') is null then
    raise exception 'Table public.portal_chat_message_attachments missing. Run scripts/portal_chat_attachments.sql first.';
  end if;
end $$;

alter table public.portal_chat_message_attachments enable row level security;

revoke all on public.portal_chat_message_attachments from anon, authenticated;
grant all on public.portal_chat_message_attachments to service_role;

drop policy if exists portal_chat_message_attachments_service_role_all on public.portal_chat_message_attachments;
create policy portal_chat_message_attachments_service_role_all
  on public.portal_chat_message_attachments
  for all
  to service_role
  using (true)
  with check (true);

commit;
