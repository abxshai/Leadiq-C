# Lead-IQ — Product & Architecture Documentation

*Last updated: 2026-06-08*

Lead-IQ is an internal self-serve tool at Deccan AI that qualifies
LinkedIn leads against a target Ideal Customer Profile (ICP) using a
Groq-hosted LLM, and exports the merged result as CSV or (planned)
pushes it to Google Sheets. Lead lists can come from a manual CSV/JSON
upload or be pulled directly from a Phantombuster Sales Navigator run.

This document is the single-source overview of what Lead-IQ is, why it
exists, how it works, and what's next. It's intended for anyone —
GTM, engineering, leadership — who needs a clear picture without
reading the codebase.

---

## 1. Why this exists

Sales / BDR / GTM teams sit on LinkedIn exports they can't easily
triage. Our existing workflow for qualifying leads had four concrete
pain points:

1. **Non-technical teammates couldn't run it.** The qualification logic
   lived in n8n, which required someone who knew n8n to execute a run.
   Every new list meant a handoff.
2. **The agent's output needed manual cleanup every single time.** The
   LLM returned JSON with literal `\n` escape sequences instead of
   clean line breaks, so whoever exported the result had to
   hand-clean the data before it was usable in a spreadsheet.
3. **There was no shared dashboard.** No visibility into how many
   leads were qualified last month, across which verticals, at which
   seniority, and under which prompt.
4. **Phantombuster → Lead-IQ was a manual export-then-import step.**
   Teammates ran Sales Nav scrapes in PB's UI, downloaded the CSV, and
   re-uploaded it into the qualification wizard. Two tools, one copy
   across the gap.

Lead-IQ collapses those four problems into a single browser workflow:
scrape or upload → configure → run → export. No terminal, no hand
editing, no n8n handoff, no CSV relay.

---

## 2. How it works (user's view)

The product is four primary screens plus analytics and placeholders:

**(a) Scrape — pull a Sales Nav run from Phantombuster.** Pick one of
your PB phantoms from a dropdown (populated live from the PB API);
optionally paste a specific container ID to grab an older run.
Click **Fetch output** and Lead-IQ pulls the phantom's result CSV from
S3, filters to just that run's rows, trims to the 9 qualification-input
columns, and shows a result card. From there you can **Download trimmed
CSV** or **Push to Campaign** — the latter jumps you straight into the
campaign wizard with the leads pre-loaded. Teammates still drive the
actual scrape in PB's UI (where cookie/identity management lives); Lead-IQ
just reads the output.

**(b) Campaigns — the home screen.** Shows every run you've done,
with status (pending, running, completed, failed), total leads,
qualified count, failed count, and the source file. Click a row to
open its detail view; click the delete icon to remove a failed run
cleanly.

**(c) New campaign — a three-step wizard.**
- **Step 1 — Upload:** drop a CSV or JSON. The parser auto-detects
  the 9 standard LinkedIn input columns (`defaultProfileUrl`,
  `fullName`, `firstName`, `lastName`, `companyName`, `title`,
  `summary`, `titleDescription`, `location`) regardless of whether
  they were written in camelCase or snake_case. A preview of the first
  rows appears before you continue.
- **Step 2 — Configure:** give the campaign a name, pick a prompt
  template (Robotics / Manufacturing AI is the default, or write an
  ad-hoc one), set concurrency (how many parallel calls) and the
  inter-call delay (default 1 s, protects you from Groq's 250k
  tokens-per-minute ceiling). Optionally paste a Google Sheet ID for
  the push target (M4).
- **Step 3 — Review and launch:** the campaign is created but not yet
  running. Next screen, you actually start it.

**(d) Campaign detail — watch it run.** Progress bar, KPI tiles
(processed / qualified / failed), a live-updating table of every lead
with its status, qualification verdict, seniority score, priority
level, and a direct link back to the LinkedIn profile. Export CSV
whenever you want, or delete the campaign with a confirmation dialog.

