import { PageHeader } from "@/components/page-header";
import { AnalyticsDashboard } from "@/components/analytics-dashboard";
import { createServerSupabase } from "@/lib/supabase/server";

// Disable Next.js's full-route cache for the analytics page so deletes /
// new runs are reflected immediately (revalidatePath happens after delete,
// but force-dynamic is the safest belt-and-suspenders for a live dashboard).
export const dynamic = "force-dynamic";

type LeadJoined = {
  id: string;
  campaign_id: string;
  function_qualification: string | null;
  icp_qualification: string | null;
  seniority_scoring: number | null;
  domain_classification: string | null;
  company_name: string | null;
  product_area: string | null;
  processed_at: string | null;
  status: string;
  // PostgREST embedded campaigns row. !inner means rows whose campaign_id
  // no longer points to a real campaign (orphaned, somehow) drop out, so
  // analytics can't reflect deleted campaigns even if FK cascade ever fails.
  campaigns: { id: string; name: string; created_at: string; status: string };
};

export default async function AnalyticsPage() {
  const supabase = await createServerSupabase();

  // Paginate — PostgREST caps at 1000 rows per response by default. The
  // worker already does this for its own SELECT; same logic here so we
  // can grow past the 1k cap without silently truncating analytics.
  const PAGE_SIZE = 1000;
  const MAX_PAGES = 30;
  const cols =
    "id, campaign_id, function_qualification, icp_qualification, seniority_scoring, domain_classification, company_name, product_area, processed_at, status, campaigns!inner(id, name, created_at, status)";

  const leads: LeadJoined[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const start = page * PAGE_SIZE;
    const { data, error } = await supabase
      .from("leads")
      .select(cols)
      .in("status", ["processed", "failed"])
      .order("processed_at", { ascending: false })
      .range(start, start + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    leads.push(...(data as unknown as LeadJoined[]));
    if (data.length < PAGE_SIZE) break;
  }

  // Campaigns for the filter UI — include even ones with no leads so users
  // can still see them as options.
  const { data: campaignRows } = await supabase
    .from("campaigns")
    .select("id, name, created_at, status")
    .order("created_at", { ascending: false })
    .limit(500);

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="Qualified-lead breakdowns across your live campaigns. Filter by time, campaign, business unit, ICP, or company — every chart re-computes from the same filter set."
      />
      <AnalyticsDashboard leads={leads} campaigns={campaignRows ?? []} />
    </div>
  );
}
