"use client";

import { useMemo, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type Lead = {
  id: string;
  campaign_id: string;
  function_qualification: string | null;
  icp_qualification: string | null;
  seniority_scoring: number | null;
  domain_classification: string | null;
  company_name: string | null;
  product_area: string | null;
  processed_at: string | null;
  status: string;
  campaigns: { id: string; name: string; created_at: string; status: string };
};

export type Campaign = {
  id: string;
  name: string;
  created_at: string;
  status: string;
};

type Range = "7d" | "30d" | "90d" | "all";
type Bucket = "day" | "week" | "month";

const RANGE_LABELS: Record<Range, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
};

const BUCKET_LABELS: Record<Bucket, string> = {
  day: "By day",
  week: "By week",
  month: "By month",
};

const NONE_LABEL = "—";

// Qualified predicate — works for legacy YES/NO and categorical prompts
// alike. Anything that isn't an explicit "NO" (and isn't null) counts.
function isQualified(l: Lead): boolean {
  const v = l.function_qualification;
  if (v == null) return false;
  return v.trim().toUpperCase() !== "NO";
}

function isProcessed(l: Lead) {
  return l.status === "processed";
}

function nonEmpty(s: string | null | undefined): string {
  const v = (s ?? "").trim();
  return v.length === 0 ? NONE_LABEL : v;
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfISOWeek(d: Date) {
  const x = startOfDay(d);
  const day = x.getDay() === 0 ? 7 : x.getDay();
  if (day !== 1) x.setDate(x.getDate() - (day - 1));
  return x;
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function rangeStart(r: Range): Date | null {
  if (r === "all") return null;
  const d = startOfDay(new Date());
  if (r === "7d") d.setDate(d.getDate() - 6);
  else if (r === "30d") d.setDate(d.getDate() - 29);
  else if (r === "90d") d.setDate(d.getDate() - 89);
  return d;
}

function toISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function bucketStart(d: Date, bucket: Bucket) {
  if (bucket === "day") return startOfDay(d);
  if (bucket === "week") return startOfISOWeek(d);
  return startOfMonth(d);
}

function bucketStep(d: Date, bucket: Bucket) {
  const x = new Date(d);
  if (bucket === "day") x.setDate(x.getDate() + 1);
  else if (bucket === "week") x.setDate(x.getDate() + 7);
  else x.setMonth(x.getMonth() + 1);
  return x;
}

function formatBucket(iso: string, bucket: Bucket) {
  const d = new Date(iso);
  if (bucket === "month") {
    return d.toLocaleString("en-US", { month: "short", year: "2-digit" });
  }
  if (bucket === "week") {
    return `Wk ${d.toLocaleString("en-US", { month: "short", day: "numeric" })}`;
  }
  return d.toLocaleString("en-US", { month: "short", day: "numeric" });
}

const chartConfig: ChartConfig = {
  qualified: { label: "Qualified", color: "var(--chart-1)" },
  not_qualified: { label: "Not qualified", color: "var(--chart-4)" },
  count: { label: "Qualified", color: "var(--chart-1)" },
};

export function AnalyticsDashboard({
  leads,
  campaigns,
}: {
  leads: Lead[];
  campaigns: Campaign[];
}) {
  const [range, setRange] = useState<Range>("30d");
  const [bucket, setBucket] = useState<Bucket>("day");
  const [selCampaigns, setSelCampaigns] = useState<Set<string>>(new Set());
  const [selBUs, setSelBUs] = useState<Set<string>>(new Set());
  const [selICPs, setSelICPs] = useState<Set<string>>(new Set());
  const [selCompanies, setSelCompanies] = useState<Set<string>>(new Set());

  // Option lists (computed once from the full dataset, NOT the filtered set,
  // so toggling one filter doesn't make the other dropdowns flicker).
  const allBUs = useMemo(
    () =>
      uniqueSorted(
        leads.filter(isQualified).map((l) => nonEmpty(l.domain_classification))
      ),
    [leads]
  );
  const allICPs = useMemo(
    () =>
      uniqueSorted(
        leads.filter(isQualified).map((l) => nonEmpty(l.icp_qualification))
      ),
    [leads]
  );
  const allCompanies = useMemo(
    () =>
      uniqueSorted(
        leads.filter(isQualified).map((l) => nonEmpty(l.company_name))
      ),
    [leads]
  );

  const filtered = useMemo(() => {
    const startD = rangeStart(range);
    return leads.filter((l) => {
      if (startD) {
        if (!l.processed_at) return false;
        if (new Date(l.processed_at) < startD) return false;
      }
      if (selCampaigns.size && !selCampaigns.has(l.campaign_id)) return false;
      if (selBUs.size && !selBUs.has(nonEmpty(l.domain_classification)))
        return false;
      if (selICPs.size && !selICPs.has(nonEmpty(l.icp_qualification)))
        return false;
      if (selCompanies.size && !selCompanies.has(nonEmpty(l.company_name)))
        return false;
      return true;
    });
  }, [leads, range, selCampaigns, selBUs, selICPs, selCompanies]);

  const processed = filtered.filter(isProcessed);
  const qualifiedLeads = processed.filter(isQualified);
  const failedCount = filtered.filter((l) => l.status === "failed").length;
  const seniority = qualifiedLeads
    .map((l) => l.seniority_scoring)
    .filter((n): n is number => typeof n === "number" && n > 0);
  const avgSeniority =
    seniority.length > 0
      ? seniority.reduce((a, b) => a + b, 0) / seniority.length
      : null;

  const activeCampaignIds = new Set(filtered.map((l) => l.campaign_id));

  // ---- time-series buckets ------------------------------------------------
  const timeSeries = useMemo(() => {
    if (qualifiedLeads.length === 0 && processed.length === 0) return [];

    let from: Date;
    let to: Date;
    const startD = rangeStart(range);
    if (startD) {
      from = bucketStart(startD, bucket);
      to = bucketStart(new Date(), bucket);
    } else {
      // All time — derive bounds from data we actually have
      const dates = processed
        .map((l) => (l.processed_at ? new Date(l.processed_at) : null))
        .filter((d): d is Date => d != null);
      if (dates.length === 0) return [];
      from = bucketStart(
        new Date(Math.min(...dates.map((d) => d.getTime()))),
        bucket
      );
      to = bucketStart(
        new Date(Math.max(...dates.map((d) => d.getTime()))),
        bucket
      );
    }

    const map = new Map<string, { qualified: number; not_qualified: number }>();
    for (let cur = from; cur <= to; cur = bucketStep(cur, bucket)) {
      map.set(toISO(cur), { qualified: 0, not_qualified: 0 });
    }
    for (const l of processed) {
      if (!l.processed_at) continue;
      const k = toISO(bucketStart(new Date(l.processed_at), bucket));
      const row = map.get(k);
      if (!row) continue;
      if (isQualified(l)) row.qualified += 1;
      else row.not_qualified += 1;
    }
    return Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, v]) => ({ date, ...v }));
  }, [processed, qualifiedLeads.length, range, bucket]);

  // ---- bar charts -------------------------------------------------------
  const buData = useMemo(
    () => topN(qualifiedLeads.map((l) => nonEmpty(l.domain_classification)), 10),
    [qualifiedLeads]
  );
  const icpData = useMemo(
    () => topN(qualifiedLeads.map((l) => nonEmpty(l.icp_qualification)), 10),
    [qualifiedLeads]
  );
  const companyData = useMemo(
    () => topN(qualifiedLeads.map((l) => nonEmpty(l.company_name)), 10),
    [qualifiedLeads]
  );

  const campaignNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of campaigns) m.set(c.id, c.name);
    for (const l of leads) m.set(l.campaign_id, l.campaigns.name);
    return m;
  }, [campaigns, leads]);

  const campaignData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of qualifiedLeads) {
      counts.set(l.campaign_id, (counts.get(l.campaign_id) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([id, count]) => ({
        id,
        name: campaignNameById.get(id) ?? "(deleted)",
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  }, [qualifiedLeads, campaignNameById]);

  // ---- KPI cards --------------------------------------------------------
  const kpis = [
    { label: "Qualified leads", value: fmt(qualifiedLeads.length) },
    {
      label: "Qualification rate",
      value: pct(qualifiedLeads.length, processed.length),
    },
    { label: "Leads processed", value: fmt(processed.length) },
    {
      label: "Avg. seniority",
      value: avgSeniority != null ? avgSeniority.toFixed(2) : "—",
    },
    { label: "Active campaigns", value: fmt(activeCampaignIds.size) },
    { label: "Failed leads", value: fmt(failedCount) },
  ];

  function resetAll() {
    setRange("30d");
    setBucket("day");
    setSelCampaigns(new Set());
    setSelBUs(new Set());
    setSelICPs(new Set());
    setSelCompanies(new Set());
  }

  const filtersAreDefault =
    range === "30d" &&
    bucket === "day" &&
    selCampaigns.size === 0 &&
    selBUs.size === 0 &&
    selICPs.size === 0 &&
    selCompanies.size === 0;

  const empty = leads.length === 0;

  return (
    <div className="space-y-6">
      {/* ---- Filter bar --------------------------------------------------- */}
      <div className="rounded-lg border border-border/60 bg-card/40 p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <PillGroup
            options={(["7d", "30d", "90d", "all"] as Range[]).map((v) => ({
              value: v,
              label: RANGE_LABELS[v],
            }))}
            value={range}
            onChange={setRange}
          />
          <Divider />
          <PillGroup
            options={(["day", "week", "month"] as Bucket[]).map((v) => ({
              value: v,
              label: BUCKET_LABELS[v],
            }))}
            value={bucket}
            onChange={setBucket}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <MultiSelect
            label="Campaigns"
            options={campaigns.map((c) => ({ value: c.id, label: c.name }))}
            selected={selCampaigns}
            onChange={setSelCampaigns}
          />
          <MultiSelect
            label="Business units"
            options={allBUs.map((v) => ({ value: v, label: v }))}
            selected={selBUs}
            onChange={setSelBUs}
          />
          <MultiSelect
            label="ICP"
            options={allICPs.map((v) => ({ value: v, label: v }))}
            selected={selICPs}
            onChange={setSelICPs}
          />
          <MultiSelect
            label="Companies"
            options={allCompanies.map((v) => ({ value: v, label: v }))}
            selected={selCompanies}
            onChange={setSelCompanies}
          />
          {!filtersAreDefault ? (
            <button
              type="button"
              onClick={resetAll}
              className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <X className="h-3 w-3" />
              Reset
            </button>
          ) : null}
        </div>
      </div>

      {/* ---- KPI cards --------------------------------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        {kpis.map((k) => (
          <Card key={k.label} className="bg-card/40">
            <CardHeader className="space-y-1">
              <CardDescription className="text-[11px] uppercase tracking-wide">
                {k.label}
              </CardDescription>
              <CardTitle className="text-2xl tabular-nums font-semibold">
                {k.value}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      {empty ? (
        <Card className="border-dashed bg-card/40">
          <CardHeader>
            <CardTitle className="text-base font-medium">
              No processed leads yet
            </CardTitle>
            <CardDescription>
              Run a campaign and the analytics will populate automatically.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          {/* ---- Time series ---- */}
          <Card className="bg-card/40">
            <CardHeader>
              <CardTitle className="text-base">
                Qualified leads over time — {BUCKET_LABELS[bucket].toLowerCase()}
              </CardTitle>
              <CardDescription>
                Stacked by qualified vs. not qualified, within the selected
                filter set.
              </CardDescription>
            </CardHeader>
            <ChartContainer
              config={chartConfig}
              className="h-64 w-full px-4 pb-4"
            >
              <AreaChart data={timeSeries}>
                <defs>
                  <linearGradient id="qualGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-qualified)" stopOpacity={0.55} />
                    <stop offset="100%" stopColor="var(--color-qualified)" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="notqGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-not_qualified)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--color-not_qualified)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v) => formatBucket(String(v), bucket)}
                  stroke="var(--chart-axis)"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  stroke="var(--chart-axis)"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11 }}
                  allowDecimals={false}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(v) => formatBucket(String(v), bucket)}
                    />
                  }
                />
                <Area
                  dataKey="not_qualified"
                  stackId="a"
                  stroke="var(--color-not_qualified)"
                  fill="url(#notqGrad)"
                  strokeWidth={1.5}
                />
                <Area
                  dataKey="qualified"
                  stackId="a"
                  stroke="var(--color-qualified)"
                  fill="url(#qualGrad)"
                  strokeWidth={1.5}
                />
              </AreaChart>
            </ChartContainer>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <BarCard
              title="Qualified per business unit"
              description="Top business units (domain_classification) among qualified leads."
              data={buData}
              keyName="key"
              empty={buData.length === 0}
            />
            <BarCard
              title="Qualified per ICP"
              description="ICP qualification (Decision Maker / Influencer / Champion / etc.) among qualified leads."
              data={icpData}
              keyName="key"
              empty={icpData.length === 0}
            />
            <BarCard
              title="Qualified per company"
              description="Top 10 companies by qualified-lead count."
              data={companyData}
              keyName="key"
              empty={companyData.length === 0}
            />
            <BarCard
              title="Qualified per campaign"
              description="Top 12 campaigns by qualified-lead count."
              data={campaignData}
              keyName="name"
              empty={campaignData.length === 0}
            />
          </div>
        </>
      )}
    </div>
  );
}

