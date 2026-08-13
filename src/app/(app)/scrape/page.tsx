"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Radar,
  Download,
  CircleAlert,
  DownloadCloud,
  ArrowRight,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { usePbApiKeyStore } from "@/lib/pb-api-key-store";
import { ApifyFetchCard } from "@/components/scrape/apify-fetch-card";

type Agent = { id: string; name: string; script: string };

type FetchResult = {
  containerId: string;
  launchedAtMs: number;
  finishedAtMs: number;
  agentName: string | null;
  exitCode: number | null;
  rowCount: number;
  csv: string;
  rawCsvUrl: string;
  note?: string;
};

const PENDING_SCRAPE_KEY = "qualifier.pending-scrape-push";

export default function ScrapePage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const apiKey = usePbApiKeyStore((s) => s.apiKey);

  const [agentId, setAgentId] = useState("");
  const [containerId, setContainerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<FetchResult | null>(null);

  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [agentsErr, setAgentsErr] = useState<string | null>(null);
  const [agentsBusy, setAgentsBusy] = useState(false);

  // Pull the agent list every time we have a key (and on reconnect).
  useEffect(() => {
    if (!apiKey) {
      setAgents(null);
      setAgentsErr(null);
      return;
    }
    let cancelled = false;
    setAgentsBusy(true);
    setAgentsErr(null);
    fetch("/api/pb-agents", { headers: { "x-pb-key": apiKey } })
      .then(async (r) => {
        const j = (await r.json()) as { agents?: Agent[]; error?: string };
        if (cancelled) return;
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        setAgents(j.agents ?? []);
      })
      .catch((e) => {
        if (cancelled) return;
        setAgentsErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setAgentsBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  const connected = mounted && Boolean(apiKey);
  const canFetch = connected && (agentId.trim() || containerId.trim()) && !busy;

  async function onFetch() {
    if (!apiKey) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const res = await fetch("/api/pb-fetch", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-pb-key": apiKey,
        },
        body: JSON.stringify({
          agentId: agentId.trim() || undefined,
          containerId: containerId.trim() || undefined,
        }),
      });
      const json = (await res.json()) as FetchResult | { error?: string };
      if (!res.ok) {
        throw new Error(("error" in json && json.error) || `HTTP ${res.status}`);
      }
      setResult(json as FetchResult);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function downloadCsv() {
    if (!result) return;
    const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `pb-${result.containerId}.trimmed.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  }

  function pushToCampaign() {
    if (!result || typeof window === "undefined") return;
    const sourceLabel = `phantombuster · ${
      result.agentName ?? "agent"
    } · ${result.containerId}`;
    window.sessionStorage.setItem(
      PENDING_SCRAPE_KEY,
      JSON.stringify({
        csv: result.csv,
        sourceLabel,
        containerId: result.containerId,
        agentName: result.agentName,
      })
    );
    router.push("/campaigns/new?from=scrape");
  }

  return (
    <>
      <PageHeader
        title="Scrape"
        description="Run your Phantombuster phantom on phantombuster.com, then paste its agent ID here to pull the result into Lead-IQ as a qualification-ready CSV."
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Radar className="h-4 w-4 text-primary" />
            Fetch Phantombuster output
          </CardTitle>
          <CardDescription>
            Paste the agent ID to grab its latest finished run. Optional:
            paste a specific container ID to pull an older run instead.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="agent-id">Phantom</Label>
              <Select
                value={agentId}
                onValueChange={(v) => setAgentId(typeof v === "string" ? v : "")}
                disabled={busy || !connected || !agents || agents.length === 0}
              >
                <SelectTrigger id="agent-id">
                  <SelectValue
                    placeholder={
                      !connected
                        ? "Connect Phantombuster first"
                        : agentsBusy
                          ? "Loading phantoms…"
                          : agentsErr
                            ? "Failed to load phantoms"
                            : agents && agents.length === 0
                              ? "No phantoms on this account"
                              : "Pick a phantom"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {(agents ?? []).map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name || `(unnamed · ${a.id})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Pulled live from{" "}
                <code className="font-mono">/agents/fetch-all</code>.
                {agentsErr ? (
                  <span className="block text-destructive">
                    {agentsErr}
                  </span>
                ) : null}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="container-id">
                Container ID <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="container-id"
                placeholder="Specific run ID"
                value={containerId}
                onChange={(e) => setContainerId(e.target.value)}
                disabled={busy}
                spellCheck={false}
              />
              <p className="text-[11px] text-muted-foreground">
                Overrides the phantom picker. Use to pull an older run by its container ID.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={onFetch}
              disabled={!canFetch}
              className="gap-2"
            >
              <DownloadCloud className="h-4 w-4" />
              {busy ? "Fetching…" : "Fetch output"}
            </Button>
            {!connected && mounted ? (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <CircleAlert className="h-3.5 w-3.5" />
                Connect Phantombuster first
              </Badge>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {err ? (
        <Card className="mb-6 border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base text-destructive">
              Fetch failed
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm font-mono text-destructive whitespace-pre-wrap break-all">
            {err}
          </CardContent>
        </Card>
      ) : null}

      {result ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Result</CardTitle>
            <CardDescription className="space-y-0.5">
              <div>
                <strong className="text-foreground">{result.rowCount}</strong>{" "}
                rows · {result.agentName ?? "agent"} · container{" "}
                <code className="font-mono text-xs">{result.containerId}</code>
              </div>
              <div className="text-xs">
                finished {new Date(result.finishedAtMs).toLocaleString()}
                {result.exitCode != null ? ` · exit ${result.exitCode}` : ""}
              </div>
              {result.note ? (
                <div className="text-xs text-amber-400">{result.note}</div>
              ) : null}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button onClick={pushToCampaign} className="gap-2">
              <ArrowRight className="h-4 w-4" />
              Push to Campaign
            </Button>
            <Button onClick={downloadCsv} variant="outline" className="gap-2">
              <Download className="h-4 w-4" />
              Download trimmed CSV
            </Button>
          </CardContent>
        </Card>
      ) : null}
      <ApifyFetchCard />
    </>
  );
}
