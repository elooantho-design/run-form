-- Read-only preflight. New objects may be absent before installation.
with required_columns(table_name,column_name,udt_name) as (
  values
    ('portal_guilds','organization_id','uuid'),('portal_guilds','guild_code','text'),
    ('guild_members','id','uuid'),('guild_members','discord_id','text'),('guild_members','guild_code','text'),
    ('guild_members','watcher_name','text'),('guild_members','roster_status','text'),('guild_members','community_access_type','text'),
    ('guild_dm_campaigns','interaction_payload','jsonb'),('guild_dm_campaigns','is_test','bool'),
    ('guild_dm_recipients','campaign_id','uuid'),('guild_dm_recipients','discord_user_id','text'),
    ('intersaison_survey_campaigns','is_test','bool'),('intersaison_survey_campaigns','poll_number','int4'),
    ('intersaison_survey_seasons','created_by_member_id','uuid'),
    ('intersaison_survey_responses','response_version','int4'),('intersaison_survey_responses','is_current','bool')
), checks as (
  select 'column_' || r.table_name || '.' || r.column_name as check_name,r.udt_name as expected_value,
    coalesce(c.udt_name,'missing') as actual_value,case when c.udt_name = r.udt_name then 'OK' else 'ERROR' end as status
  from required_columns r left join information_schema.columns c
    on c.table_schema = 'public' and c.table_name = r.table_name and c.column_name = r.column_name
  union all
  select 'objectives_admin_rpc','present',coalesce(to_regprocedure('public.assert_intersaison_objectives_admin(uuid,uuid)')::text,'missing'),
    case when to_regprocedure('public.assert_intersaison_objectives_admin(uuid,uuid)') is not null then 'OK' else 'ERROR' end
  union all
  select 'paladin_guilds','7',count(*)::text,case when count(*) = 7 then 'OK' else 'ERROR' end
  from public.portal_guilds g join public.portal_organizations o on o.id = g.organization_id
    where o.organization_key in ('paladin','paladin_cluster') and o.is_active and g.is_active and g.guild_code in ('G1','G2','G3','G4','G5','G6','G7')
  union all
  select 'ambiguous_guild_codes','0',count(*)::text,case when count(*) = 0 then 'OK' else 'ERROR' end
    from (select guild_code from public.portal_guilds where is_active and guild_code in ('G1','G2','G3','G4','G5','G6','G7')
      group by guild_code having count(distinct organization_id) > 1) x
  union all
  select 'official_survey_unique_index','present',coalesce(to_regclass('public.intersaison_survey_campaigns_season_poll_uidx')::text,'missing'),
    case when to_regclass('public.intersaison_survey_campaigns_season_poll_uidx') is not null then 'OK' else 'ERROR' end
  union all
  select 'season_org_unique_index','present',coalesce(to_regclass('public.intersaison_survey_seasons_id_org_uidx')::text,'missing'),
    case when to_regclass('public.intersaison_survey_seasons_id_org_uidx') is not null then 'OK' else 'ERROR' end
  union all
  select 'choices_installation','absent before migration / present on rerun',
    coalesce(to_regclass('public.intersaison_survey_placements')::text,'not installed'),'INFO'
)
select * from checks order by check_name;
