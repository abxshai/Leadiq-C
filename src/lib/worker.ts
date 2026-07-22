import "server-only";
import OpenAI from "openai";
import pLimit from "p-limit";
import { createServiceSupabase } from "@/lib/supabase/service";
import { GROQ_BASE_URL } from "@/lib/groq-config";
import { createRateGate } from "@/lib/rate-gate";
import {
  AgentOutputSchema,
  cleanAgentPayload,
  normalizeAgentOutput,
  type AgentOutput,
} from "@/lib/agent-schema";

type LeadRow = {
  id: string;
  default_profile_url: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  title: string | null;
  summary: string | null;
  title_description: string | null;
  location: string | null;
};

type CampaignRow = {
  id: string;
  status: string;
  model: string;
  concurrency: number;
  delay_ms: number;
  system_prompt_snapshot: string;
};

// Tracks in-flight campaigns so we don't double-dispatch within one Node
// process. The Groq key lives ONLY inside this closure and is dropped when
// the promise resolves or rejects — never persisted, never logged.
const inflight = new Map<string, Promise<void>>();

export function isRunning(campaignId: string) {
  return inflight.has(campaignId);
}

export async function startCampaignRun(params: {
  campaignId: string;
  apiKey: string;
}) {
  const { campaignId, apiKey } = params;

  if (inflight.has(campaignId)) {
    return { started: false, reason: "already_running" as const };
  }

  const supabase = createServiceSupabase();

  // Atomic claim: only flip status if it's still pending/canceled/failed.
  // This is our lock — a second caller won't match this predicate and bails.
  const { data: claimed, error: claimErr } = await supabase
    .from("campaigns")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", campaignId)
    .in("status", ["pending", "failed", "canceled"])
    .select("id")
    .maybeSingle();

  if (claimErr) throw new Error(claimErr.message);
  if (!claimed) return { started: false, reason: "not_pending" as const };

  const run = execute({ campaignId, apiKey }).finally(() => {
    inflight.delete(campaignId);
  });
  inflight.set(campaignId, run);

  return { started: true as const };
}

