begin;

create extension if not exists pgcrypto with schema public;

alter table public.guild_defenses
  add column if not exists merged_into_defense_id uuid null references public.guild_defenses(id) on delete restrict,
  add column if not exists merged_at timestamptz null,
  add column if not exists merged_by_member_id uuid null references public.guild_members(id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.guild_defenses'::regclass
      and conname = 'guild_defenses_merged_not_self_check'
  ) then
    alter table public.guild_defenses
      add constraint guild_defenses_merged_not_self_check
      check (merged_into_defense_id is null or merged_into_defense_id <> id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.guild_defenses'::regclass
      and conname = 'guild_defenses_merged_at_check'
  ) then
    alter table public.guild_defenses
      add constraint guild_defenses_merged_at_check
      check (merged_into_defense_id is null or merged_at is not null);
  end if;
end $$;

create index if not exists guild_defenses_merged_into_idx
  on public.guild_defenses (organization_id, merged_into_defense_id)
  where merged_into_defense_id is not null;

create index if not exists guild_defenses_org_active_unmerged_roots_idx
  on public.guild_defenses (organization_id, guild_code, created_at)
  where source_defense_id is null
    and coalesce(is_hidden, false) = false
    and merged_into_defense_id is null;

drop index if exists public.guild_defenses_unique_active_import_idx;
create unique index guild_defenses_unique_active_import_idx
  on public.guild_defenses (organization_id, guild_code, source_defense_id)
  where source_defense_id is not null
    and coalesce(is_hidden, false) = false
    and merged_into_defense_id is null;

create table if not exists public.guild_defense_library_merges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.portal_organizations(id) on delete restrict,
  canonical_defense_id uuid not null references public.guild_defenses(id) on delete restrict,
  absorbed_defense_id uuid not null references public.guild_defenses(id) on delete restrict,
  review_id uuid null references public.guild_defense_library_similarity_reviews(id) on delete set null,
  merged_by_member_id uuid null references public.guild_members(id) on delete set null,
  merged_by_name text null,
  merged_at timestamptz not null default now(),
  canonical_score jsonb not null default '{}'::jsonb,
  absorbed_score jsonb not null default '{}'::jsonb,
  merge_summary jsonb not null default '{}'::jsonb,
  transferred_data jsonb not null default '[]'::jsonb,
  repointed_defense_ids jsonb not null default '[]'::jsonb,
  local_collisions jsonb not null default '[]'::jsonb,
  conflicts jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint guild_defense_library_merges_distinct_check
    check (canonical_defense_id <> absorbed_defense_id),
  constraint guild_defense_library_merges_absorbed_unique
    unique (absorbed_defense_id)
);

create index if not exists guild_defense_library_merges_org_at_idx
  on public.guild_defense_library_merges (organization_id, merged_at desc);

create index if not exists guild_defense_library_merges_canonical_idx
  on public.guild_defense_library_merges (canonical_defense_id);

create index if not exists guild_defense_library_merges_review_idx
  on public.guild_defense_library_merges (review_id)
  where review_id is not null;

create or replace function public.guild_defense_library_merges_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_canonical public.guild_defenses%rowtype;
  v_absorbed public.guild_defenses%rowtype;
begin
  select *
    into v_canonical
  from public.guild_defenses
  where id = new.canonical_defense_id;

  select *
    into v_absorbed
  from public.guild_defenses
  where id = new.absorbed_defense_id;

  if v_canonical.id is null or v_absorbed.id is null then
    raise exception 'Defense de fusion introuvable.';
  end if;

  if v_canonical.organization_id is distinct from new.organization_id
    or v_absorbed.organization_id is distinct from new.organization_id
  then
    raise exception 'Fusion bibliotheque inter-organisation refusee.';
  end if;

  return new;
end;
$$;

revoke all on function public.guild_defense_library_merges_validate() from public, anon, authenticated;
grant execute on function public.guild_defense_library_merges_validate() to service_role;

drop trigger if exists guild_defense_library_merges_validate_before_write
  on public.guild_defense_library_merges;
create trigger guild_defense_library_merges_validate_before_write
before insert or update of organization_id, canonical_defense_id, absorbed_defense_id
on public.guild_defense_library_merges
for each row
execute function public.guild_defense_library_merges_validate();

alter table public.guild_defense_library_merges enable row level security;

revoke all on table public.guild_defense_library_merges from anon, authenticated;
grant select, insert, update, delete on table public.guild_defense_library_merges to service_role;

drop policy if exists guild_defense_library_merges_service_role_all
  on public.guild_defense_library_merges;
create policy guild_defense_library_merges_service_role_all
on public.guild_defense_library_merges
for all
to service_role
using (true)
with check (true);

