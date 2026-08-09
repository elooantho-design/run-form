begin;

CREATE OR REPLACE FUNCTION public.create_intersaison_campaign(
  p_guild_count integer,
  p_poll_channel_id text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
AS $function$
declare
  v_campaign_id uuid;
  v_label text;
  v_existing_active uuid;
  v_draft_dashboard_id uuid;
  i integer;
begin
  if p_guild_count < 1 or p_guild_count > 20 then
    raise exception 'Le nombre de guildes doit être compris entre 1 et 20.';
  end if;

  select id
  into v_existing_active
  from public.intersaison_campaigns
  where status = 'active'
  limit 1;

  if v_existing_active is not null then
    raise exception 'Une campagne intersaison active existe déjà.';
  end if;

  v_label := 'Intersaison ' || to_char(current_date, 'YYYY-MM-DD');

  insert into public.intersaison_campaigns (
    label,
    status,
    guild_count,
    poll_channel_id
  )
  values (
    v_label,
    'active',
    p_guild_count,
    p_poll_channel_id
  )
  returning id into v_campaign_id;

  for i in 1..p_guild_count loop
    insert into public.intersaison_dashboards (
      campaign_id,
      code,
      name,
      sort_order,
      is_draft
    )
    values (
      v_campaign_id,
      'G' || i::text,
      'Dashboard prévisionnel G' || i::text,
      i,
      false
    );
  end loop;

  insert into public.intersaison_dashboards (
    campaign_id,
    code,
    name,
    sort_order,
    is_draft
  )
  values (
    v_campaign_id,
    'BROUILLON',
    'Dashboard Brouillon',
    999,
    true
  )
  returning id into v_draft_dashboard_id;

  insert into public.intersaison_assignments (
    campaign_id,
    dashboard_id,
    member_id,
    watcher_name,
    source_guild_code,
    target_guild_code,
    is_manually_confirmed
  )
  select
    v_campaign_id,
    v_draft_dashboard_id,
    gm.id,
    gm.watcher_name,
    gm.guild_code,
    null,
    false
  from public.guild_members gm;

  return v_campaign_id;
end;
$function$;

commit;
