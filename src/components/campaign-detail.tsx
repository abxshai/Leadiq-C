"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Play,
  Download,
  Loader2,
  ExternalLink,
  CircleAlert,
  ChevronRight,
  ChevronDown,
  Thermometer,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConnectGroqDialog } from "@/components/connect-groq-dialog";
import { DeleteCampaignButton } from "@/components/delete-campaign-button";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { useGroqStore } from "@/lib/groq-store";
import { cn } from "@/lib/utils";
import {
  type Lead,
  type Temperature,
  LEAD_COLS,
  DetailGrid,
  FunctionVerdict,
  LeadStatus,
  TemperatureBadge,
  hasLeadDetail,
} from "@/components/leads/lead-display";

type Campaign = {
  id: string;
  name: string;
  status: "pending" | "running" | "completed" | "failed" | "canceled";
  total_leads: number;
  model: string;
  concurrency: number;
  source_filename: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  google_sheet_id: string | null;
};

type Stats = {
  campaign_id: string;
  total_leads: number;
  touched_count: number;
  processed_count: number;
  failed_count: number;
  qualified_count: number;
};

const statusColor: Record<Campaign["status"], string> = {
  pending: "border-muted-foreground/30 text-muted-foreground",
  running: "border-primary/40 bg-primary/10 text-primary",
  completed: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
  canceled: "border-muted-foreground/30 text-muted-foreground",
};

