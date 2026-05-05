import { z } from "zod";

// Agent output schema — mirrors the agent-produced columns on the leads
// table. Nullable fields follow the short-circuit behavior where
// function_qualification = "NO" causes downstream fields to be dropped.
//
// icp_qualification is intentionally a free string (not YES/NO) — the
// production prompt treats ICP fit as a category like "Influencer",
// "Decision Maker", "Champion", "Champion-User", etc. Old YES/NO values
// remain valid strings.
export const AgentOutputSchema = z.object({
  full_name: z.string().optional().nullable(),
  function_qualification: z.enum(["YES", "NO"]),
  // function_reasoning + lead_summary are nominally required by the prompt
  // contract, but gpt-oss-120b occasionally omits them on terse "NO"
  // responses. DB columns are nullable; mirror that here so a missing
  // field becomes a null cell instead of a dropped lead.
  function_reasoning: z.string().min(1).optional().nullable(),
  icp_qualification: z.string().optional().nullable(),
  seniority_scoring: z
    .union([z.number(), z.string().transform((s) => Number(s))])
    .pipe(z.number().int().min(1).max(5))
    .optional()
    .nullable(),
  domain_classification: z.string().optional().nullable(),
  subdomain: z.string().optional().nullable(),
  subdomain_justification: z.string().optional().nullable(),
  domain_reasoning: z.string().optional().nullable(),
  priority_level: z.string().optional().nullable(),
  product_area: z.string().optional().nullable(),
  lead_summary: z.string().min(1).optional().nullable(),
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

// Maps any naming variant (lowercase, stripped of spaces/underscores/
// hyphens/slashes) back to the canonical snake_case field name.
const CANONICAL_KEYS: Record<string, string> = {
  fullname: "full_name",
  name: "full_name",
  functionqualification: "function_qualification",
  functionqualified: "function_qualification",
  qualified: "function_qualification",
  qualification: "function_qualification",
  functionreasoning: "function_reasoning",
  reasoning: "function_reasoning",
  reason: "function_reasoning",
  rationale: "function_reasoning",
  icpqualification: "icp_qualification",
  icpqualified: "icp_qualification",
  icp: "icp_qualification",
  icpfit: "icp_qualification",
  seniorityscoring: "seniority_scoring",
  seniorityscore: "seniority_scoring",
  seniority: "seniority_scoring",
  domainclassification: "domain_classification",
  domain: "domain_classification",
  subdomain: "subdomain",
  subdomainjustification: "subdomain_justification",
  subdomainreasoning: "subdomain_justification",
  domainreasoning: "domain_reasoning",
  domainjustification: "domain_reasoning",
  prioritylevel: "priority_level",
  priority: "priority_level",
  productarea: "product_area",
  productareateam: "product_area",
  productareaslashteam: "product_area",
  team: "product_area",
  company: "product_area",
  leadsummary: "lead_summary",
  summary: "lead_summary",
};

function canonicalKey(k: string): string {
  return k
    .toLowerCase()
    .replace(/[\s_\-\/]+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Best-effort shape recovery before strict Zod validation.
 *
 * Handles the common failure modes on gpt-oss-120b output:
 * 1. Different key casings ("Function Qualification", "functionQualification")
 * 2. Nested wrappers ({"response": {...}}, {"result": {...}})
 * 3. YES/NO values in wrong case ("Yes", "yes", "true", "Y")
 * 4. Seniority returned as string ("4" vs 4) — handled downstream by Zod union
 */
export function normalizeAgentOutput(raw: unknown): Record<string, unknown> {
  let obj = raw;

  // 1. Unwrap nested containers (models sometimes wrap output).
  const wrapperKeys = ["response", "result", "output", "data", "qualification"];
  for (let i = 0; i < 3; i++) {
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      const keys = Object.keys(obj);
      if (
        keys.length === 1 &&
        wrapperKeys.includes(keys[0].toLowerCase()) &&
        obj[keys[0] as keyof typeof obj] &&
        typeof obj[keys[0] as keyof typeof obj] === "object"
      ) {
        obj = (obj as Record<string, unknown>)[keys[0]];
        continue;
      }
    }
    break;
  }

  if (!obj || typeof obj !== "object") return {};

  // 2. Remap keys to snake_case canonical names.
  const normalized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const canonical = CANONICAL_KEYS[canonicalKey(k)] ?? k;
    // First writer wins for any given canonical key.
    if (normalized[canonical] === undefined) {
      normalized[canonical] = v;
    }
  }

  // 3. Array-to-string coercion for string fields. gpt-oss-120b sometimes
  // returns prose as an array of sentences (`["foo", "bar"]`) instead of a
  // joined string — observed in production on subdomain_justification and
  // similar fields. Join with spaces; drop empty/non-string entries.
  const STRING_FIELDS = [
    "full_name",
    "function_reasoning",
    "icp_qualification",
    "domain_classification",
    "subdomain",
    "subdomain_justification",
    "domain_reasoning",
    "priority_level",
    "product_area",
    "lead_summary",
  ] as const;
  for (const key of STRING_FIELDS) {
    const v = normalized[key];
    if (Array.isArray(v)) {
      const joined = v
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((x) => x.trim())
        .join(" ");
      normalized[key] = joined.length > 0 ? joined : null;
    }
  }

  // 4. Coerce function_qualification to strict YES/NO. icp_qualification
  // is a free string (categorical: "Influencer", "Decision Maker",
  // "Champion", etc.) and was already array-flattened above.
  normalized.function_qualification = coerceYesNo(
    normalized.function_qualification
  );

  // 5. Clamp seniority_scoring to the 1–5 range. The model occasionally
  // returns 0 (or strings/floats outside the band) when it's unsure;
  // out-of-range values become null rather than failing the whole lead.
  const rawSeniority = normalized.seniority_scoring;
  if (rawSeniority !== null && rawSeniority !== undefined) {
    const n = typeof rawSeniority === "number"
      ? rawSeniority
      : typeof rawSeniority === "string"
        ? Number(rawSeniority)
        : NaN;
    if (!Number.isFinite(n) || n < 1 || n > 5) {
      normalized.seniority_scoring = null;
    } else {
      normalized.seniority_scoring = Math.round(n);
    }
  }

  // 6. Trim whitespace-only strings to null so Zod ".nullable()" paths work.
  for (const key of [
    "priority_level",
    "product_area",
    "icp_qualification",
    "domain_classification",
    "subdomain",
    "subdomain_justification",
    "domain_reasoning",
  ] as const) {
    if (typeof normalized[key] === "string") {
      const t = (normalized[key] as string).trim();
      normalized[key] = t.length > 0 ? t : null;
    }
  }

  return normalized;
}

function coerceYesNo(v: unknown): "YES" | "NO" | null | undefined {
  if (v === null || v === undefined) return v as null | undefined;
  if (typeof v === "boolean") return v ? "YES" : "NO";
  if (typeof v === "string") {
    const u = v.trim().toUpperCase();
    if (["YES", "Y", "TRUE", "1", "QUALIFIED"].includes(u)) return "YES";
    if (["NO", "N", "FALSE", "0", "UNQUALIFIED", "NOT QUALIFIED"].includes(u))
      return "NO";
  }
  return undefined;
}
