create table if not exists public.guild_defense_discord_followups (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  guild_code text not null,
  member_id uuid not null references public.guild_members(id) on delete cascade,
  member_name text null,
  member_discord_id text null,
  admin_member_id uuid null references public.guild_members(id) on delete set null,
  admin_name text null,
  discord_channel_id text null,
  discord_message_id text null,
  discord_message_ids text[] not null default '{}'::text[],
  dm_message_ids text[] not null default '{}'::text[],
  forum_post_url text null,
  defense_names jsonb not null default '[]'::jsonb,
  message_content text null,
  thread_name_before text null,
  thread_name_after text null,
  validated_by_member_id uuid null references public.guild_members(id) on delete set null,
  validated_by_discord_id text null,
  validated_by_name text null,
  validated_at timestamptz null,
  state text not null default 'pending',
  last_error text null,
  constraint guild_defense_discord_followups_state_check
    check (state in ('pending', 'validated', 'send_failed', 'deleted'))
);

create index if not exists guild_defense_discord_followups_member_state_idx
  on public.guild_defense_discord_followups(member_id, state);

create index if not exists guild_defense_discord_followups_guild_state_idx
  on public.guild_defense_discord_followups(guild_code, state);

create unique index if not exists guild_defense_discord_followups_message_uidx
  on public.guild_defense_discord_followups(discord_message_id)
  where discord_message_id is not null;

create index if not exists guild_defense_discord_followups_message_ids_idx
  on public.guild_defense_discord_followups using gin(discord_message_ids);

comment on table public.guild_defense_discord_followups
  is 'Suivi des messages Discord envoyes aux joueurs pour leurs defenses de guilde.';
