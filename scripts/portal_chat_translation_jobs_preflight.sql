-- Preflight lecture seule pour la file de traduction du Chat general.
-- Aucune ecriture. A executer avant portal_chat_translation_jobs.sql.

select
  'portal_chat_messages_exists' as check_name,
  to_regclass('public.portal_chat_messages') is not null as ok;

select
  'portal_chat_message_translations_exists' as check_name,
  to_regclass('public.portal_chat_message_translations') is not null as ok;

select
  'portal_chat_translation_jobs_exists' as check_name,
  to_regclass('public.portal_chat_translation_jobs') is not null as ok;

select
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'portal_chat_messages',
    'portal_chat_message_translations',
    'portal_chat_translation_jobs'
  )
order by table_name, ordinal_position;

select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in (
    'portal_chat_messages',
    'portal_chat_message_translations',
    'portal_chat_translation_jobs'
  )
order by tablename, indexname;

select
  table_schema,
  table_name,
  privilege_type,
  grantee
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'portal_chat_messages',
    'portal_chat_message_translations',
    'portal_chat_translation_jobs'
  )
order by table_name, grantee, privilege_type;

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
  and tablename in (
    'portal_chat_messages',
    'portal_chat_message_translations',
    'portal_chat_translation_jobs'
  )
order by tablename, policyname;

select
  'portal_chat_pending_messages' as metric,
  count(*)::bigint as value
from public.portal_chat_messages
where translation_status = 'pending';

select
  'portal_chat_existing_translations' as metric,
  count(*)::bigint as value
from public.portal_chat_message_translations;

select
  'portal_chat_duplicate_ready_translations' as check_name,
  message_id,
  target_language,
  source_hash,
  count(*)::bigint as duplicate_count
from public.portal_chat_message_translations
group by message_id, target_language, source_hash
having count(*) > 1
order by duplicate_count desc
limit 20;
