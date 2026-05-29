"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Wrench,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

export function ChatToolCall({
  name,
  args,
  result,
  ok,
}: {
  name: string;
  args: unknown;
  result: unknown;
  ok: boolean | undefined;
}) {
  const [expanded, setExpanded] = useState(false);

  const pending = result == null;
  const Icon = pending ? Loader2 : ok ? CheckCircle2 : XCircle;
  const iconClass = pending
    ? "text-muted-foreground animate-spin"
    : ok
    ? "text-emerald-400"
    : "text-destructive";

  const argPreview =
    args != null && typeof args === "object" && Object.keys(args).length > 0
      ? truncate(JSON.stringify(args), 80)
      : "";

  return (
    <div className="rounded-md border border-border bg-muted/30 text-xs font-mono">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 w-full p-2 text-left hover:bg-muted/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <Wrench className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="font-medium">{name}</span>
        {!expanded && argPreview && (
          <span className="text-muted-foreground truncate text-[10px]">
            {argPreview}
          </span>
        )}
        <Icon className={cn("h-3 w-3 ml-auto shrink-0", iconClass)} />
      </button>
      {expanded && (
        <div className="border-t border-border p-3 space-y-3">
          {args != null && (
            <div>
              <div className="text-muted-foreground text-[10px] mb-1">ARGS</div>
              <pre className="whitespace-pre-wrap text-[11px] leading-relaxed">
                {JSON.stringify(args, null, 2)}
              </pre>
            </div>
          )}
          {result != null && (
            <div>
              <div className="text-muted-foreground text-[10px] mb-1">
                RESULT
              </div>
              <pre className="whitespace-pre-wrap text-[11px] leading-relaxed max-h-72 overflow-auto">
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
