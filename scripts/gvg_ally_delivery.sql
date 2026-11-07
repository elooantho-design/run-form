-- Additive installation on top of gvg_ally_followup.sql. No existing function replaced.
-- Creates delivery receipts only; does not send, reset, touch a queue or update a player.
begin;
create table public.gvg_ally_delivery_settings (
  singleton boolean primary key default true check(singleton),
  delivery_enabled boolean not null default true
);
insert into public.gvg_ally_delivery_settings values(true,true);
-- Deliberately no FK to defenses or members: a reset must not erase delivery evidence.
create table public.gvg_ally_deliveries (
  id uuid primary key,
  portal_guild_id uuid not null references public.portal_guilds(id) on delete restrict,
  organization_id uuid not null references public.portal_organizations(id) on delete restrict,
  defense_id uuid not null,
  owner_member_id uuid not null,
  actor_member_id uuid not null,
  claim_token uuid not null,
  status text not null check(status in ('sending','sent','failed','uncertain')),
  payload jsonb not null,
  discord_message_id text,
  error_reason text,
  attempts integer not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(portal_guild_id,defense_id)
);
alter table public.gvg_ally_deliveries enable row level security;
alter table public.gvg_ally_delivery_settings enable row level security;
revoke all on public.gvg_ally_deliveries,public.gvg_ally_delivery_settings from public,anon,authenticated,service_role;

