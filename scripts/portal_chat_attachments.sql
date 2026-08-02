begin;

do $$
begin
  if to_regclass('public.portal_chat_messages') is null then
    raise exception 'Table public.portal_chat_messages missing. Run scripts/portal_chat.sql first.';
  end if;
end $$;

create table if not exists public.portal_chat_message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.portal_chat_messages(id) on delete cascade,
  attachment_type text not null,
  provider text not null,
  provider_item_id text not null,
  media_url text not null,
  preview_url text null,
  width integer null,
  height integer null,
  title text null,
  created_at timestamptz not null default now()
);

alter table public.portal_chat_message_attachments
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists message_id uuid,
  add column if not exists attachment_type text,
  add column if not exists provider text,
  add column if not exists provider_item_id text,
  add column if not exists media_url text,
  add column if not exists preview_url text,
  add column if not exists width integer,
  add column if not exists height integer,
  add column if not exists title text,
  add column if not exists created_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from public.portal_chat_message_attachments
    where message_id is null
      or attachment_type is null
      or provider is null
      or provider_item_id is null
      or media_url is null
      or length(trim(attachment_type)) = 0
      or length(trim(provider)) = 0
      or length(trim(provider_item_id)) = 0
      or length(trim(media_url)) = 0
  ) then
    raise exception 'portal_chat_message_attachments has null or empty required values. Fix data before migration.';
  end if;
end $$;

alter table public.portal_chat_message_attachments
  alter column message_id set not null,
  alter column attachment_type set not null,
  alter column provider set not null,
  alter column provider_item_id set not null,
  alter column media_url set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'portal_chat_message_attachments_message_id_fkey'
      and conrelid = 'public.portal_chat_message_attachments'::regclass
  ) then
    alter table public.portal_chat_message_attachments
      add constraint portal_chat_message_attachments_message_id_fkey
      foreign key (message_id)
      references public.portal_chat_messages(id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'portal_chat_message_attachments_type_check'
      and conrelid = 'public.portal_chat_message_attachments'::regclass
  ) then
    alter table public.portal_chat_message_attachments
      add constraint portal_chat_message_attachments_type_check
      check (attachment_type in ('gif'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'portal_chat_message_attachments_provider_check'
      and conrelid = 'public.portal_chat_message_attachments'::regclass
  ) then
    alter table public.portal_chat_message_attachments
      add constraint portal_chat_message_attachments_provider_check
      check (
        length(trim(provider)) between 1 and 40
        and length(trim(provider_item_id)) between 1 and 160
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'portal_chat_message_attachments_url_check'
      and conrelid = 'public.portal_chat_message_attachments'::regclass
  ) then
    alter table public.portal_chat_message_attachments
      add constraint portal_chat_message_attachments_url_check
      check (
        media_url ~* '^https://'
        and (preview_url is null or preview_url ~* '^https://')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'portal_chat_message_attachments_size_check'
      and conrelid = 'public.portal_chat_message_attachments'::regclass
  ) then
    alter table public.portal_chat_message_attachments
      add constraint portal_chat_message_attachments_size_check
      check (
        (width is null or width > 0)
        and (height is null or height > 0)
        and (title is null or char_length(title) <= 2000)
      );
  end if;
end $$;

create unique index if not exists portal_chat_message_attachments_one_gif_idx
  on public.portal_chat_message_attachments(message_id)
  where attachment_type = 'gif';

create index if not exists portal_chat_message_attachments_message_idx
  on public.portal_chat_message_attachments(message_id);

commit;
