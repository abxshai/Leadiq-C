# Supabase — schema source of truth

This directory is the **complete, replayable database definition** for the
lead-qualifier. Point it at a brand-new Supabase project and you get a working
DB with zero manual SQL-editor archaeology.

## Files

| File | Role |
|---|---|
| **`init.sql`** | **Canonical fresh-start build.** One idempotent script — tables, indexes, views, functions, RLS, Data-API grants, seed templates. Run this once on a new project. This is the file to run when duplicating the app to a new database. |
| `migrations/00xx_*.sql` | **Historical migration chain** from the original Lead-IQ. Kept for reference/provenance. A fresh clone does **not** replay these — `init.sql` already reflects their end state (minus CRM). New schema changes go in a new `00xx_*.sql` here, applied on top of `init.sql`. |
| `rls.sql`, `schema.sql` | **Legacy** v0.1 partial snapshots, superseded by `init.sql`. Kept only so old references don't 404; do not run them. |
| `roles/crm_ingest.sql` | Reference for the external CRM ingest role (Lead-IQ only). **Not used by this clone** — see "CRM removed" below. |

## Build a new database

### Option A — SQL editor (fastest)
1. Create a new Supabase project.
2. Open **SQL Editor**, paste the contents of `init.sql`, run it.
3. Create the shared auth user (see `../DEPLOY.md` §6): **Authentication →
   Users → Add user**, email `team@lead-iq.local`, auto-confirm on.

### Option B — psql / CLI (scriptable)
```bash
psql "$SUPABASE_DB_URL" -f supabase/init.sql
```
> Do **not** `supabase db push` the `migrations/` chain onto a fresh clone — it
> includes CRM-dependent files (`0006`, `0009`, `0011`–`0016`) that reference
> the external `crm.*` tables and will fail on a CRM-less project. `init.sql` is
> the baseline. If you want a CLI-managed forward history, treat `init.sql` as
> migration `0001` in a fresh `migrations/` dir and add new changes after it.

## CRM removed

The original Lead-IQ cross-checked leads against a `crm` schema (HubSpot +
Smartlead data) synced by a **separate ingest service**. That schema's table
DDL lived in that service, never here — which is why replaying the raw
migration chain against a fresh DB failed (migrations `0006`, `0009`,
`0011`–`0014`, `0016` create views/functions over `crm.*` tables that don't
exist on a new project).

This clone drops all of it. `init.sql` contains **no `crm` schema** and none of
the CRM-dependent objects:

- functions: `classify_campaign_temperature`, `get_lead_reply_threads`,
  `list_opportunities`, `get_opportunity_thread`, `norm_linkedin`
- views: `crm.smartlead_reply_status`
- tables: `opportunity_summaries`, the entire `crm.*` set

The `leads.temperature` / `touchpoint_match` / `touchpoint_summary` columns are
kept as harmless always-NULL columns so the `distinct_leads` and
`campaign_stats` definitions are unchanged; nothing populates them.
