"use client";

import { useState } from "react";
import { Key, ShieldCheck, AlertCircle } from "lucide-react";
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
import { useApifyStore } from "@/lib/apify-store";

export function ConnectApifyDialog({
  open,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const setKey = useApifyStore((s) => s.setKey);
  const clearKey = useApifyStore((s) => s.clearKey);
  const currentKey = useApifyStore((s) => s.apiKey);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const token = draft.trim();
    if (!token) return;
    setBusy(true);
    setErr(null);
    try {
      // Validate via our proxy (avoids CORS, keeps the token off apify.com in
      // the browser). 200 => Apify accepted it.
      const res = await fetch("/api/apify-whoami", {
        headers: { "x-apify-token": token },
      });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        setErr(body?.error ?? `Apify returned ${res.status}.`);
        return;
      }
      setKey(token);
      setDraft("");
      onOpenChange?.(false);
    } catch {
      setErr("Couldn't reach Apify. Check your network and retry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-4 w-4 text-primary" />
            Connect Apify
          </DialogTitle>
          <DialogDescription>
            Paste your Apify API token (Apify Console → Settings → Integrations →
            API token). It&apos;s validated, kept in this tab only
            (sessionStorage), and attached as a header per fetch — never stored
            on our server.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="apify-token">API token</Label>
            <Input
              id="apify-token"
              type="password"
              placeholder="apify_api_…"
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
                Validated against{" "}
                <code className="font-mono text-foreground">/users/me</code>{" "}
                before we accept it. No actor run is triggered.
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
