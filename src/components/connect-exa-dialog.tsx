"use client";

import { useState } from "react";
import { Key, ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useExaStore } from "@/lib/exa-store";

export function ConnectExaDialog({
  open,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const setKey = useExaStore((s) => s.setKey);
  const clearKey = useExaStore((s) => s.clearKey);
  const currentKey = useExaStore((s) => s.apiKey);
  const [draft, setDraft] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const key = draft.trim();
    if (!key) return;
    // No validation call here — Exa search is paid, so we don't burn a request
    // to check the key; it's verified on the first exa_search the agent runs.
    setKey(key);
    setDraft("");
    onOpenChange?.(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-4 w-4 text-primary" />
            Connect Exa
          </DialogTitle>
          <DialogDescription>
            Paste your Exa API key (dashboard.exa.ai). LeadQuery uses it to
            source signal-based leads from the web. Kept in this tab only
            (sessionStorage), forwarded per chat request, never stored on our
            server.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="exa-key">API key</Label>
            <Input
              id="exa-key"
              type="password"
              placeholder="exa_…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>
              Exa search is pay-per-use, so we don&apos;t charge a request to
              validate — the key is checked on the first search.
            </span>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            {currentKey ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  clearKey();
                  onOpenChange?.(false);
                }}
              >
                Disconnect
              </Button>
            ) : null}
            <Button type="submit" disabled={!draft.trim()}>
              Connect
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
