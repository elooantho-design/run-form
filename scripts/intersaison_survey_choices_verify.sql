-- Read-only verification. No campaign, recipient, placement or response is created.
with functions(signature) as (
  values ('preview_intersaison_survey_two(uuid,uuid,uuid)'),
    ('launch_intersaison_survey_two(uuid,uuid,uuid,uuid,text,boolean)'),
    ('add_intersaison_survey_members(uuid,uuid,uuid,uuid[])'),
    ('close_intersaison_survey(uuid,uuid,uuid)'),
    ('save_intersaison_survey_placement(uuid,uuid,uuid,uuid,text,integer)'),
    ('submit_intersaison_survey_choice(uuid,text,text,text,text,text)'),
    ('queue_intersaison_survey_reminders(uuid,uuid,uuid,uuid)')
), checks as (
  select 'rpc_' || signature as check_name,'present, service-only' as expected_value,
    coalesce(to_regprocedure('public.' || signature)::text,'missing') as actual_value,
    case when to_regprocedure('public.' || signature) is not null
      and has_function_privilege('service_role','public.' || signature,'EXECUTE')
      and not has_function_privilege('anon','public.' || signature,'EXECUTE')
      and not has_function_privilege('authenticated','public.' || signature,'EXECUTE') then 'OK' else 'ERROR' end as status from functions
  union all
  select 'new_columns','5',count(*)::text,case when count(*) = 5 then 'OK' else 'ERROR' end
  from information_schema.columns where table_schema = 'public' and (table_name,column_name) in (
    ('intersaison_survey_campaigns','objective_version_id'),('intersaison_survey_campaigns','objective_snapshot'),
    ('intersaison_survey_recipients','member_key'),('intersaison_survey_responses','discord_interaction_id'),('intersaison_survey_placements','revision'))
  union all
  select 'placement_rls','enabled',relrowsecurity::text,case when relrowsecurity then 'OK' else 'ERROR' end
    from pg_class where oid = 'public.intersaison_survey_placements'::regclass
  union all
  select 'placement_direct_writes','0',count(*)::text,case when count(*) = 0 then 'OK' else 'ERROR' end
    from information_schema.role_table_grants where table_schema = 'public' and table_name = 'intersaison_survey_placements'
      and grantee in ('PUBLIC','anon','authenticated','service_role') and privilege_type <> 'SELECT'
  union all
  select 'placement_scope_fks','2',count(*)::text,case when count(*) = 2 then 'OK' else 'ERROR' end
    from pg_constraint where conrelid = 'public.intersaison_survey_placements'::regclass
      and conname in ('intersaison_placement_season_org_fk','intersaison_placement_guild_org_fk') and contype = 'f'
  union all
  select 'immutable_snapshot_trigger','1',count(*)::text,case when count(*) = 1 then 'OK' else 'ERROR' end
    from pg_trigger where tgrelid = 'public.intersaison_survey_campaigns'::regclass and tgname = 'intersaison_survey_choice_snapshot_immutable' and not tgisinternal
  union all
  select 'response_interaction_unique_index','present',coalesce(to_regclass('public.intersaison_survey_response_interaction_uidx')::text,'missing'),
    case when to_regclass('public.intersaison_survey_response_interaction_uidx') is not null then 'OK' else 'ERROR' end
  union all
  select 'future_season_reference_trigger','1',count(*)::text,case when count(*) = 1 then 'OK' else 'ERROR' end
    from pg_trigger where tgrelid = 'public.intersaison_survey_seasons'::regclass
      and tgname = 'intersaison_survey_capture_reference' and not tgisinternal
  union all
  select 'private_enqueue_access','false',has_function_privilege('service_role','public.enqueue_intersaison_survey_members(uuid,uuid[])','EXECUTE')::text,
    case when not has_function_privilege('service_role','public.enqueue_intersaison_survey_members(uuid,uuid[])','EXECUTE') then 'OK' else 'ERROR' end
  union all
  select 'choice_snapshots_complete','0',count(*)::text,case when count(*) = 0 then 'OK' else 'ERROR' end
    from public.intersaison_survey_campaigns c where c.poll_number = 2 and (c.objective_version_id is null
      or jsonb_typeof(c.objective_snapshot) <> 'object' or (select count(*) from jsonb_object_keys(
        case when jsonb_typeof(c.objective_snapshot) = 'object' then c.objective_snapshot else '{}'::jsonb end)) <> 7)
  union all
  select 'invalid_choice_answers','0',count(*)::text,case when count(*) = 0 then 'OK' else 'ERROR' end
    from public.intersaison_survey_responses where poll_number = 2 and
      (coalesce(first_choice_guild_code,'') not in ('G1','G2','G3','G4','G5','G6','G7')
      or (second_choice_guild_code is not null and second_choice_guild_code not in ('G1','G2','G3','G4','G5','G6','G7'))
      or first_choice_guild_code = second_choice_guild_code)
  union all
  select 'response_scope_mismatches','0',count(*)::text,case when count(*) = 0 then 'OK' else 'ERROR' end
    from public.intersaison_survey_responses r join public.intersaison_survey_campaigns c on c.id = r.survey_campaign_id
    join public.intersaison_survey_recipients d on d.id = r.survey_recipient_id
    where r.poll_number = 2 and (r.organization_id <> c.organization_id or d.organization_id <> c.organization_id
      or d.survey_campaign_id <> c.id or c.poll_number <> 2)
)
select * from checks order by check_name;
