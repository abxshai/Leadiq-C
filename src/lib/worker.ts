import "server-only";
import OpenAI from "openai";
import pLimit from "p-limit";
import { createServiceSupabase } from "@/lib/supabase/service";
import { GROQ_BASE_URL } from "@/lib/groq-config";
import { createRateGate } from "@/lib/rate-gate";
import {
  AgentOutputSchema,
  cleanAgentPayload,
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

  const { data: leads, error: lErr } = await supabase
    .from("leads")
    .select(
      "id, default_profile_url, full_name, first_name, last_name, company_name, title, summary, title_description, location"
    )
    .eq("campaign_id", campaignId)
    .eq("status", "pending");

  if (lErr) {
    await markFailed(supabase, campaignId, lErr.message);
    return;
  }

  const client = new OpenAI({ apiKey, baseURL: GROQ_BASE_URL });
  const limit = pLimit(Math.max(1, Math.min(20, campaign.concurrency)));
  const gate = createRateGate(Math.max(0, campaign.delay_ms ?? 0));
  let qualified = 0;
  let failed = 0;

  try {
    await Promise.all(
      (leads ?? []).map((lead) =>
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
                function_qualification: result.output.function_qualification,
                function_reasoning: result.output.function_reasoning,
                icp_qualification: result.output.icp_qualification ?? null,
                seniority_scoring: result.output.seniority_scoring ?? null,
                priority_level: result.output.priority_level ?? null,
                product_area: result.output.product_area ?? null,
                lead_summary: result.output.lead_summary,
                status: "processed",
                error: null,
                llm_prompt_tokens: result.usage?.prompt ?? null,
                llm_completion_tokens: result.usage?.completion ?? null,
                llm_latency_ms: Date.now() - t0,
                processed_at: new Date().toISOString(),
              })
              .eq("id", lead.id);
            if (result.output.function_qualification === "YES") qualified += 1;
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            // Never include the API key in error messages.
            const safe = redact(msg);
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
          }
        })
      )
    );

    await supabase
      .from("campaigns")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        qualified_count: qualified,
        failed_count: failed,
      })
      .eq("id", campaignId);
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

  // First attempt — strict JSON mode.
  const first = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: baseMessages,
  });

  const firstText = first.choices[0]?.message?.content ?? "";
  const firstParsed = tryParseAndValidate(firstText);
  if (firstParsed.ok) {
    return {
      output: firstParsed.value,
      usage: {
        prompt: first.usage?.prompt_tokens,
        completion: first.usage?.completion_tokens,
      },
    };
  }

  // Single retry with the validation error echoed back.
  const retry = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      ...baseMessages,
      { role: "assistant" as const, content: firstText },
      {
        role: "user" as const,
        content: `Your previous response did not match the schema: ${firstParsed.error}. Return ONLY a valid JSON object that matches the schema. No markdown, no prose outside JSON.`,
      },
    ],
  });

  const retryText = retry.choices[0]?.message?.content ?? "";
  const retryParsed = tryParseAndValidate(retryText);
  if (retryParsed.ok) {
    return {
      output: retryParsed.value,
      usage: {
        prompt:
          (first.usage?.prompt_tokens ?? 0) +
          (retry.usage?.prompt_tokens ?? 0),
        completion:
          (first.usage?.completion_tokens ?? 0) +
          (retry.usage?.completion_tokens ?? 0),
      },
    };
  }

  throw new Error(`Invalid agent output after retry: ${retryParsed.error}`);
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
  const result = AgentOutputSchema.safeParse(cleaned);
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
  // eslint-disable-next-line no-console
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
