alter table public.gvg_defense
  add column if not exists mirror_group_num integer;

create index if not exists gvg_defense_guild_mirror_group_num_idx
  on public.gvg_defense (guild, mirror_group_num)
  where mirror_group_num is not null;

comment on column public.gvg_defense.mirror_group_num
  is 'Groupe miroir ennemi/allie calcule depuis Portal. Sert aux badges verts persistants du panel GVG.';
