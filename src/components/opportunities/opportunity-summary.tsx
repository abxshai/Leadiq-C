"use client";

import { useState } from "react";
import { Sparkles, Loader2, ArrowRightCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGroqStore } from "@/lib/groq-store";
import type { TouchpointSummaryData } from "@/components/leads/lead-display";

function fmtDay(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// On-demand thread recap for an opportunity conversation. Same UX as the
// per-lead TouchpointSummary, but keyed by email — opportunities mostly live in
// the conference-outreach population that has no qualified-lead row, so the
// summary is cached server-side in public.opportunity_summaries (by email)
// rather than on leads.touchpoint_summary. First click calls Groq (BYOK) via
// POST /api/opportunities/summarize; the result is cached and shared.
export function OpportunitySummary({
  email,
  initial,
  threadCount,
}: {
  email: string;
  initial: TouchpointSummaryData;
  threadCount: number;
}) {
  const apiKey = useGroqStore((s) => s.apiKey);
  const [summary, setSummary] = useState<TouchpointSummaryData>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function summarize() {
    if (!apiKey) {
      setError("Connect your Groq key to summarize.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/opportunities/summarize`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-groq-key": apiKey },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Failed to summarize.");
        return;
      }
      if (!data?.summary) {
        setError("No reply-thread content found to summarize.");
        return;
      }
      setSummary(data as TouchpointSummaryData);
    } catch {
      setError("Network error while summarizing.");
    } finally {
      setLoading(false);
    }
  }

  if (summary) {
    return (
      <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
        <div className="flex items-center gap-2 mb-1">
          <span className="inline-flex items-center gap-1 font-medium uppercase tracking-wide text-[10px] text-muted-foreground">
            <Sparkles className="h-3 w-3" />
            Conversation summary
          </span>
          {summary.generated_at ? (
            <span className="text-[10px] text-muted-foreground">
              · {fmtDay(summary.generated_at)}
            </span>
          ) : null}
          <button
            type="button"
            onClick={summarize}
            disabled={loading}
            className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Re-summarize
          </button>
        </div>
        <p className="leading-relaxed whitespace-pre-wrap text-foreground/90 text-xs">
          {summary.summary}
        </p>
        {summary.signal ? (
          <p className="mt-2 inline-flex items-start gap-1.5 text-primary text-xs">
            <ArrowRightCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span className="font-medium">{summary.signal}</span>
          </p>
        ) : null}
        {error ? <p className="mt-1 text-destructive text-xs">{error}</p> : null}
      </div>
    );
  }

  return (
    <div>
      <Button
        type="button"
        variant="outline"
        size="xs"
        onClick={summarize}
        disabled={loading}
      >
        {loading ? <Loader2 className="animate-spin" /> : <Sparkles />}
        Summarize conversation
        <span className="text-muted-foreground">· {threadCount}</span>
      </Button>
      {error ? <p className="mt-1 text-destructive text-xs">{error}</p> : null}
    </div>
  );
}
