begin;

alter table public.guild_dm_campaigns
  add column if not exists is_test boolean not null default false;

create index if not exists guild_dm_campaigns_org_is_test_created_idx
  on public.guild_dm_campaigns (organization_id, is_test, created_at desc);

comment on column public.guild_dm_campaigns.is_test
  is 'Indique une campagne MP Discord de test envoyee uniquement a l admin connecte.';

commit;
