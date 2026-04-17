import { z } from "zod";

// Agent output schema — mirrors the 8 agent-produced columns in
// "Lead data format.csv" (cols 10-17). Nullable fields follow the
// observed short-circuit behavior where function_qualification = "NO"
// causes downstream ICP / priority fields to be dropped.
export const AgentOutputSchema = z.object({
  full_name: z.string().optional().nullable(),
  function_qualification: z.enum(["YES", "NO"]),
  function_reasoning: z.string().min(1),
  icp_qualification: z.enum(["YES", "NO"]).optional().nullable(),
  seniority_scoring: z
    .union([z.number(), z.string().transform((s) => Number(s))])
    .pipe(z.number().int().min(1).max(5))
    .optional()
    .nullable(),
  priority_level: z.string().optional().nullable(),
  product_area: z.string().optional().nullable(),
  lead_summary: z.string().min(1),
});

export type AgentOutput = z.infer<typeof AgentOutputSchema>;

/**
 * Cleans trailing literal "\n" escape sequences that some models emit
 * in long prose. This is a safety net — with JSON mode enabled on Groq
 * the string is already proper, but we normalize just in case.
 */
export function cleanAgentPayload<T>(raw: T): T {
  if (typeof raw === "string") {
    return raw.replace(/\\n/g, "\n") as T;
  }
  if (Array.isArray(raw)) {
    return raw.map((v) => cleanAgentPayload(v)) as T;
  }
  if (raw && typeof raw === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      out[k] = cleanAgentPayload(v);
    }
    return out as T;
  }
  return raw;
}