**(e) Analytics — qualified leads across every campaign, filterable.**
Filter bar at the top: time range (7d / 30d / 90d / All), bucket (day
/ week / month), plus multi-select dropdowns for campaign, business
unit (`domain_classification`), ICP qualification, and company. Every
filter composes — KPI cards (qualified, qualification rate, processed,
avg seniority, active campaigns, failed), the time-series area chart,
and the four breakdown bar charts (per business unit, per ICP, per
company top-10, per campaign top-12) all recompute from the same
filter set. The server-side query inner-joins on `campaigns!inner` so
any orphaned lead from a deleted campaign drops out automatically;
`force-dynamic` means deletes and new runs reflect immediately, no
stale cache.

**(f) Templates — full CRUD with version history.** `/templates`
lists every prompt template (active and archived) with default and
archived badges, the current version number, and a per-card action
menu (Make default · Duplicate · Archive / Unarchive). `/templates/new`
and `/templates/[id]` share one form (name, description, system
prompt, default toggle); the edit page also shows a side panel
listing every prior version with a Restore action. Editing the system
prompt or name bumps the version and appends to
`prompt_template_versions`; description / default-toggle alone don't
bump. Restoring an old version goes through the same update path,
bumping to a new version pointing at the restored content. Past
campaigns keep their `system_prompt_snapshot` untouched — nothing
historical ever changes.

**(g) Leads — every qualified lead across all campaigns, in one
filterable, paginated table.** A cross-campaign browser that combines
the lead rows from every campaign. Each row mirrors the campaign-detail
table (Name + its source campaign as a subtitle, Role, Qualified, Temp,
ICP, Seniority, Domain, Priority, Area, Location, LinkedIn) and expands
inline to the same prose + touchpoint history. **Checkboxes** let you
select rows (across pages); a sticky bar then **exports the selection to
CSV** or **copies their LinkedIn URLs** — and there's an "Export all
(filtered)" for the whole result set. **Filters:** campaign, domain, ICP,
priority, temperature, seniority (multi-selects), area + company +
location (text contains — `product_area` is the per-lead company/team
name, far too many distinct values for a dropdown), a free-text
name/company/title search, and an All / Qualified toggle. Unlike Analytics, `/leads` filters **server-side
and paginates** — the filter state lives in the URL (so an Analytics
chart click can deep-link straight into a filtered view) and the full
lead set never loads into the browser, so it stays fast as volume grows.

**(h) Settings** — placeholder for future workspace-level config
(default Clay URL when M4 lands, etc.).

