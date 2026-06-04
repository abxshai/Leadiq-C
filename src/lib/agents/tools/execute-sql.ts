import "server-only";
import { z } from "zod";
import { getPgPool, QUERYABLE_SCHEMAS } from "@/lib/agents/pg-pool";
import type { Tool } from "./types";

// public first so unqualified names (leads, campaigns) keep resolving to the
// app's own tables; crm second for the ingest tables. Schema-qualified names
// (crm.gtm_contact_data) work regardless of search_path.
const SEARCH_PATH = QUERYABLE_SCHEMAS.join(", ");

const MAX_ROWS = 50;
const STATEMENT_TIMEOUT_MS = 10_000;

// Allowlist the first SQL keyword. The transaction is the actual safety
// boundary (SET LOCAL transaction read only), but rejecting obvious
// non-reads early gives clearer errors back to the LLM.
const READ_ONLY_PREFIX_RE = /^\s*(?:--[^\n]*\n|\s)*(SELECT|EXPLAIN|WITH)\b/i;

const schema = z.object({
  query: z
    .string()
    .min(1)
    .max(10_000)
    .describe(
      "A single SELECT, EXPLAIN, or WITH-SELECT statement. Read-only — INSERT/UPDATE/DELETE/DDL will be rejected by Postgres."
    ),
});

export const executeSqlTool: Tool<typeof schema> = {
  name: "execute_sql",
  description: [
    "Run a read-only SQL query against the Lead-IQ Postgres database.",
    "Covers the public schema (campaigns, leads, …) and the crm schema (HubSpot/Smartlead ingest: gtm_company_data, gtm_contact_data, gtm_deal_data, smartlead_email_stats).",
    "search_path is public,crm — qualify crm tables as crm.<table> to avoid ambiguity.",
    "Allowed: SELECT, EXPLAIN, WITH ... SELECT.",
    "Forbidden: INSERT, UPDATE, DELETE, DROP, ALTER, or any other write/DDL.",
    `Result is capped at ${MAX_ROWS} rows; statement timeout is ${
      STATEMENT_TIMEOUT_MS / 1000
    }s.`,
    "Use list_tables and get_table_schema first if you need to discover the schema.",
  ].join(" "),
  schema,
  async handler({ query }) {
    if (!READ_ONLY_PREFIX_RE.test(query)) {
      return {
        ok: false,
        error:
          "Query must start with SELECT, EXPLAIN, or WITH. Other statements are rejected before reaching the database.",
      };
    }

    const sql = getPgPool();
    try {
      const rows = await sql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL transaction read only");
        await tx.unsafe(
          `SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`
        );
        await tx.unsafe(`SET LOCAL search_path = ${SEARCH_PATH}`);
        return await tx.unsafe(query);
      });

      const result = Array.from(rows ?? []) as Record<string, unknown>[];
      const truncated = result.length > MAX_ROWS;

      return {
        ok: true,
        data: {
          rows: result.slice(0, MAX_ROWS),
          rowCount: result.length,
        },
        truncated,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  },
};
