-- Read-only: one JSON result, no data modification and no invitation.
with requirements(kind,name) as(values
  ('table','portal_organizations'),('table','portal_guilds'),('table','guild_members'),
  ('table','guild_dm_campaigns'),('table','guild_dm_recipients')),
checks as(
  select kind||'_'||name as check_name,case when to_regclass('public.'||name) is not null then 'OK' else 'ERROR' end as status from requirements
  union all
  select 'queue_column_'||column_name,case when exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name='guild_dm_campaigns' and c.column_name=r.column_name) then 'OK' else 'ERROR' end
    from(values('interaction_type'),('interaction_payload'),('is_test')) r(column_name)
  union all
  select 'member_column_'||column_name,case when exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name='guild_members' and c.column_name=r.column_name) then 'OK' else 'ERROR' end
    from(values('id'),('guild_code'),('role'),('watcher_name'),('discord_id'),('primary_member_id'),('roster_status'),('community_access_type'),('community_status')) r(column_name)
  union all
  select 'unique_active_guild_ownership',case when exists(select guild_code from public.portal_guilds where is_active group by guild_code having count(*)>1) then 'ERROR' else 'OK' end
), fingerprints as(
  select 'guild_members' as source,count(*) as rows,md5(coalesce(string_agg(to_jsonb(m)::text,'' order by m.id),'')) as fingerprint from public.guild_members m
  union all select 'intersaison_survey_campaigns',count(*),md5(coalesce(string_agg(to_jsonb(c)::text,'' order by c.id),'')) from public.intersaison_survey_campaigns c
  union all select 'intersaison_survey_responses',count(*),md5(coalesce(string_agg(to_jsonb(a)::text,'' order by a.id),'')) from public.intersaison_survey_responses a
  union all select 'intersaison_survey_placements',count(*),md5(coalesce(string_agg(to_jsonb(p)::text,'' order by p.id),'')) from public.intersaison_survey_placements p
)
select jsonb_build_object('checks',(select jsonb_agg(to_jsonb(checks) order by check_name) from checks),
  'all_checks_ok',not exists(select 1 from checks where status='ERROR'),
  'fingerprints',(select jsonb_agg(to_jsonb(fingerprints) order by source) from fingerprints)) as guild_surveys_preflight;
