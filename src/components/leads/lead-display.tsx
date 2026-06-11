import {
  CheckCircle2,
  ExternalLink,
  MessageSquareText,
  MessageSquareOff,
  Clock,
  Ban,
  ThumbsDown,
  ThumbsUp,
  CalendarCheck,
  UserX,
  Undo2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { TouchpointSummary } from "@/components/leads/touchpoint-summary";

// Shared lead-row presentation, extracted from campaign-detail.tsx so the
// cross-campaign /leads browser renders cells, badges, and the touchpoint
// expand identically. No hooks/state here — safe to import from either a
// server or a client component.

export type Temperature = "hot" | "warm" | "cold";

export type Lead = {
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
  temperature: Temperature | null;
  touchpoint_match: TouchpointMatch | null;
  touchpoint_summary: TouchpointSummaryData;
};

// Cached LLM summary of a lead's Smartlead reply thread, written on demand by
// POST /api/leads/[id]/summarize-touchpoints (migration 0009). Null until a
// teammate clicks "Summarize touchpoints" for this lead.
export type TouchpointSummaryData = {
  summary: string;
  signal: string;
  // LLM-judged stance from the lead's replies (migration 0011 + summarize
  // route). Refines the classifier's reply_status for ambiguous "replied" cases.
  // "neutral" = replied but stance unclear (renders no chip).
  status?: ReplyStatus | "neutral" | null;
  thread_count?: number;
  generated_at?: string;
  model?: string;
} | null;

// What a lead's Smartlead reply actually was. Written by
// classify_campaign_temperature (lead_category + an OOO body-pattern); the
// on-demand summary can refine a bare "replied" into a real stance. Display
// only — does NOT (yet) affect hot/warm/cold bucketing.
export type ReplyStatus =
  | "ooo"
  | "do_not_contact"
  | "not_interested"
  | "wrong_person"
  | "bounce"
  | "interested"
  | "meeting"
  | "replied";

// Shape written by classify_campaign_temperature (migration 0006). Both
// sub-objects are absent when the lead didn't match that source.
export type TouchpointMatch = {
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
    // Count of actual thread messages (sent + reply bodies) we hold for this
    // lead. Gates the "Summarize touchpoints" button — only shown when > 0.
    reply_thread_count?: number;
    // What the lead's reply was (OOO / not interested / interested / …) so a
    // timestamp-only "hot" can be read in context. See ReplyStatus.
    reply_status?: ReplyStatus | null;
    events?: TouchpointEvent[];
  };
  last_activity?: string | null;
} | null;

// One concrete Smartlead touchpoint — the citation of an actual email.
export type TouchpointEvent = {
  date?: string | null;
  action?: "sent" | "opened" | "clicked" | "replied";
  campaign?: string | null;
  campaign_id?: number | null;
  subject?: string | null;
  opens?: number;
  clicks?: number;
};

// The lead columns both the campaign-detail and /leads queries select. The
// /leads query adds `location` and the joined campaign on top of these.
export const LEAD_COLS =
  "id, full_name, title, company_name, status, function_qualification, function_reasoning, icp_qualification, seniority_scoring, domain_classification, subdomain, subdomain_justification, domain_reasoning, priority_level, product_area, lead_summary, error, default_profile_url, temperature, touchpoint_match, touchpoint_summary";

