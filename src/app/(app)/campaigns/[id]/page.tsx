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

  const [{ data: campaign }, { data: leads }] = await Promise.all([
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
      .order("created_at", { ascending: true }),
  ]);

  if (!campaign) notFound();

  return (
    <CampaignDetail
      initialCampaign={campaign}
      initialLeads={leads ?? []}
    />
  );
}
