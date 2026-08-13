"use client";

import { useEffect, useState } from "react";
import { Key } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConnectApifyDialog } from "@/components/connect-apify-dialog";
import { useApifyStore } from "@/lib/apify-store";

export function ApifyConnectPill() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const connected = useApifyStore((s) => Boolean(s.apiKey));

  useEffect(() => {
    setMounted(true);
  }, []);

  const label = !mounted
    ? "Connect Apify"
    : connected
      ? "Apify connected"
      : "Connect Apify";

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
        <Key className="h-3.5 w-3.5" />
        {label}
      </Button>
      <ConnectApifyDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
