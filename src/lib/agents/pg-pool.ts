import "server-only";
import postgres from "postgres";

// Postgres connection pool used by the LeadQuery agent's tools to run
// arbitrary SELECT queries under a read-only transaction. Read-only is
// enforced at the transaction level (SET LOCAL transaction read only),
// not via separate role/grants — defense-in-depth via SQL parsing happens
// upstream in execute-sql.ts.
//
// Required env: SUPABASE_DB_URL — get from Supabase dashboard →
// Project Settings → Database → Connection string. Use the "Transaction"
// pooler (port 6543) for serverless / short-lived; the "Session" pooler
// (port 5432) is fine for Railway's persistent process either way.
//
// Never share this pool outside tool handlers — the transaction wrapping
// inside the handlers is the safety boundary.

let _sql: ReturnType<typeof postgres> | null = null;

export function getPgPool() {
  if (_sql) return _sql;

  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    throw new Error(
      "SUPABASE_DB_URL is not set. The LeadQuery agent's tools need a " +
        "direct Postgres connection. Add it from Supabase dashboard → " +
        "Project Settings → Database → Connection string."
    );
  }

  _sql = postgres(url, {
    max: 5,
    idle_timeout: 30,
    connect_timeout: 10,
    prepare: false, // Supabase pooler in transaction mode (port 6543) doesn't support prepared statements
  });

  return _sql;
}
