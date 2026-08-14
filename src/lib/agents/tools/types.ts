import type { z } from "zod";

// A Tool is a typed unit the LeadQuery agent (and future agents) can call
// via Groq function-calling. The Zod schema is enforced at the boundary;
// handlers receive parsed/typed args plus a context object for
// request-scoped resources.

export type ToolContext = {
  // Per-request resources. DB tools get their PG pool via the module-level
  // singleton; these are threaded in from the chat route per request.
  userId?: string;
  /** BYOK Exa API key for the exa_search tool. */
  exaApiKey?: string;
};

export type ToolResult =
  | {
      ok: true;
      data: unknown;
      truncated?: boolean;
    }
  | {
      ok: false;
      error: string;
    };

export interface Tool<Schema extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  schema: Schema;
  handler: (args: z.infer<Schema>, ctx: ToolContext) => Promise<ToolResult>;
}
