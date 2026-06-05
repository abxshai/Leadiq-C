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
  temperature: "hot" | "warm" | "cold" | null;
  touchpoint_match: TouchpointMatch | null;
};

// Shape written by classify_campaign_temperature (migration 0006). Both
// sub-objects are absent when the lead didn't match that source.
type TouchpointMatch = {
  hubspot?: {
    contact_id?: number;
    lifecyclestage?: string | null;
    last_replied?: string | null;
    notes_last_updated?: string | null;
  };
  smartlead?: {
    campaigns?: string[];
    last_reply?: string | null;
    last_open?: string | null;
    last_click?: string | null;
    last_sent?: string | null;
    bounced?: boolean;
    unsubscribed?: boolean;
    events?: TouchpointEvent[];
  };
  last_activity?: string | null;
} | null;

// One concrete Smartlead touchpoint — the citation of an actual email.
type TouchpointEvent = {
  date?: string | null;
  action?: "sent" | "opened" | "clicked" | "replied";
  campaign?: string | null;
  campaign_id?: number | null;
  subject?: string | null;
  opens?: number;
  clicks?: number;
};

// Deep-link config. HubSpot's portal ID is account-specific and not in the
// CRM data, so it comes from env (link is omitted when unset). Smartlead is a
// fixed cloud host.
const HUBSPOT_PORTAL_ID = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID;
const SMARTLEAD_BASE =
  process.env.NEXT_PUBLIC_SMARTLEAD_BASE_URL ?? "https://app.smartlead.ai";

function hubspotContactUrl(contactId?: number): string | null {
  if (!HUBSPOT_PORTAL_ID || !contactId) return null;
  // 0-1 = HubSpot's object-type id for contacts.
  return `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/record/0-1/${contactId}`;
}

const smartleadTab: Record<NonNullable<TouchpointEvent["action"]>, string> = {
  replied: "replied",
  clicked: "clicked",
  opened: "opened",
  sent: "",
};

function smartleadCampaignUrl(
  campaignId?: number | null,
  action?: TouchpointEvent["action"]
): string | null {
  if (!campaignId) return null;
  const tab = action ? smartleadTab[action] : "";
  return `${SMARTLEAD_BASE}/app/email-campaigns-v2/${campaignId}/leads${
    tab ? `?tab=${tab}` : ""
  }`;
}

type Temperature = "hot" | "warm" | "cold";

const LEAD_COLS =
  "id, full_name, title, company_name, status, function_qualification, function_reasoning, icp_qualification, seniority_scoring, domain_classification, subdomain, subdomain_justification, domain_reasoning, priority_level, product_area, lead_summary, error, default_profile_url, temperature, touchpoint_match";

