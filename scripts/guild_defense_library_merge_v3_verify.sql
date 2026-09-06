with rpc_source as (
  select pg_get_functiondef('public.merge_guild_defense_library_roots(uuid, uuid, uuid, uuid, text, jsonb)'::regprocedure) as body
),
helper_source as (
  select
    pg_get_functiondef('public.guild_defense_library_similarity_signature(uuid)'::regprocedure) as similarity_body,
    pg_get_functiondef('public.guild_defense_library_identity_signature(uuid)'::regprocedure) as identity_body,
    pg_get_functiondef('public.guild_defense_library_review_signature(uuid)'::regprocedure) as review_body
),
checks as (
  select
    'rpc_merge_guild_defense_library_roots' as check_name,
    'present' as expected_value,
    case when to_regprocedure('public.merge_guild_defense_library_roots(uuid, uuid, uuid, uuid, text, jsonb)') is null then 'missing' else 'present' end as actual_value

  union all

  select
    'helper_similarity_signature',
    'present',
    case when to_regprocedure('public.guild_defense_library_similarity_signature(uuid)') is null then 'missing' else 'present' end

  union all

  select
    'helper_review_signature',
    'present',
    case when to_regprocedure('public.guild_defense_library_review_signature(uuid)') is null then 'missing' else 'present' end

  union all

  select
    'helper_identity_signature',
    'present',
    case when to_regprocedure('public.guild_defense_library_identity_signature(uuid)') is null then 'missing' else 'present' end

  union all

  select
    'helper_similarity_uses_sha256_payload',
    'present',
    case when exists (
      select 1
      from helper_source
      where similarity_body like '%guild_defense_library_js_sha256%'
        and similarity_body like '%"heroes"%'
        and similarity_body like '%"map_type"%'
    ) then 'present' else 'missing' end

  union all

  select
    'helper_identity_uses_review_signature',
    'present',
    case when exists (
      select 1
      from helper_source
      where identity_body like '%guild_defense_library_review_signature%'
    ) then 'present' else 'missing' end

  union all

  select
    'helper_review_includes_position_direction',
    'present',
    case when exists (
      select 1
      from helper_source
      where review_body like '%"position"%'
        and review_body like '%"direction"%'
    ) then 'present' else 'missing' end

  union all

  select
    'map_type_bastion_matches_fortress',
    'fortress',
    public.guild_defense_library_js_map_type('Bastion')

  union all

  select
    'map_type_forteresse_matches_fortress',
    'fortress',
    public.guild_defense_library_js_map_type('Forteresse')

  union all

  select
    'map_type_tour_matches_tower',
    'tower',
    public.guild_defense_library_js_map_type('Tour')

  union all

  select
    'champion_alias_comte_dracula',
    'countdracula',
    public.guild_defense_library_js_champion_key('Comte Dracula')

  union all

  select
    'champion_alias_captain_reve',
    'captainreve',
    public.guild_defense_library_js_champion_key('Captain Reve')

  union all

  select
    'position_tower_g10_valid',
    'G10',
    coalesce(public.guild_defense_library_js_position('g10', 'Tour'), 'null')

  union all

  select
    'position_tower_h1_invalid',
    'null',
    coalesce(public.guild_defense_library_js_position('H1', 'Tour'), 'null')

  union all

  select
    'position_fortress_h11_valid',
    'H11',
    coalesce(public.guild_defense_library_js_position('h11', 'Bastion'), 'null')

  union all

  select
    'rpc_still_checks_similarity_signature',
    'present',
    case when exists (
      select 1
      from rpc_source
      where body like '%v_review.similarity_signature%'
        and body like '%guild_defense_library_similarity_signature%'
    ) then 'present' else 'missing' end

  union all

  select
    'rpc_still_checks_identity_signature',
    'present',
    case when exists (
      select 1
      from rpc_source
      where body like '%left_identity_signature%'
        and body like '%right_identity_signature%'
        and body like '%guild_defense_library_identity_signature%'
    ) then 'present' else 'missing' end

  union all

  select
    'identical_reviews_similarity_mismatch',
    '0',
    count(*)::text
  from public.guild_defense_library_similarity_reviews review
  join public.guild_defenses left_defense
    on left_defense.id = review.left_defense_id
  join public.guild_defenses right_defense
    on right_defense.id = review.right_defense_id
  where review.status = 'identical'
    and left_defense.source_defense_id is null
    and right_defense.source_defense_id is null
    and coalesce(left_defense.is_hidden, false) = false
    and coalesce(right_defense.is_hidden, false) = false
    and left_defense.merged_into_defense_id is null
    and right_defense.merged_into_defense_id is null
    and (
      public.guild_defense_library_similarity_signature(left_defense.id) is distinct from review.similarity_signature
      or public.guild_defense_library_similarity_signature(right_defense.id) is distinct from review.similarity_signature
    )

  union all

  select
    'identical_reviews_identity_mismatch',
    '0',
    count(*)::text
  from public.guild_defense_library_similarity_reviews review
  join public.guild_defenses left_defense
    on left_defense.id = review.left_defense_id
  join public.guild_defenses right_defense
    on right_defense.id = review.right_defense_id
  where review.status = 'identical'
    and left_defense.source_defense_id is null
    and right_defense.source_defense_id is null
    and coalesce(left_defense.is_hidden, false) = false
    and coalesce(right_defense.is_hidden, false) = false
    and left_defense.merged_into_defense_id is null
    and right_defense.merged_into_defense_id is null
    and (
      public.guild_defense_library_identity_signature(left_defense.id) is distinct from review.left_identity_signature
      or public.guild_defense_library_identity_signature(right_defense.id) is distinct from review.right_identity_signature
    )
)
select
  check_name,
  expected_value,
  actual_value,
  case when actual_value = expected_value then 'OK' else 'ERROR' end as status
from checks
order by check_name;
