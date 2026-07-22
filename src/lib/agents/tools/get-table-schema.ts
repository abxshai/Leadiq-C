import "server-only";
import { z } from "zod";
import { getPgPool, QUERYABLE_SCHEMAS } from "@/lib/agents/pg-pool";
import type { Tool } from "./types";

const schema = z.object({
  table_name: z
    .string()
    .min(1)
    .max(127)
    .describe(
      "Table or view name in the public schema (e.g. 'leads', 'campaigns', 'campaign_stats')."
    ),
});

export const getTableSchemaTool: Tool<typeof schema> = {
  name: "get_table_schema",
  description:
    "Get the column list for a table or view — column name, data type, nullable, default — in the public schema. Useful before composing a SELECT against an unfamiliar table.",
  schema,
  async handler({ table_name }) {
    // Accept an optional schema qualifier ("public.leads"). Split on the
    // first dot only; bare names fall back to scanning every queryable schema.
    const trimmed = table_name.trim();
    const dot = trimmed.indexOf(".");
    const reqSchema = dot >= 0 ? trimmed.slice(0, dot) : null;
    const bareName = dot >= 0 ? trimmed.slice(dot + 1) : trimmed;
    const schemas = reqSchema
      ? [reqSchema]
      : (QUERYABLE_SCHEMAS as unknown as string[]);

    const sql = getPgPool();
    try {
      const rows = await sql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL transaction read only");
        return await tx`
          select
            table_schema,
            column_name,
            data_type,
            is_nullable,
            column_default
          from information_schema.columns
          where table_schema = any(${schemas})
            and table_name = ${bareName}
          order by table_schema, ordinal_position
        `;
      });

      const columns = Array.from(rows ?? []) as Array<{
        table_schema: string;
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }>;

      if (columns.length === 0) {
        return {
          ok: false,
          error: `Table '${
            reqSchema ? `${reqSchema}.` : ""
          }${bareName}' not found in ${schemas.join(
            " / "
          )}. Use list_tables to see what's available.`,
        };
      }

      // Resolve which schema actually matched (a bare name could in principle
      // exist in more than one — report the schema alongside the columns).
      const matchedSchema = columns[0].table_schema;
      return {
        ok: true,
        data: {
          schema_name: matchedSchema,
          table_name: bareName,
          columns: columns.map((c) => ({
            column_name: c.column_name,
            data_type: c.data_type,
            is_nullable: c.is_nullable,
            column_default: c.column_default,
          })),
        },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  },
};
