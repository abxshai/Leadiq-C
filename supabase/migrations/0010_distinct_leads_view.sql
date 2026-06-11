-- 0010_distinct_leads_view.sql
-- ---------------------------------------------------------------------------
-- Deduped lead view for the /leads cross-campaign browser.
--
-- The leads table is unique per (campaign_id, default_profile_url), so a person
-- run through multiple campaigns exists as multiple rows. /leads unions every
-- campaign, so they'd show up once per campaign. This view collapses them to
-- ONE row per person, keyed on the LinkedIn profile URL as the UID — normalized
-- exactly like M-CX1's HubSpot join (strip protocol + www. + trailing slash,
-- lowercase) so http/https/www/trailing-slash variants count as one identity.
-- Rows with no URL fall back to their id, so they stay distinct (a NULL key
-- would otherwise collapse all url-less leads into a single row).
--
-- Tiebreaker when a person is in >1 campaign: keep the most recently processed
-- row (processed_at DESC). Only processed leads are considered — that's all the
-- /leads browser ever shows — so the winning row is always a real verdict.
--
-- Scope: ONLY the /leads page + its CSV export read this view. Campaign-detail
-- and analytics still read the raw `leads` table (per-campaign rows intact).
--
-- security_invoker = true so RLS on leads/campaigns still applies (same as
-- campaign_stats). The inner join to campaigns also drops orphaned leads from
-- deleted campaigns — replacing the `campaigns!inner` the page did in PostgREST
-- and surfacing the campaign name as a flat column (avoids relying on PostgREST
-- embedding through a DISTINCT ON view).
-- ---------------------------------------------------------------------------
create or replace view public.distinct_leads
with (security_invoker = true) as
select distinct on (dedupe_key)
  l.*,
  c.name as campaign_name
from public.leads l
join public.campaigns c on c.id = l.campaign_id
cross join lateral (
  select coalesce(
    nullif(
      lower(
        regexp_replace(
          regexp_replace(l.default_profile_url, '^https?://(www\.)?', ''),
          '/+$', ''
        )
      ),
      ''
    ),
    'id:' || l.id::text
  ) as dedupe_key
) k
where l.status = 'processed'
order by dedupe_key, l.processed_at desc nulls last, l.id;

grant select on public.distinct_leads to authenticated, anon, service_role;
