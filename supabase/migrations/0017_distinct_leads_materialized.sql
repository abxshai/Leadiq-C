-- 0017_distinct_leads_materialized.sql
-- ---------------------------------------------------------------------------
-- Convert public.distinct_leads from a regular (security_invoker) view into a
-- MATERIALIZED view.
--
-- Why: the view is `select distinct on (dedupe_key) l.*`, so Postgres must sort
-- EVERY processed lead by the normalized-URL key on EVERY /leads load — and
-- because it drags `l.*` (incl. the ~23 MB of prose + jsonb across the set)
-- through the sort, that sort is ~1.5 KB wide and spills ~17 MB to disk
-- (external merge). Measured: ~1.24 s per load, and it's server-side so the
-- Railway→Supabase region colocation didn't touch it. Materializing precomputes
-- the dedup ONCE per mutation instead of on every read; /leads then reads an
-- indexed snapshot (top-N by processed_at), dropping to single-digit ms.
--
-- Data shape is IDENTICAL to the old view — same columns, same dedup key, same
-- tiebreak (most-recently-processed row per person) — so the /leads browser,
-- its filters, and the CSV export are byte-for-byte unchanged. Only freshness
-- changes, and that is kept exact by refreshing on every event that mutates a
-- processed lead (see public.refresh_distinct_leads() below + its callers):
--   - worker run-completion (after classify_campaign_temperature)
--   - POST /api/campaigns/[id]/cross-check
--   - deleteCampaign server action
--   - POST /api/leads/[id]/summarize-touchpoints (touchpoint_summary cache)
-- Campaign-detail + analytics read the raw `leads` table (not this view), so
-- the live during-a-run surfaces are unaffected.
--
-- RLS note: materialized views do NOT honor `security_invoker` / base-table RLS
-- (the data is precomputed under the owner, not re-checked per query). The old
-- view granted `anon` but RLS filtered anon to zero rows. To preserve that
-- exactly, this MV is granted to `authenticated` + `service_role` ONLY (no
-- anon) — the app queries /leads + export as the authenticated shared user, so
-- effective access is unchanged; the public anon key can no longer read it.
-- ---------------------------------------------------------------------------

drop view if exists public.distinct_leads;

create materialized view public.distinct_leads as
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
order by dedupe_key, l.processed_at desc nulls last, l.id
with data;

-- REFRESH ... CONCURRENTLY requires a UNIQUE index. leads.id is unique per
-- output row (distinct on keeps exactly one real lead row per dedupe_key).
create unique index distinct_leads_id_uidx
  on public.distinct_leads (id);

-- Serves the default /leads + export ORDER BY processed_at DESC + LIMIT.
create index distinct_leads_processed_at_idx
  on public.distinct_leads (processed_at desc);

-- Common equality filters (campaign / temperature); the low-cardinality agent
-- facets (domain/icp/priority) seq-scan fine over the materialized ~41k rows.
create index distinct_leads_campaign_idx
  on public.distinct_leads (campaign_id);
create index distinct_leads_temperature_idx
  on public.distinct_leads (temperature);

grant select on public.distinct_leads to authenticated, service_role;

-- SECURITY DEFINER so app roles can trigger a refresh without owning the MV.
-- CONCURRENTLY so /leads reads are never blocked while the snapshot rebuilds.
create or replace function public.refresh_distinct_leads()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view concurrently public.distinct_leads;
end;
$$;

grant execute on function public.refresh_distinct_leads()
  to authenticated, service_role;
