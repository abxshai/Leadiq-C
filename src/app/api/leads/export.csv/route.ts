import Papa from "papaparse";
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  parseLeadFiltersFromSearchParams,
  applyLeadFilters,
} from "@/lib/leads-filters";

// Cross-campaign CSV export for the /leads browser. Two modes:
//   ?ids=a,b,c          → export exactly those hand-picked leads
//   <filter params>     → export every lead matching the current filter set
// The filter params are the same ones the page reads (see leads-filters.ts),
// so "Export all" downloads precisely what the filtered view shows. Column
// order matches the per-campaign export, plus a leading Campaign column and a
// Temperature column (this view is cross-campaign and temperature-aware).

const COLUMNS = [
  "Campaign",
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
  "Temperature",
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
  temperature: string | null;
  campaign_name: string | null;
};

// Reads the deduped distinct_leads view (migration 0010) so the export matches
// the deduped /leads browser — one row per person (by normalized LinkedIn URL).
// campaign_name is a flat column on the view (no PostgREST embed needed).
const LEAD_COLS =
  "default_profile_url, full_name, first_name, last_name, company_name, title, summary, title_description, location, agent_full_name, function_qualification, function_reasoning, icp_qualification, seniority_scoring, domain_classification, subdomain, subdomain_justification, domain_reasoning, priority_level, product_area, lead_summary, temperature, campaign_name";

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const supabase = await createServerSupabase();

  // ids mode wins when present — keep only well-formed uuids to stay safe.
  const ids = (sp.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-fA-F-]{36}$/.test(s));
  const selectedMode = ids.length > 0;
  const filters = parseLeadFiltersFromSearchParams(sp);

  const PAGE_SIZE = 1000;
  const all: LeadExport[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const base = supabase.from("distinct_leads").select(LEAD_COLS);
    const query = selectedMode
      ? base.in("id", ids)
      : applyLeadFilters(base, filters);
    const { data, error } = await query
      .order("processed_at", { ascending: false })
      .range(start, start + PAGE_SIZE - 1);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as LeadExport[]));
    if (data.length < PAGE_SIZE) break;
  }

  const rows = all.map((l) => ({
    Campaign: l.campaign_name ?? null,
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
    "Temperature": l.temperature,
    "Lead Summary": l.lead_summary,
  }));

  const csv = Papa.unparse({ fields: COLUMNS, data: rows }, { quotes: true });
  const suffix = selectedMode ? "-selected" : "-filtered";

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="leads${suffix}.csv"`,
    },
  });
}
