import {
  ExternalLink,
  Building2,
  CalendarClock,
  Mail,
  Briefcase,
  BadgeCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  ReplyStatusChip,
  type ReplyStatus,
  type TouchpointSummaryData,
} from "@/components/leads/lead-display";
import { OpportunitySummary } from "@/components/opportunities/opportunity-summary";

// One row from the list_opportunities RPC (migration 0016). A card is either a
// Smartlead "conversation" (genuine reply showing interest) or a HubSpot
// "deal" (open pipeline deal).
export type Opportunity = {
  opp_id: string;
  kind: "conversation" | "deal";
  title: string | null;
  company: string | null;
  subtitle: string | null; // campaign (conv) | pipeline (deal)
  reply_status: ReplyStatus | null;
  stage_label: string | null;
  amount: number | null;
  owner_name: string | null;
  last_engaged: string | null;
  thread_count: number | null;
  summary: TouchpointSummaryData;
  lead_id: string | null;
  linkedin_url: string | null;
  hs_contact_id: number | null;
  hs_deal_id: number | null;
  email: string | null;
  smartlead_campaign_id: number | null;
};

const HUBSPOT_PORTAL_ID = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID;
const SMARTLEAD_BASE =
  process.env.NEXT_PUBLIC_SMARTLEAD_BASE_URL ?? "https://app.smartlead.ai";

function hubspotDealUrl(dealId: number | null): string | null {
  if (!HUBSPOT_PORTAL_ID || !dealId) return null;
  // 0-3 = HubSpot's object-type id for deals.
  return `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/record/0-3/${dealId}`;
}
function hubspotContactUrl(contactId: number | null): string | null {
  if (!HUBSPOT_PORTAL_ID || !contactId) return null;
  return `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/record/0-1/${contactId}`;
}
function smartleadUrl(campaignId: number | null): string | null {
  if (!campaignId) return null;
  return `${SMARTLEAD_BASE}/app/email-campaigns-v2/${campaignId}/leads`;
}

const amountFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function ExtLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-primary hover:underline"
    >
      {label}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

export function OpportunityCard({ opp }: { opp: Opportunity }) {
  const isDeal = opp.kind === "deal";

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card/40 p-4 shadow-[var(--card-glow)]">
      {/* header: kind + status/stage, last engaged */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge
            variant="outline"
            className={cn(
              "gap-1 text-[10px]",
              isDeal
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
            )}
          >
            {isDeal ? (
              <Briefcase className="h-3 w-3" />
            ) : (
              <Mail className="h-3 w-3" />
            )}
            {isDeal ? "Deal" : "Conversation"}
          </Badge>
          {isDeal && opp.stage_label ? (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              {opp.stage_label}
            </Badge>
          ) : null}
          {!isDeal ? <ReplyStatusChip status={opp.reply_status} /> : null}
        </div>
        <span
          className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground tabular-nums"
          title="Last engaged"
        >
          <CalendarClock className="h-3 w-3" />
          {fmtDate(opp.last_engaged)}
        </span>
      </div>

      {/* title + company */}
      <div className="space-y-1">
        <div className="font-medium leading-tight">{opp.title ?? "—"}</div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {opp.company ? (
            <span className="inline-flex items-center gap-1">
              <Building2 className="h-3 w-3" />
              {opp.company}
            </span>
          ) : null}
          {opp.subtitle ? (
            <span className="truncate">· {opp.subtitle}</span>
          ) : null}
        </div>
      </div>

      {/* deal facts */}
      {isDeal ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {opp.amount != null ? (
            <span className="font-medium text-foreground/90 tabular-nums">
              {amountFmt.format(opp.amount)}
            </span>
          ) : (
            <span className="text-muted-foreground">No amount</span>
          )}
          {opp.owner_name ? (
            <span className="text-muted-foreground">Owner: {opp.owner_name}</span>
          ) : null}
        </div>
      ) : null}

      {/* conversation summary (on-demand) */}
      {!isDeal && opp.email ? (
        <OpportunitySummary
          email={opp.email}
          initial={opp.summary}
          threadCount={opp.thread_count ?? 0}
        />
      ) : null}

      {/* footer: bridge badge + deep links */}
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs">
        {opp.lead_id ? (
          <a
            href={`/leads?q=${encodeURIComponent(opp.title ?? "")}`}
            className="inline-flex items-center gap-1 text-emerald-400 hover:underline"
            title="This conversation maps to a qualified Lead-IQ lead"
          >
            <BadgeCheck className="h-3.5 w-3.5" />
            In Lead-IQ
          </a>
        ) : null}
        {isDeal && hubspotDealUrl(opp.hs_deal_id) ? (
          <ExtLink href={hubspotDealUrl(opp.hs_deal_id)!} label="View deal" />
        ) : null}
        {!isDeal && smartleadUrl(opp.smartlead_campaign_id) ? (
          <ExtLink
            href={smartleadUrl(opp.smartlead_campaign_id)!}
            label="Smartlead"
          />
        ) : null}
        {!isDeal && hubspotContactUrl(opp.hs_contact_id) ? (
          <ExtLink href={hubspotContactUrl(opp.hs_contact_id)!} label="HubSpot" />
        ) : null}
        {!isDeal && opp.linkedin_url ? (
          <ExtLink href={opp.linkedin_url} label="LinkedIn" />
        ) : null}
      </div>
    </div>
  );
}
