-- Run in the Supabase SQL editor.
-- Live-aggregate counts per campaign so the UI never depends on the stale
-- stored counters (campaigns.qualified_count / failed_count). The
-- "qualified" predicate matches anything that isn't an explicit "NO" — that
-- works uniformly for legacy YES/NO data and categorical prompts ("Decision
-- Maker" / "Champion" / "Influencer" / etc.), so no backfill is needed.
--
-- security_invoker=true makes the view honor row-level security on the
-- underlying tables (campaigns + leads) for whoever is querying — Supabase
-- recommends this for any view exposed via PostgREST.

create or replace view public.campaign_stats
with (security_invoker = true)
as
select
  c.id as campaign_id,
  count(l.id)                                                as total_leads,
  count(l.id) filter (
    where l.status in ('processed','failed','skipped')
  )                                                          as touched_count,
  count(l.id) filter (where l.status = 'processed')          as processed_count,
  count(l.id) filter (where l.status = 'failed')             as failed_count,
  count(l.id) filter (
    where l.status = 'processed'
      and l.function_qualification is not null
      and upper(btrim(l.function_qualification)) <> 'NO'
  )                                                          as qualified_count
from public.campaigns c
left join public.leads l on l.campaign_id = c.id
group by c.id;

grant select on public.campaign_stats to authenticated, anon, service_role;
