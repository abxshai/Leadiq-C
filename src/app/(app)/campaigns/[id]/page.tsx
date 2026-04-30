import { notFound } from "next/navigation";
import { CampaignDetail } from "@/components/campaign-detail";
import { createServerSupabase } from "@/lib/supabase/server";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  // PostgREST caps SELECT responses at 1000 rows by default. The lead-list
  // table SELECT bumps the range explicitly to 5000 (covers any realistic
  // campaign); the touched-count is a separate count query that's
  // unaffected by the row cap, so the "Processed" KPI stays accurate even
  // for campaigns over 5000 rows.
  const [{ data: campaign }, { data: leads }, { count: touchedCount }] =
    await Promise.all([
      supabase
        .from("campaigns")
        .select(
          "id, name, status, total_leads, qualified_count, failed_count, model, concurrency, source_filename, created_at, started_at, completed_at, google_sheet_id"
        )
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("leads")
        .select(
          "id, full_name, title, company_name, status, function_qualification, seniority_scoring, priority_level, product_area, error, default_profile_url"
        )
        .eq("campaign_id", id)
        .order("created_at", { ascending: true })
        .range(0, 4999),
      supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", id)
        .in("status", ["processed", "failed", "skipped"]),
    ]);

  if (!campaign) notFound();

  return (
    <CampaignDetail
      initialCampaign={campaign}
      initialLeads={leads ?? []}
      initialTouchedCount={touchedCount ?? 0}
    />
  );
}
