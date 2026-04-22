"use client";

import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConnectPbDialog } from "@/components/connect-pb-dialog";
import { usePbApiKeyStore } from "@/lib/pb-api-key-store";

export function PbConnectPill() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const connected = usePbApiKeyStore((s) => Boolean(s.apiKey));

  useEffect(() => {
    setMounted(true);
  }, []);

  const label = !mounted
    ? "Connect Phantombuster"
    : connected
      ? "Phantombuster connected"
      : "Connect Phantombuster";

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
        <KeyRound className="h-3.5 w-3.5" />
        {label}
      </Button>
      <ConnectPbDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
