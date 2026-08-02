-- Preflight read-only for portal_chat_messages content typing.
-- This script performs no persistent writes and does not change data.

select
  'portal_chat_messages_exists' as check_name,
  to_regclass('public.portal_chat_messages') is not null as ok;

select
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'portal_chat_messages'
order by ordinal_position;

select
  conname,
  contype,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = to_regclass('public.portal_chat_messages')
order by conname;

select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'portal_chat_messages'
order by indexname;

select
  'message_count' as check_name,
  count(*)::bigint as value
from public.portal_chat_messages;

select
  'body_original_null_count' as check_name,
  count(*)::bigint as value
from public.portal_chat_messages
where body_original is null;

select
  'body_original_empty_after_trim_count' as check_name,
  count(*)::bigint as value
from public.portal_chat_messages
where body_original is not null
  and length(trim(body_original)) = 0;

select
  'body_original_over_10000_count' as check_name,
  count(*)::bigint as value
from public.portal_chat_messages
where body_original is not null
  and char_length(body_original) > 10000;

select
  'legacy_text_compatible_count' as check_name,
  count(*)::bigint as value
from public.portal_chat_messages
where body_original is not null
  and length(trim(body_original)) > 0
  and char_length(body_original) <= 10000;

do $$
declare
  content_type_exists boolean;
  content_type_summary jsonb;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'portal_chat_messages'
      and column_name = 'content_type'
  )
  into content_type_exists;

  if content_type_exists then
    execute $sql$
      select coalesce(jsonb_agg(row_to_json(values_by_type)), '[]'::jsonb)
      from (
        select
          content_type,
          count(*)::bigint as count
        from public.portal_chat_messages
        group by content_type
        order by content_type nulls first
      ) values_by_type
    $sql$
    into content_type_summary;

    raise notice 'portal_chat_messages.content_type values: %', content_type_summary;
  else
    raise notice 'portal_chat_messages.content_type column missing before migration.';
  end if;
end $$;
