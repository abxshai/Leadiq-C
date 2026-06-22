// URL-param contract for the /opportunities surface. The server page
// (src/app/(app)/opportunities/page.tsx) parses these and forwards them to the
// list_opportunities RPC (migration 0016); the client browser writes the same
// param names back into the URL. Mirrors the /leads pattern: filters live in
// the URL, the query runs server-side, the page is paginated.

export const OPPS_PAGE_SIZE = 24;

export type OpportunityKind = "" | "conversation" | "deal";
export type OpportunityWindow = "3m" | "6m" | "all";

// reply_status values that count as a genuine-interest conversation. The RPC
// defaults to both when none are selected.
export const OPP_STATUSES = ["meeting", "interested"] as const;

export type OpportunityFilters = {
  kind: OpportunityKind; // "" = both sources
  window: OpportunityWindow; // last-engaged cutoff
  status: string[]; // conversation reply_status (subset of OPP_STATUSES)
  q: string; // substring over title/company
  page: number; // 1-based
};

const EMPTY: OpportunityFilters = {
  kind: "",
  window: "6m",
  status: [],
  q: "",
  page: 1,
};

type Getter = (key: string) => string[];

function multi(getAll: Getter, key: string): string[] {
  return getAll(key)
    .flatMap((s) => s.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
}

function single(getAll: Getter, key: string): string {
  return (getAll(key)[0] ?? "").trim();
}

function parse(getAll: Getter): OpportunityFilters {
  const pageNum = parseInt(single(getAll, "page"), 10);
  const kind = single(getAll, "kind");
  const window = single(getAll, "window");
  return {
    kind:
      kind === "conversation" || kind === "deal" ? (kind as OpportunityKind) : "",
    window:
      window === "3m" || window === "all" ? (window as OpportunityWindow) : "6m",
    status: multi(getAll, "status").filter((s) =>
      (OPP_STATUSES as readonly string[]).includes(s)
    ),
    q: single(getAll, "q"),
    page: Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1,
  };
}

export function parseOpportunityFiltersFromObject(
  obj: Record<string, string | string[] | undefined>
): OpportunityFilters {
  return parse((k) => {
    const v = obj[k];
    if (v == null) return [];
    return Array.isArray(v) ? v : [v];
  });
}

export function hasActiveOpportunityFilters(f: OpportunityFilters): boolean {
  return (
    f.kind !== "" || f.window !== "6m" || f.status.length > 0 || f.q !== ""
  );
}

export { EMPTY as EMPTY_OPPORTUNITY_FILTERS };
