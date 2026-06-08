"use client";

import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  ExternalLink,
  Download,
  Copy,
  Check,
  X,
  Search,
  MapPin,
  Building2,
  Boxes,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { MultiSelect, PillGroup } from "@/components/ui/multi-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  type Lead,
  DetailGrid,
  FunctionVerdict,
  TemperatureBadge,
  hasLeadDetail,
} from "@/components/leads/lead-display";
import {
  type LeadFilters,
  LEADS_PAGE_SIZE,
  hasActiveFilters,
} from "@/lib/leads-filters";
import { cn } from "@/lib/utils";

export type LeadRow = Lead & {
  location: string | null;
  campaign_id: string;
  campaigns: { id: string; name: string } | null;
};

type Facets = {
  domains: string[];
  icps: string[];
  priorities: string[];
};

// Number of leading non-data columns spanned by the inline-expand row
// (checkbox cell stays empty, the rest is one wide cell).
const EXPAND_COLSPAN = 12;

export function LeadsBrowser({
  leads,
  total,
  facets,
  campaigns,
  filters,
}: {
  leads: LeadRow[];
  total: number;
  facets: Facets;
  campaigns: { id: string; name: string }[];
  filters: LeadFilters;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Selection persists across pages — keyed by lead id, carrying the data we
  // need for Export/Copy without re-fetching unloaded rows.
  const [selection, setSelection] = useState<
    Map<string, { url: string | null; name: string | null }>
  >(new Map());
  const [copied, setCopied] = useState(false);

  // ---- URL writing ------------------------------------------------------
  // Every filter change rewrites the query string; the server re-queries.
  const writeParams = useCallback(
    (mutate: (sp: URLSearchParams) => void, resetPage = true) => {
      const sp = new URLSearchParams(searchParams.toString());
      mutate(sp);
      if (resetPage) sp.delete("page");
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  const setMulti = useCallback(
    (key: string, values: Set<string>) =>
      writeParams((sp) => {
        if (values.size) sp.set(key, [...values].join(","));
        else sp.delete(key);
      }),
    [writeParams]
  );

  const setText = useCallback(
    (key: string, value: string) =>
      writeParams((sp) => {
        if (value.trim()) sp.set(key, value.trim());
        else sp.delete(key);
      }),
    [writeParams]
  );

  const toggleQualified = useCallback(
    (next: boolean) =>
      writeParams((sp) => {
        if (next) sp.set("qualified", "1");
        else sp.delete("qualified");
      }),
    [writeParams]
  );

  const resetAll = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

  const goToPage = useCallback(
    (page: number) =>
      writeParams((sp) => {
        if (page > 1) sp.set("page", String(page));
        else sp.delete("page");
      }, false),
    [writeParams]
  );

  // ---- debounced text filters ------------------------------------------
  const [areaText, setAreaText] = useState(filters.area);
  const [companyText, setCompanyText] = useState(filters.company);
  const [locationText, setLocationText] = useState(filters.location);
  const [qText, setQText] = useState(filters.q);

  // Keep local inputs in sync when the URL changes from elsewhere
  // (back/forward, Reset, an analytics deep-link).
  useEffect(() => setAreaText(filters.area), [filters.area]);
  useEffect(() => setCompanyText(filters.company), [filters.company]);
  useEffect(() => setLocationText(filters.location), [filters.location]);
  useEffect(() => setQText(filters.q), [filters.q]);

  useDebouncedSync(areaText, filters.area, (v) => setText("area", v));
  useDebouncedSync(companyText, filters.company, (v) => setText("company", v));
  useDebouncedSync(locationText, filters.location, (v) =>
    setText("location", v)
  );
  useDebouncedSync(qText, filters.q, (v) => setText("q", v));

  // ---- selection --------------------------------------------------------
  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelect(l: LeadRow, checked: boolean) {
    setSelection((prev) => {
      const next = new Map(prev);
      if (checked)
        next.set(l.id, { url: l.default_profile_url, name: l.full_name });
      else next.delete(l.id);
      return next;
    });
  }

  const pageSelectedCount = leads.filter((l) => selection.has(l.id)).length;
  const allPageSelected = leads.length > 0 && pageSelectedCount === leads.length;
  const somePageSelected =
    pageSelectedCount > 0 && pageSelectedCount < leads.length;

  function toggleSelectPage(checked: boolean) {
    setSelection((prev) => {
      const next = new Map(prev);
      for (const l of leads) {
        if (checked)
          next.set(l.id, { url: l.default_profile_url, name: l.full_name });
        else next.delete(l.id);
      }
      return next;
    });
  }

  async function copyUrls() {
    const urls = [...selection.values()]
      .map((s) => s.url)
      .filter((u): u is string => Boolean(u));
    try {
      await navigator.clipboard.writeText(urls.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked (insecure context / permissions) — silently
      // no-op rather than throwing in the UI.
    }
  }

  // ---- derived ----------------------------------------------------------
  const page = filters.page;
  const totalPages = Math.max(1, Math.ceil(total / LEADS_PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * LEADS_PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * LEADS_PAGE_SIZE, total);
  const selectedCount = selection.size;
  const selectedUrlCount = [...selection.values()].filter((s) => s.url).length;
  const exportFilterQs = searchParams.toString();
  const exportSelectedQs = `ids=${[...selection.keys()].join(",")}`;

  return (
    <div className="space-y-4">
      {/* ---- filter bar ---- */}
      <div className="rounded-lg border border-border/60 bg-card/40 p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <MultiSelect
            label="Campaigns"
            options={campaigns.map((c) => ({ value: c.id, label: c.name }))}
            selected={new Set(filters.campaign)}
            onChange={(s) => setMulti("campaign", s)}
          />
          <MultiSelect
            label="Domain"
            options={facets.domains.map((v) => ({ value: v, label: v }))}
            selected={new Set(filters.bu)}
            onChange={(s) => setMulti("bu", s)}
          />
          <MultiSelect
            label="ICP"
            options={facets.icps.map((v) => ({ value: v, label: v }))}
            selected={new Set(filters.icp)}
            onChange={(s) => setMulti("icp", s)}
          />
          <MultiSelect
            label="Priority"
            options={facets.priorities.map((v) => ({ value: v, label: v }))}
            selected={new Set(filters.priority)}
            onChange={(s) => setMulti("priority", s)}
          />
          <MultiSelect
            label="Temperature"
            options={[
              { value: "hot", label: "Hot" },
              { value: "warm", label: "Warm" },
              { value: "cold", label: "Cold" },
            ]}
            selected={new Set(filters.temp)}
            onChange={(s) => setMulti("temp", s)}
          />
          <MultiSelect
            label="Seniority"
            options={["1", "2", "3", "4", "5"].map((v) => ({
              value: v,
              label: v,
            }))}
            selected={new Set(filters.sen)}
            onChange={(s) => setMulti("sen", s)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <TextFilter
            icon={<Boxes className="h-3.5 w-3.5" />}
            placeholder="Area contains…"
            value={areaText}
            onChange={setAreaText}
          />
          <TextFilter
            icon={<Building2 className="h-3.5 w-3.5" />}
            placeholder="Company contains…"
            value={companyText}
            onChange={setCompanyText}
          />
          <TextFilter
            icon={<MapPin className="h-3.5 w-3.5" />}
            placeholder="Location contains…"
            value={locationText}
            onChange={setLocationText}
          />
          <TextFilter
            icon={<Search className="h-3.5 w-3.5" />}
            placeholder="Search name / company / title…"
            value={qText}
            onChange={setQText}
            wide
          />
          <PillGroup
            options={[
              { value: "all", label: "All" },
              { value: "qualified", label: "Qualified" },
            ]}
            value={filters.qualified ? "qualified" : "all"}
            onChange={(v) => toggleQualified(v === "qualified")}
          />
          {hasActiveFilters(filters) ? (
            <button
              type="button"
              onClick={resetAll}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
              Reset
            </button>
          ) : null}
        </div>
      </div>

      {/* ---- count + export-all ---- */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {total === 0
            ? "No leads match the current filters."
            : `Showing ${rangeStart}–${rangeEnd} of ${total.toLocaleString()} leads`}
        </span>
        {total > 0 ? (
          <a
            href={`/api/leads/export.csv${exportFilterQs ? `?${exportFilterQs}` : ""}`}
            download
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 hover:bg-muted transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Export all ({total.toLocaleString()})
          </a>
        ) : null}
      </div>

      {/* ---- table ---- */}
      <div className="rounded-lg border border-border bg-card/30 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox
                  aria-label="Select all on this page"
                  checked={allPageSelected}
                  indeterminate={somePageSelected}
                  onCheckedChange={(c) => toggleSelectPage(Boolean(c))}
                  disabled={leads.length === 0}
                />
              </TableHead>
              <TableHead className="w-8"></TableHead>
              <TableHead className="w-[16%]">Lead</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Qualified</TableHead>
              <TableHead>Temp</TableHead>
              <TableHead>ICP</TableHead>
              <TableHead>Seniority</TableHead>
              <TableHead>Domain</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Area</TableHead>
              <TableHead>Location</TableHead>
              <TableHead className="w-8"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={EXPAND_COLSPAN + 1}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  No leads match the current filters.
                </TableCell>
              </TableRow>
            ) : null}
            {leads.map((l) => {
              const isOpen = expanded.has(l.id);
              const hasDetail = hasLeadDetail(l);
              const isSelected = selection.has(l.id);
              return (
                <Fragment key={l.id}>
                  <TableRow
                    className={cn(
                      hasDetail ? "cursor-pointer" : "",
                      isSelected && "bg-primary/5"
                    )}
                    onClick={() => hasDetail && toggleExpand(l.id)}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        aria-label={`Select ${l.full_name ?? "lead"}`}
                        checked={isSelected}
                        onCheckedChange={(c) => toggleSelect(l, Boolean(c))}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {hasDetail ? (
                        isOpen ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )
                      ) : null}
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      <div className="flex flex-col leading-tight">
                        <span className="font-medium truncate">
                          {l.full_name ?? "—"}
                        </span>
                        {l.campaigns?.name ? (
                          <span className="text-[11px] text-muted-foreground truncate">
                            {l.campaigns.name}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground truncate max-w-[220px]">
                      {l.title ?? "—"}{" "}
                      <span className="opacity-60">
                        {l.company_name ? `@ ${l.company_name}` : ""}
                      </span>
                    </TableCell>
                    <TableCell>
                      <FunctionVerdict value={l.function_qualification} />
                    </TableCell>
                    <TableCell>
                      <TemperatureBadge value={l.temperature} />
                    </TableCell>
                    <TableCell className="truncate max-w-[140px]">
                      {l.icp_qualification ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {l.seniority_scoring ?? "—"}
                    </TableCell>
                    <TableCell className="truncate max-w-[160px]">
                      {l.domain_classification ? (
                        <div className="flex flex-col leading-tight">
                          <span>{l.domain_classification}</span>
                          {l.subdomain ? (
                            <span className="text-[11px] text-muted-foreground truncate">
                              {l.subdomain}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>{l.priority_level ?? "—"}</TableCell>
                    <TableCell className="truncate max-w-[140px]">
                      {l.product_area ?? "—"}
                    </TableCell>
                    <TableCell className="truncate max-w-[140px]">
                      {l.location ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {l.default_profile_url ? (
                        <Link
                          href={l.default_profile_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-primary"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                      ) : null}
                    </TableCell>
                  </TableRow>
                  {isOpen && hasDetail ? (
                    <TableRow className="bg-muted/20 hover:bg-muted/20">
                      <TableCell></TableCell>
                      <TableCell colSpan={EXPAND_COLSPAN} className="py-4">
                        <DetailGrid lead={l} />
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* ---- pagination ---- */}
      {totalPages > 1 ? (
        <div className="flex items-center justify-center gap-3 text-xs">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => goToPage(page - 1)}
            className="gap-1"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Prev
          </Button>
          <span className="tabular-nums text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => goToPage(page + 1)}
            className="gap-1"
          >
            Next
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : null}

      {/* ---- selection action bar ---- */}
      {selectedCount > 0 ? (
        <div className="sticky bottom-4 z-10 mx-auto flex w-fit items-center gap-3 rounded-full border border-border bg-popover/95 px-4 py-2 text-sm shadow-lg backdrop-blur">
          <span className="tabular-nums">
            {selectedCount} selected
          </span>
          <div className="h-4 w-px bg-border" />
          <a
            href={`/api/leads/export.csv?${exportSelectedQs}`}
            download
            className="inline-flex items-center gap-1.5 text-primary hover:underline"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </a>
          <button
            type="button"
            onClick={copyUrls}
            disabled={selectedUrlCount === 0}
            className="inline-flex items-center gap-1.5 text-foreground hover:text-primary disabled:opacity-40"
            title={
              selectedUrlCount === 0
                ? "None of the selected leads have a LinkedIn URL"
                : `Copy ${selectedUrlCount} LinkedIn URL(s)`
            }
          >
            {copied ? (
              <Check className="h-4 w-4 text-emerald-400" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            {copied ? "Copied" : `Copy URLs (${selectedUrlCount})`}
          </button>
          <button
            type="button"
            onClick={() => setSelection(new Map())}
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </button>
        </div>
      ) : null}
    </div>
  );
}

// Pushes a debounced value into the URL only when it actually differs from the
// param the server already saw — prevents a write loop on mount / nav.
function useDebouncedSync(
  local: string,
  committed: string,
  push: (v: string) => void
) {
  useEffect(() => {
    if (local === committed) return;
    const t = setTimeout(() => push(local), 400);
    return () => clearTimeout(t);
  }, [local, committed, push]);
}

function TextFilter({
  icon,
  placeholder,
  value,
  onChange,
  wide,
}: {
  icon: ReactNode;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/40 px-2.5 py-1 text-xs",
        wide ? "min-w-[16rem] flex-1" : "w-[12rem]"
      )}
    >
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-transparent outline-none placeholder:text-muted-foreground/60"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="text-muted-foreground hover:text-foreground shrink-0"
          aria-label="Clear"
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}
