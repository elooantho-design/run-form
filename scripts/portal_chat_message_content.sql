begin;

do $$
begin
  if to_regclass('public.portal_chat_messages') is null then
    raise exception 'Table public.portal_chat_messages missing. Run scripts/portal_chat.sql first.';
  end if;
end $$;

alter table public.portal_chat_messages
  add column if not exists content_type text not null default 'text';

do $$
begin
  if exists (
    select 1
    from public.portal_chat_messages
    where content_type not in ('text', 'gif', 'mixed')
       or content_type is null
  ) then
    raise exception 'portal_chat_messages.content_type has invalid values. Fix data before migration.';
  end if;

  if exists (
    select 1
    from public.portal_chat_messages
    where body_original is null
  ) then
    raise exception 'portal_chat_messages.body_original has NULL values. Fix data before migration.';
  end if;
end $$;

alter table public.portal_chat_messages
  alter column content_type set not null;

alter table public.portal_chat_messages
  drop constraint if exists portal_chat_messages_content_type_check;

alter table public.portal_chat_messages
  add constraint portal_chat_messages_content_type_check
  check (content_type in ('text', 'gif', 'mixed'));

alter table public.portal_chat_messages
  drop constraint if exists portal_chat_messages_body_length_check;

alter table public.portal_chat_messages
  add constraint portal_chat_messages_body_length_check
  check (
    body_original is not null
    and char_length(body_original) <= 10000
    and (
      length(trim(body_original)) > 0
      or content_type = 'gif'
    )
  );

commit;
