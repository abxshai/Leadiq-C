# Cloning Lead-IQ for a new use case

This is the **single source of truth for duplicating Lead-IQ** into a new
Railway + Supabase deployment for a different use case. Hand this file (plus the
repo) to Claude — or follow it by hand — and you get a clean, functional clone.

The clone is **Lead-IQ minus the CRM temperature feature** and minus the
Deccan-specific visual frills. Everything else — campaigns, the qualification
worker, prompt-template CRUD, the `/leads` cross-campaign browser, the LeadQuery
chat agent, Phantombuster fetch, CSV export, BYOK Groq — ships unchanged.

> **`main` is never touched.** This playbook produces the clone in a *separate*
> repo / branch / deploy. Do not run the destructive steps against the Lead-IQ
> production branch.

---

## 0. What's in vs. out

**Kept (the whole lean product):**
- Campaigns: create → run → export loop, resilient worker, rerun-failed
- Prompt templates: full CRUD + version history + snapshot-on-run
- `/leads`: cross-campaign browser, dedup (`distinct_leads` materialized view),
  server-side filters, cross-page selection, CSV export
- `/chat`: LeadQuery agent (NL → read-only SQL over the `public` schema)
- Phantombuster fetch → Push to Campaign
- Light/dark theme, BYOK Groq + Phantombuster (session-scoped)

**Removed — CRM temperature feature (needs the external `crm` schema):**
- Lead **temperature** (hot/warm/cold) classification + the `Temperature` column,
  filter chip, and per-campaign hot·warm·cold breakdown
- **Touchpoint history** + on-demand LLM **touchpoint summaries**
- **Reply-status** chip / **thread marker**
- The **`/opportunities`** surface
- The LeadQuery agent's access to the `crm.*` schema
- Everything that JOINs `crm.gtm_contact_data` / `crm.smartlead_email_stats` / etc.

  *Why:* the `crm` schema is populated by a **separate HubSpot/Smartlead ingest
  service** that the clone won't have. Its table DDL was never in this repo, so
  the CRM-dependent migrations (`0006`, `0009`, `0011`–`0016`) can't even apply
  to a fresh DB. The lean schema (`supabase/init.sql`) omits all of it.

**Removed — visual frills (keep it functional/generic):**
- The Deccan logo (`public/logowhite.png`) on the sidebar + login
- The animated ASCII login hero (`login-hero.tsx` + the `hero-stream` animation)

---

## 1. Two ways to start

The clone = Lead-IQ `main` **plus** the `0017` `/leads` materialized-view speedup
**minus** the CRM temperature feature **minus** the visual frills.

**Recommended — use the already-built branch.** `clone/lean-core` in this repo has
all of §2–§4 applied and is internally consistent. It's the fastest, safest path:
push that branch to a new repo, then go straight to §5 → §6 → §7. Sections §3–§4
below document *what* changed (for review, or a from-scratch rebuild) — you don't
have to re-do them if you start from the branch.

**From scratch (by hand).** Duplicate `main`, then apply §3 (CRM strip) and §4
(de-frill). One thing to fold in that is **not** on `main`: the `0017` `/leads`
speedup. `init.sql` builds `distinct_leads` as a **materialized** view, so the app
must refresh it after every write to a processed lead — otherwise `/leads` shows
stale data. The branch already has these `refresh_distinct_leads()` calls; when
rebuilding from `main`, add them:
- `src/lib/worker.ts` — a `refreshDistinctLeadsSoft(supabase)` helper (soft-fail
  `supabase.rpc("refresh_distinct_leads")`), called right after the run flips a
  campaign to `completed`.
- `src/app/(app)/campaigns/actions.ts` — the same `refresh_distinct_leads` rpc
  call at the end of `deleteCampaign`.

Either way, finish by renaming to taste (`package.json` `name`, page titles, the
`Lead-IQ` wordmark in `app-sidebar.tsx` + `login/page.tsx`, the metadata title in
`layout.tsx`, and the seed template ICP text in `supabase/init.sql`).

---

## 2. Database — one script, fresh Supabase project

1. Create a new Supabase project.
2. SQL Editor → paste **`supabase/init.sql`** (bundled in this repo) → run.
   It builds the entire lean schema from zero: tables, indexes, the
   `campaign_stats` + `distinct_leads` (materialized) views, `lead_filter_facets`
   + `refresh_distinct_leads` functions, RLS, Data-API grants, and the two seed
   prompt templates. Idempotent.