export const temperatureBadge: Record<Temperature, string> = {
  hot: "border-red-500/40 bg-red-500/10 text-red-400",
  warm: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  cold: "border-muted-foreground/30 text-muted-foreground",
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

export function fmtDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function TemperatureBadge({ value }: { value: Temperature | null }) {
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

// How many Smartlead reply-thread messages we hold for this lead.
//   null  -> not applicable (cold / not cross-checked / no CRM match)
//   0     -> hot/warm, cross-checked, but no thread recorded yet
//   >0    -> recorded
// Recomputed by classify_campaign_temperature on every cross-check, so it
// fills in on its own as the threads table grows and a campaign is re-checked.
export function threadCountOf(l: Lead): number | null {
  if (!hasTouchpoints(l)) return null;
  return l.touchpoint_match?.smartlead?.reply_thread_count ?? 0;
}

// Compact "is a reply thread on file?" marker shown next to the Temp badge in
// the lead tables — lit when recorded (with the count), dim when none.
export function ThreadMarker({ lead }: { lead: Lead }) {
  const n = threadCountOf(lead);
  if (n == null) return null;
  const has = n > 0;
  return (
    <span
      title={
        has
          ? `${n} reply message${n === 1 ? "" : "s"} on file`
          : "No reply thread recorded yet"
      }
      className={cn(
        "inline-flex items-center gap-0.5 text-[10px] tabular-nums",
        has ? "text-primary" : "text-muted-foreground/40"
      )}
    >
      {has ? (
        <MessageSquareText className="h-3 w-3" />
      ) : (
        <MessageSquareOff className="h-3 w-3" />
      )}
      {has ? n : null}
    </span>
  );
}

export function FunctionVerdict({ value }: { value: string | null }) {
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

export function LeadStatus({
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

// True when a row has anything worth expanding inline.
export function hasLeadDetail(l: Lead): boolean {
  return Boolean(
    l.function_reasoning ||
      l.subdomain_justification ||
      l.domain_reasoning ||
      l.lead_summary ||
      l.error ||
      hasTouchpoints(l)
  );
}

export function hasTouchpoints(l: Lead): boolean {
  return (
    (l.temperature === "hot" || l.temperature === "warm") &&
    l.touchpoint_match != null
  );
}

export function DetailGrid({ lead }: { lead: Lead }) {
  const sections: { label: string; value: string | null }[] = [
    { label: "Function reasoning", value: lead.function_reasoning },
    { label: "Subdomain justification", value: lead.subdomain_justification },
    { label: "Domain reasoning", value: lead.domain_reasoning },
    { label: "Lead summary", value: lead.lead_summary },
  ];
  const filled = sections.filter((s) => s.value && s.value.trim().length > 0);
  const showTouchpoints = hasTouchpoints(lead);

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
          leadId={lead.id}
          temperature={lead.temperature as Temperature}
          match={lead.touchpoint_match!}
          summary={lead.touchpoint_summary}
        />
      ) : null}
    </div>
  );
}

// Reply-status chip shown beside the temperature in the touchpoint expand, so
// a "hot" tagged purely on a reply timestamp can be read in context — e.g. an
// OOO auto-reply or a "do not contact" isn't real interest. "replied" (a bare,
// un-categorized reply) renders nothing — there's no signal beyond the existing
// "Replied to" event until the summary refines it.
const replyStatusMeta: Record<
  Exclude<ReplyStatus, "replied">,
  { label: string; cls: string; Icon: typeof Clock }
> = {
  ooo: {
    label: "OOO reply",
    cls: "border-muted-foreground/30 bg-muted/30 text-muted-foreground",
    Icon: Clock,
  },
  do_not_contact: {
    label: "Do not contact",
    cls: "border-destructive/40 bg-destructive/10 text-destructive",
    Icon: Ban,
  },
  not_interested: {
    label: "Not interested",
    cls: "border-red-500/40 bg-red-500/10 text-red-400",
    Icon: ThumbsDown,
  },
  wrong_person: {
    label: "Wrong person",
    cls: "border-muted-foreground/30 bg-muted/30 text-muted-foreground",
    Icon: UserX,
  },
  bounce: {
    label: "Bounced",
    cls: "border-muted-foreground/30 bg-muted/30 text-muted-foreground",
    Icon: Undo2,
  },
  interested: {
    label: "Interested",
    cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
    Icon: ThumbsUp,
  },
  meeting: {
    label: "Meeting",
    cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
    Icon: CalendarCheck,
  },
};

export function ReplyStatusChip({
  status,
}: {
  status?: ReplyStatus | "neutral" | null;
}) {
  if (!status || status === "replied" || status === "neutral") return null;
  const meta = replyStatusMeta[status];
  if (!meta) return null;
  const { label, cls, Icon } = meta;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
        cls
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

const actionColor: Record<NonNullable<TouchpointEvent["action"]>, string> = {
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
export function TouchpointHistory({
  leadId,
  temperature,
  match,
  summary,
}: {
  leadId: string;
  temperature: Temperature;
  match: NonNullable<TouchpointMatch>;
  summary?: TouchpointSummaryData;
}) {
  const hs = match.hubspot;
  const sl = match.smartlead;
  const events = sl?.events ?? [];
  const threadCount = sl?.reply_thread_count ?? 0;
  // Prefer the LLM-refined stance from a cached summary; fall back to the
  // classifier's auto-detected reply_status (OOO / category).
  const replyStatus = summary?.status ?? sl?.reply_status ?? null;

  return (
    <div className="border-t border-border pt-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="font-medium uppercase tracking-wide text-[10px] text-muted-foreground">
          Touchpoint history
        </span>
        <TemperatureBadge value={temperature} />
        <ReplyStatusChip status={replyStatus} />
      </div>

      {threadCount > 0 ? (
        <TouchpointSummary
          leadId={leadId}
          initial={summary ?? null}
          threadCount={threadCount}
        />
      ) : (
        <div className="mb-3 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <MessageSquareOff className="h-3 w-3" />
          No reply thread recorded yet
        </div>
      )}

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
