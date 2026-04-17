"use client";

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

export type DailyPoint = {
  date: string;
  qualified: number;
  not_qualified: number;
};

export type AreaPoint = {
  product_area: string;
  count: number;
};

export type SeniorityPoint = {
  seniority: number;
  count: number;
};

const trendConfig: ChartConfig = {
  qualified: {
    label: "Qualified",
    color: "var(--primary)",
  },
  not_qualified: {
    label: "Not qualified",
    color: "oklch(0.4 0.05 240)",
  },
};

const areaConfig: ChartConfig = {
  count: {
    label: "Qualified leads",
    color: "var(--primary)",
  },
};

const seniorityConfig: ChartConfig = {
  count: {
    label: "Qualified",
    color: "var(--primary)",
  },
};

function formatShortDate(s: string) {
  const d = new Date(s);
  return `${d.toLocaleString("en-US", { month: "short" })} ${d.getDate()}`;
}

export function AnalyticsCharts({
  daily,
  areas,
  seniority,
}: {
  daily: DailyPoint[];
  areas: AreaPoint[];
  seniority: SeniorityPoint[];
}) {
  return (
    <div className="space-y-4">
      <Card className="bg-card/40">
        <CardHeader>
          <CardTitle className="text-base">
            Qualified vs. not qualified — last 30 days
          </CardTitle>
          <CardDescription>
            Counts of processed leads per day, split by Function Qualification.
          </CardDescription>
        </CardHeader>
        <ChartContainer
          config={trendConfig}
          className="h-64 w-full px-4 pb-4"
        >
          <AreaChart data={daily}>
            <defs>
              <linearGradient id="qual" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor="var(--color-qualified)"
                  stopOpacity={0.55}
                />
                <stop
                  offset="100%"
                  stopColor="var(--color-qualified)"
                  stopOpacity={0.05}
                />
              </linearGradient>
              <linearGradient id="notq" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor="var(--color-not_qualified)"
                  stopOpacity={0.35}
                />
                <stop
                  offset="100%"
                  stopColor="var(--color-not_qualified)"
                  stopOpacity={0.02}
                />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="oklch(1 0 0 / 0.08)"
            />
            <XAxis
              dataKey="date"
              tickFormatter={formatShortDate}
              stroke="oklch(0.68 0.02 240)"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11 }}
            />
            <YAxis
              stroke="oklch(0.68 0.02 240)"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11 }}
              allowDecimals={false}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(v) => formatShortDate(String(v))}
                />
              }
            />
            <Area
              dataKey="not_qualified"
              stackId="a"
              stroke="var(--color-not_qualified)"
              fill="url(#notq)"
              strokeWidth={1.5}
            />
            <Area
              dataKey="qualified"
              stackId="a"
              stroke="var(--color-qualified)"
              fill="url(#qual)"
              strokeWidth={1.5}
            />
          </AreaChart>
        </ChartContainer>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="bg-card/40">
          <CardHeader>
            <CardTitle className="text-base">
              Top qualified areas
            </CardTitle>
            <CardDescription>
              Qualified leads grouped by Product Area / Team. Top 10.
            </CardDescription>
          </CardHeader>
          <ChartContainer
            config={areaConfig}
            className="h-72 w-full px-4 pb-4"
          >
            <BarChart
              data={areas}
              layout="vertical"
              margin={{ left: 8, right: 16 }}
            >
              <CartesianGrid
                horizontal={false}
                stroke="oklch(1 0 0 / 0.06)"
              />
              <XAxis
                type="number"
                stroke="oklch(0.68 0.02 240)"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11 }}
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="product_area"
                stroke="oklch(0.68 0.02 240)"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11 }}
                width={140}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar
                dataKey="count"
                fill="var(--color-count)"
                radius={[0, 4, 4, 0]}
              />
            </BarChart>
          </ChartContainer>
        </Card>

        <Card className="bg-card/40">
          <CardHeader>
            <CardTitle className="text-base">Seniority distribution</CardTitle>
            <CardDescription>
              Qualified leads bucketed by Seniority Scoring (1 = IC, 5 =
              founder/C-suite).
            </CardDescription>
          </CardHeader>
          <ChartContainer
            config={seniorityConfig}
            className="h-72 w-full px-4 pb-4"
          >
            <BarChart data={seniority}>
              <CartesianGrid
                vertical={false}
                stroke="oklch(1 0 0 / 0.06)"
              />
              <XAxis
                dataKey="seniority"
                stroke="oklch(0.68 0.02 240)"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11 }}
              />
              <YAxis
                stroke="oklch(0.68 0.02 240)"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11 }}
                allowDecimals={false}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar
                dataKey="count"
                fill="var(--color-count)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ChartContainer>
        </Card>
      </div>
    </div>
  );
}
