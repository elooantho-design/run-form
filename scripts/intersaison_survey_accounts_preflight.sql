-- Read only. Existing shared Discord IDs are diagnostic, not blockers.
with required(table_name,column_name,expected_type) as (values
  ('guild_members','id','uuid'),('guild_members','primary_member_id','uuid'),('guild_members','discord_id','text'),
  ('guild_dm_recipients','member_id','uuid'),('guild_dm_recipients','discord_user_id','text'),
  ('intersaison_survey_recipients','member_key','uuid'),('intersaison_survey_campaigns','objective_snapshot','jsonb')
), checks as (
  select r.table_name||'.'||r.column_name as check_name,r.expected_type as expected,
    coalesce(c.udt_name,'missing') as actual,case when c.udt_name=r.expected_type then 'OK' else 'ERROR' end as status
  from required r left join information_schema.columns c on c.table_schema='public' and c.table_name=r.table_name and c.column_name=r.column_name
  union all
  select 'required_rpc_'||signature,'present',coalesce(to_regprocedure('public.'||signature)::text,'missing'),
    case when to_regprocedure('public.'||signature) is not null then 'OK' else 'ERROR' end
  from (values ('assert_intersaison_survey_choice_admin(uuid,uuid)'),('enqueue_intersaison_survey_members(uuid,uuid[])'),
    ('submit_intersaison_survey_choice(uuid,text,text,text,text,text)'),('launch_intersaison_survey_two(uuid,uuid,uuid,uuid,text,boolean)')) f(signature)
  union all
  select 'choice_dm_missing_member','0',count(*)::text,case when count(*)=0 then 'OK' else 'ERROR' end
    from public.guild_dm_recipients d join public.guild_dm_campaigns c on c.id=d.campaign_id where c.interaction_type='intersaison_choice' and d.member_id is null
  union all
  select 'choice_dm_account_mismatch','0',count(*)::text,case when count(*)=0 then 'OK' else 'ERROR' end
    from public.guild_dm_recipients d join public.guild_dm_campaigns c on c.id=d.campaign_id
    join public.intersaison_survey_recipients r on r.guild_dm_recipient_id=d.id where c.interaction_type='intersaison_choice'
      and (r.member_id is distinct from d.member_id or r.organization_id<>d.organization_id or r.survey_campaign_id not in
        (select id from public.intersaison_survey_campaigns where guild_dm_campaign_id=d.campaign_id and organization_id=d.organization_id))
  union all
  select 'duplicate_dm_account','0',count(*)::text,case when count(*)=0 then 'OK' else 'ERROR' end from (
    select d.campaign_id,d.member_id from public.guild_dm_recipients d join public.guild_dm_campaigns c on c.id=d.campaign_id
    where c.interaction_type='intersaison_choice' group by d.campaign_id,d.member_id having count(*)>1) x
  union all
  select 'shared_survey_dm_recipient','0',count(*)::text,case when count(*)=0 then 'OK' else 'ERROR' end from (
    select guild_dm_recipient_id from public.intersaison_survey_recipients where guild_dm_recipient_id is not null group by guild_dm_recipient_id having count(*)>1) x
  union all
  select 'excluded_choice_accounts','informational',count(*)::text,'INFO' from public.intersaison_survey_recipients r
    join public.intersaison_survey_campaigns c on c.id=r.survey_campaign_id where c.poll_number=2 and not c.is_test and r.delivery_status='excluded_duplicate'
  union all
  select 'choice_queue_in_flight','0 before controlled bot restart',count(*)::text,'INFO' from public.guild_dm_recipients d
    join public.guild_dm_campaigns c on c.id=d.campaign_id where c.interaction_type='intersaison_choice' and d.status in ('queued','sending')
  union all
  select 'existing_unique_index_'||ci.relname,'diagnostic',pg_get_indexdef(i.indexrelid),'INFO'
    from pg_index i join pg_class ct on ct.oid=i.indrelid join pg_class ci on ci.oid=i.indexrelid
    join pg_namespace ns on ns.oid=ct.relnamespace where ns.nspname='public' and i.indisunique
      and ct.relname in ('guild_dm_recipients','intersaison_survey_recipients','intersaison_survey_responses')
)
select * from checks order by check_name;