async function execute({
  campaignId,
  apiKey,
}: {
  campaignId: string;
  apiKey: string;
}) {
  const supabase = createServiceSupabase();

  const { data: campaignData, error: cErr } = await supabase
    .from("campaigns")
    .select("id, status, model, concurrency, delay_ms, system_prompt_snapshot")
    .eq("id", campaignId)
    .single();

  if (cErr || !campaignData) {
    await markFailed(supabase, campaignId, cErr?.message ?? "Campaign missing");
    return;
  }
  const campaign = campaignData as CampaignRow;

  // Paginate through unfinished leads. PostgREST defaults to 1000 rows
  // per response, so the previous unbounded select silently capped at
  // 1000 — a 1950-lead campaign would finish "completed" with ~950 leads
  // sitting in pending, untouched. Loop until exhausted.
  //
  // Status set: 'pending' (never touched) + 'failed' (retry — transient
  // errors like cookie expiry / Groq 4xx / network blips often clear on
  // a second attempt; the success-path update overwrites the prior error
  // and llm_* fields in place).
  const PAGE_SIZE = 1000;
  const leadCols =
    "id, default_profile_url, full_name, first_name, last_name, company_name, title, summary, title_description, location";
  const leads: LeadRow[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("leads")
      .select(leadCols)
      .eq("campaign_id", campaignId)
      .in("status", ["pending", "failed"])
      .order("id", { ascending: true })
      .range(start, start + PAGE_SIZE - 1);
    if (error) {
      await markFailed(supabase, campaignId, error.message);
      return;
    }
    if (!data || data.length === 0) break;
    leads.push(...(data as LeadRow[]));
    if (data.length < PAGE_SIZE) break;
  }

  // Orphan-campaign guard. If there's nothing pending/failed AND the
  // campaign has zero rows in the leads table at all, it's an orphaned
  // shell — almost always from a createCampaign that crashed mid-import
  // and left the row behind with total_leads claiming N. Without this
  // check the post-run gate sees zero leftover and flips status to
  // "completed" against an empty campaign, which masks the real bug.
  // A genuinely re-run-after-completion campaign has leads.length === 0
  // here too, but its count(*) is > 0 — so we only fail loudly when both
  // are zero.
  if (leads.length === 0) {
    const { count: anyLeads, error: anyErr } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId);
    if (anyErr) {
      await markFailed(supabase, campaignId, anyErr.message);
      return;
    }
    if ((anyLeads ?? 0) === 0) {
      await markFailed(
        supabase,
        campaignId,
        "campaign has no lead rows — likely orphaned by a failed import. Delete and recreate."
      );
      return;
    }
  }

  const client = new OpenAI({ apiKey, baseURL: GROQ_BASE_URL });
  const limit = pLimit(Math.max(1, Math.min(20, campaign.concurrency)));
  const gate = createRateGate(Math.max(0, campaign.delay_ms ?? 0));
  let qualified = 0;
  let failed = 0;
  // Leads we touched but couldn't write back to (network blip mid-update,
  // RLS edge case). These end up still in 'pending' even though the
  // limit-callback resolved — tracked so the post-run gate flags it.
  let silentFailures = 0;

  try {
    await Promise.all(
      leads.map((lead) =>
        limit(async () => {
          await gate();
          const t0 = Date.now();
          try {
            const result = await qualifyLead({
              client,
              model: campaign.model,
              systemPrompt: campaign.system_prompt_snapshot,
              lead: lead as LeadRow,
            });
            await supabase
              .from("leads")
              .update({
                agent_full_name: result.output.full_name ?? null,
                function_qualification:
                  result.output.function_qualification ?? null,
                function_reasoning: result.output.function_reasoning ?? null,
                icp_qualification: result.output.icp_qualification ?? null,
                seniority_scoring: result.output.seniority_scoring ?? null,
                domain_classification:
                  result.output.domain_classification ?? null,
                subdomain: result.output.subdomain ?? null,
                subdomain_justification:
                  result.output.subdomain_justification ?? null,
                domain_reasoning: result.output.domain_reasoning ?? null,
                priority_level: result.output.priority_level ?? null,
                product_area: result.output.product_area ?? null,
                lead_summary: result.output.lead_summary ?? null,
                status: "processed",
                error: null,
                llm_prompt_tokens: result.usage?.prompt ?? null,
                llm_completion_tokens: result.usage?.completion ?? null,
                llm_latency_ms: Date.now() - t0,
                processed_at: new Date().toISOString(),
              })
              .eq("id", lead.id);
            // Anything that isn't an explicit "NO" counts as qualified —
            // categorical prompts ("Decision Maker" / "Influencer" / etc.)
            // need to increment qualified_count, not just literal "YES".
            const fq = result.output.function_qualification;
            if (fq != null && fq.trim().toUpperCase() !== "NO") qualified += 1;
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            // Never include the API key in error messages.
            const safe = redact(msg);
            try {
              await supabase
                .from("leads")
                .update({
                  status: "failed",
                  error: safe,
                  llm_latency_ms: Date.now() - t0,
                  processed_at: new Date().toISOString(),
                })
                .eq("id", lead.id);
              failed += 1;
            } catch (writeErr) {
              silentFailures += 1;
              console.error(
                `[worker] silent-failure update on lead ${lead.id}:`,
                writeErr
              );
            }
          }
        })
      )
    );

    // Post-run gate: count leads still pending or running. If non-zero, the
    // run did NOT actually finish — flip status to 'failed' with a clear
    // reason instead of misreporting 'completed'. Catches both the silent
    // update failures above and any future "looked done but wasn't" bug.
    const { count: leftover, error: leftoverErr } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .in("status", ["pending", "running"]);

    if (leftoverErr) {
      await markFailed(
        supabase,
        campaignId,
        `post-run leftover check failed: ${leftoverErr.message}`
      );
      return;
    }

    if ((leftover ?? 0) > 0) {
      const reason = silentFailures
        ? `partial run: ${leftover} leads still pending (${silentFailures} silent update failures)`
        : `partial run: ${leftover} leads still pending`;
      await supabase
        .from("campaigns")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          qualified_count: qualified,
          failed_count: failed,
        })
        .eq("id", campaignId);
      console.error(`[worker] campaign ${campaignId} ${reason}`);
      return;
    }

    await supabase
      .from("campaigns")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        qualified_count: qualified,
        failed_count: failed,
      })
      .eq("id", campaignId);

    // Refresh the /leads deduped snapshot now that this run's leads are
    // processed + classified. SOFT-FAIL: a stale snapshot must never turn a
    // successful run into a failure. Awaited so the snapshot is fresh by the
    // time anyone navigates to /leads.
    await refreshDistinctLeadsSoft(supabase);
  } catch (err) {
    await markFailed(
      supabase,
      campaignId,
      redact(err instanceof Error ? err.message : "Worker crashed")
    );
  }
}

