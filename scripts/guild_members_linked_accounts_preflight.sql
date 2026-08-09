-- Preflight read-only for guild_members linked account V1.
-- Do not modify data from this script.

select
  'guild_members_columns' as section,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'guild_members'
order by ordinal_position;

select
  'existing_primary_member_id_column' as section,
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'guild_members'
      and column_name = 'primary_member_id'
  ) as primary_member_id_exists;

select
  'guild_members_total' as section,
  count(*) as total_member_count
from public.guild_members;

select
  'possible_existing_link_columns' as section,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'guild_members'
  and (
    column_name ilike '%primary%'
    or column_name ilike '%parent%'
    or column_name ilike '%main%'
    or column_name ilike '%account%'
    or column_name ilike '%person%'
    or column_name ilike '%link%'
  )
order by column_name;

select
  'guild_members_constraints' as section,
  constraint_name,
  constraint_type
from information_schema.table_constraints
where table_schema = 'public'
  and table_name = 'guild_members'
order by constraint_type, constraint_name;

select
  'guild_members_foreign_keys' as section,
  tc.constraint_name,
  kcu.column_name,
  ccu.table_schema as foreign_table_schema,
  ccu.table_name as foreign_table_name,
  ccu.column_name as foreign_column_name,
  rc.update_rule,
  rc.delete_rule
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on kcu.constraint_schema = tc.constraint_schema
  and kcu.constraint_name = tc.constraint_name
join information_schema.constraint_column_usage ccu
  on ccu.constraint_schema = tc.constraint_schema
  and ccu.constraint_name = tc.constraint_name
left join information_schema.referential_constraints rc
  on rc.constraint_schema = tc.constraint_schema
  and rc.constraint_name = tc.constraint_name
where tc.table_schema = 'public'
  and tc.table_name = 'guild_members'
  and tc.constraint_type = 'FOREIGN KEY'
order by tc.constraint_name, kcu.ordinal_position;

select
  'guild_members_indexes' as section,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'guild_members'
order by indexname;

select
  'guild_members_triggers' as section,
  trigger_name,
  event_manipulation,
  action_timing,
  action_statement
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table = 'guild_members'
order by trigger_name, event_manipulation;

select
  'duplicate_watcher_name' as section,
  lower(trim(watcher_name)) as normalized_watcher_name,
  count(*) as member_count,
  array_agg(id order by watcher_name, id) as member_ids,
  array_agg(watcher_name order by watcher_name, id) as watcher_names
from public.guild_members
where nullif(trim(coalesce(watcher_name, '')), '') is not null
group by lower(trim(watcher_name))
having count(*) > 1
order by member_count desc, normalized_watcher_name;

select
  'discord_id_quality_summary' as section,
  count(*) as total_member_count,
  count(*) filter (where nullif(trim(coalesce(discord_id, '')), '') is null) as without_discord_id,
  count(*) filter (where nullif(trim(coalesce(discord_id, '')), '') is not null) as with_discord_id,
  count(*) filter (
    where nullif(trim(coalesce(discord_id, '')), '') is not null
      and trim(discord_id) ~ '^[0-9]{15,25}$'
  ) as standard_discord_id,
  count(*) filter (
    where nullif(trim(coalesce(discord_id, '')), '') is not null
      and trim(discord_id) !~ '^[0-9]{15,25}$'
  ) as non_standard_discord_id
from public.guild_members;

select
  'members_without_discord_id' as section,
  id,
  watcher_name,
  guild_code,
  role,
  community_access_type,
  community_status
from public.guild_members
where nullif(trim(coalesce(discord_id, '')), '') is null
order by guild_code nulls last, watcher_name nulls last, id
limit 200;

select
  'duplicate_discord_id' as section,
  trim(discord_id) as discord_id,
  count(*) as member_count,
  array_agg(id order by watcher_name, id) as member_ids,
  array_agg(watcher_name order by watcher_name, id) as watcher_names,
  array_agg(guild_code order by watcher_name, id) as guild_codes
from public.guild_members
where nullif(trim(coalesce(discord_id, '')), '') is not null
group by trim(discord_id)
having count(*) > 1
order by member_count desc, discord_id;

select
  'non_standard_discord_id' as section,
  id,
  watcher_name,
  guild_code,
  discord_id
from public.guild_members
where nullif(trim(coalesce(discord_id, '')), '') is not null
  and trim(discord_id) !~ '^[0-9]{15,25}$'
order by guild_code nulls last, watcher_name nulls last, id;

select
  'personal_forum_post_url_summary' as section,
  count(*) as member_count,
  count(*) filter (where nullif(trim(coalesce(personal_forum_post_url, '')), '') is not null) as with_forum_url,
  count(*) filter (
    where nullif(trim(coalesce(personal_forum_post_url, '')), '') is not null
      and personal_forum_post_url !~* '^https://(www\.)?discord(app)?\.com/channels/'
  ) as non_standard_forum_url_count
from public.guild_members;

select
  'non_standard_personal_forum_post_url' as section,
  id,
  watcher_name,
  guild_code,
  personal_forum_post_url
from public.guild_members
where nullif(trim(coalesce(personal_forum_post_url, '')), '') is not null
  and personal_forum_post_url !~* '^https://(www\.)?discord(app)?\.com/channels/'
order by guild_code nulls last, watcher_name nulls last, id
limit 100;

select
  'possible_secondary_name_candidates' as section,
  id,
  watcher_name,
  guild_code,
  discord_id,
  personal_forum_post_url
from public.guild_members
where watcher_name ~* '(^|[^a-z0-9])(alt|reroll|second|secondary|2|bis|g[1-9])([^a-z0-9]|$)'
order by guild_code nulls last, watcher_name nulls last, id
limit 200;

do $$
declare
  v_has_primary_member_id boolean;
  v_self_count integer;
  v_link_count integer;
  v_chain_count integer;
  v_missing_primary_count integer;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'guild_members'
      and column_name = 'primary_member_id'
  )
  into v_has_primary_member_id;

  if not v_has_primary_member_id then
    raise notice 'primary_member_id not present yet; existing link diagnostics not applicable.';
    return;
  end if;

  execute 'select count(*) from public.guild_members where primary_member_id is not null'
  into v_link_count;

  execute 'select count(*) from public.guild_members where primary_member_id = id'
  into v_self_count;

  execute $sql$
    select count(*)
    from public.guild_members secondary
    join public.guild_members primary_member
      on primary_member.id = secondary.primary_member_id
    where primary_member.primary_member_id is not null
  $sql$
  into v_chain_count;

  execute $sql$
    select count(*)
    from public.guild_members secondary
    left join public.guild_members primary_member
      on primary_member.id = secondary.primary_member_id
    where secondary.primary_member_id is not null
      and primary_member.id is null
  $sql$
  into v_missing_primary_count;

  raise notice 'primary_member_id existing links: %, self links: %, chains: %, missing principals: %',
    v_link_count,
    v_self_count,
    v_chain_count,
    v_missing_primary_count;
end;
$$;
