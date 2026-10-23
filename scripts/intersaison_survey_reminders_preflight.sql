-- Read-only catalog checks. No live campaign/admin/recipient sample is required.
with required(table_name,column_name,expected_type) as (values
  ('guild_dm_recipients','account_member_key','uuid'),('guild_dm_recipients','reminder_count','int4'),
  ('guild_dm_recipients','discord_message_id','text'),('guild_dm_recipients','last_sent_at','timestamptz'),
  ('guild_dm_campaigns','interaction_type','text'),('guild_dm_campaigns','is_test','bool'),
  ('guild_members','primary_member_id','uuid'),('intersaison_survey_recipients','member_key','uuid'),
  ('intersaison_survey_recipients','response_status','text'),('intersaison_survey_campaigns','is_test','bool'),
  ('intersaison_survey_campaigns','objective_snapshot','jsonb'),('intersaison_survey_responses','is_current','bool')
), functions(signature) as (values
  ('assert_intersaison_survey_choice_admin(uuid,uuid)'),('intersaison_choice_account_identity(uuid,uuid)'),
  ('guard_guild_dm_account_identity()'),('queue_intersaison_survey_reminders(uuid,uuid,uuid,uuid)')
), checks as (
  select r.table_name||'.'||r.column_name as check_name,r.expected_type as expected,coalesce(c.udt_name,'missing') as actual,
    case when c.udt_name=r.expected_type then 'OK' else 'ERROR' end as status
    from required r left join information_schema.columns c
      on c.table_schema='public' and c.table_name=r.table_name and c.column_name=r.column_name
  union all
  select 'required_rpc_'||signature,'present',coalesce(to_regprocedure('public.'||signature)::text,'missing'),
    case when to_regprocedure('public.'||signature) is not null then 'OK' else 'ERROR' end from functions
  union all
  select 'required_index_'||name,'unique',coalesce(i.indisunique::text,'missing'),case when i.indisunique then 'OK' else 'ERROR' end
    from (values ('intersaison_survey_one_active_season_by_org_idx'),('intersaison_survey_recipient_dm_uidx'),
      ('guild_dm_recipients_campaign_account_uidx')) n(name) left join pg_index i on i.indexrelid=to_regclass('public.'||name)
  union all
  select 'live_samples','not required','No preview, queue, backfill or live sample lookup is performed.','INFO'
)
select * from checks order by check_name;
