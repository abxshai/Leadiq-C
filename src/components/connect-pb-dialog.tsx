"use client";

import { useState } from "react";
import { KeyRound, ShieldCheck, AlertCircle } from "lucide-react";
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
import { usePbApiKeyStore } from "@/lib/pb-api-key-store";

export function ConnectPbDialog({
  open,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const setKey = usePbApiKeyStore((s) => s.setKey);
  const clearKey = usePbApiKeyStore((s) => s.clearKey);
  const currentKey = usePbApiKeyStore((s) => s.apiKey);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    setBusy(true);
    setErr(null);
    try {
      // Validate by hitting a harmless read endpoint with the key.
      const res = await fetch("https://api.phantombuster.com/api/v2/orgs/fetch-resources", {
        headers: { "X-Phantombuster-Key-1": trimmed, Accept: "application/json" },
      });
      if (!res.ok) {
        setErr(
          res.status === 401 || res.status === 403
            ? "Phantombuster rejected that key. Double-check on phantombuster.com → Settings → API key."
            : `Phantombuster returned ${res.status}. Try again or check your network.`
        );
        return;
      }
      setKey(trimmed);
      setDraft("");
      onOpenChange?.(false);
    } catch {
      setErr("Couldn't reach api.phantombuster.com. Check your network and retry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            Connect Phantombuster
          </DialogTitle>
          <DialogDescription>
            Your PB API key stays in this tab only (sessionStorage), forwarded
            as a header when you fetch a scrape result. Never persisted on our
            server.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pb-key">API key</Label>
            <Input
              id="pb-key"
              type="password"
              placeholder="e.g. F0fq21ok0HxSA…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          {err ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{err}</span>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>
                Validated against PB&apos;s{" "}
                <code className="font-mono text-foreground">/orgs/fetch-resources</code>{" "}
                (read-only) before accepting. No scrape is launched.
              </span>
            </div>
          )}

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
            <Button type="submit" disabled={busy || !draft.trim()}>
              {busy ? "Validating…" : "Connect"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
