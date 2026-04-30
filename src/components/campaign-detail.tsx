"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Play,
  Download,
  Loader2,
  ExternalLink,
  CircleAlert,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
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

type Campaign = {
  id: string;
  name: string;
  status: "pending" | "running" | "completed" | "failed" | "canceled";
  total_leads: number;
  qualified_count: number;
  failed_count: number;
  model: string;
  concurrency: number;
  source_filename: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  google_sheet_id: string | null;
};

type Lead = {
  id: string;
  full_name: string | null;
  title: string | null;
  company_name: string | null;
  status: "pending" | "running" | "processed" | "failed" | "skipped";
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
  error: string | null;
  default_profile_url: string | null;
};

const LEAD_COLS =
  "id, full_name, title, company_name, status, function_qualification, function_reasoning, icp_qualification, seniority_scoring, domain_classification, subdomain, subdomain_justification, domain_reasoning, priority_level, product_area, lead_summary, error, default_profile_url";

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
  initialTouchedCount,
}: {
  initialCampaign: Campaign;
  initialLeads: Lead[];
  initialTouchedCount: number;
}) {
  const [campaign, setCampaign] = useState(initialCampaign);
  const [leads, setLeads] = useState(initialLeads);
  const [touchedCount, setTouchedCount] = useState(initialTouchedCount);
  const [starting, setStarting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const apiKey = useGroqStore((s) => s.apiKey);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // KPI counts come from server-side count queries (touchedCount), not
  // from the in-memory `leads` array — that array is capped at 5000 for
  // table rendering and would undercount on very large campaigns.
  const processed = touchedCount;
  const pct =
    campaign.total_leads > 0 ? (processed / campaign.total_leads) * 100 : 0;

  const [refreshErr, setRefreshErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const supabase = createBrowserSupabase();
    const [
      { data: c, error: cErr },
      { data: l, error: lErr },
      { count: touched, error: tErr },
    ] = await Promise.all([
      supabase
        .from("campaigns")
        .select(
          "id, name, status, total_leads, qualified_count, failed_count, model, concurrency, source_filename, created_at, started_at, completed_at, google_sheet_id"
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
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaign.id)
        .in("status", ["processed", "failed", "skipped"]),
    ]);
    const firstErr = cErr || lErr || tErr;
    if (firstErr) {
      console.error("[campaign-detail] refresh error:", firstErr);
      setRefreshErr(firstErr.message);
      return;
    }
    setRefreshErr(null);
    if (c) setCampaign(c as Campaign);
    if (l) setLeads(l as Lead[]);
    if (touched != null) setTouchedCount(touched);
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

  const canStart =
    campaign.status === "pending" ||
    campaign.status === "failed" ||
    campaign.status === "canceled";

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
          <a
            href={`/api/campaigns/${campaign.id}/export.csv`}
            download
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm hover:bg-muted transition-colors"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </a>
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
            <Kpi label="Processed" value={`${processed} / ${campaign.total_leads}`} />
            <Kpi label="Qualified" value={campaign.qualified_count} accent="text-primary" />
            <Kpi label="Failed" value={campaign.failed_count} accent={campaign.failed_count > 0 ? "text-destructive" : undefined} />
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

      <div className="rounded-lg border border-border bg-card/30 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead className="w-[18%]">Lead</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Qualified</TableHead>
              <TableHead>ICP</TableHead>
              <TableHead>Seniority</TableHead>
              <TableHead>Domain</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Area</TableHead>
              <TableHead className="w-8"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.map((l) => {
              const isOpen = expanded.has(l.id);
              const hasDetail =
                l.function_reasoning ||
                l.subdomain_justification ||
                l.domain_reasoning ||
                l.lead_summary ||
                l.error;
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
                      {l.function_qualification === "YES" ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          YES
                        </span>
                      ) : l.function_qualification === "NO" ? (
                        <span className="text-muted-foreground">NO</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
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
                      <TableCell colSpan={10} className="py-4">
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

function DetailGrid({ lead }: { lead: Lead }) {
  const sections: { label: string; value: string | null }[] = [
    { label: "Function reasoning", value: lead.function_reasoning },
    { label: "Subdomain justification", value: lead.subdomain_justification },
    { label: "Domain reasoning", value: lead.domain_reasoning },
    { label: "Lead summary", value: lead.lead_summary },
  ];
  const filled = sections.filter((s) => s.value && s.value.trim().length > 0);

  return (
    <div className="space-y-3 text-xs">
      {lead.error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">
          <div className="font-medium uppercase tracking-wide text-[10px] mb-1">
            Error
          </div>
          <div className="font-mono whitespace-pre-wrap break-all">
            {lead.error}
          </div>
        </div>
      ) : null}
      {filled.length === 0 && !lead.error ? (
        <div className="text-muted-foreground italic">
          No additional detail captured for this lead.
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {filled.map((s) => (
          <div key={s.label}>
            <div className="font-medium uppercase tracking-wide text-[10px] text-muted-foreground mb-1">
              {s.label}
            </div>
            <div className="leading-relaxed whitespace-pre-wrap text-foreground/90">
              {s.value}
            </div>
          </div>
        ))}
      </div>
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

function LeadStatus({
  status,
  error,
}: {
  status: Lead["status"];
  error: string | null;
}) {
  const map: Record<Lead["status"], string> = {
    pending: "text-muted-foreground",
    running: "text-primary animate-pulse",
    processed: "text-emerald-400",
    failed: "text-destructive",
    skipped: "text-muted-foreground",
  };
  return (
    <span className={cn("text-xs", map[status])} title={error ?? undefined}>
      {status}
    </span>
  );
}
