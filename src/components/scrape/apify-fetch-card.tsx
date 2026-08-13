"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Boxes,
  DownloadCloud,
  Download,
  ArrowRight,
  CircleAlert,
  Loader2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useApifyStore, DEFAULT_APIFY_ACTOR_ID } from "@/lib/apify-store";

// Same handoff key the RunWizard consumes (also in scrape/page.tsx).
const PENDING_SCRAPE_KEY = "qualifier.pending-scrape-push";

type Result = {
  source: string;
  datasetItemCount: number;
  rowCount: number;
  csv: string;
};

export function ApifyFetchCard() {
  const router = useRouter();
  const apiKey = useApifyStore((s) => s.apiKey);

  const [actorId, setActorId] = useState(DEFAULT_APIFY_ACTOR_ID);
  const [runId, setRunId] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const connected = Boolean(apiKey);
  const canFetch = connected && !busy && (actorId.trim() || runId.trim() || datasetId.trim());

  async function onFetch() {
    if (!apiKey) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const res = await fetch("/api/apify-fetch", {
        method: "POST",
        headers: { "content-type": "application/json", "x-apify-token": apiKey },
        body: JSON.stringify({
          actorId: actorId.trim() || undefined,
          runId: runId.trim() || undefined,
          datasetId: datasetId.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setErr(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      setResult(body as Result);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Fetch failed.");
    } finally {
      setBusy(false);
    }
  }

  function pushToCampaign() {
    if (!result) return;
    window.sessionStorage.setItem(
      PENDING_SCRAPE_KEY,
      JSON.stringify({
        csv: result.csv,
        sourceLabel: `apify · ${actorId || result.source}`,
        agentName: result.source,
      })
    );
    router.push("/campaigns/new?from=scrape");
  }

  function downloadCsv() {
    if (!result) return;
    const blob = new Blob([result.csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `apify-${(actorId || "run").replace(/[^a-z0-9]+/gi, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Boxes className="h-4 w-4 text-primary" />
          Fetch an Apify run
        </CardTitle>
        <CardDescription>
          Cookie-free alternative to Phantombuster. Run the actor in Apify
          (default: harvestapi LinkedIn Profile Scraper), then pull its latest
          successful run here — trimmed to the 9 qualification columns and
          deduped, ready to Push to Campaign.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-3">
            <Label htmlFor="apify-actor">Actor ID</Label>
            <Input
              id="apify-actor"
              value={actorId}
              onChange={(e) => setActorId(e.target.value)}
              placeholder={DEFAULT_APIFY_ACTOR_ID}
              disabled={!connected}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="apify-run" className="text-xs text-muted-foreground">
              Run ID (optional)
            </Label>
            <Input
              id="apify-run"
              value={runId}
              onChange={(e) => setRunId(e.target.value)}
              placeholder="specific run"
              disabled={!connected}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="apify-ds" className="text-xs text-muted-foreground">
              Dataset ID (optional)
            </Label>
            <Input
              id="apify-ds"
              value={datasetId}
              onChange={(e) => setDatasetId(e.target.value)}
              placeholder="specific dataset"
              disabled={!connected}
            />
          </div>
          <div className="flex items-end">
            <Button onClick={onFetch} disabled={!canFetch} className="gap-2 w-full">
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <DownloadCloud className="h-4 w-4" />
              )}
              Fetch output
            </Button>
          </div>
        </div>

        {!connected ? (
          <Badge
            variant="outline"
            className="border-yellow-500/40 bg-yellow-500/10 text-yellow-400"
          >
            Connect Apify first (pill in the top-right)
          </Badge>
        ) : null}

        <div className="text-xs text-muted-foreground">
          Precedence: Dataset ID → Run ID → the actor&apos;s last successful run.
        </div>

        {err ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="break-words">{err}</span>
          </div>
        ) : null}

        {result ? (
          <div className="rounded-lg border border-border bg-background/40 p-3">
            <div className="text-sm">
              <span className="font-medium">{result.rowCount}</span> leads
              {result.datasetItemCount !== result.rowCount ? (
                <span className="text-muted-foreground">
                  {" "}
                  (from {result.datasetItemCount} dataset items)
                </span>
              ) : null}
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {result.source}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" onClick={pushToCampaign} className="gap-1.5">
                <ArrowRight className="h-3.5 w-3.5" />
                Push to Campaign
              </Button>
              <Button size="sm" variant="outline" onClick={downloadCsv} className="gap-1.5">
                <Download className="h-3.5 w-3.5" />
                Download CSV
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