// ---- helpers ------------------------------------------------------------

function fmt(n: number) {
  return n.toLocaleString();
}

function pct(n: number, d: number) {
  if (d === 0) return "—";
  return `${((n / d) * 100).toFixed(1)}%`;
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function topN(
  values: string[],
  n: number
): { key: string; count: number }[] {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return Array.from(m.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));
}

// ---- subcomponents ------------------------------------------------------

function PillGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-border/60 bg-background/40 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "px-2.5 py-1 text-xs rounded-sm transition-colors",
            value === o.value
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Divider() {
  return <div className="h-5 w-px bg-border/60" aria-hidden />;
}

function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const count = selected.size;
  const disabled = options.length === 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/40 px-2.5 py-1 text-xs",
          "hover:bg-accent hover:text-accent-foreground transition-colors",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <span>{label}</span>
        {count > 0 ? (
          <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/15 px-1 text-[10px] text-primary tabular-nums">
            {count}
          </span>
        ) : null}
        <ChevronDown className="h-3.5 w-3.5 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-72 w-64 overflow-y-auto"
      >
        <div className="flex items-center justify-between px-1.5 py-1 text-xs font-medium text-muted-foreground">
          <span>{label}</span>
          {count > 0 ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange(new Set());
              }}
              className="text-[10px] uppercase tracking-wide hover:text-foreground"
            >
              Clear
            </button>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        {options.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            No options
          </div>
        ) : (
          options.map((o) => (
            <DropdownMenuCheckboxItem
              key={o.value}
              checked={selected.has(o.value)}
              onCheckedChange={(checked) => {
                const next = new Set(selected);
                if (checked) next.add(o.value);
                else next.delete(o.value);
                onChange(next);
              }}
            >
              <span className="truncate">{o.label}</span>
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BarCard({
  title,
  description,
  data,
  keyName,
  empty,
}: {
  title: string;
  description: string;
  data: Array<{ count: number } & Record<string, unknown>>;
  keyName: string;
  empty: boolean;
}) {
  return (
    <Card className="bg-card/40">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      {empty ? (
        <div className="px-6 pb-6 text-xs text-muted-foreground">
          No qualified leads match the current filters.
        </div>
      ) : (
        <ChartContainer config={chartConfig} className="h-72 w-full px-4 pb-4">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ left: 8, right: 16 }}
          >
            <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
            <XAxis
              type="number"
              stroke="var(--chart-axis)"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11 }}
              allowDecimals={false}
            />
            <YAxis
              type="category"
              dataKey={keyName}
              stroke="var(--chart-axis)"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11 }}
              width={140}
              tickFormatter={(v) =>
                typeof v === "string" && v.length > 18
                  ? `${v.slice(0, 18)}…`
                  : String(v)
              }
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="count" fill="var(--color-count)" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ChartContainer>
      )}
    </Card>
  );
}
