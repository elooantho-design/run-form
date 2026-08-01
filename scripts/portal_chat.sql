BEGIN;

create extension if not exists pgcrypto;

create table if not exists public.portal_chat_messages (
  id uuid primary key default gen_random_uuid(),
  channel_key text not null default 'global',
  client_message_id uuid not null,
  author_member_id uuid null references public.guild_members(id) on delete set null,
  body_original text not null,
  body_hash text not null,
  source_language text not null default 'und',
  language_hint text null,
  reply_to_message_id uuid null,
  translation_status text not null default 'disabled',
  created_at timestamptz not null default now(),
  deleted_at timestamptz null
);

alter table public.portal_chat_messages
  add column if not exists channel_key text not null default 'global',
  add column if not exists client_message_id uuid,
  add column if not exists author_member_id uuid null,
  add column if not exists body_original text,
  add column if not exists body_hash text,
  add column if not exists source_language text not null default 'und',
  add column if not exists language_hint text null,
  add column if not exists reply_to_message_id uuid null,
  add column if not exists translation_status text not null default 'disabled',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz null;

do $$
begin
  if exists (
    select 1
    from public.portal_chat_messages
    where client_message_id is null
  ) then
    raise exception 'portal_chat_messages.client_message_id contient des valeurs NULL. Corrige les donnees avant migration.';
  end if;

  if exists (
    select 1
    from public.portal_chat_messages
    where body_original is null or length(trim(body_original)) = 0
  ) then
    raise exception 'portal_chat_messages.body_original contient des valeurs NULL ou vides. Corrige les donnees avant migration.';
  end if;

  if exists (
    select 1
    from public.portal_chat_messages
    where body_hash is null or length(trim(body_hash)) = 0
  ) then
    raise exception 'portal_chat_messages.body_hash contient des valeurs NULL ou vides. Corrige les donnees avant migration.';
  end if;
end $$;

alter table public.portal_chat_messages
  alter column client_message_id set not null,
  alter column body_original set not null,
  alter column body_hash set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'portal_chat_messages_author_member_id_fkey'
      and conrelid = 'public.portal_chat_messages'::regclass
  ) then
    alter table public.portal_chat_messages
      add constraint portal_chat_messages_author_member_id_fkey
      foreign key (author_member_id)
      references public.guild_members(id)
      on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'portal_chat_messages_reply_to_message_id_fkey'
      and conrelid = 'public.portal_chat_messages'::regclass
  ) then
    alter table public.portal_chat_messages
      add constraint portal_chat_messages_reply_to_message_id_fkey
      foreign key (reply_to_message_id)
      references public.portal_chat_messages(id)
      on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'portal_chat_messages_body_length_check'
      and conrelid = 'public.portal_chat_messages'::regclass
  ) then
    alter table public.portal_chat_messages
      add constraint portal_chat_messages_body_length_check
      check (
        length(trim(body_original)) > 0
        and char_length(body_original) <= 10000
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'portal_chat_messages_language_check'
      and conrelid = 'public.portal_chat_messages'::regclass
  ) then
    alter table public.portal_chat_messages
      add constraint portal_chat_messages_language_check
      check (
        source_language ~ '^[a-z]{2,8}(-[a-z0-9]{2,8})*$'
        and (
          language_hint is null
          or language_hint ~ '^[a-z]{2,8}(-[a-z0-9]{2,8})*$'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'portal_chat_messages_translation_status_check'
      and conrelid = 'public.portal_chat_messages'::regclass
  ) then
    alter table public.portal_chat_messages
      add constraint portal_chat_messages_translation_status_check
      check (translation_status in ('pending', 'ready', 'partial', 'failed', 'disabled'));
  end if;
end $$;

create unique index if not exists portal_chat_messages_author_client_uidx
  on public.portal_chat_messages(author_member_id, client_message_id)
  where author_member_id is not null;

create index if not exists portal_chat_messages_channel_created_idx
  on public.portal_chat_messages(channel_key, created_at desc, id desc);

create index if not exists portal_chat_messages_author_idx
  on public.portal_chat_messages(author_member_id, created_at desc);

create index if not exists portal_chat_messages_reply_idx
  on public.portal_chat_messages(reply_to_message_id)
  where reply_to_message_id is not null;

create table if not exists public.portal_chat_message_translations (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.portal_chat_messages(id) on delete cascade,
  target_language text not null,
  source_hash text not null,
  translated_body text not null,
  provider text not null default 'disabled',
  model text null,
  status text not null default 'ready',
  char_count integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.portal_chat_message_translations
  add column if not exists message_id uuid,
  add column if not exists target_language text,
  add column if not exists source_hash text,
  add column if not exists translated_body text,
  add column if not exists provider text not null default 'disabled',
  add column if not exists model text null,
  add column if not exists status text not null default 'ready',
  add column if not exists char_count integer not null default 0,
  add column if not exists created_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from public.portal_chat_message_translations
    where message_id is null
      or target_language is null
      or length(trim(target_language)) = 0
      or source_hash is null
      or length(trim(source_hash)) = 0
      or translated_body is null
      or length(trim(translated_body)) = 0
  ) then
    raise exception 'portal_chat_message_translations contient des valeurs obligatoires NULL ou vides. Corrige les donnees avant migration.';
  end if;
end $$;

alter table public.portal_chat_message_translations
  alter column message_id set not null,
  alter column target_language set not null,
  alter column source_hash set not null,
  alter column translated_body set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'portal_chat_message_translations_message_id_fkey'
      and conrelid = 'public.portal_chat_message_translations'::regclass
  ) then
    alter table public.portal_chat_message_translations
      add constraint portal_chat_message_translations_message_id_fkey
      foreign key (message_id)
      references public.portal_chat_messages(id)
      on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'portal_chat_message_translations_language_check'
      and conrelid = 'public.portal_chat_message_translations'::regclass
  ) then
    alter table public.portal_chat_message_translations
      add constraint portal_chat_message_translations_language_check
      check (target_language ~ '^[a-z]{2,8}(-[a-z0-9]{2,8})*$');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'portal_chat_message_translations_status_check'
      and conrelid = 'public.portal_chat_message_translations'::regclass
  ) then
    alter table public.portal_chat_message_translations
      add constraint portal_chat_message_translations_status_check
      check (status in ('ready', 'failed', 'disabled'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'portal_chat_message_translations_char_count_check'
      and conrelid = 'public.portal_chat_message_translations'::regclass
  ) then
    alter table public.portal_chat_message_translations
      add constraint portal_chat_message_translations_char_count_check
      check (char_count >= 0);
  end if;
end $$;

create unique index if not exists portal_chat_translations_message_target_hash_uidx
  on public.portal_chat_message_translations(message_id, target_language, source_hash);

create index if not exists portal_chat_translations_target_idx
  on public.portal_chat_message_translations(target_language, created_at desc);

COMMIT;
