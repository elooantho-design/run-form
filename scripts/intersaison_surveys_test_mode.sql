begin;

alter table public.intersaison_survey_campaigns
  add column if not exists is_test boolean not null default false;

update public.intersaison_survey_campaigns
set is_test = false
where is_test is null;

alter table public.intersaison_survey_campaigns
  alter column is_test set default false,
  alter column is_test set not null;

drop index if exists public.intersaison_survey_campaigns_season_poll_uidx;

create unique index intersaison_survey_campaigns_season_poll_uidx
  on public.intersaison_survey_campaigns (season_id, poll_number)
  where status <> 'cancelled' and is_test = false;

create index if not exists intersaison_survey_campaigns_org_test_created_idx
  on public.intersaison_survey_campaigns (organization_id, is_test, created_at desc)
  where is_test = true;

comment on column public.intersaison_survey_campaigns.is_test
  is 'Marks technical personal test survey campaigns excluded from official tracking and exports.';

commit;