async function qualifyLead(args: {
  client: OpenAI;
  model: string;
  systemPrompt: string;
  lead: LeadRow;
}): Promise<{
  output: AgentOutput;
  usage: { prompt?: number; completion?: number } | null;
}> {
  const { client, model, systemPrompt, lead } = args;

  const userPayload = {
    defaultProfileUrl: lead.default_profile_url,
    fullName: lead.full_name,
    firstName: lead.first_name,
    lastName: lead.last_name,
    companyName: lead.company_name,
    title: lead.title,
    summary: lead.summary,
    titleDescription: lead.title_description,
    location: lead.location,
  };

  const baseMessages = [
    { role: "system" as const, content: systemPrompt },
    {
      role: "user" as const,
      content: `Qualify this LinkedIn profile. Return ONLY the JSON object described in the system prompt.\n\n${JSON.stringify(userPayload, null, 2)}`,
    },
  ];

  // First attempt — strict JSON mode. Two failure modes funnel into the
  // same retry path:
  //  1. Call returns 200, but the body fails Zod (schema drift).
  //  2. Groq's JSON-mode parser rejects the model output server-side and
  //     returns HTTP 400 with `failed_generation` holding the malformed
  //     text. This never produces a parseable string, so the Zod path
  //     below can't see it — we have to catch it here.
  let firstText = "";
  let firstPromptTokens = 0;
  let firstCompletionTokens = 0;
  let correctionPrompt: string;

  try {
    const first = await client.chat.completions.create({
      model,
      temperature: 0,
      max_tokens: 4096,
      response_format: { type: "json_object" },
      messages: baseMessages,
    });
    firstText = first.choices[0]?.message?.content ?? "";
    firstPromptTokens = first.usage?.prompt_tokens ?? 0;
    firstCompletionTokens = first.usage?.completion_tokens ?? 0;

    const firstParsed = tryParseAndValidate(firstText);
    if (firstParsed.ok) {
      return {
        output: firstParsed.value,
        usage: { prompt: firstPromptTokens, completion: firstCompletionTokens },
      };
    }
    correctionPrompt = `Your previous response did not match the schema: ${firstParsed.error}. Return ONLY a valid JSON object that matches the schema. No markdown, no prose outside JSON.`;
  } catch (err) {
    const failedGen = extractFailedGeneration(err);
    if (!failedGen) throw err;
    firstText = failedGen;
    correctionPrompt =
      "Your previous response was not valid JSON and the parser rejected it. Return ONLY a single JSON object matching the schema. No markdown fences, no prose outside JSON, no trailing text, all strings properly escaped.";
  }

  // Retry runs at non-zero temperature on purpose: with temp=0 on both
  // calls the model often regenerates the same malformed output (the
  // conversation prefix is near-identical), so the retry inherits the
  // deterministic failure. A small bump gives just enough variance to
  // escape that trap without making the schema creative.
  const retry = await client.chat.completions.create({
    model,
    temperature: 0.3,
    max_tokens: 4096,
    response_format: { type: "json_object" },
    messages: [
      ...baseMessages,
      { role: "assistant" as const, content: firstText },
      { role: "user" as const, content: correctionPrompt },
    ],
  });

  const retryText = retry.choices[0]?.message?.content ?? "";
  const retryParsed = tryParseAndValidate(retryText);
  if (retryParsed.ok) {
    return {
      output: retryParsed.value,
      usage: {
        prompt: firstPromptTokens + (retry.usage?.prompt_tokens ?? 0),
        completion:
          firstCompletionTokens + (retry.usage?.completion_tokens ?? 0),
      },
    };
  }

  throw new Error(`Invalid agent output after retry: ${retryParsed.error}`);
}

function extractFailedGeneration(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  // Only the JSON-mode 400 carries `failed_generation`. Gate on status to
  // avoid retrying on unrelated 4xx/5xx that happen to share a field name.
  // OpenAI SDK BadRequestError exposes the response body on `.error`; Groq
  // wraps its API error under `body.error`, so the field can sit at either
  // depth depending on SDK version / future changes — try both.
  const e = err as {
    status?: unknown;
    error?: {
      error?: { failed_generation?: unknown };
      failed_generation?: unknown;
    };
  };
  if (e.status !== 400) return null;
  const candidates = [
    e.error?.error?.failed_generation,
    e.error?.failed_generation,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  return null;
}

function tryParseAndValidate(
  text: string
): { ok: true; value: AgentOutput } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // Some models wrap JSON in ```json ... ``` even under json mode. Strip.
    const stripped = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    try {
      json = JSON.parse(stripped);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "JSON parse failed",
      };
    }
  }

  const cleaned = cleanAgentPayload(json);
  const normalized = normalizeAgentOutput(cleaned);
  const result = AgentOutputSchema.safeParse(normalized);
  if (!result.success) {
    return {
      ok: false,
      error: result.error.issues
        .map((i) => `${i.path.join(".")} ${i.message}`)
        .join("; "),
    };
  }
  return { ok: true, value: result.data };
}

/**
 * Refresh the /leads deduped snapshot (public.distinct_leads materialized view,
 * migration 0017). SOFT-FAIL by design: a snapshot-refresh problem is
 * enrichment plumbing and must never cascade into a campaign being marked
 * failed. Concurrent refresh, so /leads reads are never blocked while it runs.
 */
async function refreshDistinctLeadsSoft(
  supabase: ReturnType<typeof createServiceSupabase>
) {
  try {
    const { error } = await supabase.rpc("refresh_distinct_leads");
    if (error) {
      console.error("[worker] refresh_distinct_leads failed:", error.message);
    }
  } catch (err) {
    console.error(
      "[worker] refresh_distinct_leads threw:",
      err instanceof Error ? err.message : err
    );
  }
}

async function markFailed(
  supabase: ReturnType<typeof createServiceSupabase>,
  campaignId: string,
  message: string
) {
  await supabase
    .from("campaigns")
    .update({
      status: "failed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", campaignId);
  console.error(`[worker] campaign ${campaignId} failed:`, message);
}

/**
 * Defense-in-depth: scrub anything that looks like a Groq API key from
 * outbound error strings. We never put keys into errors deliberately, but
 * OpenAI SDK error messages can echo back Authorization headers.
 */
function redact(s: string): string {
  return s.replace(/gsk_[A-Za-z0-9_-]{10,}/g, "gsk_********");
}
