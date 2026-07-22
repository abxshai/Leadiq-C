// Shared filter contract for the /leads cross-campaign browser. The server
// page (src/app/(app)/leads/page.tsx) and the CSV export route
// (src/app/api/leads/export.csv/route.ts) both parse the same URL params and
// apply the same predicates through here, so a filtered view and its export
// can never drift. The client (leads-browser.tsx) writes these same param
// names into the URL.

export const LEADS_PAGE_SIZE = 50;

// URL param keys. `bu`/`icp`/`company` are the canonical filter names a caller
// can deep-link into to land on a pre-filtered /leads view.
export type LeadFilters = {
  campaign: string[]; // campaign_id (uuid)
  bu: string[]; // domain_classification
  icp: string[]; // icp_qualification
  priority: string[]; // priority_level
  sen: string[]; // seniority_scoring: 1..5 (as strings)
  area: string; // product_area — text contains (ilike); ~9.5k distinct values
  company: string; // company_name — text contains (ilike)
  location: string; // location — text contains (ilike)
  q: string; // free-text across name/company/title
  qualified: boolean; // restrict to non-"NO" verdicts
  page: number; // 1-based
};

const EMPTY: LeadFilters = {
  campaign: [],
  bu: [],
  icp: [],
  priority: [],
  sen: [],
  area: "",
  company: "",
  location: "",
  q: "",
  qualified: false,
  page: 1,
};

type Getter = (key: string) => string[];

function multi(getAll: Getter, key: string): string[] {
  // Accept both repeated params (?bu=a&bu=b) and comma-joined (?bu=a,b).
  return getAll(key)
    .flatMap((s) => s.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
}

function single(getAll: Getter, key: string): string {
  return (getAll(key)[0] ?? "").trim();
}

function parse(getAll: Getter): LeadFilters {
  const pageNum = parseInt(single(getAll, "page"), 10);
  return {
    campaign: multi(getAll, "campaign"),
    bu: multi(getAll, "bu"),
    icp: multi(getAll, "icp"),
    priority: multi(getAll, "priority"),
    sen: multi(getAll, "sen").filter((s) => /^[1-5]$/.test(s)),
    area: single(getAll, "area"),
    company: single(getAll, "company"),
    location: single(getAll, "location"),
    q: single(getAll, "q"),
    qualified: single(getAll, "qualified") === "1",
    page: Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1,
  };
}

export function parseLeadFiltersFromObject(
  obj: Record<string, string | string[] | undefined>
): LeadFilters {
  return parse((k) => {
    const v = obj[k];
    if (v == null) return [];
    return Array.isArray(v) ? v : [v];
  });
}

export function parseLeadFiltersFromSearchParams(
  sp: URLSearchParams
): LeadFilters {
  return parse((k) => sp.getAll(k));
}

// Strip the characters that would break a PostgREST `.or()` / `ilike` pattern
// (commas/periods/parens separate conditions; `%`/`*` are wildcards). Leaves a
// plain substring safe to interpolate.
function sanitize(v: string): string {
  return v.replace(/[,.()%*:\\]/g, " ").trim();
}

// Minimal shape of the supabase-js filter builder we touch — avoids importing
// the generic Postgrest types while keeping the chain typed.
type FilterableQuery = {
  in(column: string, values: readonly (string | number)[]): FilterableQuery;
  ilike(column: string, pattern: string): FilterableQuery;
  or(filters: string): FilterableQuery;
  not(column: string, operator: string, value: unknown): FilterableQuery;
  neq(column: string, value: unknown): FilterableQuery;
  eq(column: string, value: unknown): FilterableQuery;
};

// Applies the filter set to a leads query. Always scopes to status='processed'
// (the only rows with agent-output columns populated), so the page, the
// export, and the facet function all agree on the population.
//
// Q is left unconstrained so the caller's concrete supabase query type flows
// straight through (preserving `.order()` / `.range()` on the result); we cast
// to the minimal FilterableQuery shape internally to call the chain.
export function applyLeadFilters<Q>(query: Q, f: LeadFilters): Q {
  let q = (query as FilterableQuery).eq("status", "processed");

  if (f.campaign.length) q = q.in("campaign_id", f.campaign);
  if (f.bu.length) q = q.in("domain_classification", f.bu);
  if (f.icp.length) q = q.in("icp_qualification", f.icp);
  if (f.priority.length) q = q.in("priority_level", f.priority);
  if (f.sen.length) q = q.in("seniority_scoring", f.sen.map(Number));

  const area = sanitize(f.area);
  if (area) q = q.ilike("product_area", `%${area}%`);

  const company = sanitize(f.company);
  if (company) q = q.ilike("company_name", `%${company}%`);

  const location = sanitize(f.location);
  if (location) q = q.ilike("location", `%${location}%`);

  const term = sanitize(f.q);
  if (term) {
    q = q.or(
      `full_name.ilike.%${term}%,company_name.ilike.%${term}%,title.ilike.%${term}%`
    );
  }

  if (f.qualified) {
    q = q.not("function_qualification", "is", null);
    q = q.neq("function_qualification", "NO");
  }

  return q as Q;
}

// True when any filter is set (used to show a Reset control).
export function hasActiveFilters(f: LeadFilters): boolean {
  return (
    f.campaign.length > 0 ||
    f.bu.length > 0 ||
    f.icp.length > 0 ||
    f.priority.length > 0 ||
    f.sen.length > 0 ||
    f.area !== "" ||
    f.company !== "" ||
    f.location !== "" ||
    f.q !== "" ||
    f.qualified
  );
}

export { EMPTY as EMPTY_LEAD_FILTERS };
