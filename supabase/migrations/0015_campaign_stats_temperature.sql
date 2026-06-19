-- 0015_campaign_stats_temperature.sql
-- Surface the hot/warm/cold breakdown per campaign on the Campaigns list.
--
-- Apply via the Supabase SQL editor / MCP (project convention).
--
-- The campaign-detail lead table already shows temperature per lead (M-CX1),
-- but the Campaigns overview (/campaigns) only had total/qualified/failed
-- counts. This appends hot/warm/cold counts to the existing campaign_stats
-- view so the list can show, at a glance post-run, how each campaign's
-- qualified leads break down by warmth. Temperature is only set on qualified
-- leads that have been cross-checked, so a not-yet-cross-checked campaign
-- reads 0/0/0 (the UI renders that as "—").
--
-- CREATE OR REPLACE keeps the existing columns in the same order and only
-- appends the three new ones at the end (Postgres requires the leading column
-- set to be unchanged).

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
  )                                                          as qualified_count,
  count(l.id) filter (where l.temperature = 'hot')           as hot_count,
  count(l.id) filter (where l.temperature = 'warm')          as warm_count,
  count(l.id) filter (where l.temperature = 'cold')          as cold_count
from public.campaigns c
left join public.leads l on l.campaign_id = c.id
group by c.id;

grant select on public.campaign_stats to authenticated, anon, service_role;