3. Auth → Users → **Add user**: email `team@lead-iq.local` (or your own), a strong
   password, **auto-confirm on**. This is the single shared login.

`supabase/init.sql` is the canonical build. The numbered `supabase/migrations/*`
files are the **original Lead-IQ history** (they reference the external `crm`
schema) — do **not** replay them on the clone. See `supabase/README.md`.

---

## 3. Remove the CRM temperature feature (code)

### 3a. Delete these files (they exist only for the CRM feature)

```
src/app/(app)/opportunities/page.tsx
src/app/api/opportunities/summarize/route.ts
src/app/api/campaigns/[id]/cross-check/route.ts
src/app/api/leads/[id]/summarize-touchpoints/route.ts
src/components/opportunities/opportunities-browser.tsx
src/components/opportunities/opportunity-card.tsx
src/components/opportunities/opportunity-summary.tsx
src/components/leads/touchpoint-summary.tsx
src/lib/touchpoint-thread.ts
src/lib/opportunity-filters.ts
```
(Remove the now-empty `opportunities/` dirs.)

### 3b. Edit these files (remove the CRM parts, keep the rest)

- **`src/components/leads/lead-display.tsx`** — the shared lead-cell module.
  Remove: the `Temperature`, `TouchpointMatch`, `TouchpointEvent`,
  `TouchpointSummaryData`, `ReplyStatus` types; the `temperature` /
  `touchpoint_match` / `touchpoint_summary` fields on the `Lead` type; the same
  three columns from the `LEAD_COLS` string; and the components/helpers
  `TemperatureBadge`, `ThreadMarker`, `TouchpointHistory`, `ReplyStatusChip`,
  `threadCountOf`, `hasTouchpoints`, `temperatureBadge`, `fmtDate`,
  `hubspotContactUrl`, `smartleadCampaignUrl`, and the HubSpot/Smartlead env
  consts. Drop the `hasTouchpoints(l)` clause from `hasLeadDetail`, and the
  touchpoint block from `DetailGrid`. **Keep** `FunctionVerdict`, `LeadStatus`,
  `hasLeadDetail`, `DetailGrid`, `LEAD_COLS`, the `Lead` type.
- **`src/components/campaign-detail.tsx`** — remove the `Thermometer`/`RefreshCw`
  icons, the `Temperature`/`TemperatureBadge`/`ThreadMarker` imports, the
  `crossChecking`/`tempFilter` state, the `onCrossCheck` fn, the
  `crossCheckable`/`tempCounts`/`anyTemperature`/`visibleLeads` derivations, the
  "Cross-check leads" button, the temperature filter chips, and the `Temp`
  column (header + cell). Map the table over `leads` (not `visibleLeads`); drop
  the detail-row `colSpan` by one (11 → 10).
- **`src/components/leads/leads-browser.tsx`** — remove the `TemperatureBadge`/
  `ThreadMarker` imports, the Temperature `MultiSelect` filter, the `Temp`
  column (header + cell), and decrement `EXPAND_COLSPAN` (12 → 11).
- **`src/lib/leads-filters.ts`** — remove the `temp: string[]` field from
  `LeadFilters`, its `EMPTY` entry, its `parse` block, the
  `q.in("temperature", …)` line in `applyLeadFilters`, and the
  `f.temp.length` term in `hasActiveFilters`.
