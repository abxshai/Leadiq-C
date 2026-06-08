"use client";

import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// Shared filter controls, extracted from analytics-dashboard.tsx so the
// /leads filter bar reads identically. Presentation only — the consumer owns
// the selection state (a Set for MultiSelect, a single value for PillGroup).

export function PillGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-border/60 bg-background/40 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "px-2.5 py-1 text-xs rounded-sm transition-colors",
            value === o.value
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Divider() {
  return <div className="h-5 w-px bg-border/60" aria-hidden />;
}

export function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const count = selected.size;
  const disabled = options.length === 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/40 px-2.5 py-1 text-xs",
          "hover:bg-accent hover:text-accent-foreground transition-colors",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <span>{label}</span>
        {count > 0 ? (
          <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/15 px-1 text-[10px] text-primary tabular-nums">
            {count}
          </span>
        ) : null}
        <ChevronDown className="h-3.5 w-3.5 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-72 w-64 overflow-y-auto"
      >
        <div className="flex items-center justify-between px-1.5 py-1 text-xs font-medium text-muted-foreground">
          <span>{label}</span>
          {count > 0 ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange(new Set());
              }}
              className="text-[10px] uppercase tracking-wide hover:text-foreground"
            >
              Clear
            </button>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        {options.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            No options
          </div>
        ) : (
          options.map((o) => (
            <DropdownMenuCheckboxItem
              key={o.value}
              checked={selected.has(o.value)}
              onCheckedChange={(checked) => {
                const next = new Set(selected);
                if (checked) next.add(o.value);
                else next.delete(o.value);
                onChange(next);
              }}
            >
              <span className="truncate">{o.label}</span>
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