const temperatureBadge: Record<Temperature, string> = {
  hot: "border-red-500/40 bg-red-500/10 text-red-400",
  warm: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  cold: "border-muted-foreground/30 text-muted-foreground",
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
              const hasTouchpoints =
                (l.temperature === "hot" || l.temperature === "warm") &&
                l.touchpoint_match != null;
              const hasDetail =
                l.function_reasoning ||
                l.subdomain_justification ||
                l.domain_reasoning ||
                l.lead_summary ||
                l.error ||
                hasTouchpoints;
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

function DetailGrid({ lead }: { lead: Lead }) {
  const sections: { label: string; value: string | null }[] = [
    { label: "Function reasoning", value: lead.function_reasoning },
    { label: "Subdomain justification", value: lead.subdomain_justification },
    { label: "Domain reasoning", value: lead.domain_reasoning },
    { label: "Lead summary", value: lead.lead_summary },
  ];
  const filled = sections.filter((s) => s.value && s.value.trim().length > 0);
  const showTouchpoints =
    (lead.temperature === "hot" || lead.temperature === "warm") &&
    lead.touchpoint_match != null;

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
      {filled.length === 0 && !lead.error && !showTouchpoints ? (
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
      {showTouchpoints ? (
        <TouchpointHistory
          temperature={lead.temperature as Temperature}
          match={lead.touchpoint_match!}
        />
      ) : null}
    </div>
  );
}

function TemperatureBadge({ value }: { value: Temperature | null }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge
      variant="outline"
      className={cn("capitalize", temperatureBadge[value])}
    >
      {value}
    </Badge>
  );
}

function fmtDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

const actionColor: Record<
  NonNullable<TouchpointEvent["action"]>,
  string
> = {
  replied: "text-emerald-400",
  clicked: "text-primary",
  opened: "text-amber-400",
  sent: "text-muted-foreground",
};
const actionVerb: Record<NonNullable<TouchpointEvent["action"]>, string> = {
  replied: "Replied to",
  clicked: "Clicked",
  opened: "Opened",
  sent: "Sent",
};

// Renders the HubSpot + Smartlead evidence captured by
// classify_campaign_temperature, mirroring the prose-expand pattern: a
// divider, a header with the temperature badge, then a cited list of the
// actual touchpoints (each Smartlead email's subject + what happened + when),
// most-recent first.
function TouchpointHistory({
  temperature,
  match,
}: {
  temperature: Temperature;
  match: NonNullable<TouchpointMatch>;
}) {
  const hs = match.hubspot;
  const sl = match.smartlead;
  const events = sl?.events ?? [];

  return (
    <div className="border-t border-border pt-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="font-medium uppercase tracking-wide text-[10px] text-muted-foreground">
          Touchpoint history
        </span>
        <TemperatureBadge value={temperature} />
      </div>

      {hs ? (
        <div className="mb-2 text-foreground/90">
          <span className="text-muted-foreground">HubSpot:</span>{" "}
          {hs.lifecyclestage ? (
            <span className="capitalize">{hs.lifecyclestage}</span>
          ) : (
            "contact"
          )}
          {hs.last_replied ? (
            <span className="text-muted-foreground">
              {" "}
              · replied {fmtDate(hs.last_replied)}
            </span>
          ) : null}
          {hubspotContactUrl(hs.contact_id) ? (
            <a
              href={hubspotContactUrl(hs.contact_id)!}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 inline-flex items-center gap-0.5 text-primary hover:underline"
            >
              View in HubSpot
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </div>
      ) : null}

      {events.length > 0 ? (
        <ul className="space-y-2">
          {events.map((e, i) => {
            const action = e.action ?? "sent";
            const url = smartleadCampaignUrl(e.campaign_id, action);
            return (
              <li key={i} className="flex gap-2 leading-snug">
                <span className="text-muted-foreground tabular-nums shrink-0 w-[5rem]">
                  {fmtDate(e.date) ?? "—"}
                </span>
                <span className="min-w-0">
                  <span className={cn("font-medium", actionColor[action])}>
                    {actionVerb[action]}
                  </span>
                  {e.campaign ? (
                    url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-primary hover:underline"
                      >
                        {" "}
                        · {e.campaign}
                        <ExternalLink className="ml-0.5 inline h-3 w-3 align-text-top" />
                      </a>
                    ) : (
                      <span className="text-muted-foreground"> · {e.campaign}</span>
                    )
                  ) : null}
                  {e.subject ? (
                    <span className="block text-foreground/80 italic truncate">
                      “{e.subject}”
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : sl ? (
        <div className="text-muted-foreground">
          Smartlead: {sl.campaigns?.join(", ") ?? "engaged"}
        </div>
      ) : null}

      {sl && (sl.bounced || sl.unsubscribed) ? (
        <div className="mt-2 text-[11px] text-muted-foreground">
          {[sl.bounced ? "bounced" : null, sl.unsubscribed ? "unsubscribed" : null]
            .filter(Boolean)
            .join(" · ")}
        </div>
      ) : null}
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

function FunctionVerdict({ value }: { value: string | null }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  const upper = value.trim().toUpperCase();
  if (upper === "NO") return <span className="text-muted-foreground">NO</span>;
  if (upper === "YES") {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" />
        YES
      </span>
    );
  }
  // Categorical verdict ("Decision Maker", "Influencer", "Champion", etc.) —
  // show the literal value styled as qualified-positive.
  return (
    <span
      className="inline-flex items-center gap-1 text-emerald-400 truncate max-w-[160px]"
      title={value}
    >
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{value}</span>
    </span>
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
