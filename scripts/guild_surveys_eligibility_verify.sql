-- Read-only diagnostics. Only actor/list branches are evaluated; no draft,
-- participant, response or delivery is created. Counts follow the live roster.
with signatures(signature) as(values
  ('public._guild_survey_actor(uuid)'),('public._guild_survey_roster(uuid)'),
  ('public._guild_survey_recipient_state(uuid)'),('public.guild_survey_request(uuid,text,uuid,integer,jsonb)'),
  ('public.authorize_guild_survey_delivery(uuid,text)')),
definitions as materialized(
  select s.signature,p.oid,p.prosecdef,p.proconfig,p.prosrc from signatures s left join pg_proc p on p.oid=to_regprocedure(s.signature)
), readiness as(
  select count(oid)=5 and bool_and(case when signature='public._guild_survey_actor(uuid)' then
    position('and lower(btrim(coalesce(m.community_status,' in prosrc)>0
    and position('or lower(btrim(coalesce(m.role,' in prosrc)>0
    and position('not in (''community_member'',''content_creator'',''vip'') then rank' in prosrc)>0
    else position('community_status' in prosrc)=0 and position('''community_member'',''content_creator'',''vip''' in prosrc)>0 end) as patched
  from definitions
), owned_guilds as materialized(
  select g.*,o.organization_key from public.portal_guilds g join public.portal_organizations o on o.id=g.organization_id and o.is_active
  where g.is_active and not exists(select 1 from public.portal_guilds other where other.guild_code=g.guild_code and other.organization_id<>g.organization_id and other.is_active)
), active_members as materialized(
  select m.*,g.organization_id,g.organization_key from public.guild_members m join owned_guilds g on g.guild_code=m.guild_code
  where coalesce(m.roster_status,'active')='active' and coalesce(m.community_access_type,'guild')<>'community'
    and lower(btrim(coalesce(m.role,''))) not in ('community_member','content_creator','vip')
), probes as materialized(
  select m.*,case when coalesce((select patched from readiness),false) then public._guild_survey_actor(m.id) else null end as actor
  from active_members m
), managers as(
  select distinct on (organization_id) id,organization_id from active_members
    where lower(btrim(role)) in ('leader','admin','administrateur') order by organization_id,case when lower(btrim(role))='leader' then 0 else 1 end,id
), catalogs as materialized(
  select m.organization_id,case when coalesce((select patched from readiness),false) then public.guild_survey_request(m.id,'list') else null end as result
  from managers m
), catalog_rows as(
  select c.organization_id,g.value from catalogs c cross join lateral jsonb_array_elements(coalesce(c.result->'guilds','[]'::jsonb)) g
), guild_counts as materialized(
  select g.organization_id,g.organization_key,g.guild_code,
    (select count(*) from active_members m where m.guild_code=g.guild_code) as expected_active_accounts,
    (select (r.value->>'active_members')::bigint from catalog_rows r where r.organization_id=g.organization_id and r.value->>'id'=g.id::text) as reported_active_accounts,
    (select count(*) from active_members m where m.guild_code=g.guild_code and lower(btrim(coalesce(m.community_status,'')))='inactive') as previously_filtered_accounts,
    exists(select 1 from catalogs c where c.organization_id=g.organization_id and c.result is not null) as catalog_probed
  from owned_guilds g
), checks(check_name,status) as(
  select 'five_target_functions_patched',case when coalesce((select patched from readiness),false) then 'OK' else 'ERROR' end
  union all select 'security_definer_preserved',case when (select count(oid)=5 and bool_and(prosecdef) from definitions) then 'OK' else 'ERROR' end
  union all select 'fixed_search_paths_preserved',case when (select count(oid)=5 and bool_and('search_path=public, pg_temp'=any(proconfig)) from definitions) then 'OK' else 'ERROR' end
  union all select 'service_only_public_rpcs',case when not exists(select 1 from definitions where signature in
    ('public.guild_survey_request(uuid,text,uuid,integer,jsonb)','public.authorize_guild_survey_delivery(uuid,text)') and
    (oid is null or not has_function_privilege('service_role',oid,'execute') or has_function_privilege('anon',oid,'execute') or has_function_privilege('authenticated',oid,'execute'))) then 'OK' else 'ERROR' end
  union all select 'private_helpers_denied',case when not exists(select 1 from definitions where signature like 'public._guild_survey_%' and
    (oid is null or has_function_privilege('service_role',oid,'execute') or has_function_privilege('anon',oid,'execute') or has_function_privilege('authenticated',oid,'execute'))) then 'OK' else 'ERROR' end
  union all select 'delivery_stays_disabled',case when (select count(*) from public.guild_survey_settings where singleton and not delivery_enabled)=1 then 'OK' else 'ERROR' end
  union all select 'active_guild_member_access',case when coalesce((select patched from readiness),false) and not exists(
    select 1 from probes where (actor->>'org')::uuid is distinct from organization_id) then 'OK' else 'ERROR' end
  union all select 'leader_admin_permissions',case when coalesce((select patched from readiness),false) and not exists(select 1 from probes where
    (actor->>'rank')::integer is distinct from case lower(btrim(role)) when 'leader' then 2 when 'admin' then 1 when 'administrateur' then 1 else 0 end) then 'OK' else 'ERROR' end
  union all select 'dynamic_guild_catalog_counts',case when coalesce((select patched from readiness),false) and not exists(
    select 1 from guild_counts where catalog_probed and reported_active_accounts is distinct from expected_active_accounts) then 'OK' else 'ERROR' end
  union all select 'organization_catalog_isolation',case when coalesce((select patched from readiness),false) and not exists(select 1 from catalog_rows r
    where not exists(select 1 from owned_guilds g where g.organization_id=r.organization_id and g.id::text=r.value->>'id')) then 'OK' else 'ERROR' end
), fingerprints as(
  select 'guild_members' as source,count(*) as rows,md5(coalesce(string_agg(to_jsonb(m)::text,'' order by m.id),'')) as fingerprint from public.guild_members m
  union all select 'guild_dm_campaigns',count(*),md5(coalesce(string_agg(to_jsonb(c)::text,'' order by c.id),'')) from public.guild_dm_campaigns c
  union all select 'guild_dm_recipients',count(*),md5(coalesce(string_agg(to_jsonb(r)::text,'' order by r.id),'')) from public.guild_dm_recipients r
  union all select 'intersaison_survey_campaigns',count(*),md5(coalesce(string_agg(to_jsonb(c)::text,'' order by c.id),'')) from public.intersaison_survey_campaigns c
  union all select 'intersaison_survey_recipients',count(*),md5(coalesce(string_agg(to_jsonb(r)::text,'' order by r.id),'')) from public.intersaison_survey_recipients r
  union all select 'intersaison_survey_responses',count(*),md5(coalesce(string_agg(to_jsonb(a)::text,'' order by a.id),'')) from public.intersaison_survey_responses a
  union all select 'intersaison_survey_placements',count(*),md5(coalesce(string_agg(to_jsonb(p)::text,'' order by p.id),'')) from public.intersaison_survey_placements p
  union all select 'intersaison_survey_forecast_roles',count(*),md5(coalesce(string_agg(to_jsonb(r)::text,'' order by r.id),'')) from public.intersaison_survey_forecast_roles r
  union all select 'intersaison_survey_objective_versions',count(*),md5(coalesce(string_agg(to_jsonb(v)::text,'' order by v.id),'')) from public.intersaison_survey_objective_versions v
  union all select 'intersaison_survey_objective_items',count(*),md5(coalesce(string_agg(to_jsonb(i)::text,'' order by i.version_id,i.guild_code),'')) from public.intersaison_survey_objective_items i
)
select jsonb_build_object(
  'checks',(select jsonb_agg(to_jsonb(checks) order by check_name) from checks),
  'all_checks_ok',not exists(select 1 from checks where status='ERROR'),
  'delivery_enabled',(select delivery_enabled from public.guild_survey_settings where singleton),
  'surveys',(select count(*) from public.guild_surveys),'waves',(select count(*) from public.guild_survey_waves),
  'discord_queue',jsonb_build_object('queued',(select count(*) from public.guild_dm_recipients where status='queued'),
    'sending',(select count(*) from public.guild_dm_recipients where status='sending')),
  'organizations',(select jsonb_agg(jsonb_build_object('organization_key',o.organization_key,
    'active_guild_accounts',(select count(*) from active_members m where m.organization_id=o.id),
    'previously_filtered_active_accounts',(select count(*) from active_members m where m.organization_id=o.id and lower(btrim(coalesce(m.community_status,'')))='inactive'),
    'recovered_leaders',(select count(*) from probes m where m.organization_id=o.id and lower(btrim(coalesce(m.community_status,'')))='inactive' and lower(btrim(m.role))='leader' and (m.actor->>'rank')::integer=2),
    'recovered_admins',(select count(*) from probes m where m.organization_id=o.id and lower(btrim(coalesce(m.community_status,'')))='inactive' and lower(btrim(m.role)) in ('admin','administrateur') and (m.actor->>'rank')::integer=1)
  ) order by o.organization_key) from public.portal_organizations o where o.is_active),
  'guild_counts',(select jsonb_agg(to_jsonb(guild_counts) order by organization_key,guild_code) from guild_counts),
  'fingerprints',(select jsonb_agg(to_jsonb(fingerprints) order by source) from fingerprints)
) as guild_surveys_eligibility_verify;
