-- NOT part of installation. Run only after explicit rollout authorization and
-- after the adapted worker has been installed, tested and confirmed active.
-- This enables future confirmed sends; it does not publish a survey or enqueue.
begin;
do $$ begin
  if to_regprocedure('public.guild_survey_request(uuid,text,uuid,integer,jsonb)') is null
    or to_regprocedure('public.authorize_guild_survey_delivery(uuid,text)') is null
    or not exists(select 1 from pg_trigger where tgname='guild_survey_delivery_guard' and tgenabled='O') then
    raise exception 'Installation des sondages de guilde incomplete.';
  end if;
end $$;
update public.guild_survey_settings set delivery_enabled=true where singleton;
commit;

-- Emergency disable (execute separately if needed):
-- update public.guild_survey_settings set delivery_enabled=false where singleton;
-- A Discord request already accepted cannot be recalled by this flag.
