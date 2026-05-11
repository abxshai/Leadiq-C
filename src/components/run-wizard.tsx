"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useDropzone } from "react-dropzone";
import {
  Upload,
  FileCheck2,
  Loader2,
  Settings2,
  Rocket,
  CircleAlert,
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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseCsv, parseFile, type ParsedLead, type ParseResult } from "@/lib/lead-parser";
import { createCampaign } from "@/app/(app)/campaigns/actions";
import { cn } from "@/lib/utils";

type Template = {
  id: string;
  name: string;
  slug: string;
  is_default: boolean;
};

// Key used by /scrape to hand off a fetched PB result. Same tab only.
const PENDING_SCRAPE_KEY = "qualifier.pending-scrape-push";

type PendingScrapePayload = {
  csv: string;
  sourceLabel: string;
  containerId?: string;
  agentName?: string | null;
};

export function RunWizard({ templates }: { templates: Template[] }) {
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [scrapeSource, setScrapeSource] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [parseErr, setParseErr] = useState<string | null>(null);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const defaultTemplate = useMemo(
    () => templates.find((t) => t.is_default) ?? templates[0],
    [templates]
  );

  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState<string | "custom">(
    defaultTemplate?.id ?? "custom"
  );
  const [customPrompt, setCustomPrompt] = useState("");
  const [concurrency, setConcurrency] = useState(5);
  const [delayMs, setDelayMs] = useState(1000);
  const [sheetId, setSheetId] = useState("");

  // If /scrape → "Push to Campaign" stashed a payload, auto-populate step 2.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.sessionStorage.getItem(PENDING_SCRAPE_KEY);
    if (!raw) return;
    window.sessionStorage.removeItem(PENDING_SCRAPE_KEY);
    try {
      const payload = JSON.parse(raw) as PendingScrapePayload;
      const parsed = parseCsv(payload.csv);
      if (parsed.leads.length === 0) {
        setParseErr("Pushed scrape had no rows after parsing.");
        return;
      }
      setResult(parsed);
      setScrapeSource(payload.sourceLabel);
      setName(payload.agentName?.trim() || payload.sourceLabel);
      setStep(2);
    } catch (err) {
      setParseErr(
        err instanceof Error ? err.message : "Failed to load pushed scrape."
      );
    }
  }, []);

  const onDrop = useCallback(async (accepted: File[]) => {
    const f = accepted[0];
    if (!f) return;
    setFile(f);
    setScrapeSource(null); // uploading a file overrides a previously-pushed scrape
    setResult(null);
    setParseErr(null);
    try {
      const parsed = await parseFile(f);
      setResult(parsed);
      if (!name) {
        const stem = f.name.replace(/\.(csv|json)$/i, "");
        setName(stem);
      }
    } catch (err) {
      setParseErr(err instanceof Error ? err.message : "Could not parse file.");
    }
  }, [name]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "text/csv": [".csv"],
      "application/json": [".json"],
    },
    multiple: false,
  });

  const canProceedStep1 = result && result.leads.length > 0;
  const canProceedStep2 =
    name.trim().length > 0 &&
    (templateId !== "custom" || customPrompt.trim().length > 0);

  // Server-action redirects throw with a digest like "NEXT_REDIRECT;..." —
  // re-raise those so Next.js can navigate; absorb everything else into a
  // visible banner. Without this, createCampaign failures (10 MB body
  // limit, RLS, network blips) used to disappear silently and look like
  // the platform had crashed.
  function isRedirect(err: unknown): boolean {
    return (
      typeof err === "object" &&
      err !== null &&
      "digest" in err &&
      typeof (err as { digest: unknown }).digest === "string" &&
      (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
    );
  }

  function onCreate() {
    if (!result) return;
    setCreateErr(null);
    startTransition(async () => {
      try {
        await createCampaign({
          name: name.trim(),
          source_filename: file?.name ?? scrapeSource ?? null,
          prompt_template_id: templateId === "custom" ? null : templateId,
          system_prompt_override:
            templateId === "custom" ? customPrompt.trim() : null,
          concurrency,
          delay_ms: delayMs,
          google_sheet_id: sheetId.trim() || null,
          leads: result.leads as ParsedLead[],
        });
      } catch (err) {
        if (isRedirect(err)) throw err;
        setCreateErr(
          err instanceof Error
            ? err.message
            : "Failed to create campaign. Check your file size or retry."
        );
      }
    });
  }

  return (
    <div className="space-y-6">
      <Stepper step={step} />

      {step === 1 ? (
        <Card className="bg-card/40">
          <CardHeader>
            <CardTitle className="text-base">Upload lead list</CardTitle>
            <CardDescription>
              CSV or JSON. We pass through the first 9 columns
              (defaultProfileUrl → location) and let the agent fill the rest.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              {...getRootProps()}
              className={cn(
                "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center transition-colors cursor-pointer",
                isDragActive
                  ? "border-primary/60 bg-primary/10"
                  : "border-border/70 bg-background/40 hover:border-primary/40 hover:bg-primary/5"
              )}
            >
              <input {...getInputProps()} />
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/25">
                {file ? (
                  <FileCheck2 className="h-5 w-5 text-primary" />
                ) : (
                  <Upload className="h-5 w-5 text-primary" />
                )}
              </div>
              {file ? (
                <div>
                  <div className="font-medium">{file.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB
                  </div>
                </div>
              ) : (
                <>
                  <div className="font-medium">
                    Drop a file or click to browse
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Accepts .csv and .json
                  </div>
                </>
              )}
            </div>

            {scrapeSource && result ? (
              <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-primary">
                Using {result.leads.length} leads pushed from{" "}
                <span className="font-mono">{scrapeSource}</span>. Drop a file
                above to replace.
              </div>
            ) : null}

            {parseErr ? (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{parseErr}</span>
              </div>
            ) : null}

            {result ? <ParsePreview result={result} /> : null}

            <div className="flex justify-end">
              <Button
                onClick={() => setStep(2)}
                disabled={!canProceedStep1}
                className="gap-2"
              >
                Next
                <Settings2 className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card className="bg-card/40">
          <CardHeader>
            <CardTitle className="text-base">Configure the run</CardTitle>
            <CardDescription>
              Pick a prompt template or supply an ad-hoc system prompt. The
              snapshot is frozen when the campaign is created.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="name">Campaign name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. ICLR26 attendees — April batch"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Prompt template</Label>
                <Select
                  value={templateId}
                  onValueChange={(v) => setTemplateId(v as string)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a template" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                        {t.is_default ? " (default)" : ""}
                      </SelectItem>
                    ))}
                    <SelectItem value="custom">Custom (ad-hoc)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Concurrency</Label>
                <Select
                  value={String(concurrency)}
                  onValueChange={(v) => setConcurrency(Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 3, 5, 8, 10, 15].map((c) => (
                      <SelectItem key={c} value={String(c)}>
                        {c} parallel
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label>
                  Delay between calls
                  <span className="ml-2 text-xs text-muted-foreground">
                    keeps you under Groq&apos;s 250k TPM rate limit
                  </span>
                </Label>
                <Select
                  value={String(delayMs)}
                  onValueChange={(v) => setDelayMs(Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">No delay</SelectItem>
                    <SelectItem value="500">500 ms</SelectItem>
                    <SelectItem value="1000">1000 ms (recommended)</SelectItem>
                    <SelectItem value="2000">2000 ms</SelectItem>
                    <SelectItem value="5000">5000 ms</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {templateId === "custom" ? (
              <div className="space-y-1.5">
                <Label htmlFor="custom">Ad-hoc system prompt</Label>
                <Textarea
                  id="custom"
                  rows={8}
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="Describe the ICP and the strict JSON schema the agent must return…"
                />
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="sheet">Google Sheet ID (optional)</Label>
              <Input
                id="sheet"
                value={sheetId}
                onChange={(e) => setSheetId(e.target.value)}
                placeholder="Paste the ID between /d/ and /edit in the Sheets URL"
              />
            </div>

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button
                onClick={() => setStep(3)}
                disabled={!canProceedStep2}
                className="gap-2"
              >
                Review
                <Rocket className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 3 ? (
        <Card className="bg-card/40">
          <CardHeader>
            <CardTitle className="text-base">Review and launch</CardTitle>
            <CardDescription>
              Campaign is created as <em>pending</em>. You&apos;ll start the
              actual Groq run from the campaign page once your key is connected.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <Summary label="Name" value={name} />
            <Summary
              label="Source"
              value={`${file?.name ?? scrapeSource ?? "—"} · ${result?.leads.length ?? 0} leads`}
            />
            <Summary
              label="Prompt"
              value={
                templateId === "custom"
                  ? "Custom (ad-hoc)"
                  : templates.find((t) => t.id === templateId)?.name ?? "—"
              }
            />
            <Summary label="Concurrency" value={`${concurrency} parallel`} />
            <Summary
              label="Delay between calls"
              value={delayMs === 0 ? "No delay" : `${delayMs} ms`}
            />
            <Summary
              label="Google Sheet"
              value={sheetId || "— (CSV download only)"}
            />

            <Separator className="my-2" />

            {createErr ? (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="break-words">{createErr}</span>
              </div>
            ) : null}

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button onClick={onCreate} disabled={pending} className="gap-2">
                {pending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creating…
                  </>
                ) : (
                  <>
                    <Rocket className="h-4 w-4" />
                    Create campaign
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  const steps = ["Upload", "Configure", "Review"];
  return (
    <ol className="flex items-center gap-2 text-xs text-muted-foreground">
      {steps.map((label, i) => {
        const n = i + 1;
        const active = step === n;
        const done = step > n;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-medium",
                active
                  ? "bg-primary text-primary-foreground ring-2 ring-primary/30"
                  : done
                    ? "bg-primary/20 text-primary"
                    : "bg-muted text-muted-foreground"
              )}
            >
              {n}
            </span>
            <span className={active ? "text-foreground" : ""}>{label}</span>
            {n < steps.length ? (
              <span className="h-px w-8 bg-border" aria-hidden />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function ParsePreview({ result }: { result: ParseResult }) {
  const { leads, detectedColumns, missingColumns, duplicatesSkipped } = result;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge
          variant="outline"
          className="border-primary/40 bg-primary/10 text-primary"
        >
          {leads.length} leads parsed
        </Badge>
        <Badge variant="outline" className="text-muted-foreground">
          {detectedColumns.length} columns detected
        </Badge>
        {duplicatesSkipped > 0 ? (
          <Badge
            variant="outline"
            className="border-yellow-500/40 bg-yellow-500/10 text-yellow-400"
          >
            {duplicatesSkipped} duplicate{duplicatesSkipped === 1 ? "" : "s"}{" "}
            skipped
          </Badge>
        ) : null}
        {missingColumns.length > 0 ? (
          <Badge
            variant="outline"
            className="border-yellow-500/40 bg-yellow-500/10 text-yellow-400"
          >
            {missingColumns.length} unmapped input columns
          </Badge>
        ) : null}
      </div>

      {missingColumns.length > 0 ? (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-xs text-yellow-200">
          Couldn&apos;t map:{" "}
          <code className="font-mono">{missingColumns.join(", ")}</code>. These
          cells will be blank in the output.
        </div>
      ) : null}

      {leads.length > 0 ? (
        <div className="rounded-md border border-border bg-background/40 px-4 py-3 text-xs">
          <div className="mb-2 text-muted-foreground">First 3 rows:</div>
          <ul className="space-y-2">
            {leads.slice(0, 3).map((l, i) => (
              <li key={i} className="truncate">
                <span className="text-foreground">
                  {l.full_name ?? "—"}
                </span>{" "}
                <span className="text-muted-foreground">
                  · {l.title ?? "—"} @ {l.company_name ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right text-foreground max-w-[60%] truncate">
        {value}
      </span>
    </div>
  );
}
