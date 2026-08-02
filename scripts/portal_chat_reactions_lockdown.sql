begin;

do $$
begin
  if to_regclass('public.portal_chat_message_reactions') is null then
    raise exception 'Table public.portal_chat_message_reactions missing. Run scripts/portal_chat_reactions.sql first.';
  end if;
end $$;

alter table public.portal_chat_message_reactions enable row level security;

revoke all on public.portal_chat_message_reactions from anon, authenticated;
grant all on public.portal_chat_message_reactions to service_role;

drop policy if exists portal_chat_message_reactions_service_role_all on public.portal_chat_message_reactions;
create policy portal_chat_message_reactions_service_role_all
  on public.portal_chat_message_reactions
  for all
  to service_role
  using (true)
  with check (true);

commit;
