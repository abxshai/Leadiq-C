"use client";

import { useEffect, useState } from "react";
import { Radar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConnectExaDialog } from "@/components/connect-exa-dialog";
import { useExaStore } from "@/lib/exa-store";

export function ExaConnectPill() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const connected = useExaStore((s) => Boolean(s.apiKey));

  useEffect(() => {
    setMounted(true);
  }, []);

  const label = !mounted
    ? "Connect Exa"
    : connected
      ? "Exa connected"
      : "Connect Exa";

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-2 border-primary/30 bg-primary/5 hover:bg-primary/10"
      >
        <span
          className={
            mounted && connected
              ? "inline-block h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_oklch(0.78_0.18_150)]"
              : "inline-block h-2 w-2 rounded-full bg-muted-foreground/40"
          }
        />
        <Radar className="h-3.5 w-3.5" />
        {label}
      </Button>
      <ConnectExaDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
