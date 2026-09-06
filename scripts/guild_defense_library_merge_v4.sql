-- Correction V4 de la fusion Bibliotheque.
-- Corrige la signature du helper de conditions pour utiliser le vrai type champion_id.

begin;

do $$
declare
  v_condition_champion_type text;
  v_condition_awakening_type text;
begin
  select format_type(attribute.atttypid, attribute.atttypmod)
    into v_condition_champion_type
  from pg_attribute attribute
  join pg_class relation
    on relation.oid = attribute.attrelid
  join pg_namespace namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname = 'guild_defense_conditions'
    and attribute.attname = 'champion_id'
    and attribute.attnum > 0
    and not attribute.attisdropped;

  select format_type(attribute.atttypid, attribute.atttypmod)
    into v_condition_awakening_type
  from pg_attribute attribute
  join pg_class relation
    on relation.oid = attribute.attrelid
  join pg_namespace namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname = 'guild_defense_conditions'
    and attribute.attname = 'min_awakening'
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if v_condition_champion_type is distinct from 'bigint' then
    raise exception 'Type inattendu pour guild_defense_conditions.champion_id: %, attendu bigint.', coalesce(v_condition_champion_type, 'missing');
  end if;

  if v_condition_awakening_type is distinct from 'integer' then
    raise exception 'Type inattendu pour guild_defense_conditions.min_awakening: %, attendu integer.', coalesce(v_condition_awakening_type, 'missing');
  end if;
end;
$$;

drop function if exists public.guild_defense_library_condition_key(uuid, integer);

create or replace function public.guild_defense_library_condition_key(
  p_champion_id bigint,
  p_min_awakening integer
)
returns text
language sql
immutable
as $$
  select coalesce(p_champion_id::text, '') || ':a' || coalesce(p_min_awakening, 0)::text;
$$;

revoke all on function public.guild_defense_library_condition_key(bigint, integer) from public, anon, authenticated;
grant execute on function public.guild_defense_library_condition_key(bigint, integer) to service_role;

comment on function public.guild_defense_library_condition_key(bigint, integer)
  is 'V4: builds merge condition keys with the real guild_defense_conditions.champion_id bigint type.';

commit;
