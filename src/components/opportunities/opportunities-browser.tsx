"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MultiSelect, PillGroup } from "@/components/ui/multi-select";
import {
  OpportunityCard,
  type Opportunity,
} from "@/components/opportunities/opportunity-card";
import {
  type OpportunityFilters,
  OPPS_PAGE_SIZE,
  hasActiveOpportunityFilters,
} from "@/lib/opportunity-filters";
import { cn } from "@/lib/utils";

export function OpportunitiesBrowser({
  opportunities,
  total,
  filters,
}: {
  opportunities: Opportunity[];
  total: number;
  filters: OpportunityFilters;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

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

  const setParam = useCallback(
    (key: string, value: string, clearWhen: string) =>
      writeParams((sp) => {
        if (value && value !== clearWhen) sp.set(key, value);
        else sp.delete(key);
      }),
    [writeParams]
  );

  const setMulti = useCallback(
    (key: string, values: Set<string>) =>
      writeParams((sp) => {
        if (values.size) sp.set(key, [...values].join(","));
        else sp.delete(key);
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

  // debounced search
  const [qText, setQText] = useState(filters.q);
  useEffect(() => setQText(filters.q), [filters.q]);
  useEffect(() => {
    if (qText === filters.q) return;
    const t = setTimeout(
      () =>
        writeParams((sp) => {
          if (qText.trim()) sp.set("q", qText.trim());
          else sp.delete("q");
        }),
      400
    );
    return () => clearTimeout(t);
  }, [qText, filters.q, writeParams]);

  const page = filters.page;
  const totalPages = Math.max(1, Math.ceil(total / OPPS_PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * OPPS_PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * OPPS_PAGE_SIZE, total);

  return (
    <div className="space-y-4">
      {/* ---- filter bar ---- */}
      <div className="rounded-lg border border-border/60 bg-card/40 p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <PillGroup
            options={[
              { value: "all", label: "All" },
              { value: "conversation", label: "Conversations" },
              { value: "deal", label: "Deals" },
            ]}
            value={filters.kind === "" ? "all" : filters.kind}
            onChange={(v) => setParam("kind", v, "all")}
          />
          <PillGroup
            options={[
              { value: "3m", label: "Past 3 months" },
              { value: "6m", label: "Past 6 months" },
              { value: "all", label: "All time" },
            ]}
            value={filters.window}
            onChange={(v) => setParam("window", v, "6m")}
          />
          <MultiSelect
            label="Interest"
            options={[
              { value: "meeting", label: "Meeting" },
              { value: "interested", label: "Interested" },
            ]}
            selected={new Set(filters.status)}
            onChange={(s) => setMulti("status", s)}
          />
          <TextFilter
            icon={<Search className="h-3.5 w-3.5" />}
            placeholder="Search person / company / deal…"
            value={qText}
            onChange={setQText}
            wide
          />
          {hasActiveOpportunityFilters(filters) ? (
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

      {/* ---- count ---- */}
      <div className="text-xs text-muted-foreground">
        {total === 0
          ? "No opportunities match the current filters."
          : `Showing ${rangeStart}–${rangeEnd} of ${total.toLocaleString()} opportunities`}
      </div>

      {/* ---- card grid ---- */}
      {opportunities.length === 0 ? (
        <div className="rounded-lg border border-border bg-card/30 py-16 text-center text-sm text-muted-foreground">
          No opportunities match the current filters.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {opportunities.map((opp) => (
            <OpportunityCard key={opp.opp_id} opp={opp} />
          ))}
        </div>
      )}

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
    </div>
  );
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