export function CampaignDetail({
  initialCampaign,
  initialLeads,
  initialStats,
}: {
  initialCampaign: Campaign;
  initialLeads: Lead[];
  initialStats: Stats;
}) {
  const [campaign, setCampaign] = useState(initialCampaign);
  const [leads, setLeads] = useState(initialLeads);
  const [stats, setStats] = useState(initialStats);
  const [starting, setStarting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [crossChecking, setCrossChecking] = useState(false);
  const [tempFilter, setTempFilter] = useState<Temperature | "all">("all");
  const apiKey = useGroqStore((s) => s.apiKey);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // KPI counts come from the campaign_stats view (live aggregate over
  // leads with the `function_qualification IS NOT NULL AND != 'NO'`
  // predicate). The in-memory `leads` array below is capped at 5000 for
  // table rendering — these stats stay accurate past that cap.
  const processed = stats.touched_count;
  const totalLeads = Math.max(campaign.total_leads, stats.total_leads);
  const pct = totalLeads > 0 ? (processed / totalLeads) * 100 : 0;

  const [refreshErr, setRefreshErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const supabase = createBrowserSupabase();
    const [
      { data: c, error: cErr },
      { data: l, error: lErr },
      { data: s, error: sErr },
    ] = await Promise.all([
      supabase
        .from("campaigns")
        .select(
          "id, name, status, total_leads, model, concurrency, source_filename, created_at, started_at, completed_at, google_sheet_id"
        )
        .eq("id", campaign.id)
        .single(),
      supabase
        .from("leads")
        .select(LEAD_COLS)
        .eq("campaign_id", campaign.id)
        .order("created_at", { ascending: true })
        .range(0, 4999),
      supabase
        .from("campaign_stats")
        .select("*")
        .eq("campaign_id", campaign.id)
        .single(),
    ]);
    const firstErr = cErr || lErr || sErr;
    if (firstErr) {
      console.error("[campaign-detail] refresh error:", firstErr);
      setRefreshErr(firstErr.message);
      return;
    }
    setRefreshErr(null);
    if (c) setCampaign(c as Campaign);
    if (l) setLeads(l as Lead[]);
    if (s) setStats(s as Stats);
  }, [campaign.id]);

  // Poll while running.
  useEffect(() => {
    if (campaign.status !== "running") return;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [campaign.status, refresh]);

  async function onStart() {
    if (!apiKey) {
      setDialogOpen(true);
      return;
    }
    setStarting(true);
    setRunError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/run`, {
        method: "POST",
        headers: { "x-groq-key": apiKey },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRunError(body.error ?? `Server responded ${res.status}`);
        return;
      }
      await refresh();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Network error");
    } finally {
      setStarting(false);
    }
  }

  async function onCrossCheck() {
    setCrossChecking(true);
    setRunError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/cross-check`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRunError(body.error ?? `Server responded ${res.status}`);
        return;
      }
      await refresh();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Network error");
    } finally {
      setCrossChecking(false);
    }
  }

  const canStart =
    campaign.status === "pending" ||
    campaign.status === "failed" ||
    campaign.status === "canceled";

  // Temperature is only meaningful for qualified leads that have been
  // cross-checked. Show the cross-check button once the run has produced
  // leads (i.e. not while pending/empty).
  const crossCheckable =
    campaign.status === "completed" || stats.touched_count > 0;

  const tempCounts = leads.reduce(
    (acc, l) => {
      if (l.temperature) acc[l.temperature] += 1;
      return acc;
    },
    { hot: 0, warm: 0, cold: 0 } as Record<Temperature, number>
  );
  const anyTemperature =
    tempCounts.hot + tempCounts.warm + tempCounts.cold > 0;

  const visibleLeads =
    tempFilter === "all"
      ? leads
      : leads.filter((l) => l.temperature === tempFilter);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {campaign.name}
            </h1>
            <Badge variant="outline" className={statusColor[campaign.status]}>
              {campaign.status}
            </Badge>
          </div>
          <div className="text-sm text-muted-foreground">
            {campaign.total_leads} leads · {campaign.model} ·{" "}
            {campaign.concurrency} parallel
            {campaign.source_filename
              ? ` · ${campaign.source_filename}`
              : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {crossCheckable ? (
            <Button
              variant="outline"
              onClick={onCrossCheck}
              disabled={crossChecking}
              className="gap-2"
              title="Cross-check qualified leads against HubSpot + Smartlead and tag hot / warm / cold"
            >
              {crossChecking ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {anyTemperature ? "Re-cross-check" : "Cross-check leads"}
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm hover:bg-muted transition-colors"
            >
              <Download className="h-4 w-4" />
              Export CSV
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                render={
                  <a
                    href={`/api/campaigns/${campaign.id}/export.csv`}
                    download
                  />
                }
              >
                All leads
              </DropdownMenuItem>
              <DropdownMenuItem
                render={
                  <a
                    href={`/api/campaigns/${campaign.id}/export.csv?qualified=1`}
                    download
                  />
                }
              >
                Qualified only
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {canStart ? (
            <Button onClick={onStart} disabled={starting} className="gap-2">
              {starting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Starting…
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  {campaign.status === "pending" ? "Start run" : "Resume"}
                </>
              )}
            </Button>
          ) : null}
          <DeleteCampaignButton
            id={campaign.id}
            name={campaign.name}
            redirectTo="/campaigns"
            variant="full"
          />
        </div>
      </div>

      {runError ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{runError}</span>
        </div>
      ) : null}

      {!apiKey && canStart ? (
        <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>
            Connect your Groq key before starting. It stays in this tab and is
            only forwarded for this run.
          </span>
          <button
            onClick={() => setDialogOpen(true)}
            className="ml-auto underline text-primary"
          >
            Connect now
          </button>
        </div>
      ) : null}

      <Card className="bg-card/40">
        <CardContent className="py-5 space-y-4">
          <div className="flex items-center gap-6 text-sm">
            <Kpi label="Processed" value={`${processed} / ${totalLeads}`} />
            <Kpi
              label="Qualified"
              value={stats.qualified_count}
              accent="text-primary"
            />
            <Kpi
              label="Failed"
              value={stats.failed_count}
              accent={
                stats.failed_count > 0 ? "text-destructive" : undefined
              }
            />
          </div>
          <Progress value={pct} />
        </CardContent>
      </Card>

      {refreshErr ? (
        <div className="mb-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive font-mono break-all">
          Lead-list query failed: {refreshErr}
        </div>
      ) : null}

      {leads.length === 5000 && campaign.total_leads > 5000 ? (
        <div className="mb-2 rounded-md border border-border bg-card/30 px-3 py-2 text-xs text-muted-foreground">
          Showing the first 5000 of {campaign.total_leads} leads. The KPI
          tiles above use server-side counts — they remain accurate
          beyond this slice. CSV export covers the full set.
        </div>
      ) : null}

      {anyTemperature ? (
        <div className="flex items-center gap-2 text-xs">
          <Thermometer className="h-3.5 w-3.5 text-muted-foreground" />
          {(["all", "hot", "warm", "cold"] as const).map((t) => {
            const active = tempFilter === t;
            const count =
              t === "all"
                ? tempCounts.hot + tempCounts.warm + tempCounts.cold
                : tempCounts[t];
            return (
              <button
                key={t}
                onClick={() => setTempFilter(t)}
                className={cn(
                  "rounded-full border px-2.5 py-1 capitalize transition-colors",
                  active
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted"
                )}
              >
                {t} {t === "all" ? "" : `(${count})`}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-card/30 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead className="w-[18%]">Lead</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Qualified</TableHead>
              <TableHead>Temp</TableHead>
              <TableHead>ICP</TableHead>
              <TableHead>Seniority</TableHead>
              <TableHead>Domain</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Area</TableHead>
              <TableHead className="w-8"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleLeads.map((l) => {
              const isOpen = expanded.has(l.id);
              const hasDetail = hasLeadDetail(l);
              return (
                <Fragment key={l.id}>
                  <TableRow
                    className={hasDetail ? "cursor-pointer" : ""}
                    onClick={() => hasDetail && toggleExpand(l.id)}
                  >
                    <TableCell className="text-muted-foreground">
                      {hasDetail ? (
                        isOpen ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )
                      ) : null}
                    </TableCell>
                    <TableCell className="font-medium truncate max-w-[180px]">
                      {l.full_name ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground truncate max-w-[220px]">
                      {l.title ?? "—"}{" "}
                      <span className="opacity-60">
                        {l.company_name ? `@ ${l.company_name}` : ""}
                      </span>
                    </TableCell>
                    <TableCell>
                      <LeadStatus status={l.status} error={l.error} />
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
                      <TableCell colSpan={11} className="py-4">
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

      <ConnectGroqDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}

function Kpi({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: string;
}) {
  return (
    <div>
      <div className={cn("text-xl tabular-nums font-semibold", accent)}>
        {value}
      </div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

