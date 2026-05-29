import "server-only";
import { z } from "zod";
import { getPgPool } from "@/lib/agents/pg-pool";
import type { Tool } from "./types";

const schema = z.object({});

export const listTablesTool: Tool<typeof schema> = {
  name: "list_tables",
  description:
    "List all tables and views in the public schema with approximate row counts. Useful for discovering what's queryable.",
  schema,
  async handler() {
    const sql = getPgPool();
    try {
      const rows = await sql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL transaction read only");
        return await tx`
          select
            c.relname        as table_name,
            c.relkind        as kind,
            c.reltuples::bigint as approx_rows,
            c.relrowsecurity as rls_enabled
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relkind in ('r','v','m')
          order by c.relname
        `;
      });

      const tables = (Array.from(rows ?? []) as Array<{
        table_name: string;
        kind: string;
        approx_rows: bigint;
        rls_enabled: boolean;
      }>).map((r) => ({
        table_name: r.table_name,
        kind:
          r.kind === "r"
            ? "table"
            : r.kind === "v"
            ? "view"
            : r.kind === "m"
            ? "materialized_view"
            : r.kind,
        approx_rows: Number(r.approx_rows),
        rls_enabled: r.rls_enabled,
      }));

      return { ok: true, data: { tables } };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  },
};
