-- Preflight read-only for portal_chat_message_reactions.

select
  'portal_chat_messages_exists' as check_name,
  to_regclass('public.portal_chat_messages') is not null as ok;

select
  'guild_members_exists' as check_name,
  to_regclass('public.guild_members') is not null as ok;

select
  'portal_chat_message_reactions_exists' as check_name,
  to_regclass('public.portal_chat_message_reactions') is not null as ok;

select
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('portal_chat_messages', 'guild_members', 'portal_chat_message_reactions')
order by table_name, ordinal_position;

select
  tablename,
  policyname,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'portal_chat_message_reactions'
order by policyname;

select
  grantee,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'portal_chat_message_reactions'
order by grantee, privilege_type;

select
  conname,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = to_regclass('public.portal_chat_message_reactions');
