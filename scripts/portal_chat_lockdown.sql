BEGIN;

do $$
begin
  if to_regclass('public.portal_chat_messages') is null then
    raise exception 'Table public.portal_chat_messages introuvable. Execute portal_chat.sql avant le lockdown.';
  end if;

  if to_regclass('public.portal_chat_message_translations') is null then
    raise exception 'Table public.portal_chat_message_translations introuvable. Execute portal_chat.sql avant le lockdown.';
  end if;
end $$;

alter table public.portal_chat_messages enable row level security;
alter table public.portal_chat_message_translations enable row level security;

revoke all on public.portal_chat_messages from anon, authenticated;
revoke all on public.portal_chat_message_translations from anon, authenticated;

grant all on public.portal_chat_messages to service_role;
grant all on public.portal_chat_message_translations to service_role;

drop policy if exists portal_chat_messages_service_role_all on public.portal_chat_messages;
create policy portal_chat_messages_service_role_all
  on public.portal_chat_messages
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists portal_chat_translations_service_role_all on public.portal_chat_message_translations;
create policy portal_chat_translations_service_role_all
  on public.portal_chat_message_translations
  for all
  to service_role
  using (true)
  with check (true);

COMMIT;
