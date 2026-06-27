alter table public.guild_defenses
  add column if not exists is_hidden boolean not null default false;

create index if not exists guild_defenses_source_guild_idx
  on public.guild_defenses (source_defense_id, guild_code)
  where source_defense_id is not null;

create index if not exists guild_defenses_guild_hidden_idx
  on public.guild_defenses (guild_code, is_hidden);

comment on column public.guild_defenses.source_defense_id
  is 'Defense source lorsque cette ligne est une variante locale propre a une guilde.';

comment on column public.guild_defenses.is_hidden
  is 'Masque local: permet de retirer une defense heritee pour une guilde sans supprimer la source.';
