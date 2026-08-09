begin;

-- Non-destructive retirement of the historical contaminated Inter-saison campaign.
-- Keeps dashboards, assignments, notes and history in place.
update public.intersaison_campaigns
set status = 'archived'
where id = 'fd5f6382-270e-4006-ace8-ab0072c4dd00'::uuid
  and status = 'active';

commit;
