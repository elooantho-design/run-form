-- Read only. An absent new role table is expected before this migration.
with required(table_name,column_name,expected_type) as (values
  ('guild_members','id','uuid'),('guild_members','primary_member_id','uuid'),('guild_members','discord_id','text'),
  ('intersaison_survey_seasons','id','uuid'),('intersaison_survey_seasons','organization_id','uuid'),
  ('intersaison_survey_placements','member_key','uuid'),('intersaison_survey_placements','revision','int4')
), checks as (
  select r.table_name||'.'||r.column_name as check_name,r.expected_type as expected,coalesce(c.udt_name,'missing') as actual,
    case when c.udt_name=r.expected_type then 'OK' else 'ERROR' end as status
    from required r left join information_schema.columns c
      on c.table_schema='public' and c.table_name=r.table_name and c.column_name=r.column_name
  union all
  select signature,'present',coalesce(to_regprocedure('public.'||signature)::text,'missing'),
    case when to_regprocedure('public.'||signature) is not null then 'OK' else 'ERROR' end
    from (values ('assert_intersaison_survey_choice_admin(uuid,uuid)'),('intersaison_survey_choice_roster(uuid)'),
      ('save_intersaison_survey_placement(uuid,uuid,uuid,uuid,text,integer)')) f(signature)
  union all
  select 'existing_forecast_roles','absent before first application, present on repeat',
    coalesce(to_regclass('public.intersaison_survey_forecast_roles')::text,'absent'),'INFO'
)
select * from checks order by check_name;
