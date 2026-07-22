import Papa from "papaparse";
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

// Output column order: pass-through scraper input first, then the
// agent's qualification fields. Domain classification + subdomain land
// between Seniority and Priority — matches the prompt's logical flow
// (qualify → score → classify → prioritize).
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
  "Domain Classification",
  "Subdomain",
  "Subdomain Justification",
  "Domain Reasoning",
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
  domain_classification: string | null;
  subdomain: string | null;
  subdomain_justification: string | null;
  domain_reasoning: string | null;
  priority_level: string | null;
  product_area: string | null;
  lead_summary: string | null;
};

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  // `qualified=1` filters out leads with an explicit "NO" verdict and
  // any lead that never reached a verdict (null function_qualification —
  // failed/pending rows). Any other value flows through (YES, plus any
  // categorical verdict a custom prompt produces).
  const qualifiedOnly =
    new URL(request.url).searchParams.get("qualified") === "1";
  const supabase = await createServerSupabase();

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();
  if (!campaign) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Paginate around PostgREST's 1000-row default. A 2k+ row campaign
  // would otherwise export only the first 1000 leads silently.
  const PAGE_SIZE = 1000;
  const leadCols =
    "default_profile_url, full_name, first_name, last_name, company_name, title, summary, title_description, location, agent_full_name, function_qualification, function_reasoning, icp_qualification, seniority_scoring, domain_classification, subdomain, subdomain_justification, domain_reasoning, priority_level, product_area, lead_summary";
  const allLeads: LeadExport[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    let query = supabase
      .from("leads")
      .select(leadCols)
      .eq("campaign_id", id);
    if (qualifiedOnly) {
      query = query
        .not("function_qualification", "is", null)
        .neq("function_qualification", "NO");
    }
    const { data, error } = await query
      .order("created_at", { ascending: true })
      .range(start, start + PAGE_SIZE - 1);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data || data.length === 0) break;
    allLeads.push(...(data as LeadExport[]));
    if (data.length < PAGE_SIZE) break;
  }

  const rows = allLeads.map((l) => ({
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
    "Domain Classification": l.domain_classification,
    "Subdomain": l.subdomain,
    "Subdomain Justification": l.subdomain_justification,
    "Domain Reasoning": l.domain_reasoning,
    "Priority Level": l.priority_level,
    "Product Area / Team": l.product_area,
    "Lead Summary": l.lead_summary,
  }));

  const csv = Papa.unparse({ fields: COLUMNS, data: rows }, { quotes: true });
  const safeName = campaign.name.replace(/[^a-z0-9-_ ]/gi, "").slice(0, 60);
  const suffix = qualifiedOnly ? "-qualified" : "";

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${safeName || "campaign"}${suffix}.csv"`,
    },
  });
}
