import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Shared lead-row presentation, extracted from campaign-detail.tsx so the
// cross-campaign /leads browser renders cells, badges, and the inline expand
// identically. No hooks/state here — safe to import from either a server or a
// client component.

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
};

// The lead columns both the campaign-detail and /leads queries select. The
// /leads query adds `location` and the joined campaign on top of these.
export const LEAD_COLS =
  "id, full_name, title, company_name, status, function_qualification, function_reasoning, icp_qualification, seniority_scoring, domain_classification, subdomain, subdomain_justification, domain_reasoning, priority_level, product_area, lead_summary, error, default_profile_url";

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
      l.error
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
