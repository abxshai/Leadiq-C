"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  ArrowRight,
  Download,
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
import { useApifyStore } from "@/lib/apify-store";

const PENDING_SCRAPE_KEY = "qualifier.pending-scrape-push";

type Phase = "idle" | "running" | "fetching" | "done" | "error";
type Result = { rowCount: number; datasetItemCount: number; csv: string };

const csvList = (s: string) =>
  s.split(",").map((x) => x.trim()).filter(Boolean);

export function ApifySearchCard() {
  const router = useRouter();
  const apiKey = useApifyStore((s) => s.apiKey);

  const [query, setQuery] = useState("");
  const [titles, setTitles] = useState("");
  const [locations, setLocations] = useState("");
  const [companies, setCompanies] = useState("");
  const [maxItems, setMaxItems] = useState(1000);
  const [full, setFull] = useState(true);

  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState<string>("");
  const [runId, setRunId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const headers = useCallback(
    (json = false): Record<string, string> => ({
      ...(json ? { "content-type": "application/json" } : {}),
      ...(apiKey ? { "x-apify-token": apiKey } : {}),
    }),
    [apiKey]
  );

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };
  useEffect(() => stopPoll, []);

  const fetchResult = useCallback(
    async (rid: string) => {
      setPhase("fetching");
      try {
        const res = await fetch("/api/apify-fetch", {
          method: "POST",
          headers: headers(true),
          body: JSON.stringify({ runId: rid }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
        setResult(body as Result);
        setPhase("done");
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Fetch failed.");
        setPhase("error");
      }
    },
    [headers]
  );

  const startPoll = useCallback(
    (rid: string) => {
      stopPoll();
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/apify-search?runId=${rid}`, {
            headers: headers(),
          });
          const body = await res.json();
          if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
          setStatus(body.status);
          if (body.done) {
            stopPoll();
            void fetchResult(rid);
          } else if (body.failed) {
            stopPoll();
            setErr(`Apify run ${body.status}.`);
            setPhase("error");
          }
        } catch {
          /* transient — keep polling */
        }
      }, 8000);
    },
    [headers, fetchResult]
  );

  async function onStart() {
    setErr(null);
    setResult(null);
    setStatus("");
    setPhase("running");
    try {
      const res = await fetch("/api/apify-search", {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify({
          searchQuery: query,
          currentJobTitles: csvList(titles),
          locations: csvList(locations),
          currentCompanies: csvList(companies),
          maxItems,
          mode: full ? "Full" : "Short",
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setRunId(body.runId);
      setStatus(body.status ?? "RUNNING");
      startPoll(body.runId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to start.");
      setPhase("error");
    }
  }

  function pushToCampaign() {
    if (!result) return;
    window.sessionStorage.setItem(
      PENDING_SCRAPE_KEY,
      JSON.stringify({
        csv: result.csv,
        sourceLabel: `apify search · ${query || titles || "run"}`,
        agentName: query || "Apify search",
      })
    );
    router.push("/campaigns/new?from=scrape");
  }

  function downloadCsv() {
    if (!result) return;
    const blob = new Blob([result.csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "apify-search.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const busy = phase === "running" || phase === "fetching";
  const canStart =
    !busy && (query.trim() || titles.trim() || companies.trim());

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="h-4 w-4 text-primary" />
          Search &amp; scrape (Apify)
        </CardTitle>
        <CardDescription>
          Cookie-free LinkedIn people search via harvestapi — enter filters,
          scrape up to 1,000 profiles without the Phantombuster stall, then Push
          to Campaign. Full mode (with profile detail) ≈ $8 / 1k; Short ≈ $4 / 1k.
          LinkedIn caps a single search near ~1,000 — split by filters for more.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="q">Search query</Label>
            <Input
              id="q"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. machine learning platform infrastructure"
              disabled={busy}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="titles">Job titles (comma-separated)</Label>
            <Input
              id="titles"
              value={titles}
              onChange={(e) => setTitles(e.target.value)}
              placeholder="VP Engineering, Head of Data"
              disabled={busy}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="locs">Locations</Label>
            <Input
              id="locs"
              value={locations}
              onChange={(e) => setLocations(e.target.value)}
              placeholder="United States, London"
              disabled={busy}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cos">Companies</Label>
            <Input
              id="cos"
              value={companies}
              onChange={(e) => setCompanies(e.target.value)}
              placeholder="optional"
              disabled={busy}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="max">Max profiles</Label>
            <Input
              id="max"
              type="number"
              min={1}
              max={1000}
              value={maxItems || ""}
              onChange={(e) =>
                setMaxItems(e.target.value === "" ? 0 : Number(e.target.value))
              }
              disabled={busy}
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={full}
              onChange={(e) => setFull(e.target.checked)}
              disabled={busy}
            />
            Full profile detail (better qualification; ~$8/1k)
          </label>
          <Button onClick={onStart} disabled={!canStart} className="ml-auto gap-2">
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            {phase === "running"
              ? `Scraping… ${status}`
              : phase === "fetching"
                ? "Fetching results…"
                : "Search & scrape"}
          </Button>
        </div>

        {busy ? (
          <div className="text-xs text-muted-foreground">
            Run {runId ? runId : "starting"} — this can take several minutes for
            ~1,000 in Full mode. You can leave this open; if you close it, fetch
            the finished run from the &ldquo;Fetch an Apify run&rdquo; card below.
          </div>
        ) : null}

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
                  (from {result.datasetItemCount} scraped)
                </span>
              ) : null}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" onClick={pushToCampaign} className="gap-1.5">
                <ArrowRight className="h-3.5 w-3.5" />
                Push to Campaign
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={downloadCsv}
                className="gap-1.5"
              >
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
