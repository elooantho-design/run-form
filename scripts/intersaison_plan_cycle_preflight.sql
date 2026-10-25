-- Read-only. One result containing all checks, fingerprints and current survey state.
-- Every check must be OK before installing intersaison_plan_cycle_install.sql.
with tables(name) as(values ('portal_organizations'),('portal_guilds'),('guild_members'),('intersaison_assignments'),
 ('intersaison_survey_seasons'),('intersaison_survey_campaigns'),('intersaison_survey_recipients'),
 ('intersaison_survey_responses'),('intersaison_survey_placements'),('intersaison_survey_forecast_roles'),
 ('intersaison_survey_objective_versions'),('intersaison_survey_objective_items'),('guild_dm_campaigns'),('guild_dm_recipients')),
checks as (
select 'table_'||name as check_name,case when to_regclass('public.'||name) is not null then 'OK' else 'ERROR' end as status from tables
union all
select 'member_column_'||column_name,case when exists(select 1 from information_schema.columns c
 where table_schema='public' and table_name='guild_members' and c.column_name=required.column_name) then 'OK' else 'ERROR' end
from (values('id'),('watcher_name'),('guild_code'),('role'),('roster_status'),('community_access_type'),('community_status'),
 ('primary_member_id'),('assignment'),('status'),('discord_id')) required(column_name)
union all select 'unique_guild_codes',case when not exists(select guild_code from public.portal_guilds group by guild_code having count(*)>1) then 'OK' else 'ERROR' end
union all select 'one_paladin_organization',case when (select count(*) from public.portal_organizations
 where lower(organization_key) in ('paladin','paladin_cluster'))=1 then 'OK' else 'ERROR' end
union all select 'reserved_codes_owned_by_paladin',case when not exists(select 1 from public.portal_guilds g
 join public.portal_organizations o on o.id=g.organization_id where g.guild_code ~ '^G([1-9]|1[0-9]|2[0-5])$'
 and lower(o.organization_key) not in ('paladin','paladin_cluster')) then 'OK' else 'ERROR' end
union all select 'account_aware_preview_installed',case when exists(select 1 from pg_proc where pronamespace='public'::regnamespace
 and proname='preview_intersaison_survey_two' and position('intersaison_choice_account_identity' in prosrc)>0) then 'OK' else 'ERROR' end
union all select 'reminder_guard_installed',case when to_regprocedure('public.queue_intersaison_survey_two_reminders(uuid,uuid,uuid,text,uuid,boolean)') is not null then 'OK' else 'ERROR' end
),

-- Capture these counts/fingerprints before installation. No player is changed by the migration.
fingerprints as (
select 'guild_members' as source,count(*) as rows,md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'[]')) as fingerprint from public.guild_members t
union all select 'survey_responses',count(*),md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'[]')) from public.intersaison_survey_responses t
union all select 'survey_recipients',count(*),md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'[]')) from public.intersaison_survey_recipients t
union all select 'placements',count(*),md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'[]')) from public.intersaison_survey_placements t
),

survey_two as (
select s.id as season_id,s.status as season_status,c.id as survey_2_id,c.status as survey_2_status,
 (select count(*) from public.intersaison_survey_recipients where survey_campaign_id=c.id) as recipients,
 (select count(*) from public.intersaison_survey_responses where survey_campaign_id=c.id and is_current) as responses
from public.intersaison_survey_seasons s join public.intersaison_survey_campaigns c on c.season_id=s.id and c.organization_id=s.organization_id
join public.portal_organizations o on o.id=s.organization_id
where lower(o.organization_key) in ('paladin','paladin_cluster') and s.status<>'finished' and c.poll_number=2 and not c.is_test
)
select jsonb_build_object(
 'all_checks_ok',(select bool_and(status='OK') from checks),
 'checks',(select jsonb_agg(to_jsonb(c) order by check_name) from checks c),
 'fingerprints',(select jsonb_agg(to_jsonb(f) order by source) from fingerprints f),
 'survey_two',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from survey_two s)
) as intersaison_plan_preflight;