create or replace function public.guild_defense_library_normalized_text(p_value text)
returns text
language sql
immutable
as $$
  select regexp_replace(lower(btrim(coalesce(p_value, ''))), '\s+', ' ', 'g');
$$;

create or replace function public.guild_defense_library_has_useful_text(p_value text)
returns boolean
language sql
immutable
as $$
  select public.guild_defense_library_normalized_text(p_value) not in ('', 'none', 'aucun', '--', 'meta_s');
$$;

create or replace function public.guild_defense_library_similarity_signature(p_defense_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  select
    public.guild_defense_library_normalized_text(coalesce(nullif(defense.type, ''), 'Tour'))
      || ':' ||
    string_agg(slot.champion_id::text, ',' order by slot.champion_id::text)
  from public.guild_defenses defense
  join public.guild_defense_slots slot
    on slot.defense_id = defense.id
  where defense.id = p_defense_id
  group by defense.id, defense.type
  having count(*) = 5
     and count(slot.champion_id) = 5;
$$;

create or replace function public.guild_defense_library_layout_signature(p_defense_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  select
    public.guild_defense_library_similarity_signature(p_defense_id)
      || ':' ||
    string_agg(
      slot.champion_id::text || '@' || upper(btrim(slot.position)) || ':' || upper(btrim(slot.direction)),
      '|'
      order by slot.champion_id::text
    )
  from public.guild_defense_slots slot
  where slot.defense_id = p_defense_id
  group by slot.defense_id
  having count(*) = 5
     and count(slot.champion_id) = 5
     and count(nullif(btrim(slot.position), '')) = 5
     and count(nullif(btrim(slot.direction), '')) = 5;
$$;

create or replace function public.guild_defense_library_identity_signature(p_defense_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(
    public.guild_defense_library_layout_signature(p_defense_id),
    public.guild_defense_library_similarity_signature(p_defense_id)
  );
$$;

create or replace function public.guild_defense_library_has_complete_layout(p_defense_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select public.guild_defense_library_layout_signature(p_defense_id) is not null;
$$;

create or replace function public.guild_defense_library_enemy_identity(p_defense_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(
    nullif(btrim(defense.source_enemy_defense_fingerprint), ''),
    case when defense.source_enemy_defense_id is null then null else 'id:' || defense.source_enemy_defense_id::text end,
    ''
  )
  from public.guild_defenses defense
  where defense.id = p_defense_id;
$$;

create or replace function public.guild_defense_library_enemy_links_compatible(p_left_defense_id uuid, p_right_defense_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select
    public.guild_defense_library_enemy_identity(p_left_defense_id) = ''
    or public.guild_defense_library_enemy_identity(p_right_defense_id) = ''
    or public.guild_defense_library_enemy_identity(p_left_defense_id) = public.guild_defense_library_enemy_identity(p_right_defense_id);
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

create or replace function public.guild_defense_library_condition_key(
  p_champion_id uuid,
  p_min_awakening integer
)
returns text
language sql
immutable
as $$
  select coalesce(p_champion_id::text, '') || ':a' || coalesce(p_min_awakening, 0)::text;
$$;

create or replace function public.guild_defense_library_block_key(
  p_block_type text,
  p_content text
)
returns text
language sql
immutable
as $$
  select public.guild_defense_library_normalized_text(coalesce(p_block_type, 'text'))
    || ':' ||
    public.guild_defense_library_normalized_text(p_content);
$$;

create or replace function public.guild_defense_library_merge_score(p_defense_id uuid)
returns integer
language plpgsql
stable
set search_path = public
as $$
declare
  v_defense public.guild_defenses%rowtype;
  v_score integer := 0;
  v_block_count integer := 0;
  v_condition_count integer := 0;
  v_copy_count integer := 0;
  v_guild_count integer := 0;
begin
  select *
    into v_defense
  from public.guild_defenses
  where id = p_defense_id;

  if v_defense.id is null then
    return -1;
  end if;

  if public.guild_defense_library_has_complete_layout(p_defense_id) then
    v_score := v_score + 400;
  end if;

  if public.guild_defense_library_enemy_identity(p_defense_id) <> '' then
    v_score := v_score + 250;
  end if;

  if nullif(btrim(coalesce(v_defense.image_url, '')), '') is not null then
    v_score := v_score + 180;
  end if;

  select count(distinct public.guild_defense_library_block_key(block.block_type, block.content))
    into v_block_count
  from public.guild_defense_blocks block
  where block.defense_id = p_defense_id
    and nullif(btrim(coalesce(block.content, '')), '') is not null;

  select count(distinct public.guild_defense_library_condition_key(condition_row.champion_id, condition_row.min_awakening))
    into v_condition_count
  from public.guild_defense_conditions condition_row
  where condition_row.defense_id = p_defense_id;

  select count(*)
    into v_copy_count
  from public.guild_defenses copy_defense
  where copy_defense.source_defense_id = p_defense_id
    and coalesce(copy_defense.is_hidden, false) = false
    and copy_defense.merged_into_defense_id is null;

  select count(distinct family_defense.guild_code)
    into v_guild_count
  from public.guild_defenses family_defense
  where (family_defense.id = p_defense_id or family_defense.source_defense_id = p_defense_id)
    and coalesce(family_defense.is_hidden, false) = false
    and family_defense.merged_into_defense_id is null;

  v_score := v_score + least(v_block_count, 8) * 20;
  v_score := v_score + least(v_condition_count, 8) * 15;
  v_score := v_score + least(v_guild_count, 10) * 12;
  v_score := v_score + least(v_copy_count, 12) * 8;

  if length(public.guild_defense_library_normalized_text(v_defense.name)) >= 7
    and public.guild_defense_library_normalized_text(v_defense.name) not in ('test', 'defense', 'def', 'tour', 'bastion', 'copy', 'copie')
  then
    v_score := v_score + 30;
  end if;

  if public.guild_defense_library_has_useful_text(v_defense.tier) then
    v_score := v_score + 10;
  end if;

  if public.guild_defense_library_has_useful_text(v_defense.faction) then
    v_score := v_score + 10;
  end if;

  return v_score;
end;
$$;

create or replace function public.guild_defense_library_preferred_defense(
  p_left_defense_id uuid,
  p_right_defense_id uuid
)
returns uuid
language sql
stable
set search_path = public
as $$
  select defense.id
  from public.guild_defenses defense
  where defense.id in (p_left_defense_id, p_right_defense_id)
  order by
    public.guild_defense_library_merge_score(defense.id) desc,
    defense.created_at asc nulls last,
    defense.id::text asc
  limit 1;
$$;

create or replace function public.guild_defense_library_repoint_references(
  p_from_defense_id uuid,
  p_to_defense_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_to public.guild_defenses%rowtype;
  v_defense_1_count integer := 0;
  v_defense_2_count integer := 0;
  v_likes_deleted integer := 0;
  v_likes_updated integer := 0;
  v_enemy_reviews_deleted integer := 0;
  v_enemy_reviews_updated integer := 0;
begin
  if p_from_defense_id is null or p_to_defense_id is null or p_from_defense_id = p_to_defense_id then
    return jsonb_build_object('skipped', true);
  end if;

  select *
    into v_to
  from public.guild_defenses
  where id = p_to_defense_id;

  if v_to.id is null then
    raise exception 'Defense cible de repointage introuvable.';
  end if;

  update public.guild_members
  set
    defense_1_id = p_to_defense_id,
    defense_1 = v_to.name
  where defense_1_id = p_from_defense_id;
  get diagnostics v_defense_1_count = row_count;

  update public.guild_members
  set
    defense_2_id = p_to_defense_id,
    defense_2 = v_to.name
  where defense_2_id = p_from_defense_id;
  get diagnostics v_defense_2_count = row_count;

  if to_regclass('public.cluster_defense_likes') is not null then
    execute '
      delete from public.cluster_defense_likes absorbed_like
      using public.cluster_defense_likes kept_like
      where absorbed_like.defense_id = $1
        and kept_like.defense_id = $2
        and absorbed_like.member_id = kept_like.member_id
    ' using p_from_defense_id, p_to_defense_id;
    get diagnostics v_likes_deleted = row_count;

    execute '
      update public.cluster_defense_likes
      set defense_id = $1
      where defense_id = $2
    ' using p_to_defense_id, p_from_defense_id;
    get diagnostics v_likes_updated = row_count;
  end if;

  if to_regclass('public.gvg_enemy_defense_similarity_reviews') is not null then
    execute '
      delete from public.gvg_enemy_defense_similarity_reviews absorbed_review
      using public.gvg_enemy_defense_similarity_reviews kept_review
      where absorbed_review.local_defense_id = $1
        and kept_review.local_defense_id = $2
        and absorbed_review.enemy_defense_id = kept_review.enemy_defense_id
    ' using p_from_defense_id, p_to_defense_id;
    get diagnostics v_enemy_reviews_deleted = row_count;

    execute '
      update public.gvg_enemy_defense_similarity_reviews
      set
        local_defense_id = $1,
        local_guild_code = $3,
        updated_at = now()
      where local_defense_id = $2
    ' using p_to_defense_id, p_from_defense_id, v_to.guild_code;
    get diagnostics v_enemy_reviews_updated = row_count;
  end if;

  return jsonb_build_object(
    'defense_1_assignments', v_defense_1_count,
    'defense_2_assignments', v_defense_2_count,
    'likes_deleted', v_likes_deleted,
    'likes_updated', v_likes_updated,
    'enemy_reviews_deleted', v_enemy_reviews_deleted,
    'enemy_reviews_updated', v_enemy_reviews_updated
  );
end;
$$;

create or replace function public.guild_defense_library_apply_conservative_merge(
  p_keep_defense_id uuid,
  p_absorbed_defense_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_keep public.guild_defenses%rowtype;
  v_absorbed public.guild_defenses%rowtype;
  v_inserted integer := 0;
  v_transfers jsonb := '[]'::jsonb;
  v_ignored jsonb := '[]'::jsonb;
begin
  if p_keep_defense_id is null or p_absorbed_defense_id is null or p_keep_defense_id = p_absorbed_defense_id then
    raise exception 'Deux defenses distinctes sont requises pour la fusion.';
  end if;

  select *
    into v_keep
  from public.guild_defenses
  where id = p_keep_defense_id
  for update;

  select *
    into v_absorbed
  from public.guild_defenses
  where id = p_absorbed_defense_id
  for update;

  if v_keep.id is null or v_absorbed.id is null then
    raise exception 'Defense de fusion introuvable.';
  end if;

  if v_keep.organization_id is distinct from v_absorbed.organization_id then
    raise exception 'Fusion inter-organisation refusee.';
  end if;

  if public.guild_defense_library_similarity_signature(v_keep.id) is distinct from public.guild_defense_library_similarity_signature(v_absorbed.id) then
    raise exception 'Type ou cinq heros incompatibles.';
  end if;

  if not public.guild_defense_library_layouts_compatible(v_keep.id, v_absorbed.id) then
    raise exception 'Layouts complets differents.';
  end if;

  if not public.guild_defense_library_enemy_links_compatible(v_keep.id, v_absorbed.id) then
    raise exception 'Liens enemy incompatibles.';
  end if;

  if not public.guild_defense_library_has_complete_layout(v_keep.id)
    and public.guild_defense_library_has_complete_layout(v_absorbed.id)
  then
    update public.guild_defense_slots keep_slot
    set
      position = absorbed_slot.position,
      direction = absorbed_slot.direction
    from public.guild_defense_slots absorbed_slot
    where keep_slot.defense_id = v_keep.id
      and absorbed_slot.defense_id = v_absorbed.id
      and absorbed_slot.champion_id = keep_slot.champion_id;

    v_transfers := v_transfers || jsonb_build_array(jsonb_build_object('type', 'layout'));
  end if;

  if v_keep.source_enemy_defense_id is null
    and v_absorbed.source_enemy_defense_id is not null
  then
    update public.guild_defenses
    set
      source_enemy_defense_id = v_absorbed.source_enemy_defense_id,
      source_enemy_defense_fingerprint = v_absorbed.source_enemy_defense_fingerprint,
      source_enemy_portal_guild_id = v_absorbed.source_enemy_portal_guild_id,
      source_enemy_label = v_absorbed.source_enemy_label,
      source_enemy_imported_at = coalesce(v_absorbed.source_enemy_imported_at, now())
    where id = v_keep.id;

    v_transfers := v_transfers || jsonb_build_array(jsonb_build_object('type', 'enemy'));
  end if;

  if nullif(btrim(coalesce(v_keep.image_url, '')), '') is null
    and nullif(btrim(coalesce(v_absorbed.image_url, '')), '') is not null
  then
    update public.guild_defenses
    set image_url = v_absorbed.image_url
    where id = v_keep.id;

    v_transfers := v_transfers || jsonb_build_array(jsonb_build_object('type', 'image'));
  elsif nullif(btrim(coalesce(v_keep.image_url, '')), '') is not null
    and nullif(btrim(coalesce(v_absorbed.image_url, '')), '') is not null
    and v_keep.image_url is distinct from v_absorbed.image_url
  then
    v_ignored := v_ignored || jsonb_build_array(jsonb_build_object(
      'type', 'absorbed_image',
      'image_url', v_absorbed.image_url
    ));
  end if;

  if not public.guild_defense_library_has_useful_text(v_keep.tier)
    and public.guild_defense_library_has_useful_text(v_absorbed.tier)
  then
    update public.guild_defenses
    set tier = v_absorbed.tier
    where id = v_keep.id;

    v_transfers := v_transfers || jsonb_build_array(jsonb_build_object('type', 'tier'));
  elsif public.guild_defense_library_has_useful_text(v_keep.tier)
    and public.guild_defense_library_has_useful_text(v_absorbed.tier)
    and public.guild_defense_library_normalized_text(v_keep.tier) <> public.guild_defense_library_normalized_text(v_absorbed.tier)
  then
    v_ignored := v_ignored || jsonb_build_array(jsonb_build_object(
      'type', 'tier_conflict_kept',
      'kept', v_keep.tier,
      'absorbed', v_absorbed.tier
    ));
  end if;

  if not public.guild_defense_library_has_useful_text(v_keep.faction)
    and public.guild_defense_library_has_useful_text(v_absorbed.faction)
  then
    update public.guild_defenses
    set faction = v_absorbed.faction
    where id = v_keep.id;

    v_transfers := v_transfers || jsonb_build_array(jsonb_build_object('type', 'faction'));
  elsif public.guild_defense_library_has_useful_text(v_keep.faction)
    and public.guild_defense_library_has_useful_text(v_absorbed.faction)
    and public.guild_defense_library_normalized_text(v_keep.faction) <> public.guild_defense_library_normalized_text(v_absorbed.faction)
  then
    v_ignored := v_ignored || jsonb_build_array(jsonb_build_object(
      'type', 'faction_conflict_kept',
      'kept', v_keep.faction,
      'absorbed', v_absorbed.faction
    ));
  end if;

  with inserted_conditions as (
    insert into public.guild_defense_conditions (defense_id, champion_id, min_awakening)
    select v_keep.id, condition_row.champion_id, condition_row.min_awakening
    from public.guild_defense_conditions condition_row
    where condition_row.defense_id = v_absorbed.id
      and not exists (
        select 1
        from public.guild_defense_conditions existing_condition
        where existing_condition.defense_id = v_keep.id
          and existing_condition.champion_id is not distinct from condition_row.champion_id
          and existing_condition.min_awakening is not distinct from condition_row.min_awakening
      )
    returning id
  )
  select count(*) into v_inserted
  from inserted_conditions;

  if v_inserted > 0 then
    v_transfers := v_transfers || jsonb_build_array(jsonb_build_object('type', 'conditions', 'count', v_inserted));
  end if;

  with base as (
    select coalesce(max(sort_order), 0) as max_sort_order
    from public.guild_defense_blocks
    where defense_id = v_keep.id
  ),
  candidates as (
    select
      block.block_type,
      block.content,
      row_number() over (order by coalesce(block.sort_order, 9999), block.id) as row_number
    from public.guild_defense_blocks block
    where block.defense_id = v_absorbed.id
      and nullif(btrim(coalesce(block.content, '')), '') is not null
      and not exists (
        select 1
        from public.guild_defense_blocks existing_block
        where existing_block.defense_id = v_keep.id
          and public.guild_defense_library_block_key(existing_block.block_type, existing_block.content)
            = public.guild_defense_library_block_key(block.block_type, block.content)
      )
  ),
  inserted_blocks as (
    insert into public.guild_defense_blocks (defense_id, block_type, content, sort_order)
    select
      v_keep.id,
      candidates.block_type,
      candidates.content,
      base.max_sort_order + candidates.row_number
    from candidates
    cross join base
    returning id
  )
  select count(*) into v_inserted
  from inserted_blocks;

  if v_inserted > 0 then
    v_transfers := v_transfers || jsonb_build_array(jsonb_build_object('type', 'blocks', 'count', v_inserted));
  end if;

  return jsonb_build_object(
    'keep_defense_id', v_keep.id,
    'absorbed_defense_id', v_absorbed.id,
    'transferred_data', v_transfers,
    'ignored_data', v_ignored
  );
end;
$$;

create or replace function public.merge_guild_defense_library_roots(
  p_review_id uuid,
  p_canonical_defense_id uuid,
  p_absorbed_defense_id uuid,
  p_actor_member_id uuid default null,
  p_actor_name text default null,
  p_merge_plan jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review public.guild_defense_library_similarity_reviews%rowtype;
  v_canonical public.guild_defenses%rowtype;
  v_absorbed public.guild_defenses%rowtype;
  v_expected_canonical_id uuid;
  v_existing_merge public.guild_defense_library_merges%rowtype;
  v_pair_match boolean := false;
  v_plan_conflicts jsonb := '[]'::jsonb;
  v_root_transfer_result jsonb := '{}'::jsonb;
  v_root_reference_result jsonb := '{}'::jsonb;
  v_child public.guild_defenses%rowtype;
  v_existing_child public.guild_defenses%rowtype;
  v_keep_child_id uuid;
  v_hide_child_id uuid;
  v_collision_transfer_result jsonb;
  v_collision_reference_result jsonb;
  v_repointed_ids jsonb := '[]'::jsonb;
  v_local_collisions jsonb := '[]'::jsonb;
  v_audit_id uuid;
  v_merge_summary jsonb;
begin
  if p_review_id is null or p_canonical_defense_id is null or p_absorbed_defense_id is null then
    raise exception 'Review, canonical et absorbed sont requis.';
  end if;

  if p_canonical_defense_id = p_absorbed_defense_id then
    raise exception 'Deux roots distinctes sont requises.';
  end if;

  v_plan_conflicts := coalesce(p_merge_plan->'conflicts', '[]'::jsonb);
  if jsonb_typeof(v_plan_conflicts) = 'array' and jsonb_array_length(v_plan_conflicts) > 0 then
    raise exception 'Fusion bloquee par le plan de preview.';
  end if;

  select *
    into v_review
  from public.guild_defense_library_similarity_reviews
  where id = p_review_id
  for update;

  if v_review.id is null then
    raise exception 'Review bibliotheque introuvable.';
  end if;

  select *
    into v_canonical
  from public.guild_defenses
  where id = p_canonical_defense_id
  for update;

  select *
    into v_absorbed
  from public.guild_defenses
  where id = p_absorbed_defense_id
  for update;

  if v_canonical.id is null or v_absorbed.id is null then
    raise exception 'Root de fusion introuvable.';
  end if;

  select *
    into v_existing_merge
  from public.guild_defense_library_merges
  where absorbed_defense_id = p_absorbed_defense_id
  for share;

  if v_existing_merge.id is not null
    or v_absorbed.merged_into_defense_id = p_canonical_defense_id
  then
    return jsonb_build_object(
      'status', 'already_merged',
      'canonical_defense_id', coalesce(v_existing_merge.canonical_defense_id, p_canonical_defense_id),
      'absorbed_defense_id', p_absorbed_defense_id,
      'merge_id', v_existing_merge.id
    );
  end if;

  if v_canonical.merged_into_defense_id is not null then
    raise exception 'La root canonical demandee est deja fusionnee.';
  end if;

  if v_absorbed.merged_into_defense_id is not null then
    raise exception 'La root absorbed demandee est deja fusionnee vers une autre root.';
  end if;

  v_pair_match :=
    (v_review.left_defense_id = p_canonical_defense_id and v_review.right_defense_id = p_absorbed_defense_id)
    or
    (v_review.left_defense_id = p_absorbed_defense_id and v_review.right_defense_id = p_canonical_defense_id);

  if not v_pair_match then
    raise exception 'La review ne correspond pas aux roots demandees.';
  end if;

  if v_review.status <> 'identical' then
    raise exception 'La paire doit etre validee IDENTIQUE avant fusion.';
  end if;

  if v_canonical.organization_id is distinct from v_absorbed.organization_id
    or v_review.organization_id is distinct from v_canonical.organization_id
  then
    raise exception 'Fusion inter-organisation refusee.';
  end if;

  if v_canonical.source_defense_id is not null or v_absorbed.source_defense_id is not null then
    raise exception 'Seules deux roots natives Bibliotheque peuvent etre fusionnees.';
  end if;

  if coalesce(v_canonical.is_hidden, false) or coalesce(v_absorbed.is_hidden, false) then
    raise exception 'Une root est deja masquee.';
  end if;

  if public.guild_defense_library_similarity_signature(v_canonical.id) is null
    or public.guild_defense_library_similarity_signature(v_canonical.id) is distinct from public.guild_defense_library_similarity_signature(v_absorbed.id)
    or public.guild_defense_library_similarity_signature(v_canonical.id) is distinct from v_review.similarity_signature
  then
    raise exception 'Type ou cinq heros incompatibles.';
  end if;

  if public.guild_defense_library_identity_signature(v_review.left_defense_id) is distinct from v_review.left_identity_signature
    or public.guild_defense_library_identity_signature(v_review.right_defense_id) is distinct from v_review.right_identity_signature
  then
    raise exception 'Review bibliotheque obsolete apres changement de defense.';
  end if;

  if not public.guild_defense_library_layouts_compatible(v_canonical.id, v_absorbed.id) then
    raise exception 'Layouts complets differents.';
  end if;

  if not public.guild_defense_library_enemy_links_compatible(v_canonical.id, v_absorbed.id) then
    raise exception 'Liens enemy incompatibles.';
  end if;

  v_expected_canonical_id := public.guild_defense_library_preferred_defense(v_review.left_defense_id, v_review.right_defense_id);
  if v_expected_canonical_id is null or v_expected_canonical_id <> p_canonical_defense_id then
    raise exception 'Canonical incoherente avec le score de fusion.';
  end if;

  v_root_transfer_result := public.guild_defense_library_apply_conservative_merge(
    v_canonical.id,
    v_absorbed.id
  );

  for v_child in
    select *
    from public.guild_defenses child
    where child.source_defense_id = v_absorbed.id
      and coalesce(child.is_hidden, false) = false
      and child.merged_into_defense_id is null
    order by child.guild_code, child.created_at nulls last, child.id
    for update
  loop
    v_existing_child := null;

    select *
      into v_existing_child
    from public.guild_defenses child
    where child.organization_id = v_canonical.organization_id
      and child.guild_code = v_child.guild_code
      and child.source_defense_id = v_canonical.id
      and coalesce(child.is_hidden, false) = false
      and child.merged_into_defense_id is null
    order by child.created_at nulls last, child.id
    limit 1
    for update;

    if v_existing_child.id is null then
      update public.guild_defenses
      set
        source_defense_id = v_canonical.id,
        source_guild_code = v_canonical.guild_code,
        source_defense_name = v_canonical.name,
        imported_at = coalesce(imported_at, now())
      where id = v_child.id;

      v_repointed_ids := v_repointed_ids || jsonb_build_array(v_child.id);
    else
      if not public.guild_defense_library_layouts_compatible(v_existing_child.id, v_child.id) then
        raise exception 'Collision locale impossible a resoudre dans %: layouts differents.', v_child.guild_code;
      end if;

      if not public.guild_defense_library_enemy_links_compatible(v_existing_child.id, v_child.id) then
        raise exception 'Collision locale impossible a resoudre dans %: liens enemy differents.', v_child.guild_code;
      end if;

      v_keep_child_id := public.guild_defense_library_preferred_defense(v_existing_child.id, v_child.id);
      if v_keep_child_id = v_existing_child.id then
        v_hide_child_id := v_child.id;
      else
        v_hide_child_id := v_existing_child.id;
      end if;

      v_collision_transfer_result := public.guild_defense_library_apply_conservative_merge(
        v_keep_child_id,
        v_hide_child_id
      );

      update public.guild_defenses
      set
        source_defense_id = v_canonical.id,
        source_guild_code = v_canonical.guild_code,
        source_defense_name = v_canonical.name,
        imported_at = coalesce(imported_at, now())
      where id = v_keep_child_id;

      v_collision_reference_result := public.guild_defense_library_repoint_references(
        v_hide_child_id,
        v_keep_child_id
      );

      update public.guild_defenses
      set
        is_hidden = true,
        merged_into_defense_id = v_keep_child_id,
        merged_at = now(),
        merged_by_member_id = p_actor_member_id
      where id = v_hide_child_id;

      v_local_collisions := v_local_collisions || jsonb_build_array(jsonb_build_object(
        'guild_code', v_child.guild_code,
        'keep_defense_id', v_keep_child_id,
        'hidden_defense_id', v_hide_child_id,
        'transfers', v_collision_transfer_result,
        'references', v_collision_reference_result
      ));
    end if;
  end loop;

  v_root_reference_result := public.guild_defense_library_repoint_references(
    v_absorbed.id,
    v_canonical.id
  );

  update public.guild_defenses
  set
    is_hidden = true,
    merged_into_defense_id = v_canonical.id,
    merged_at = now(),
    merged_by_member_id = p_actor_member_id
  where id = v_absorbed.id;

  v_merge_summary := jsonb_build_object(
    'status', 'merged',
    'review_id', v_review.id,
    'canonical_defense_id', v_canonical.id,
    'canonical_name', v_canonical.name,
    'absorbed_defense_id', v_absorbed.id,
    'absorbed_name', v_absorbed.name,
    'absorbed_guild_code', v_absorbed.guild_code,
    'merged_by_member_id', p_actor_member_id,
    'merged_by_name', p_actor_name,
    'root_transfers', v_root_transfer_result,
    'root_references', v_root_reference_result,
    'repointed_defense_ids', v_repointed_ids,
    'local_collisions', v_local_collisions,
    'canonical_score', public.guild_defense_library_merge_score(v_canonical.id),
    'absorbed_score', public.guild_defense_library_merge_score(v_absorbed.id),
    'preview_plan', coalesce(p_merge_plan, '{}'::jsonb)
  );

  insert into public.guild_defense_library_merges (
    organization_id,
    canonical_defense_id,
    absorbed_defense_id,
    review_id,
    merged_by_member_id,
    merged_by_name,
    canonical_score,
    absorbed_score,
    merge_summary,
    transferred_data,
    repointed_defense_ids,
    local_collisions,
    conflicts
  )
  values (
    v_canonical.organization_id,
    v_canonical.id,
    v_absorbed.id,
    v_review.id,
    p_actor_member_id,
    nullif(btrim(coalesce(p_actor_name, '')), ''),
    coalesce(p_merge_plan->'canonicalScore', p_merge_plan->'canonical_score', jsonb_build_object('score', public.guild_defense_library_merge_score(v_canonical.id))),
    coalesce(p_merge_plan->'absorbedScore', p_merge_plan->'absorbed_score', jsonb_build_object('score', public.guild_defense_library_merge_score(v_absorbed.id))),
    v_merge_summary,
    coalesce(v_root_transfer_result->'transferred_data', '[]'::jsonb),
    v_repointed_ids,
    v_local_collisions,
    '[]'::jsonb
  )
  returning id into v_audit_id;

  return v_merge_summary || jsonb_build_object('merge_id', v_audit_id);
end;
$$;

revoke all on function public.guild_defense_library_normalized_text(text) from public, anon, authenticated;
revoke all on function public.guild_defense_library_has_useful_text(text) from public, anon, authenticated;
revoke all on function public.guild_defense_library_similarity_signature(uuid) from public, anon, authenticated;
revoke all on function public.guild_defense_library_layout_signature(uuid) from public, anon, authenticated;
revoke all on function public.guild_defense_library_identity_signature(uuid) from public, anon, authenticated;
revoke all on function public.guild_defense_library_has_complete_layout(uuid) from public, anon, authenticated;
revoke all on function public.guild_defense_library_enemy_identity(uuid) from public, anon, authenticated;
revoke all on function public.guild_defense_library_enemy_links_compatible(uuid, uuid) from public, anon, authenticated;
revoke all on function public.guild_defense_library_layouts_compatible(uuid, uuid) from public, anon, authenticated;
revoke all on function public.guild_defense_library_condition_key(uuid, integer) from public, anon, authenticated;
revoke all on function public.guild_defense_library_block_key(text, text) from public, anon, authenticated;
revoke all on function public.guild_defense_library_merge_score(uuid) from public, anon, authenticated;
revoke all on function public.guild_defense_library_preferred_defense(uuid, uuid) from public, anon, authenticated;
revoke all on function public.guild_defense_library_repoint_references(uuid, uuid) from public, anon, authenticated;
revoke all on function public.guild_defense_library_apply_conservative_merge(uuid, uuid) from public, anon, authenticated;
revoke all on function public.merge_guild_defense_library_roots(uuid, uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;

grant execute on function public.guild_defense_library_normalized_text(text) to service_role;
grant execute on function public.guild_defense_library_has_useful_text(text) to service_role;
grant execute on function public.guild_defense_library_similarity_signature(uuid) to service_role;
grant execute on function public.guild_defense_library_layout_signature(uuid) to service_role;
grant execute on function public.guild_defense_library_identity_signature(uuid) to service_role;
grant execute on function public.guild_defense_library_has_complete_layout(uuid) to service_role;
grant execute on function public.guild_defense_library_enemy_identity(uuid) to service_role;
grant execute on function public.guild_defense_library_enemy_links_compatible(uuid, uuid) to service_role;
grant execute on function public.guild_defense_library_layouts_compatible(uuid, uuid) to service_role;
grant execute on function public.guild_defense_library_condition_key(uuid, integer) to service_role;
grant execute on function public.guild_defense_library_block_key(text, text) to service_role;
grant execute on function public.guild_defense_library_merge_score(uuid) to service_role;
grant execute on function public.guild_defense_library_preferred_defense(uuid, uuid) to service_role;
grant execute on function public.guild_defense_library_repoint_references(uuid, uuid) to service_role;
grant execute on function public.guild_defense_library_apply_conservative_merge(uuid, uuid) to service_role;
grant execute on function public.merge_guild_defense_library_roots(uuid, uuid, uuid, uuid, text, jsonb) to service_role;

comment on column public.guild_defenses.merged_into_defense_id
  is 'Soft-merge pointer used when a historical library root or local copy is absorbed by a canonical defense.';

comment on column public.guild_defenses.merged_at
  is 'Timestamp for conservative defense-library soft merges.';

comment on column public.guild_defenses.merged_by_member_id
  is 'Admin member who performed the conservative defense-library soft merge.';

comment on table public.guild_defense_library_merges
  is 'Durable audit log for conservative merges between two native guild-defense library roots.';

comment on function public.merge_guild_defense_library_roots(uuid, uuid, uuid, uuid, text, jsonb)
  is 'Transactionally merges two validated identical native library roots without physically deleting historical rows.';

commit;
