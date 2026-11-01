-- Targeted correction for the installation already present. Do NOT replay guild_surveys.sql.
-- Only seven predicates in five existing functions are changed. Existing ACLs,
-- owners, signatures and unrelated function text are preserved.
-- No member/response/queue write, no publication, no delivery activation.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $guild_survey_eligibility_patch$
declare
  rules jsonb := $guild_survey_eligibility_rules$
[
  {
    "signature": "public._guild_survey_actor(uuid)",
    "before": "or coalesce(m.community_status,'')='inactive'",
    "after": "or ((coalesce(m.community_access_type,'guild')='community' or lower(btrim(coalesce(m.role,''))) in ('community_member','content_creator','vip')) and lower(btrim(coalesce(m.community_status,'')))='inactive')"
  },
  {
    "signature": "public._guild_survey_actor(uuid)",
    "before": "count_org=1 and coalesce(m.community_access_type,'guild')<>'community' then rank",
    "after": "count_org=1 and coalesce(m.community_access_type,'guild')<>'community' and lower(btrim(coalesce(m.role,''))) not in ('community_member','content_creator','vip') then rank"
  },
  {
    "signature": "public._guild_survey_roster(uuid)",
    "before": "coalesce(root.community_access_type,'guild')='community' or coalesce(root.community_status,'')='inactive'",
    "after": "coalesce(root.community_access_type,'guild')='community' or lower(btrim(coalesce(root.role,''))) in ('community_member','content_creator','vip')"
  },
  {
    "signature": "public._guild_survey_roster(uuid)",
    "before": "coalesce(m.community_access_type,'guild')<>'community' and coalesce(m.community_status,'')<>'inactive'",
    "after": "coalesce(m.community_access_type,'guild')<>'community' and lower(btrim(coalesce(m.role,''))) not in ('community_member','content_creator','vip')"
  },
  {
    "signature": "public._guild_survey_recipient_state(uuid)",
    "before": "coalesce(m.community_access_type,'guild')='community' or coalesce(m.community_status,'')='inactive'",
    "after": "coalesce(m.community_access_type,'guild')='community' or lower(btrim(coalesce(m.role,''))) in ('community_member','content_creator','vip')"
  },
  {
    "signature": "public.guild_survey_request(uuid,text,uuid,integer,jsonb)",
    "before": "coalesce(m.community_access_type,'guild')<>'community' and coalesce(m.community_status,'')<>'inactive'",
    "after": "coalesce(m.community_access_type,'guild')<>'community' and lower(btrim(coalesce(m.role,''))) not in ('community_member','content_creator','vip')"
  },
  {
    "signature": "public.authorize_guild_survey_delivery(uuid,text)",
    "before": "coalesce(m.community_access_type,'guild')='community' or coalesce(m.community_status,'')='inactive'",
    "after": "coalesce(m.community_access_type,'guild')='community' or lower(btrim(coalesce(m.role,''))) in ('community_member','content_creator','vip')"
  }
]
$guild_survey_eligibility_rules$::jsonb;
  target text;
  rule jsonb;
  function_oid oid;
  original_definition text;
  patched_definition text;
  old_count integer;
  new_count integer;
begin
  lock table public.guild_survey_settings in share mode;
  if (select count(*) from public.guild_survey_settings where singleton and not delivery_enabled) <> 1 then
    raise exception 'Arret : les envois doivent deja etre desactives. Aucune activation/desactivation automatique.';
  end if;
  for target in select distinct item->>'signature' from jsonb_array_elements(rules) item order by 1 loop
    function_oid := to_regprocedure(target);
    if function_oid is null or not exists(select 1 from pg_proc where oid=function_oid and prosecdef) then
      raise exception 'Arret : fonction attendue absente ou incompatible : %', target;
    end if;
    original_definition := pg_get_functiondef(function_oid);
    patched_definition := original_definition;
    for rule in select item from jsonb_array_elements(rules) item where item->>'signature'=target loop
      old_count := (length(patched_definition)-length(replace(patched_definition,rule->>'before','')))/length(rule->>'before');
      new_count := (length(patched_definition)-length(replace(patched_definition,rule->>'after','')))/length(rule->>'after');
      if old_count=1 and new_count=0 then
        patched_definition := replace(patched_definition,rule->>'before',rule->>'after');
      elsif old_count=0 and new_count=1 then
        null; -- Already corrected: leave the function untouched.
      else
        raise exception 'Arret : definition inattendue pour %. Ne pas forcer ni rejouer la migration complete.', target;
      end if;
    end loop;
    if patched_definition is distinct from original_definition then execute patched_definition; end if;
  end loop;
end
$guild_survey_eligibility_patch$;

commit;
