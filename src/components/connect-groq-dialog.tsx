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
import { GROQ_BASE_URL, useGroqStore } from "@/lib/groq-store";

export function ConnectGroqDialog({
  open,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const setKey = useGroqStore((s) => s.setKey);
  const clearKey = useGroqStore((s) => s.clearKey);
  const currentKey = useGroqStore((s) => s.apiKey);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`${GROQ_BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${draft.trim()}` },
      });
      if (!res.ok) {
        setErr(
          res.status === 401
            ? "That key was rejected by Groq. Double-check it on console.groq.com."
            : `Groq returned ${res.status}. Try again or check your network.`
        );
        return;
      }
      setKey(draft.trim());
      setDraft("");
      onOpenChange?.(false);
    } catch {
      setErr("Couldn't reach api.groq.com. Check your network and retry.");
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
            Connect Groq
          </DialogTitle>
          <DialogDescription>
            Your key is validated with Groq, kept in this tab only
            (sessionStorage), and attached as a header on each run. It&apos;s
            never stored on our server.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="groq-key">API key</Label>
            <Input
              id="groq-key"
              type="password"
              placeholder="gsk_…"
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
                We validate against{" "}
                <code className="font-mono text-foreground">/models</code>{" "}
                before accepting the key. No run is charged.
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
