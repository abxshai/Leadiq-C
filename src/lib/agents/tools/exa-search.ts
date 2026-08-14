import "server-only";
import { z } from "zod";
import type { Tool } from "./types";

// Signal-based web sourcing for the LeadQuery agent via Exa's semantic search.
// Lets the agent find companies + people matching a signal ("AI infra startups
// that raised a Series A this year", "VPs of Data at Series B fintechs") to seed
// a lead list, which it then qualifies + ICP-segments in the same turn. Web
// results are thinner/less reliable than a LinkedIn scrape — the agent should
// treat them as candidates and say so.

const EXA_API = "https://api.exa.ai/search";
const MAX_RESULTS = 25;
const SNIPPET_CHARS = 600;

const schema = z.object({
  query: z
    .string()
    .min(1)
    .max(1000)
    .describe(
      "Natural-language search describing the signal + who you want. Be specific about role, industry, geography, and the signal (funding, launch, hiring, etc.)."
    ),
  category: z
    .enum([
      "company",
      "people",
      "news",
      "publication",
      "financial report",
      "personal site",
    ])
    .optional()
    .describe(
      "Bias results to an entity type. Use 'company' to source accounts, 'people' to source individual contacts, 'news' for the signal itself."
    ),
  numResults: z
    .number()
    .int()
    .min(1)
    .max(MAX_RESULTS)
    .optional()
    .describe(`How many results (max ${MAX_RESULTS}, default 10).`),
});

type ExaResult = {
  id?: string;
  url?: string;
  title?: string;
  publishedDate?: string;
  author?: string | null;
  text?: string;
  highlights?: string[];
  summary?: string;
};

export const exaSearchTool: Tool<typeof schema> = {
  name: "exa_search",
  description: [
    "Search the live web (Exa semantic search) to source signal-based leads —",
    "companies (category='company') or people (category='people') matching a",
    "signal you describe. Returns url, title, date, and a relevant snippet per",
    "result. Use it to seed a candidate list you then qualify + ICP-segment.",
    "Web-sourced data is thinner than a LinkedIn scrape — flag candidates as",
    "unverified. Requires a connected Exa key.",
  ].join(" "),
  schema,
  async handler({ query, category, numResults }, ctx) {
    if (!ctx.exaApiKey) {
      return {
        ok: false,
        error:
          "No Exa key connected. Ask the user to connect one via the Exa pill (top-right).",
      };
    }
    try {
      const res = await fetch(EXA_API, {
        method: "POST",
        headers: {
          "x-api-key": ctx.exaApiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query,
          type: "auto",
          ...(category ? { category } : {}),
          numResults: Math.min(numResults ?? 10, MAX_RESULTS),
          contents: {
            highlights: true,
            text: { maxCharacters: SNIPPET_CHARS },
          },
        }),
      });
      const text = await res.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      if (!res.ok) {
        const msg = typeof body === "string" ? body : JSON.stringify(body);
        return {
          ok: false,
          error: `Exa ${res.status}: ${msg.split(ctx.exaApiKey).join("<exa-key>")}`,
        };
      }
      const results = ((body as { results?: ExaResult[] }).results ?? []).map(
        (r) => ({
          url: r.url ?? null,
          title: r.title ?? null,
          publishedDate: r.publishedDate ?? null,
          author: r.author ?? null,
          snippet:
            (r.highlights && r.highlights.join(" … ")) ||
            (r.summary ?? "") ||
            (r.text ?? "").slice(0, SNIPPET_CHARS) ||
            null,
        })
      );
      return { ok: true, data: { query, category: category ?? "auto", results } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: `Exa request failed: ${msg.split(ctx.exaApiKey).join("<exa-key>")}`,
      };
    }
  },
};
