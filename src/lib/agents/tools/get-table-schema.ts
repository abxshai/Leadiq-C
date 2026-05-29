import "server-only";
import { z } from "zod";
import { getPgPool } from "@/lib/agents/pg-pool";
import type { Tool } from "./types";

const schema = z.object({
  table_name: z
    .string()
    .min(1)
    .max(63)
    .describe(
      "Name of the table or view in the public schema (e.g. 'leads', 'campaigns', 'campaign_stats')."
    ),
});

export const getTableSchemaTool: Tool<typeof schema> = {
  name: "get_table_schema",
  description:
    "Get the column list for a table or view in the public schema — column name, data type, nullable, default. Useful before composing a SELECT against an unfamiliar table.",
  schema,
  async handler({ table_name }) {
    const sql = getPgPool();
    try {
      const rows = await sql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL transaction read only");
        return await tx`
          select
            column_name,
            data_type,
            is_nullable,
            column_default
          from information_schema.columns
          where table_schema = 'public' and table_name = ${table_name}
          order by ordinal_position
        `;
      });

      const columns = Array.from(rows ?? []) as Array<{
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }>;

      if (columns.length === 0) {
        return {
          ok: false,
          error: `Table 'public.${table_name}' not found. Use list_tables to see what's available.`,
        };
      }

      return { ok: true, data: { table_name, columns } };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  },
};