create function public.read_gvg_ally_delivery(p_portal_guild_id uuid,p_actor_member_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v jsonb;
begin
  v:=public.read_gvg_ally_followup(p_portal_guild_id,p_actor_member_id);
  return v||jsonb_build_object('delivery_version',1,'snapshot_version',md5(v::text),
    'delivery_enabled',(select delivery_enabled from public.gvg_ally_delivery_settings where singleton),
    'deliveries',(select coalesce(jsonb_agg(jsonb_build_object('defense_id',r.defense_id,'status',r.status,
      'error_reason',r.error_reason,'updated_at',r.updated_at,'discord_message_id',r.discord_message_id) order by r.defense_id),'[]'::jsonb)
      from public.gvg_ally_deliveries r where r.portal_guild_id=p_portal_guild_id
        and r.defense_id in (select (d->>'id')::uuid from jsonb_array_elements(v->'defenses') d)));
end $$;

create function public.claim_gvg_ally_delivery(p_portal_guild_id uuid,p_actor_member_id uuid,p_defense_id uuid,
  p_snapshot_version text,p_payload jsonb,p_receipt_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare c jsonb; v jsonb; s public.gvg_ally_followup_state%rowtype; m jsonb; matches integer;
  d public.gvg_defense%rowtype; r public.gvg_ally_deliveries%rowtype; code text;
begin
  c:=public._gvg_reset_context(p_portal_guild_id,p_actor_member_id); code:=c->>'technical_guild';
  if not pg_try_advisory_xact_lock(hashtextextended('gvg-reset-guild:'||p_portal_guild_id::text,0)) then
    raise exception 'Une operation GvG est en cours' using errcode='55P03'; end if;
  if exists(select 1 from public.gvg_reset_operations where portal_guild_id=p_portal_guild_id and state in ('prepared','committed')) then
    raise exception 'Reset en cours : aucun nouvel envoi' using errcode='55P03'; end if;
  if not coalesce((select delivery_enabled from public.gvg_ally_delivery_settings where singleton),false) then
    raise exception 'Envois allies desactives' using errcode='42501'; end if;
  perform 1 from public.guild_members where public._gvg_reset_code(guild_code)=code order by id for share;
  perform 1 from public.gvg_defense where guild=code and is_ally is true order by id for share;
  perform 1 from public.gvg_ally_followup_state where defense_id in
    (select id from public.gvg_defense where guild=code and is_ally is true) order by defense_id for share;
  v:=public.read_gvg_ally_followup(p_portal_guild_id,p_actor_member_id);
  if md5(v::text) is distinct from p_snapshot_version then
    raise exception 'Les retours ont change. Actualisez avant envoi' using errcode='40001'; end if;
  select * into d from public.gvg_defense where id=p_defense_id and guild=code and is_ally is true;
  if not found or public._gvg_ally_signature(d) is null then
    raise exception 'Defense alliee invalide' using errcode='42501'; end if;
  select * into s from public.gvg_ally_followup_state where defense_id=d.id;
  if not found or s.opened is not true or s.owner_confirmed is not true then
    raise exception 'Defense non ouverte ou proprietaire non confirme' using errcode='42501'; end if;
  select count(*) into matches from jsonb_array_elements(v->'members') x
    where lower(public._gvg_ally_assignment(x->>'assignment'))=lower(public._gvg_ally_position(d));
  select x into m from jsonb_array_elements(v->'members') x where x->>'id'=s.owner_member_id::text;
  if matches<>1 or m is null or lower(public._gvg_ally_assignment(m->>'assignment')) is distinct from lower(public._gvg_ally_position(d))
    or exists(select 1 from public.gvg_ally_provisional_assignments where member_id=s.owner_member_id)
    or m->>'personal_forum_post_url' is distinct from p_payload->>'thread_url'
    or p_payload->>'owner_member_id' is distinct from s.owner_member_id::text
    or coalesce(p_payload->>'thread_url','') !~ '^https://(www\.)?(discord\.com|discordapp\.com)/channels/[0-9]{17,20}/[0-9]{17,20}(/[0-9]{17,20})?/?$'
    or coalesce(length(p_payload->>'content'),0) not between 1 and 2000
    or p_receipt_id is null or p_claim_token is null then
    raise exception 'Destinataire ou message invalide' using errcode='42501'; end if;
  select * into r from public.gvg_ally_deliveries where portal_guild_id=p_portal_guild_id and defense_id=d.id for update;
  if found and r.status<>'failed' then return jsonb_build_object('claimed',false,'status',r.status); end if;
  if r.id is not null then
    update public.gvg_ally_deliveries set status='sending',payload=p_payload,owner_member_id=s.owner_member_id,
      actor_member_id=p_actor_member_id,claim_token=p_claim_token,error_reason=null,attempts=attempts+1,updated_at=clock_timestamp()
      where id=r.id returning * into r;
  else
    insert into public.gvg_ally_deliveries(id,portal_guild_id,organization_id,defense_id,owner_member_id,actor_member_id,claim_token,status,payload)
      values(p_receipt_id,p_portal_guild_id,(c->>'organization_id')::uuid,d.id,s.owner_member_id,p_actor_member_id,p_claim_token,'sending',p_payload)
      returning * into r;
  end if;
  return jsonb_build_object('claimed',true,'receipt_id',r.id,'claim_token',r.claim_token,'payload',r.payload);
end $$;

-- The server can record the outcome of its existing claim after reset or permission loss.
-- This capability cannot claim or send a new message. Uncertain sends are never requeued.
create function public.finish_gvg_ally_delivery(p_receipt_id uuid,p_claim_token uuid,p_status text,p_message_id text,p_error text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.gvg_ally_deliveries%rowtype;
begin
  select * into r from public.gvg_ally_deliveries where id=p_receipt_id and claim_token=p_claim_token for update;
  if not found then raise exception 'Recu non autorise' using errcode='42501'; end if;
  if p_status not in ('sent','failed','uncertain') or (p_status='sent' and coalesce(p_message_id,'') !~ '^[0-9]{17,20}$') then
    raise exception 'Resultat Discord invalide' using errcode='22023'; end if;
  if r.status='sending' then
    update public.gvg_ally_deliveries set status=p_status,discord_message_id=case when p_status='sent' then p_message_id end,
      error_reason=left(p_error,400),updated_at=clock_timestamp() where id=r.id returning * into r;
  end if;
  return jsonb_build_object('status',r.status);
end $$;
revoke all on function public.read_gvg_ally_delivery(uuid,uuid),public.claim_gvg_ally_delivery(uuid,uuid,uuid,text,jsonb,uuid,uuid),
  public.finish_gvg_ally_delivery(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.read_gvg_ally_delivery(uuid,uuid),public.claim_gvg_ally_delivery(uuid,uuid,uuid,text,jsonb,uuid,uuid),
  public.finish_gvg_ally_delivery(uuid,uuid,text,text,text) to service_role;
commit;
