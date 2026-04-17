import Papa from "papaparse";
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

// Output column order matches `Lead data format.csv`:
// cols 1-9  = pass-through scraper input
// cols 10-17 = agent output
const COLUMNS = [
  "defaultProfileUrl",
  "fullName",
  "firstName",
  "lastName",
  "companyName",
  "title",
  "summary",
  "titleDescription",
  "location",
  "Full Name",
  "Function Qualification",
  "Function Reasoning",
  "ICP Qualification",
  "Seniority Scoring",
  "Priority Level",
  "Product Area / Team",
  "Lead Summary",
];

type LeadExport = {
  default_profile_url: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  title: string | null;
  summary: string | null;
  title_description: string | null;
  location: string | null;
  agent_full_name: string | null;
  function_qualification: string | null;
  function_reasoning: string | null;
  icp_qualification: string | null;
  seniority_scoring: number | null;
  priority_level: string | null;
  product_area: string | null;
  lead_summary: string | null;
};

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const supabase = await createServerSupabase();

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();
  if (!campaign) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: leads, error } = await supabase
    .from("leads")
    .select(
      "default_profile_url, full_name, first_name, last_name, company_name, title, summary, title_description, location, agent_full_name, function_qualification, function_reasoning, icp_qualification, seniority_scoring, priority_level, product_area, lead_summary"
    )
    .eq("campaign_id", id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = ((leads ?? []) as LeadExport[]).map((l) => ({
    defaultProfileUrl: l.default_profile_url,
    fullName: l.full_name,
    firstName: l.first_name,
    lastName: l.last_name,
    companyName: l.company_name,
    title: l.title,
    summary: l.summary,
    titleDescription: l.title_description,
    location: l.location,
    "Full Name": l.agent_full_name,
    "Function Qualification": l.function_qualification,
    "Function Reasoning": l.function_reasoning,
    "ICP Qualification": l.icp_qualification,
    "Seniority Scoring": l.seniority_scoring,
    "Priority Level": l.priority_level,
    "Product Area / Team": l.product_area,
    "Lead Summary": l.lead_summary,
  }));

  const csv = Papa.unparse({ fields: COLUMNS, data: rows }, { quotes: true });
  const safeName = campaign.name.replace(/[^a-z0-9-_ ]/gi, "").slice(0, 60);

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${safeName || "campaign"}.csv"`,
    },
  });
}
