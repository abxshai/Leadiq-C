-- 0008_lead_filter_facets.sql
-- M3.5 — /leads cross-campaign browser.
--
-- Apply via the Supabase SQL editor (project convention; see migrations
-- 0002–0006 and the roadmap 2026-05-07 entry).
--
-- 0007 is reserved for M-AG2's pgvector embeddings (deferred, see
-- agent-section-plan.md §12), so this lands at 0008.
--
-- The /leads page filters server-side and paginates, so it never loads the
-- full lead set into the browser (unlike /analytics, which fetches everything
-- and filters in-memory — the pattern the roadmap flags as unscalable). To
-- populate the filter dropdowns without that full fetch, this function returns
-- the distinct values for the low-cardinality agent-output facets in one round
-- trip. Campaigns come from the campaigns table; temperature (hot/warm/cold)
-- and seniority (1–5) are fixed sets the client hard-codes; company name,
-- location, AND product_area are high-cardinality (product_area is the
-- per-lead company/team name — ~9.5k distinct), so the UI filters those three
-- with a text "contains" (ilike) instead of enumerating them here.
--
-- Facets are computed over status='processed' leads only — the agent-output
-- columns are null for pending/running/failed rows, so restricting here keeps
-- the option lists clean. SECURITY INVOKER (the default for SQL functions) so
-- the caller's RLS on public.leads still applies.

create or replace function public.lead_filter_facets()
returns jsonb
language sql
stable
security invoker
as $$
  select jsonb_build_object(
    'domains', (
      select coalesce(jsonb_agg(v order by v), '[]'::jsonb)
      from (
        select distinct btrim(domain_classification) as v
        from public.leads
        where status = 'processed'
          and nullif(btrim(domain_classification), '') is not null
      ) t
    ),
    'icps', (
      select coalesce(jsonb_agg(v order by v), '[]'::jsonb)
      from (
        select distinct btrim(icp_qualification) as v
        from public.leads
        where status = 'processed'
          and nullif(btrim(icp_qualification), '') is not null
      ) t
    ),
    'priorities', (
      select coalesce(jsonb_agg(v order by v), '[]'::jsonb)
      from (
        select distinct btrim(priority_level) as v
        from public.leads
        where status = 'processed'
          and nullif(btrim(priority_level), '') is not null
      ) t
    )
  );
$$;

grant execute on function public.lead_filter_facets() to authenticated, anon, service_role;