**(i) Chat — LeadQuery agent.** `/chat` route with a multi-agent
registry; **LeadQuery** is the first agent (more drop in as config).
Ask natural-language questions about your qualified leads ("How many
decision-makers in May's Robotics campaign?", "Top 10 companies by
qualified count this quarter") and the agent composes read-only SQL
against `campaigns` / `leads` / `campaign_stats` via three MCP-style
tools (`execute_sql`, `list_tables`, `get_table_schema`). It can also
read the `crm` schema — HubSpot contacts/companies/deals and Smartlead
email engagement, synced in by a separate ingest service — so you can
ask cross-source questions ("which qualified leads have already replied
to a Smartlead campaign?", "show open HubSpot deals for accounts we
just qualified"). Tool calls render as collapsible cards inline so you
can audit the SQL and result. Answers render as formatted markdown —
query results come back as real, selectable tables and LinkedIn/other
URLs as clickable links. Responses stream token-by-token (SSE).
Conversation history persists in `chat_messages`. Semantic similarity
(concept-match without shared keywords) is intentionally deferred to
M-AG2.

---

## 3. Key features

- **Phantombuster fetch integration.** Pick a phantom from a live dropdown,
  fetch its latest finished run, get a qualification-ready CSV trimmed to
  the 9 input columns the pipeline expects. Result URL is resolved via three
  fallbacks (phantom log → `/containers/fetch-result-object` → agent S3
  folder) so timing races with PB's result-object population don't strand
  valid runs. Rows are timestamp-filtered to the container's own launch
  window so older accumulated rows on the shared agent's S3 file don't leak
  into the current pull. BYOK for the PB API key, session-scoped.
- **Dynamic ICPs per campaign.** Versioned prompt templates, snapshotted
  on the campaign row at run time. You can tune a template next month
  without retroactively changing last month's analytics.
- **No manual JSON cleanup.** The agent's output is treated as
  structured JSON (Groq's `response_format: json_object`), normalized
  for key-naming variants, YES/NO casing, prose-as-array coercion, and
  out-of-range seniority clamping, then validated with Zod. We retry
  once on schema mismatch (echoing the Zod error back to the model) and
  on Groq's HTTP 400 `json_validate_failed` (echoing the malformed
  `failed_generation` back as the assistant turn). The retry runs at a
  small non-zero temperature to escape deterministic-failure loops.
  Past one retry, the lead is marked failed with the exact error stored
  for debugging.
- **Categorical verdicts everywhere.** Both `function_qualification` and
  `icp_qualification` accept free-form categorical values — custom
  prompts can return `"Decision Maker"` / `"Champion"` / `"Influencer"`
  and they flow straight through to the DB and CSV. The four-field
  domain bundle (classification, subdomain, subdomain justification,
  domain reasoning) is stored alongside, displayed in the lead table,
  and included in exports. Loose YES/NO synonyms (`"Y"`, `"qualified"`,
  `true`) still snap onto canonical YES/NO for legacy data.
- **Export toggle.** CSV export dropdown: **All leads** (everything) or
  **Qualified only** (excludes explicit `"NO"` verdicts plus failed/
  pending leads). The "qualified" predicate is `function_qualification
  IS NOT NULL AND != 'NO'`, so it works prompt-agnostically — a
  categorical-prompt run still gets the right inclusion behavior.
- **Ingest dedupe.** The parser dedupes by `default_profile_url` before
  submission, surfacing a "duplicates skipped" badge in the wizard
  preview so the user sees the real row count up front. Server-side,
  the action uses `upsert(ignoreDuplicates: true)` against the
  `(campaign_id, default_profile_url)` unique constraint as defense in
  depth — duplicate URLs can no longer atomically roll back an INSERT
  chunk and leave a half-imported campaign behind.
- **Inline lead detail.** The campaign-detail table shows compact
  columns (ICP, Seniority, Domain, Priority, Area) for fast scanning;
  any row with prose content (function reasoning, subdomain
  justification, domain reasoning, lead summary) expands inline so you
  can audit the agent's reasoning without leaving the page or
  exporting a CSV.
- **Resilient worker.** Lead pagination handles campaigns over the
  PostgREST 1000-row default. A post-run gate verifies every lead
  reached a terminal state before flipping the campaign to
  `completed` — partial runs land in `failed` with an explicit reason
  instead of silently misreporting success. Reruns include both
  `pending` *and* previously `failed` leads so transient errors
  (Groq 4xx, network blips, expired cookies) can clear on retry.
- **Bring Your Own Key (BYOK) for Groq.** Every teammate pastes their
  own Groq API key when they start a session. The key lives only in
  the browser tab (sessionStorage) and in the worker process memory
  for the duration of a run. It is **never** persisted server-side, is
  never written to logs, and is stripped defensively from error
  messages. No operator-held bulk key means no bulk-key risk.
- **Rate-limit-aware.** A per-campaign `delay_ms` plus a global
  min-interval gate ensures at most one Groq call starts per
  `delay_ms` regardless of how many concurrent workers are running.
- **Live campaign counts via `campaign_stats` view.** Total, processed,
  failed, and qualified counts are computed live from the leads table
  per campaign — the campaigns list, campaign detail KPIs, and the
  detail-page polling all read from this view. Predicate is
  `function_qualification IS NOT NULL AND upper(btrim(...)) <> 'NO'`,
  same as analytics, so categorical verdicts and legacy YES count
  uniformly without any backfill. `security_invoker = true` so RLS on
  the underlying tables still applies. The `campaigns.qualified_count` /
  `failed_count` stored columns are no longer surfaced — the worker
  still writes them on completion, but every read goes through the
  view, so stale or never-set counters no longer mislead the UI.
- **Filterable analytics.** Time range (7d / 30d / 90d / All), bucket
  (day / week / month), and multi-select filters for campaign, business
  unit, ICP, and company. The orphaned-lead defense via
  `campaigns!inner` plus `force-dynamic` rendering means a deleted
  campaign's leads can never reflect in the totals, even if FK cascade
  ever fails.
- **Prompt templates CRUD with version history.** Full self-serve
  template management — create, edit, duplicate, archive / unarchive,
  set default, restore from any prior version. Editing bumps `version`
  and appends to `prompt_template_versions`. The snapshot principle is
  preserved end-to-end: the wizard fetches non-archived templates,
  `createCampaign` snapshots `system_prompt + version` into the
  campaign row at run time, and the worker reads
  `campaigns.system_prompt_snapshot` — never re-fetches the template.
  Edits and restores cannot retroactively change historical behavior.
- **Light / dark theme toggle.** `next-themes` wired into the root
  layout with light tokens defined alongside the dark in `globals.css`;
  the toggle lives in the app header. Default is dark; the login screen
  stays dark-locked.
- **Campaign analytics.** Qualification rates, seniority distribution,
  per-product-area breakdowns — all pulling directly from Supabase
  with no pre-aggregation job.
- **LeadQuery agent — natural-language SQL over Lead-IQ + CRM data.**
  Three MCP-style tools (`execute_sql`, `list_tables`,
  `get_table_schema`) give the agent a small, predictable surface over
  the `public` schema (campaigns, leads, …) and the read-only `crm`
  schema (HubSpot + Smartlead ingest); read-only is enforced at the
  Postgres transaction level (`SET LOCAL transaction read only`) so
  even a malformed query can't write. Results capped at 50 rows;
  statement timeout 10s. SSE streaming with collapsible tool-call
  cards. Multi-agent registry
  from day 1 — future agents (Touchpoint Retrieval after M-CX1,
  ICP-tuning suggestions, etc.) plug in as config rather than
  infrastructure. Semantic similarity deferred to M-AG2.

---

## 4. Who it's for

- **Primary users:** Deccan AI's BDR / GTM team members who own a
  LinkedIn lead list and want it qualified fast.
- **Secondary users:** founders, sales engineers, anyone adjacent who
  occasionally needs lead triage.
- **Not for:** external users, unknown domains, anyone without the
  shared access password. This is an internal tool by design.

---

## 5. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 16** (App Router, Turbopack) | One deploy artifact for UI + API, fast server components |
| UI | **shadcn/ui on Base UI** + **Tailwind v4** | Own the components, headless primitives, no design-system lock-in |
| Theme | Dark, pure black + **#6bb3ff** sky-blue radial gradient; **Major Mono Display** headings + **JetBrains Mono** body | Calm, identifiable, developer-adjacent feel |
| Charts | **Recharts** via shadcn Chart | Declarative, themable via CSS vars |
| Auth | **Supabase Auth — shared password** (single shared user) | 5-person team, OAuth / per-user auth would be overkill |
| Database | **Supabase Postgres** with row-level security | Managed, auth-integrated, cheap |
| LLM | **Groq** `openai/gpt-oss-120b` via the OpenAI SDK (BYOK) | 250k tokens/min, OpenAI-compatible API, open-weights |
| Scrape source | **Phantombuster** Sales Navigator Search Export (BYOK) | Vendor handles cookies/identities/bans; we just read the S3 result |
| Parsing | **papaparse** | Streams CSV and handles edge cases cleanly |
| Validation | **Zod** | Runtime schema, drives retry logic on schema failures |
| Concurrency | **p-limit** + a custom min-interval rate gate | Bounds both N-in-flight and N-per-delay_ms |
| BYOK state | **Zustand** + sessionStorage | Scoped to tab, wiped on close — exactly the right primitive |
| Host | **Railway** | Persistent Node process for the long-running worker (serverless would kill runs) |

---

## 6. Architecture — one diagram

```
┌──────────────────┐        ┌───────────────────────────┐
│     Browser      │        │  Next.js server (Node)    │
│                  │        │                           │
│  Zustand store   │        │  • Route handlers         │
│  ├ groqKey (tab) │        │  • Server Actions         │
│  └ …             │        │  • In-process worker      │
│                  │        │                           │
│  React UI        │◀──────▶│  proxy.ts (session guard) │
└────────┬─────────┘        └───────────┬───────────────┘
         │                              │
         │   signInWithPassword         │  createServerSupabase
         ▼                              ▼
  ┌─────────────────┐          ┌────────────────────┐
  │  Supabase Auth  │          │  Supabase Postgres │
  │  (shared user)  │          │  + Row-Level Sec.  │
  └─────────────────┘          └──────────┬─────────┘
                                          │
                                  campaigns, leads,
                                  prompt_templates,
                                  prompt_template_versions,
                                  campaign_stats (view)
                                          │
                    ┌─────────────────────┴──────────────────────┐
                    │ Worker (spawned by POST …/run)             │
                    │                                            │
                    │   p-limit(concurrency)                     │
                    │   ├─ gate(delay_ms) ─▶ Groq API (user key) │
                    │   ├─ JSON-mode response                    │
                    │   ├─ normalize + Zod validate              │
                    │   ├─ retry once on schema failure          │
                    │   └─ UPDATE leads SET … (status=processed) │
                    │                                            │
                    │   Groq key lives ONLY in closure,          │
                    │   dropped when run promise settles.        │
                    └────────────────────────────────────────────┘
```

**Data flow per campaign:**
```
Source (either):
  (a) user-uploaded CSV/JSON
  (b) Phantombuster fetch
      │
      ▼  GET /agents/fetch-all     → user picks a phantom
      ▼  /containers/fetch-all     → latest finished container
      ▼  log-scan | result-object  → CSV URL on PB's S3
      ▼  papaparse + timestamp filter + 9-col projection
      │
      ▼  (sessionStorage handoff: scrape → /campaigns/new)
      ▼
LinkedIn CSV/JSON (normalized)
      │
      ▼  papaparse + alias map → 9 input cols (pass-through)
Supabase: INSERT campaign + INSERT leads (status='pending')
      │
      ▼  POST /api/campaigns/:id/run  (X-Groq-Key header)
      │    - atomic DB claim: status='pending' → 'running'
      │    - worker spawned, key held in closure
      │
      ▼  per lead, under p-limit + rate gate:
Groq openai/gpt-oss-120b (JSON mode)
      │
      ▼  normalize → Zod.safeParse
      │    ├─ ok: UPDATE lead SET (agent cols…) status='processed'
      │    └─ invalid: retry once with error echoed, then fail loudly
      │
      ▼  post-run gate: count(status in 'pending'|'running')
      │    ├─ zero: UPDATE campaigns SET status='completed', counters…
      │    └─ non-zero: UPDATE campaigns SET status='failed' (partial run)
      │
      └─▶  CSV export  ·  (planned) Google Sheets batch append
```

---

## 7. Security & trust model

- **Single shared workspace.** Every teammate signs into the same
  Supabase user (`team@lead-iq.local`) with a shared password. No
  audit trail of "who ran what" — the tradeoff is accepted for the
  5-person team size. Upgrade path to multi-tenant is drop in a
  `workspace_id` column + tighten RLS `USING` clauses; no data
  migration needed.
- **Row-level security is enabled.** All four tables
  (`prompt_templates`, `prompt_template_versions`, `campaigns`,
  `leads`) gate reads/writes on the authenticated role. The anon key
  alone can't read or write data — auth is mandatory.
- **Groq keys and Phantombuster keys are BYOK.** By design, Lead-IQ
  never holds either. Both live in the browser tab's sessionStorage,
  forwarded as request headers (`X-Groq-Key`, `X-PB-Key`) only when the
  user initiates an action that needs them, held in the server handler's
  closure for the duration of that one call, and dropped. Any leak from
  the server side does not give an attacker either key, because there's
  none to leak. The blast radius of a server compromise is confined to
  the data in Supabase (internal lead lists).
- **Supabase anon key is public.** That key is designed to be shipped
  to browsers and is not a secret. The security comes from RLS.
- **Supabase service-role key is secret.** Held only in
  Railway's environment, used only by the worker for bulk inserts.
  Rotate if ever exposed.

---

## 8. Current state

**Shipped:**
- **`/leads` cross-campaign browser (M3.5)** — every qualified lead
  across all campaigns in one server-filtered, URL-driven, paginated
  table (rich campaign-detail-style rows + inline expand). Row
  **checkboxes** with cross-page selection feed a sticky bar that
  **exports the selection to CSV** or **copies LinkedIn URLs**, plus an
  "Export all (filtered)". Filters: campaign, domain, ICP,
  priority, temperature, seniority (multi-select); area, company,
  location (contains); free-text search; All/Qualified toggle. Filters live in
  the URL so `/analytics` bar charts deep-link in
  (`/leads?bu=/icp=/company=/campaign=`). New `GET /api/leads/export.csv`
  + migration `0008_lead_filter_facets.sql` (a `lead_filter_facets()`
  SQL function powering the dropdowns without loading the full lead set).
- **Smartlead/HubSpot cross-check + lead temperature (M-CX1)** — every
  qualified lead is tagged **hot** / **warm** / **cold** by a direct local
  JOIN against the `crm` schema (no external service — the HubSpot/Smartlead
  data is already in this project). Hot = an active HubSpot pipeline stage
  (opportunity/customer/evangelist) or a reply in the last 90 days; warm =
  any outreach/engagement in the last 6 months; cold = otherwise / no CRM
  match. New `Temperature` column + filter chip on the campaign-detail table,
  and a "Touchpoint history" section in the inline-expand for hot/warm leads.
  Migration `0006_lead_temperature.sql` adds `leads.temperature` +
  `touchpoint_match jsonb` + a set-based classifier function
  (`classify_campaign_temperature`); the worker runs it just before flipping
  the campaign to `completed` (so temperatures render the moment the run
  finishes; soft-fail — never gates qualification), and a "Cross-check
  leads" button re-runs it on demand. Join bridges leads→HubSpot contact (by
  normalized LinkedIn URL) →Smartlead (by contact email). The "Touchpoint
  history" expand **cites the actual engagement** — each Smartlead email's
  subject + action (sent/opened/clicked/replied) + date — and **deep-links**
  to the Smartlead campaign and the HubSpot contact record (HubSpot link needs
  `NEXT_PUBLIC_HUBSPOT_PORTAL_ID`; see `DEPLOY.md`).
- **LeadQuery agent + chat surface (M-AG1)** — `/chat` route with
  natural-language → read-only SQL over `campaigns` / `leads` /
  `campaign_stats` via three MCP-style tools (`execute_sql`,
  `list_tables`, `get_table_schema`). Multi-agent registry; first
  agent of a pluggable surface. SSE streaming with token deltas +
  collapsible tool-call cards. Conversation persistence in
  `chat_messages`. Migration `0005_chat_tables.sql` adds
  `chat_conversations` + `chat_messages` with RLS and Data API grants.
  New env: `SUPABASE_DB_URL` (transaction-pooler URI). Semantic
  similarity deferred to M-AG2.
- **LeadQuery CRM access** — the agent's SQL tools now also reach the
  `crm` schema (HubSpot contacts/companies/deals + Smartlead email
  stats, synced by a separate ingest service). Read-only and visibility-
  only: no migration or grants (the pooler role already has `SELECT`;
  RLS is disabled on `crm`), and the read-only transaction boundary is
  unchanged. Per-lead temperature write-back (hot/warm/cold) remains a
  separate milestone (M-CX1).
- Full campaign creation → run → export loop with rerun-failed support
- **Filterable analytics dashboard** — time / bucket / campaign /
  business unit / ICP / company filters, KPI cards, time-series area
  chart, and four breakdown bar charts; `force-dynamic` rendering plus
  `campaigns!inner` join means deleted campaigns can't show up in totals
- **Live campaign counts via the `campaign_stats` SQL view** — the
  campaigns list, campaign detail, and detail polling all read live
  aggregates instead of the stored counters; categorical verdicts and
  legacy YES count uniformly via a single predicate
- **Prompt templates CRUD with version history** — full self-serve
  template management with restore-from-version; snapshot principle
  preserved end-to-end
- **Light / dark theme toggle** — `next-themes` wired in the root
  layout, toggle in the app header
- **Atomic campaign creation + orphan guard end-to-end.** If any chunk
  INSERT fails, `createCampaign` rolls back by deleting the campaign
  row before re-throwing; if an orphan ever slips through, the worker
  detects it post-pagination and marks `failed` with a clear reason
  instead of silently completing.
- **Zombie-campaign auto-reset on server boot** via Next 16's
  `instrumentation.ts` — Railway redeploys mid-run no longer strand
  campaigns in `running`. On every boot, running leads flip to pending
  and running campaigns flip to `canceled` (resumable). User clicks
  Resume; no SQL needed.
- **Ingest scrubs NUL bytes** at parse time — Phantombuster summary
  fields occasionally carry stray `U+0000` chars; Postgres' JSON parser
  rejects those, failing the INSERT chunk. Stripped before INSERT to
  protect both CSV and JSON ingest.
- **Visible wizard errors.** Server-action failures during campaign
  create now render in a red banner instead of silently failing — body
  limit, RLS, and network errors are all explicit.
- Delete with confirmation
- Rate-limit-aware worker; paginated lead SELECT (handles ≥1k campaigns
  past PostgREST's row cap); post-run completion gate that flips the
  campaign to `failed` with an explicit "partial run" reason if any
  lead is left in a non-terminal state
- BYOK Groq + Phantombuster keys, both session-scoped, never persisted
- Phantombuster fetch ingestion — live agent dropdown, trim + timestamp
  filter, Push to Campaign handoff into the existing RunWizard
- Agent output key-variant normalizer (handles
  `"Function Qualification"`, `"functionQualification"`,
  `"function_qualification"`, plus loose YES/NO casing, prose-as-array
  coercion, out-of-range seniority clamping)
- Domain classification fields end-to-end (classification, subdomain,
  subdomain justification, domain reasoning); `icp_qualification` and
  `function_qualification` both accept categorical values now —
  custom prompts can return `"Decision Maker"` / `"Champion"` / etc.
  without being silently coerced back to YES/NO
- Inline expandable lead detail on the campaign-detail page (function
  reasoning, subdomain justification, domain reasoning, lead summary)
- KPIs use server-side count queries so they stay accurate beyond the
  lead-table's 5000-row visual cap
- CSV export with **All leads / Qualified only** dropdown — qualified
  predicate is `function_qualification IS NOT NULL AND != 'NO'`,
  prompt-agnostic so categorical verdicts flow through correctly
- Worker reliability: catches Groq HTTP 400 `json_validate_failed`
  (echoes `failed_generation` back as the assistant turn for the retry,
  same shape as the Zod-failure retry); retry runs at non-zero
  temperature to escape deterministic-output loops; `max_tokens=4096`
  on both calls; first-call temperature pinned to 0
- Schema relaxed: `function_reasoning` and `lead_summary` nullable
  (model occasionally omits prose on terse "NO" verdicts); failing the
  whole lead is no longer the failure mode
- Ingest dedupe by `default_profile_url` in the parser plus
  `upsert(ignoreDuplicates: true)` server-side, so duplicate URLs no
  longer atomically roll back an INSERT chunk and leave a half-imported
  campaign with `total_leads` lying about the real count
- 10 MB Server Action body limit (was 1 MB) so Push to Campaign and
  manual CSV uploads don't 413 around 200+ row scrapes
- Major Mono Display headings + JetBrains Mono body; ASCII hero login page; password-based shared auth

**Not yet shipped (roadmap):**
- **Semantic similarity in LeadQuery** *(M-AG2)* — pgvector + Supabase gte-small embeddings + a `semantic_search_leads` tool. Lets the agent answer concept-match questions ("find leads about AI infra even if their title says 'ML platform engineer'"). Design lives in [`agent-section-plan.md`](./agent-section-plan.md) §4 + §8 (tagged **[M-AG2 — DEFERRED]**).
- **Clay webhook push** *(M4 — parked 2026-05-28)* — Smartlead/HubSpot via M-CX1 covers the outreach pattern from the enrichment angle; revisit Clay if a push-style gap remains after M-CX1 ships.
- **Analytics scale fix** — today the page fetches every processed lead
  across all campaigns and filters in-memory; will be visibly slow past
  ~50k leads. Right fix: pre-aggregated SQL views or RPC with the
  filter set passed as params. Defer until volume actually warrants.
- **BI offload (Looker Studio / Metabase)** — deferred until Smartlead /
  HubSpot integrations land. Plan: SQL views per source, shaped like
  `campaign_stats`, then point a BI tool at those views for exec /
  cross-source reports while operational dashboards stay in-app.
- **Scheduled / cron runs** — today everything is user-triggered.
- **Multi-tenant** — single-workspace mode for now, by choice.

**Known limitations:**
- Lead temperature (M-CX1) classifies a Smartlead reply as **hot** from
  `reply_time` alone — it has no reply *content* (Smartlead's `lead_category`
  is null in the ingest), so an out-of-office auto-reply is indistinguishable
  from a genuine interested reply and gets tagged hot. Accepted for now; the
  fix is gated on the ingest team landing a replies/threads table (see
  roadmap backlog — "reply-content citations + OOO filtering").
- A server restart while a campaign is running abandons the in-process
  worker — but the campaign is no longer stuck visibly: `instrumentation.ts`
  flips zombies to `canceled` (resumable) on the next boot. User just
  clicks Resume after the deploy. The actual progress in flight at the
  moment of restart is lost (model calls for the affected leads need to
  re-run); the leads themselves are not corrupted, just flipped back to
  pending.
- Server Action body limit is 10 MB. Comfortably handles ~2k row
  campaigns once profile summaries are included. Past that, push to
  Campaign / manual upload will 413 and the new wizard error banner
  will surface it. A chunked route handler is the right fix when scale
  warrants — see roadmap backlog.
- Phantombuster Sales Nav phantoms cap around ~1000 rows per run by
  default. If you need more, split the search into multiple narrower
  phantoms and concat the CSVs (Lead-IQ dedupes on ingest).
- Agent output quality depends on the prompt — ad-hoc prompts that
  don't describe the expected JSON schema clearly will cause
  validation failures, even with the categorical relaxation. Use the
  seeded templates as a reference.

---

## 9. Design principles worth preserving

- **Minimal surface area.** Every new feature should justify itself
  against the 3-screen simplicity of the product. Dashboards rot when
  they grow to 20 pages of settings.
- **The prompt snapshot is sacred.** Never change
  `system_prompt_snapshot` on a historical campaign row. Reproducibility
  of "which prompt produced this result" is a core promise.
- **BYOK is non-negotiable.** If we ever add a shared Groq key,
  that's a new product and it needs a different trust model — not a
  setting to toggle.
- **Fail loudly.** Validation failures surface as errors on the lead
  row with the exact Zod issue text. Don't silently swallow a failed
  lead; the user needs to see it to decide whether to retry.

---

## 10. Where things live

- **Live app:** <https://lead-iq.up.railway.app/>
- **Source:** <https://github.com/abxshai/Lead-IQ>
- **Database / auth:** Supabase project (ask a teammate for dashboard
  access)
- **Host:** Railway
- **Deploy guide:** [`DEPLOY.md`](./DEPLOY.md)
- **Developer setup:** [`README.md`](./README.md)
- **Design system / UI tokens:** [`UI.md`](./UI.md)

---

## 11. UI / design tokens

The design system — fonts, color tokens, component conventions, gradient overlay, and "decisions on the table" for the next visual pass — lives in [`UI.md`](./UI.md). Updated 2026-06-06: **Major Mono Display** headings (lowercase→caps) + **JetBrains Mono** body; brand color **#6bb3ff** sky-blue with a matching bottom-right gradient; page titles carry a 10s decode animation. Anything you'd touch when changing color, font, or layout starts there.
