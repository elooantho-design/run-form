-- Read only; no campaign, recipient, response, or recovery is created.
with functions(signature,is_public) as (values
  ('inspect_intersaison_choice_recipient(uuid,uuid,uuid)',true),
  ('requeue_intersaison_choice_recipient(uuid,uuid,uuid,text,boolean)',true),
  ('check_intersaison_choice_delivery(uuid)',true),('intersaison_choice_account_identity(uuid,uuid)',false)
), checks as (
  select 'rpc_'||signature as check_name,'service-only or private' as expected,
    coalesce(to_regprocedure('public.'||signature)::text,'missing') as actual,
    case when to_regprocedure('public.'||signature) is not null
      and has_function_privilege('service_role','public.'||signature,'EXECUTE')=is_public
      and not has_function_privilege('anon','public.'||signature,'EXECUTE')
      and not has_function_privilege('authenticated','public.'||signature,'EXECUTE') then 'OK' else 'ERROR' end as status from functions
  union all
  select 'account_member_key_type','uuid',coalesce(max(udt_name),'missing'),case when max(udt_name)='uuid' then 'OK' else 'ERROR' end
    from information_schema.columns where table_schema='public' and table_name='guild_dm_recipients' and column_name='account_member_key'
  union all
  select 'unique_index_'||name,'unique',coalesce(i.indisunique::text,'missing'),case when i.indisunique then 'OK' else 'ERROR' end
    from (values ('guild_dm_recipients_campaign_account_uidx'),('guild_dm_recipients_legacy_discord_uidx'),('intersaison_survey_recipient_dm_uidx')) n(name)
    left join pg_index i on i.indexrelid=to_regclass('public.'||name)
  union all
  select 'old_discord_global_index','absent',coalesce(to_regclass('public.guild_dm_recipients_campaign_discord_uidx')::text,'absent'),
    case when to_regclass('public.guild_dm_recipients_campaign_discord_uidx') is null then 'OK' else 'ERROR' end
  union all
  select 'trigger_'||name,'present',count(t.oid)::text,case when count(t.oid)=1 then 'OK' else 'ERROR' end
    from (values ('guild_dm_account_identity_guard'),('intersaison_choice_response_account')) n(name)
    left join pg_trigger t on t.tgname=n.name and not t.tgisinternal group by name
  union all
  select 'choice_account_scope_mismatch','0',count(*)::text,case when count(*)=0 then 'OK' else 'ERROR' end
    from public.guild_dm_recipients d join public.guild_dm_campaigns c on c.id=d.campaign_id
    where c.interaction_type='intersaison_choice' and (d.account_member_key is null or (d.member_id is not null and d.account_member_key<>d.member_id))
  union all
  select 'classic_account_scope_contamination','0',count(*)::text,case when count(*)=0 then 'OK' else 'ERROR' end
    from public.guild_dm_recipients d join public.guild_dm_campaigns c on c.id=d.campaign_id where c.interaction_type<>'intersaison_choice' and d.account_member_key is not null
  union all
  select 'duplicate_account_recipient','0',count(*)::text,case when count(*)=0 then 'OK' else 'ERROR' end from (
    select campaign_id,account_member_key from public.guild_dm_recipients where account_member_key is not null group by campaign_id,account_member_key having count(*)>1) x
  union all
  select 'response_account_mismatch','0',count(*)::text,case when count(*)=0 then 'OK' else 'ERROR' end
    from public.intersaison_survey_responses a join public.intersaison_survey_recipients r on r.id=a.survey_recipient_id
    join public.guild_dm_recipients d on d.id=r.guild_dm_recipient_id where a.poll_number=2
      and (a.member_id is distinct from r.member_id or (a.member_id is not null and a.member_id is distinct from d.account_member_key))
  union all
  select 'recoverable_excluded_accounts','informational',count(*)::text,'INFO' from public.intersaison_survey_recipients r
    join public.intersaison_survey_campaigns c on c.id=r.survey_campaign_id where c.poll_number=2 and not c.is_test and c.status='open'
      and r.delivery_status='excluded_duplicate' and (public.intersaison_choice_account_identity(c.organization_id,coalesce(r.member_key,r.member_id))->>'eligible')::boolean
)
select * from checks order by check_name;
