begin;

create extension if not exists pgcrypto with schema public;

create or replace function public.guild_defense_library_js_sha256(p_payload text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(digest(convert_to(coalesce(p_payload, ''), 'UTF8'), 'sha256'), 'hex');
$$;

create or replace function public.guild_defense_library_js_map_type(p_map_type text)
returns text
language sql
immutable
as $$
  select case
    when lower(btrim(coalesce(p_map_type, ''))) in ('fortress', 'forteresse', 'bastion') then 'fortress'
    when lower(btrim(coalesce(p_map_type, ''))) in ('tower', 'tour') then 'tower'
    else 'tower'
  end;
$$;

create or replace function public.guild_defense_library_js_champion_key(p_value text)
returns text
language plpgsql
immutable
as $$
declare
  v_value text := lower(btrim(coalesce(p_value, '')));
begin
  v_value := replace(v_value, U&'\0153', 'oe');
  v_value := replace(v_value, U&'\00E6', 'ae');
  v_value := replace(v_value, U&'\00DF', 'ss');

  v_value := translate(v_value, U&'\00E0\00E1\00E2\00E3\00E4\00E5', 'aaaaaa');
  v_value := translate(v_value, U&'\00E7\0107\010D', 'ccc');
  v_value := translate(v_value, U&'\00E8\00E9\00EA\00EB', 'eeee');
  v_value := translate(v_value, U&'\00EC\00ED\00EE\00EF', 'iiii');
  v_value := translate(v_value, U&'\00F1\0144', 'nn');
  v_value := translate(v_value, U&'\00F2\00F3\00F4\00F5\00F6\00F8', 'oooooo');
  v_value := translate(v_value, U&'\00F9\00FA\00FB\00FC', 'uuuu');
  v_value := translate(v_value, U&'\00FD\00FF', 'yy');
  v_value := translate(v_value, U&'\017E\017A\017C', 'zzz');

  v_value := regexp_replace(v_value, '\d+$', '', 'g');
  v_value := regexp_replace(v_value, '[^a-z0-9]+', '', 'g');
  v_value := regexp_replace(v_value, '\d+$', '', 'g');

  if v_value = '' then
    return null;
  end if;

  if v_value in ('comtedracula', 'countdracula') then
    return 'countdracula';
  end if;

  if v_value in ('capitainereve', 'captainreve') then
    return 'captainreve';
  end if;

  return v_value;
end;
$$;

create or replace function public.guild_defense_library_js_direction(p_direction text)
returns text
language sql
immutable
as $$
  select case
    when upper(btrim(coalesce(p_direction, ''))) in ('N', 'NORD', 'NORTH', U&'\2191') then 'N'
    when upper(btrim(coalesce(p_direction, ''))) in ('S', 'SUD', 'SOUTH', U&'\2193') then 'S'
    when upper(btrim(coalesce(p_direction, ''))) in ('E', 'EST', 'EAST', U&'\2192') then 'E'
    when upper(btrim(coalesce(p_direction, ''))) in ('O', 'OUEST', 'WEST', 'W', U&'\2190') then 'O'
    else null
  end;
$$;

create or replace function public.guild_defense_library_js_position(
  p_position text,
  p_map_type text
)
returns text
language plpgsql
immutable
as $$
declare
  v_position text := upper(btrim(coalesce(p_position, '')));
  v_row_letter text;
  v_col integer;
  v_row integer;
  v_rows integer;
  v_cols integer;
begin
  if v_position !~ '^[A-Z][1-9][0-9]?$' then
    return null;
  end if;

  v_row_letter := substring(v_position from 1 for 1);
  v_col := substring(v_position from 2)::integer;
  v_row := ascii(v_row_letter) - ascii('A') + 1;

  if public.guild_defense_library_js_map_type(p_map_type) = 'fortress' then
    v_rows := 8;
    v_cols := 11;
  else
    v_rows := 7;
    v_cols := 10;
  end if;

  if v_row < 1 or v_row > v_rows or v_col < 1 or v_col > v_cols then
    return null;
  end if;

  return v_position;
end;
$$;

create or replace function public.guild_defense_library_similarity_signature(p_defense_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  with defense_row as (
    select public.guild_defense_library_js_map_type(defense.type) as map_type
    from public.guild_defenses defense
    where defense.id = p_defense_id
  ),
  slots as (
    select public.guild_defense_library_js_champion_key(
      coalesce(champion.name, champion.portal_name, champion.english_name)
    ) as champion_key
    from public.guild_defense_slots slot
    left join public.champions champion
      on champion.id = slot.champion_id
    where slot.defense_id = p_defense_id
  ),
  payload as (
    select
      '{"heroes":[' ||
      string_agg(to_json(slots.champion_key)::text, ',' order by slots.champion_key) ||
      '],"map_type":' ||
      to_json(defense_row.map_type)::text ||
      ',"version":1}' as stable_payload
    from defense_row
    cross join slots
    group by defense_row.map_type
    having count(*) = 5
       and count(slots.champion_key) = 5
  )
  select public.guild_defense_library_js_sha256(payload.stable_payload)
  from payload;
$$;

create or replace function public.guild_defense_library_review_signature(p_defense_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  with defense_row as (
    select public.guild_defense_library_js_map_type(defense.type) as map_type
    from public.guild_defenses defense
    where defense.id = p_defense_id
  ),
  slots as (
    select
      public.guild_defense_library_js_champion_key(
        coalesce(champion.name, champion.portal_name, champion.english_name)
      ) as champion_key,
      public.guild_defense_library_js_position(slot.position, defense_row.map_type) as position,
      public.guild_defense_library_js_direction(slot.direction) as direction
    from public.guild_defense_slots slot
    cross join defense_row
    left join public.champions champion
      on champion.id = slot.champion_id
    where slot.defense_id = p_defense_id
  ),
  payload as (
    select
      '{"heroes":[' ||
      string_agg(
        '{"champion":' || to_json(slots.champion_key)::text ||
        ',"direction":' || coalesce(to_json(slots.direction)::text, 'null') ||
        ',"position":' || coalesce(to_json(slots.position)::text, 'null') ||
        '}',
        ','
        order by slots.champion_key, coalesce(slots.position, ''), coalesce(slots.direction, '')
      ) ||
      '],"map_type":' ||
      to_json(defense_row.map_type)::text ||
      ',"version":1}' as stable_payload
    from defense_row
    cross join slots
    group by defense_row.map_type
    having count(*) = 5
       and count(slots.champion_key) = 5
  )
  select public.guild_defense_library_js_sha256(payload.stable_payload)
  from payload;
$$;

create or replace function public.guild_defense_library_has_complete_layout(p_defense_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  with defense_row as (
    select public.guild_defense_library_js_map_type(defense.type) as map_type
    from public.guild_defenses defense
    where defense.id = p_defense_id
  ),
  slots as (
    select
      public.guild_defense_library_js_champion_key(
        coalesce(champion.name, champion.portal_name, champion.english_name)
      ) as champion_key,
      public.guild_defense_library_js_position(slot.position, defense_row.map_type) as position,
      public.guild_defense_library_js_direction(slot.direction) as direction
    from public.guild_defense_slots slot
    cross join defense_row
    left join public.champions champion
      on champion.id = slot.champion_id
    where slot.defense_id = p_defense_id
  )
  select coalesce((
    select count(*) = 5
       and count(champion_key) = 5
       and count(position) = 5
       and count(direction) = 5
    from slots
  ), false);
$$;

create or replace function public.guild_defense_library_layout_signature(p_defense_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when public.guild_defense_library_has_complete_layout(p_defense_id)
      then public.guild_defense_library_review_signature(p_defense_id)
    else null
  end;
$$;

create or replace function public.guild_defense_library_identity_signature(p_defense_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(
    public.guild_defense_library_review_signature(p_defense_id),
    public.guild_defense_library_similarity_signature(p_defense_id)
  );
$$;

create or replace function public.guild_defense_library_layouts_compatible(p_left_defense_id uuid, p_right_defense_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select
    not public.guild_defense_library_has_complete_layout(p_left_defense_id)
    or not public.guild_defense_library_has_complete_layout(p_right_defense_id)
    or public.guild_defense_library_layout_signature(p_left_defense_id) = public.guild_defense_library_layout_signature(p_right_defense_id);
$$;

revoke all on function public.guild_defense_library_js_sha256(text) from public, anon, authenticated;
revoke all on function public.guild_defense_library_js_map_type(text) from public, anon, authenticated;
revoke all on function public.guild_defense_library_js_champion_key(text) from public, anon, authenticated;
revoke all on function public.guild_defense_library_js_direction(text) from public, anon, authenticated;
revoke all on function public.guild_defense_library_js_position(text, text) from public, anon, authenticated;
revoke all on function public.guild_defense_library_similarity_signature(uuid) from public, anon, authenticated;
revoke all on function public.guild_defense_library_review_signature(uuid) from public, anon, authenticated;
revoke all on function public.guild_defense_library_has_complete_layout(uuid) from public, anon, authenticated;
revoke all on function public.guild_defense_library_layout_signature(uuid) from public, anon, authenticated;
revoke all on function public.guild_defense_library_identity_signature(uuid) from public, anon, authenticated;
revoke all on function public.guild_defense_library_layouts_compatible(uuid, uuid) from public, anon, authenticated;

grant execute on function public.guild_defense_library_js_sha256(text) to service_role;
grant execute on function public.guild_defense_library_js_map_type(text) to service_role;
grant execute on function public.guild_defense_library_js_champion_key(text) to service_role;
grant execute on function public.guild_defense_library_js_direction(text) to service_role;
grant execute on function public.guild_defense_library_js_position(text, text) to service_role;
grant execute on function public.guild_defense_library_similarity_signature(uuid) to service_role;
grant execute on function public.guild_defense_library_review_signature(uuid) to service_role;
grant execute on function public.guild_defense_library_has_complete_layout(uuid) to service_role;
grant execute on function public.guild_defense_library_layout_signature(uuid) to service_role;
grant execute on function public.guild_defense_library_identity_signature(uuid) to service_role;
grant execute on function public.guild_defense_library_layouts_compatible(uuid, uuid) to service_role;

comment on function public.guild_defense_library_similarity_signature(uuid)
  is 'V3: returns the same SHA-256 similarity signature as the Portal JS matcher: normalized map type plus unordered five champion keys.';

comment on function public.guild_defense_library_identity_signature(uuid)
  is 'V3: returns the same SHA-256 review identity signature as the Portal JS matcher, including normalized position/direction when present.';

comment on function public.guild_defense_library_layouts_compatible(uuid, uuid)
  is 'V3: keeps conservative layout blocking only when both defenses have complete normalized layouts.';

commit;
