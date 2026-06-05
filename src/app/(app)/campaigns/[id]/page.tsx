import { notFound } from "next/navigation";
import { CampaignDetail } from "@/components/campaign-detail";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  // KPI counts come from the campaign_stats view (live aggregate against
  // leads using the `function_qualification IS NOT NULL AND != 'NO'`
  // predicate) so categorical verdicts count and the numbers don't lag
  // when an old run had stored counters set under the legacy YES-only
  // semantics. The lead-list table SELECT ranges to 5000 — covers any
  // realistic campaign for visual rendering, and the stats above stay
  // accurate beyond that slice.
  const [{ data: campaign }, { data: leads }, { data: stats }] =
    await Promise.all([
      supabase
        .from("campaigns")
        .select(
          "id, name, status, total_leads, model, concurrency, source_filename, created_at, started_at, completed_at, google_sheet_id"
        )
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("leads")
        .select(
          "id, full_name, title, company_name, status, function_qualification, function_reasoning, icp_qualification, seniority_scoring, domain_classification, subdomain, subdomain_justification, domain_reasoning, priority_level, product_area, lead_summary, error, default_profile_url, temperature, touchpoint_match"
        )
        .eq("campaign_id", id)
        .order("created_at", { ascending: true })
        .range(0, 4999),
      supabase
        .from("campaign_stats")
        .select("*")
        .eq("campaign_id", id)
        .maybeSingle(),
    ]);

  if (!campaign) notFound();

  const initialStats = stats ?? {
    campaign_id: id,
    total_leads: 0,
    touched_count: 0,
    processed_count: 0,
    failed_count: 0,
    qualified_count: 0,
  };

  return (
    <CampaignDetail
      initialCampaign={campaign}
      initialLeads={leads ?? []}
      initialStats={initialStats}
    />
  );
}
