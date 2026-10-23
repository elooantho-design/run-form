-- Read-only, including on an empty database with prerequisites installed.
with functions(signature,exposed) as (values
  ('preview_intersaison_survey_two_reminders(uuid,uuid,uuid)',true),
  ('queue_intersaison_survey_two_reminders(uuid,uuid,uuid,text,uuid,boolean)',true),
  ('refresh_intersaison_choice_delivery_counters(uuid)',true),
  ('intersaison_choice_delivery_attempts(uuid,integer)',true),
  ('queue_intersaison_survey_reminders(uuid,uuid,uuid,uuid)',true),
  ('queue_intersaison_survey_reminders_legacy_private(uuid,uuid,uuid,uuid)',false),
  ('intersaison_survey_two_reminder_state(uuid,uuid)',false),
  ('guard_intersaison_reminder_record()',false),('audit_intersaison_survey_two_delivery()',false)
), checks as (
  select 'rpc_'||f.signature as check_name,'security definer, pinned path, service-only or private' as expected,
    coalesce(p.oid::regprocedure::text,'missing') as actual,
    case when p.oid is not null and p.prosecdef and p.proconfig @> array['search_path=public, pg_temp']
      and has_function_privilege('service_role',p.oid,'EXECUTE')=f.exposed
      and not has_function_privilege('anon',p.oid,'EXECUTE')
      and not has_function_privilege('authenticated',p.oid,'EXECUTE') then 'OK' else 'ERROR' end as status
    from functions f left join pg_proc p on p.oid=to_regprocedure('public.'||f.signature)
  union all
  select 'table_'||name,'RLS, service select only',coalesce(c.relrowsecurity::text,'missing'),
    case when c.relrowsecurity and has_table_privilege('service_role',c.oid,'SELECT')
      and not has_table_privilege('service_role',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE')
      and not has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      and not has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then 'OK' else 'ERROR' end
    from (values ('intersaison_survey_reminder_batches'),('intersaison_survey_delivery_events')) n(name)
    left join pg_class c on c.oid=to_regclass('public.'||name)
  union all
  select 'trigger_'||name,'enabled',coalesce(t.tgenabled::text,'missing'),case when t.tgenabled='O' then 'OK' else 'ERROR' end
    from (values ('intersaison_survey_two_delivery_audit'),('intersaison_reminder_batch_guard'),
      ('intersaison_delivery_event_guard'),('intersaison_reminder_batch_no_truncate'),('intersaison_delivery_event_no_truncate')) n(name)
    left join pg_trigger t on t.tgname=name and not t.tgisinternal
  union all
  select 'batch_scope','0 mismatches',count(*)::text,case when count(*)=0 then 'OK' else 'ERROR' end
    from public.intersaison_survey_reminder_batches b join public.intersaison_survey_campaigns c on c.id=b.survey_campaign_id
    where b.organization_id<>c.organization_id or c.poll_number<>2 or c.is_test
  union all
  select 'event_scope','0 mismatches',count(*)::text,case when count(*)=0 then 'OK' else 'ERROR' end
    from public.intersaison_survey_delivery_events e
    join public.intersaison_survey_campaigns c on c.id=e.survey_campaign_id
    join public.intersaison_survey_recipients s on s.id=e.survey_recipient_id
    join public.guild_dm_recipients d on d.id=e.dm_recipient_id
    where e.organization_id<>c.organization_id or e.organization_id<>s.organization_id or e.organization_id<>d.organization_id
      or s.survey_campaign_id<>c.id or d.campaign_id is distinct from c.guild_dm_campaign_id or s.guild_dm_recipient_id<>d.id
  union all
  select 'event_parent_lock_safety','no FK to survey campaign/recipient or DM recipient',count(*)::text,
    case when count(*)=0 then 'OK' else 'ERROR' end from pg_constraint
    where conrelid=to_regclass('public.intersaison_survey_delivery_events') and contype='f'
      and confrelid in (to_regclass('public.intersaison_survey_campaigns'),to_regclass('public.intersaison_survey_recipients'),
        to_regclass('public.guild_dm_recipients'))
  union all
  select 'live_samples','not required','Zero batches/events is normal before the first explicit reminder.','INFO'
)
select * from checks order by check_name;
