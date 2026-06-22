import { PageHeader } from "@/components/page-header";
import { OpportunitiesBrowser } from "@/components/opportunities/opportunities-browser";
import type { Opportunity } from "@/components/opportunities/opportunity-card";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  parseOpportunityFiltersFromObject,
  OPPS_PAGE_SIZE,
} from "@/lib/opportunity-filters";

// Request-time rendering: filters live in the URL and the RPC runs server-side,
// so a new reply / deal sync / filter change is always reflected.
export const dynamic = "force-dynamic";

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const filters = parseOpportunityFiltersFromObject(await searchParams);
  const supabase = await createServerSupabase();

  const { data, error } = await supabase.rpc("list_opportunities", {
    p_kind: filters.kind || null,
    p_window: filters.window,
    p_status: filters.status.length ? filters.status : null,
    p_q: filters.q || null,
    p_limit: OPPS_PAGE_SIZE,
    p_offset: (filters.page - 1) * OPPS_PAGE_SIZE,
  });

  const rows = (data as (Opportunity & { total_count: number })[]) ?? [];
  const total = rows[0]?.total_count ?? 0;

  return (
    <div>
      <PageHeader
        title="Opportunities"
        description="Live, positive signals worth acting on — genuine-interest replies from Smartlead and open HubSpot deals. Opens, clicks, OOO and negative replies are excluded; only real customer interaction shows here."
      />

      {error ? (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive font-mono break-all">
          Opportunities query failed: {error.message}
        </div>
      ) : null}

      <OpportunitiesBrowser
        opportunities={rows}
        total={total}
        filters={filters}
      />
    </div>
  );
}
