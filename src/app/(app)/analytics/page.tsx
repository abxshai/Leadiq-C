import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import {
  AnalyticsCharts,
  type DailyPoint,
  type AreaPoint,
  type SeniorityPoint,
} from "@/components/analytics-charts";
import { createServerSupabase } from "@/lib/supabase/server";

type LeadRow = {
  function_qualification: string | null;
  seniority_scoring: number | null;
  product_area: string | null;
  status: string;
  processed_at: string | null;
};

type CampaignRow = {
  id: string;
  status: string;
  created_at: string;
};

function fmtPct(n: number, d: number) {
  if (d === 0) return "—";
  return `${((n / d) * 100).toFixed(1)}%`;
}

function toISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

export default async function AnalyticsPage() {
  const supabase = await createServerSupabase();

  const [{ data: leads }, { data: campaigns }] = await Promise.all([
    supabase
      .from("leads")
      .select("function_qualification, seniority_scoring, product_area, status, processed_at")
      .limit(10000),
    supabase
      .from("campaigns")
      .select("id, status, created_at")
      .limit(1000),
  ]);

  const leadRows = (leads ?? []) as LeadRow[];
  const campaignRows = (campaigns ?? []) as CampaignRow[];

  const processed = leadRows.filter((l) => l.status === "processed");
  const qualified = processed.filter((l) => l.function_qualification === "YES");
  const failed = leadRows.filter((l) => l.status === "failed");

  const senioritySum = qualified.reduce(
    (acc, l) => acc + (l.seniority_scoring ?? 0),
    0
  );
  const seniorityCount = qualified.filter((l) => l.seniority_scoring).length;

  const monthStart = startOfMonth();
  const campaignsThisMonth = campaignRows.filter(
    (c) => new Date(c.created_at) >= monthStart
  ).length;

  // Daily series for last 30 days.
  const since = daysAgo(30);
  const daily = new Map<string, { qualified: number; not_qualified: number }>();
  for (let i = 0; i <= 30; i++) {
    const d = new Date(since);
    d.setDate(since.getDate() + i);
    daily.set(toISODate(d), { qualified: 0, not_qualified: 0 });
  }
  for (const l of processed) {
    if (!l.processed_at) continue;
    const day = toISODate(new Date(l.processed_at));
    const row = daily.get(day);
    if (!row) continue;
    if (l.function_qualification === "YES") row.qualified += 1;
    else row.not_qualified += 1;
  }
  const dailyPoints: DailyPoint[] = Array.from(daily.entries())
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  // Product area top 10 (qualified only — it's where it matters).
  const areaMap = new Map<string, number>();
  for (const l of qualified) {
    const key = (l.product_area ?? "—").trim() || "—";
    areaMap.set(key, (areaMap.get(key) ?? 0) + 1);
  }
  const areaPoints: AreaPoint[] = Array.from(areaMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([product_area, count]) => ({ product_area, count }));

  // Seniority distribution 1-5 (qualified only).
  const seniorityMap = new Map<number, number>();
  for (let i = 1; i <= 5; i++) seniorityMap.set(i, 0);
  for (const l of qualified) {
    if (!l.seniority_scoring) continue;
    seniorityMap.set(
      l.seniority_scoring,
      (seniorityMap.get(l.seniority_scoring) ?? 0) + 1
    );
  }
  const seniorityPoints: SeniorityPoint[] = Array.from(seniorityMap.entries())
    .map(([seniority, count]) => ({ seniority, count }))
    .sort((a, b) => a.seniority - b.seniority);

  const kpis = [
    { label: "Leads processed", value: processed.length.toLocaleString() },
    { label: "Qualified (YES)", value: qualified.length.toLocaleString() },
    {
      label: "Qualification rate",
      value: fmtPct(qualified.length, processed.length),
    },
    {
      label: "Avg. seniority",
      value:
        seniorityCount > 0
          ? (senioritySum / seniorityCount).toFixed(2)
          : "—",
    },
    { label: "Campaigns this month", value: String(campaignsThisMonth) },
    { label: "Failed leads", value: failed.length.toLocaleString() },
  ];

  const empty = processed.length === 0;

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="Monthly recap across all campaigns. Numbers reflect leads that finished processing (status = processed)."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6 mb-8">
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
              Run a campaign and the analytics will populate automatically. If
              you just finished a run, refresh this page.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <AnalyticsCharts
          daily={dailyPoints}
          areas={areaPoints}
          seniority={seniorityPoints}
        />
      )}
    </div>
  );
}
