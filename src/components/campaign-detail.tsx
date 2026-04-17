"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Play,
  Download,
  Loader2,
  ExternalLink,
  CircleAlert,
  CheckCircle2,
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
  seniority_scoring: number | null;
  priority_level: string | null;
  product_area: string | null;
  error: string | null;
  default_profile_url: string | null;
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
}: {
  initialCampaign: Campaign;
  initialLeads: Lead[];
}) {
  const [campaign, setCampaign] = useState(initialCampaign);
  const [leads, setLeads] = useState(initialLeads);
  const [starting, setStarting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const apiKey = useGroqStore((s) => s.apiKey);

  const processed = leads.filter((l) =>
    ["processed", "failed", "skipped"].includes(l.status)
  ).length;
  const pct =
    campaign.total_leads > 0 ? (processed / campaign.total_leads) * 100 : 0;

  const refresh = useCallback(async () => {
    const supabase = createBrowserSupabase();
    const [{ data: c }, { data: l }] = await Promise.all([
      supabase
        .from("campaigns")
        .select(
          "id, name, status, total_leads, qualified_count, failed_count, model, concurrency, source_filename, created_at, started_at, completed_at, google_sheet_id"
        )
        .eq("id", campaign.id)
        .single(),
      supabase
        .from("leads")
        .select(
          "id, full_name, title, company_name, status, function_qualification, seniority_scoring, priority_level, product_area, error, default_profile_url"
        )
        .eq("campaign_id", campaign.id)
        .order("created_at", { ascending: true }),
    ]);
    if (c) setCampaign(c as Campaign);
    if (l) setLeads(l as Lead[]);
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

      <div className="rounded-lg border border-border bg-card/30 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[22%]">Lead</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Qualified</TableHead>
              <TableHead>Seniority</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Area</TableHead>
              <TableHead className="w-8"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="font-medium truncate max-w-[200px]">
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
                <TableCell className="tabular-nums">
                  {l.seniority_scoring ?? "—"}
                </TableCell>
                <TableCell>{l.priority_level ?? "—"}</TableCell>
                <TableCell className="truncate max-w-[140px]">
                  {l.product_area ?? "—"}
                </TableCell>
                <TableCell>
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
            ))}
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
