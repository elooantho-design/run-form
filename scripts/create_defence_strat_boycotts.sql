create table if not exists public.defence_strat_boycotts (
  strat_id bigint not null references public.defence_strat(id) on delete cascade,
  guild_code text not null,
  actor_member_id uuid null references public.guild_members(id) on delete set null,
  actor_name text null,
  created_at timestamptz not null default now(),
  constraint defence_strat_boycotts_guild_code_check check (length(trim(guild_code)) > 0),
  constraint defence_strat_boycotts_pkey primary key (strat_id, guild_code)
);

create index if not exists defence_strat_boycotts_guild_idx
  on public.defence_strat_boycotts(guild_code);
