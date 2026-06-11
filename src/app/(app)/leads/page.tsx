import { PageHeader } from "@/components/page-header";
import { LeadsBrowser, type LeadRow } from "@/components/leads/leads-browser";
import { createServerSupabase } from "@/lib/supabase/server";
import { LEAD_COLS } from "@/components/leads/lead-display";
import {
  parseLeadFiltersFromObject,
  applyLeadFilters,
  LEADS_PAGE_SIZE,
} from "@/lib/leads-filters";

// Request-time rendering: the filter set lives in the URL and the query runs
// server-side, so a new run / delete / filter change is always reflected.
export const dynamic = "force-dynamic";

type Facets = {
  domains: string[];
  icps: string[];
  priorities: string[];
};

const EMPTY_FACETS: Facets = {
  domains: [],
  icps: [],
  priorities: [],
};

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const filters = parseLeadFiltersFromObject(await searchParams);
  const supabase = await createServerSupabase();

  // Filter dropdown options + the campaign list run in parallel with the page
  // query. Facets come from one RPC (distinct values, computed in Postgres) so
  // we never pull the full lead set into the browser to build them.
  const [facetsRes, campaignsRes] = await Promise.all([
    supabase.rpc("lead_filter_facets"),
    supabase
      .from("campaigns")
      .select("id, name")
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  const facets: Facets = {
    ...EMPTY_FACETS,
    ...((facetsRes.data as Facets | null) ?? {}),
  };
  const campaigns = (campaignsRes.data as { id: string; name: string }[]) ?? [];

  // /leads dedupes on the LinkedIn profile URL (the UID) via the distinct_leads
  // view (migration 0010): one row per person across all campaigns, keyed on
  // the normalized URL, keeping their most recently processed row. The view's
  // inner join to campaigns also drops orphaned leads and exposes the campaign
  // name as a flat `campaign_name` column — we reshape it back into the
  // { campaigns: { id, name } } shape the row component expects. count: 'exact'
  // drives pagination (now over the deduped set).
  const cols = `${LEAD_COLS}, location, campaign_id, campaign_name`;
  const from = (filters.page - 1) * LEADS_PAGE_SIZE;

  const filtered = applyLeadFilters(
    supabase.from("distinct_leads").select(cols, { count: "exact" }),
    filters
  );

  const { data, count, error } = await filtered
    .order("processed_at", { ascending: false })
    .range(from, from + LEADS_PAGE_SIZE - 1);

  const leads = (
    (data as unknown as (LeadRow & { campaign_name: string | null })[]) ?? []
  ).map((l) => ({
    ...l,
    campaigns: l.campaign_name
      ? { id: l.campaign_id, name: l.campaign_name }
      : null,
  }));
  const total = count ?? 0;

  return (
    <div>
      <PageHeader
        title="Leads"
        description="Every qualified lead across all campaigns in one view. Filter by campaign, domain, ICP, area, priority, seniority, temperature, company, or location — then select rows to export or copy LinkedIn URLs."
      />

      {error ? (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive font-mono break-all">
          Lead query failed: {error.message}
        </div>
      ) : null}

      <LeadsBrowser
        leads={leads}
        total={total}
        facets={facets}
        campaigns={campaigns}
        filters={filters}
      />
    </div>
  );
}
