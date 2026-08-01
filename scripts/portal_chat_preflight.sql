-- Preflight lecture seule pour l'onglet Chat general.
-- Ce script ne cree, ne modifie et ne supprime aucune donnee.

select
  'table_exists' as check_name,
  'guild_members' as object_name,
  to_regclass('public.guild_members') is not null as ok;

select
  'table_exists' as check_name,
  'portal_chat_messages' as object_name,
  to_regclass('public.portal_chat_messages') is not null as ok;

select
  'table_exists' as check_name,
  'portal_chat_message_translations' as object_name,
  to_regclass('public.portal_chat_message_translations') is not null as ok;

select
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'guild_members',
    'portal_chat_messages',
    'portal_chat_message_translations'
  )
order by table_name, ordinal_position;

select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('portal_chat_messages', 'portal_chat_message_translations')
order by tablename, indexname;

select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('portal_chat_messages', 'portal_chat_message_translations')
order by c.relname;

select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('portal_chat_messages', 'portal_chat_message_translations')
order by tablename, policyname;

select
  grantee,
  table_name,
  privilege_type
from information_schema.table_privileges
where table_schema = 'public'
  and table_name in ('portal_chat_messages', 'portal_chat_message_translations')
  and grantee in ('anon', 'authenticated', 'service_role')
order by table_name, grantee, privilege_type;

do $$
declare
  duplicate_record record;
begin
  if to_regclass('public.portal_chat_messages') is not null then
    for duplicate_record in
      execute $query$
        select
          author_member_id,
          client_message_id,
          count(*) as duplicate_count
        from public.portal_chat_messages
        where author_member_id is not null
        group by author_member_id, client_message_id
        having count(*) > 1
      $query$
    loop
      raise notice 'Doublon message idempotent potentiel: author_member_id=%, client_message_id=%, count=%',
        duplicate_record.author_member_id,
        duplicate_record.client_message_id,
        duplicate_record.duplicate_count;
    end loop;
  end if;

  if to_regclass('public.portal_chat_message_translations') is not null then
    for duplicate_record in
      execute $query$
        select
          message_id,
          target_language,
          source_hash,
          count(*) as duplicate_count
        from public.portal_chat_message_translations
        group by message_id, target_language, source_hash
        having count(*) > 1
      $query$
    loop
      raise notice 'Doublon traduction potentiel: message_id=%, target_language=%, source_hash=%, count=%',
        duplicate_record.message_id,
        duplicate_record.target_language,
        duplicate_record.source_hash,
        duplicate_record.duplicate_count;
    end loop;
  end if;
end $$;