- **`src/lib/worker.ts`** — remove the `classifyTemperatureSoft(...)` call before
  the "completed" flip and the `classifyTemperatureSoft` function itself.
  **Keep** `refreshDistinctLeadsSoft` (that's the `/leads` dedup snapshot, not CRM).
- **`src/app/(app)/campaigns/page.tsx`** — remove `hot_count`/`warm_count`/
  `cold_count` from the `Stats` type + `ZERO_STATS`, the `<TempStat…>` render,
  and the `TempStat` component.
- **`src/app/(app)/campaigns/[id]/page.tsx`** — the leads `.select(...)` string
  drops `temperature, touchpoint_match, touchpoint_summary` (or import and use
  `LEAD_COLS`).
- **`src/app/(app)/leads/page.tsx`** — drop the word "temperature" from the
  `PageHeader` description.
- **`src/app/api/leads/export.csv/route.ts`** and
  **`src/app/api/campaigns/[id]/export.csv/route.ts`** — remove the
  `"Temperature"` CSV column, the `temperature` field from `LeadExport`, and
  `temperature` from the select string + row mapping.
- **LeadQuery agent** (scope it to the `public` schema only):
  - `src/lib/agents/pg-pool.ts` — `QUERYABLE_SCHEMAS = ["public"]` (drop `"crm"`).
  - `src/lib/agents/leadquery-prompt.ts` — delete the `# CRM schema (crm.*)`
    section + the "Per-lead temperature enrichment (M-CX1)" bullet.
  - `src/lib/agents/tools/execute-sql.ts`, `get-table-schema.ts`,
    `list-tables.ts` — remove `crm` from the tool descriptions / comments.
- **`src/components/app-sidebar.tsx`** — remove the `Target` icon import and the
  `/opportunities` nav entry.

### 3c. Sanity checks after 3a/3b

```bash
# should print nothing:
grep -rniE "\bcrm\b|opportunit|touchpoint|reply_status|hot_count|TemperatureBadge|ThreadMarker" src \
  | grep -viE "temperature: ?0|non-zero temperature"
# should print nothing (no imports of deleted modules):
grep -rnE "touchpoint-summary|touchpoint-thread|opportunity-filters|components/opportunities" src
```

---

## 4. Remove the visual frills

- **`src/app/login/page.tsx`** — remove `import Image`, the `<Image
  src="/logowhite.png">` block, the `import { LoginHero }` + `<LoginHero />`, and
  collapse the two-column hero grid to a single centered `max-w-md` column
  (title + password card). Keep the form logic untouched.
- **`src/components/app-sidebar.tsx`** — remove `import Image` and the `<Image
  src="/logowhite.png">` logo; keep the plain text `Lead-IQ` wordmark.
- **Delete** `src/components/login-hero.tsx`.
- Optional cleanup: delete `public/logowhite.png`; drop the unused
  `@keyframes hero-stream` / `.animate-hero-stream` from `src/app/globals.css`;
  scrub the "login-hero" comment in `src/app/layout.tsx`. All harmless if left.
- Optional: the in-app page-title decode animation (`ScrambleText` in
  `PageHeader`) is separate from the login hero — left in place. Remove it too if
  you want zero animation.

---

## 5. Environment variables

Set on Railway (and in `.env.local` for dev). See `.env.example`:

| Key | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | new project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | new project anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | new project service-role key |
| `SUPABASE_DB_URL` | transaction-pooler URI (port 6543) — used by the LeadQuery chat agent |
| `NODE_ENV` | `production` |
| `NEXT_TELEMETRY_DISABLED` | `1` |

No Groq key env — BYOK by design. The clone needs **no** `NEXT_PUBLIC_HUBSPOT_PORTAL_ID`
or `NEXT_PUBLIC_SMARTLEAD_BASE_URL` (those were CRM deep-link config).

---

## 6. Deploy (Railway)

Follow `DEPLOY.md`. Summary: push the clone repo → Railway "Deploy from GitHub"
→ **set the region to match your Supabase region** (page-load latency depends on
it) → set the env vars above → build `npm install && npm run build`, start
`npm run start`. Create the shared auth user (step 2.3), then smoke-test:
campaigns list, Connect Groq, a small run, `/leads`, CSV export, `/chat`.

---

## 7. Verify the build

This must pass before deploying (a Node runtime is required — it was **not**
available in the environment where this playbook was authored, so the strip is
**not build-verified**):

```bash
npm install
npm run build
```

Fix any `crm`/temperature references the compiler flags (the sweeps in §3c
should have caught them).

---

## 8. Reference: companion files in this repo

This playbook is the master instruction, but it works **together with the repo**
— a few artifacts it relies on live as real files, not inlined here:

- **`supabase/init.sql`** — the entire clone DB build (§2). Self-contained; run as-is.
- **`supabase/README.md`** — DB apply path + why the numbered migrations aren't replayed.
- **`.env.example`** — the env-var template (§5).
- **`DEPLOY.md`** — the full Railway walkthrough (§6).
- **the `clone/lean-core` branch** — §2–§4 already applied, internally consistent,
  `main` untouched. This *is* the finished clone; if you use it, skip §3–§4.

So "everything needed to duplicate" = **this file + the repo it lives in** (ideally
the `clone/lean-core` branch). `CLONE.md` alone, without the repo, is not enough —
§3–§4 are edits to existing source files, and the schema lives in `init.sql`.
