begin;

alter table public.guild_members
  add column if not exists primary_member_id uuid null;

do $$
declare
  v_self_links text;
begin
  select string_agg(id::text, ', ' order by id::text)
  into v_self_links
  from public.guild_members
  where primary_member_id = id;

  if v_self_links is not null then
    raise exception 'primary_member_id self-reference detected for guild_members ids: %', v_self_links;
  end if;
end;
$$;

do $$
declare
  v_missing_principals text;
begin
  select string_agg(secondary.id::text, ', ' order by secondary.id::text)
  into v_missing_principals
  from public.guild_members secondary
  left join public.guild_members primary_member
    on primary_member.id = secondary.primary_member_id
  where secondary.primary_member_id is not null
    and primary_member.id is null;

  if v_missing_principals is not null then
    raise exception 'primary_member_id references missing guild_members ids for secondary ids: %', v_missing_principals;
  end if;
end;
$$;

do $$
declare
  v_chain_links text;
begin
  select string_agg(secondary.id::text, ', ' order by secondary.id::text)
  into v_chain_links
  from public.guild_members secondary
  join public.guild_members primary_member
    on primary_member.id = secondary.primary_member_id
  where primary_member.primary_member_id is not null;

  if v_chain_links is not null then
    raise exception 'primary_member_id chain detected for secondary ids: %', v_chain_links;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'guild_members_primary_member_not_self_check'
      and conrelid = 'public.guild_members'::regclass
  ) then
    alter table public.guild_members
      add constraint guild_members_primary_member_not_self_check
      check (primary_member_id is null or primary_member_id <> id);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'guild_members_primary_member_id_fkey'
      and conrelid = 'public.guild_members'::regclass
  ) then
    alter table public.guild_members
      add constraint guild_members_primary_member_id_fkey
      foreign key (primary_member_id)
      references public.guild_members(id)
      on delete restrict;
  end if;
end;
$$;

create or replace function public.guild_members_validate_linked_account()
returns trigger
language plpgsql
as $function$
declare
  v_primary_primary_member_id uuid;
  v_existing_secondary_id uuid;
begin
  if new.primary_member_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and old.primary_member_id is not null
    and new.primary_member_id is distinct from old.primary_member_id then
    raise exception 'Un compte secondaire doit etre delie avant de changer de principal.';
  end if;

  if new.primary_member_id = new.id then
    raise exception 'Un compte ne peut pas etre secondaire de lui-meme.';
  end if;

  select primary_member.primary_member_id
  into v_primary_primary_member_id
  from public.guild_members primary_member
  where primary_member.id = new.primary_member_id
  for update;

  if not found then
    raise exception 'Compte principal introuvable.';
  end if;

  if v_primary_primary_member_id is not null then
    raise exception 'Le compte principal choisi est deja un compte secondaire.';
  end if;

  select secondary.id
  into v_existing_secondary_id
  from public.guild_members secondary
  where secondary.primary_member_id = new.id
    and secondary.id <> new.id
  order by secondary.id
  limit 1
  for update;

  if v_existing_secondary_id is not null then
    raise exception 'Un compte possedant deja des secondaires ne peut pas devenir secondaire.';
  end if;

  return new;
end;
$function$;

revoke all on function public.guild_members_validate_linked_account()
from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'guild_members_validate_linked_account_trigger'
      and tgrelid = 'public.guild_members'::regclass
  ) then
    create trigger guild_members_validate_linked_account_trigger
      before insert or update of primary_member_id
      on public.guild_members
      for each row
      execute function public.guild_members_validate_linked_account();
  end if;
end;
$$;

create index if not exists guild_members_primary_member_id_idx
  on public.guild_members(primary_member_id)
  where primary_member_id is not null;

comment on column public.guild_members.primary_member_id is
  'Nullable self-reference for linked game accounts. NULL means principal/autonomous account; a UUID means this account is secondary of the referenced principal account. Discord ID is synchronized at application level; gameplay data remains per guild_members row.';

commit;
