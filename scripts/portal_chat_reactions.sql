begin;

do $$
begin
  if to_regclass('public.portal_chat_messages') is null then
    raise exception 'Table public.portal_chat_messages missing. Run scripts/portal_chat.sql first.';
  end if;
  if to_regclass('public.guild_members') is null then
    raise exception 'Table public.guild_members missing.';
  end if;
end $$;

create table if not exists public.portal_chat_message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.portal_chat_messages(id) on delete cascade,
  member_id uuid not null references public.guild_members(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now()
);

alter table public.portal_chat_message_reactions
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists message_id uuid,
  add column if not exists member_id uuid,
  add column if not exists emoji text,
  add column if not exists created_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1 from public.portal_chat_message_reactions
    where message_id is null or member_id is null or emoji is null or length(trim(emoji)) = 0
  ) then
    raise exception 'portal_chat_message_reactions has null or empty required values. Fix data before migration.';
  end if;
end $$;

alter table public.portal_chat_message_reactions
  alter column message_id set not null,
  alter column member_id set not null,
  alter column emoji set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'portal_chat_message_reactions_message_id_fkey'
      and conrelid = 'public.portal_chat_message_reactions'::regclass
  ) then
    alter table public.portal_chat_message_reactions
      add constraint portal_chat_message_reactions_message_id_fkey
      foreign key (message_id)
      references public.portal_chat_messages(id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'portal_chat_message_reactions_member_id_fkey'
      and conrelid = 'public.portal_chat_message_reactions'::regclass
  ) then
    alter table public.portal_chat_message_reactions
      add constraint portal_chat_message_reactions_member_id_fkey
      foreign key (member_id)
      references public.guild_members(id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'portal_chat_message_reactions_emoji_check'
      and conrelid = 'public.portal_chat_message_reactions'::regclass
  ) then
    alter table public.portal_chat_message_reactions
      add constraint portal_chat_message_reactions_emoji_check
      check (length(trim(emoji)) between 1 and 32);
  end if;
end $$;

create unique index if not exists portal_chat_message_reactions_unique_idx
  on public.portal_chat_message_reactions(message_id, member_id, emoji);

create index if not exists portal_chat_message_reactions_message_idx
  on public.portal_chat_message_reactions(message_id);

create index if not exists portal_chat_message_reactions_member_idx
  on public.portal_chat_message_reactions(member_id);

commit;
