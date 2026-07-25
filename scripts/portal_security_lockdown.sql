begin;

-- Sensitive Portal tables are API-only. The browser must not read or write them directly.
-- This block is intentionally after all data compatibility checks.
do $$
declare
  table_name text;
  policy_record record;
  policy_name text;
begin
  foreach table_name in array array[
    'guild_members',
    'member_awakenings',
    'member_monsters',
    'member_soulstones',
    'member_pb_entries',
    'member_demonic_monsters',
    'soul_stones',
    'guild_defenses',
    'guild_defense_slots',
    'guild_defense_conditions',
    'guild_defense_blocks',
    'cluster_defense_likes',
    'portal_guild_licenses',
    'portal_guild_spaces',
    'portal_activity_logs',
    'member_defense_threads',
    'member_defense_messages',
    'member_defense_message_mentions',
    'member_defense_thread_reads',
    'guild_defense_discord_followups',
    'gvg_defense',
    'gvg_repro',
    'gvg_discord_repro_requests',
    'gvg_strat_boycotts',
    'defence_strat',
    'defence_slot',
    'defence_strat_boycotts',
    'intersaison_campaigns',
    'intersaison_dashboards',
    'intersaison_assignments',
    'intersaison_notes',
    'portal_community_access_requests',
    'pve_videos',
    'pve_video_stages',
    'pve_video_heroes',
    'pve_video_hero_alternatives'
  ] loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('revoke all on table public.%I from anon, authenticated', table_name);
      execute format('grant all on table public.%I to service_role', table_name);
      execute format('alter table public.%I enable row level security', table_name);

      for policy_record in
        select policyname
        from pg_policies
        where schemaname = 'public'
          and tablename = table_name
      loop
        execute format('drop policy if exists %I on public.%I', policy_record.policyname, table_name);
      end loop;

      policy_name := left(table_name || '_service_role_all', 63);
      execute format(
        'create policy %I on public.%I for all to service_role using (true) with check (true)',
        policy_name,
        table_name
      );
    end if;
  end loop;
end $$;

-- Public PvE catalog reads remain available; writes stay server-only.
do $$
declare
  policy_record record;
begin
  if to_regclass('public.pve_contents') is not null then
    revoke insert, update, delete on table public.pve_contents from anon, authenticated;
    grant select on table public.pve_contents to anon, authenticated;
    grant all on table public.pve_contents to service_role;
    alter table public.pve_contents enable row level security;

    for policy_record in
      select policyname from pg_policies where schemaname = 'public' and tablename = 'pve_contents'
    loop
      execute format('drop policy if exists %I on public.pve_contents', policy_record.policyname);
    end loop;

    create policy pve_contents_public_read_active
      on public.pve_contents
      for select
      to anon, authenticated
      using (is_active = true);

    create policy pve_contents_service_role_all
      on public.pve_contents
      for all
      to service_role
      using (true)
      with check (true);
  end if;

  if to_regclass('public.pve_content_stages') is not null then
    revoke insert, update, delete on table public.pve_content_stages from anon, authenticated;
    grant select on table public.pve_content_stages to anon, authenticated;
    grant all on table public.pve_content_stages to service_role;
    alter table public.pve_content_stages enable row level security;

    for policy_record in
      select policyname from pg_policies where schemaname = 'public' and tablename = 'pve_content_stages'
    loop
      execute format('drop policy if exists %I on public.pve_content_stages', policy_record.policyname);
    end loop;

    create policy pve_content_stages_public_read_active
      on public.pve_content_stages
      for select
      to anon, authenticated
      using (
        exists (
          select 1
          from public.pve_contents
          where public.pve_contents.id = public.pve_content_stages.content_id
            and public.pve_contents.is_active = true
        )
      );

    create policy pve_content_stages_service_role_all
      on public.pve_content_stages
      for all
      to service_role
      using (true)
      with check (true);
  end if;

  if to_regclass('public.pve_creators') is not null then
    revoke insert, update, delete on table public.pve_creators from anon, authenticated;
    grant select on table public.pve_creators to anon, authenticated;
    grant all on table public.pve_creators to service_role;
    alter table public.pve_creators enable row level security;

    for policy_record in
      select policyname from pg_policies where schemaname = 'public' and tablename = 'pve_creators'
    loop
      execute format('drop policy if exists %I on public.pve_creators', policy_record.policyname);
    end loop;

    create policy pve_creators_public_read
      on public.pve_creators
      for select
      to anon, authenticated
      using (true);

    create policy pve_creators_service_role_all
      on public.pve_creators
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

commit;
