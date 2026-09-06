-- Correction V5 de la fusion Bibliotheque.
-- Corrige l'ordre transactionnel des collisions locales pour ne jamais creer
-- deux copies actives temporaires de la meme root dans la meme guilde.

begin;

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
  v_root_local_presence jsonb := '{}'::jsonb;
  v_canonical_guild_key text;
  v_absorbed_guild_key text;
  v_absorbed_root_handled boolean := false;
  v_absorbed_root_preserved boolean := false;
  v_absorbed_root_local_target_id uuid := null;
  v_existing_absorbed_guild_copy public.guild_defenses%rowtype;
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
    or v_absorbed.source_defense_id = p_canonical_defense_id
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

  v_canonical_guild_key := public.guild_defense_library_normalized_text(v_canonical.guild_code);
  v_absorbed_guild_key := public.guild_defense_library_normalized_text(v_absorbed.guild_code);

  if v_canonical_guild_key <> v_absorbed_guild_key then
    v_existing_absorbed_guild_copy := null;

    select *
      into v_existing_absorbed_guild_copy
    from public.guild_defenses local_copy
    where local_copy.organization_id = v_canonical.organization_id
      and local_copy.guild_code = v_absorbed.guild_code
      and local_copy.source_defense_id = v_canonical.id
      and coalesce(local_copy.is_hidden, false) = false
      and local_copy.merged_into_defense_id is null
    order by local_copy.created_at nulls last, local_copy.id
    limit 1
    for update;

    if v_existing_absorbed_guild_copy.id is null then
      update public.guild_defenses
      set
        source_defense_id = v_canonical.id,
        source_guild_code = v_canonical.guild_code,
        source_defense_name = v_canonical.name,
        imported_at = coalesce(imported_at, now()),
        is_hidden = false,
        merged_into_defense_id = null,
        merged_at = null,
        merged_by_member_id = null
      where id = v_absorbed.id;

      v_absorbed_root_handled := true;
      v_absorbed_root_preserved := true;
      v_absorbed_root_local_target_id := v_absorbed.id;
      v_root_reference_result := jsonb_build_object(
        'skipped', true,
        'reason', 'absorbed_root_preserved_as_local_copy',
        'local_defense_id', v_absorbed.id
      );
      v_root_local_presence := jsonb_build_object(
        'action', 'convert_absorbed_root',
        'guild_code', v_absorbed.guild_code,
        'keep_defense_id', v_absorbed.id,
        'source_defense_id', v_canonical.id,
        'source_guild_code', v_canonical.guild_code,
        'source_defense_name', v_canonical.name
      );
    else
      if not public.guild_defense_library_layouts_compatible(v_existing_absorbed_guild_copy.id, v_absorbed.id) then
        raise exception 'Collision locale root impossible a resoudre dans %: layouts differents.', v_absorbed.guild_code;
      end if;

      if not public.guild_defense_library_enemy_links_compatible(v_existing_absorbed_guild_copy.id, v_absorbed.id) then
        raise exception 'Collision locale root impossible a resoudre dans %: liens enemy differents.', v_absorbed.guild_code;
      end if;

      v_keep_child_id := public.guild_defense_library_preferred_defense(v_existing_absorbed_guild_copy.id, v_absorbed.id);
      if v_keep_child_id = v_existing_absorbed_guild_copy.id then
        v_hide_child_id := v_absorbed.id;
      else
        v_hide_child_id := v_existing_absorbed_guild_copy.id;
      end if;

      v_collision_transfer_result := public.guild_defense_library_apply_conservative_merge(
        v_keep_child_id,
        v_hide_child_id
      );

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

      update public.guild_defenses
      set
        source_defense_id = v_canonical.id,
        source_guild_code = v_canonical.guild_code,
        source_defense_name = v_canonical.name,
        imported_at = coalesce(imported_at, now()),
        is_hidden = false,
        merged_into_defense_id = null,
        merged_at = null,
        merged_by_member_id = null
      where id = v_keep_child_id;

      v_absorbed_root_handled := true;
      v_absorbed_root_preserved := v_keep_child_id = v_absorbed.id;
      v_absorbed_root_local_target_id := v_keep_child_id;
      v_root_reference_result := v_collision_reference_result;
      v_root_local_presence := jsonb_build_object(
        'action', 'merge_absorbed_root_with_existing_copy',
        'guild_code', v_absorbed.guild_code,
        'keep_defense_id', v_keep_child_id,
        'hidden_defense_id', v_hide_child_id,
        'absorbed_root_preserved', v_absorbed_root_preserved
      );
      v_local_collisions := v_local_collisions || jsonb_build_array(jsonb_build_object(
        'guild_code', v_absorbed.guild_code,
        'keep_defense_id', v_keep_child_id,
        'hidden_defense_id', v_hide_child_id,
        'absorbed_root', true,
        'transfers', v_collision_transfer_result,
        'references', v_collision_reference_result
      ));
    end if;
  else
    v_root_local_presence := jsonb_build_object(
      'action', 'covered_by_canonical_root',
      'guild_code', v_absorbed.guild_code,
      'keep_defense_id', v_canonical.id,
      'absorbed_defense_id', v_absorbed.id
    );
  end if;

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

      update public.guild_defenses
      set
        source_defense_id = v_canonical.id,
        source_guild_code = v_canonical.guild_code,
        source_defense_name = v_canonical.name,
        imported_at = coalesce(imported_at, now())
      where id = v_keep_child_id;

      v_local_collisions := v_local_collisions || jsonb_build_array(jsonb_build_object(
        'guild_code', v_child.guild_code,
        'keep_defense_id', v_keep_child_id,
        'hidden_defense_id', v_hide_child_id,
        'absorbed_root', false,
        'transfers', v_collision_transfer_result,
        'references', v_collision_reference_result
      ));
    end if;
  end loop;

  if not v_absorbed_root_handled then
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
  end if;

  v_merge_summary := jsonb_build_object(
    'status', 'merged',
    'review_id', v_review.id,
    'canonical_defense_id', v_canonical.id,
    'canonical_name', v_canonical.name,
    'absorbed_defense_id', v_absorbed.id,
    'absorbed_name', v_absorbed.name,
    'absorbed_guild_code', v_absorbed.guild_code,
    'absorbed_root_handled', v_absorbed_root_handled,
    'absorbed_root_preserved_as_local_copy', v_absorbed_root_preserved,
    'absorbed_root_local_target_id', v_absorbed_root_local_target_id,
    'root_local_presence', v_root_local_presence,
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

revoke all on function public.merge_guild_defense_library_roots(uuid, uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.merge_guild_defense_library_roots(uuid, uuid, uuid, uuid, text, jsonb) to service_role;

comment on function public.merge_guild_defense_library_roots(uuid, uuid, uuid, uuid, text, jsonb)
  is 'Fusionne deux roots Bibliotheque equivalentes. V5 resout les collisions locales avant de reconfigurer la copie active afin de respecter guild_defenses_unique_active_import_idx.';

commit;
