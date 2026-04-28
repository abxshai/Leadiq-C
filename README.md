# Qualifier

A self-serve lead-qualification dashboard. Upload a LinkedIn profile
list (or pull a Sales Nav run directly from Phantombuster), qualify
against a target ICP via Groq's `openai/gpt-oss-120b` (BYOK), and
export the merged result as CSV or (planned) push to Google Sheets.

Built for Deccan AI — optimized for its manufacturing-robotics ICP but
ships with a neutral B2B template you can point at any list.

---

## Use case

Sales, BDR, and GTM teams sit on LinkedIn exports they can't easily
triage. Qualifier turns that flow into a 3-click loop:

1. **Source** a lead list — drop a CSV/JSON, or pick a Phantombuster
   phantom from the Scrape page and pull its latest run.
2. **Pick an ICP prompt** (Robotics, General B2B, or an ad-hoc prompt).
3. **Run** — each profile goes through the qualification agent, and the
   merged output (input columns + agent scoring) appears in a searchable
   table and is one click away from CSV.

The things it specifically solves:

- **Dynamic ICPs per campaign.** Different lead lists need different
  qualification lenses — Qualifier ships versioned prompt templates and
  freezes the prompt on the campaign row so old runs stay reproducible
  even after a template edit.
- **No manual JSON cleanup.** The agent returns structured JSON via
  Groq's `response_format: json_object`, validated by a Zod schema with
  a one-shot retry on schema failure. No more `\n` escape-sequence
  hand-cleaning.
- **No shared API keys.** Groq keys *and* Phantombuster keys are
  Bring-Your-Own-Key, session-only, and never touch the database, logs,
  or env vars — users paste a key before each work session and it's
  dropped when the call finishes.
- **Phantombuster fetch.** Pick a phantom, fetch its last finished run,
  trim to qualification-input columns, push the result straight into the
  campaign wizard. Vendor handles cookies/identities/bans; Lead-IQ just
  reads the S3 result.
- **Rate-limit-aware.** A per-campaign inter-call delay (default 1 s)
  plus a global rate gate keeps you under Groq's 250k TPM ceiling
  regardless of concurrency.
- **Campaign analytics.** Qualification rates, seniority distribution,
  and per-product-area breakdowns, groupable by template so you can A/B
  prompts over time.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 16** (App Router, Turbopack) | Server components for data fetching, one deploy artifact for UI + API |
| UI | **shadcn/ui on Base UI** + **Tailwind v4** | Fast headless primitives, own your components |
| Theme | Dark, pure black + sky-blue radial gradient accent | — |
| Font | **Space Mono** via `next/font/google` | — |
| Charts | **Recharts** via shadcn Chart | Declarative, themable via CSS vars |
| Auth | **Supabase Auth** — shared password (single user `team@lead-iq.local`) | 5-person team; multi-user OAuth would be overkill |
| Database | **Supabase Postgres** with RLS | Managed, cheap, auth-integrated |
| LLM | **Groq** `openai/gpt-oss-120b` via the OpenAI SDK (BYOK) | 250k TPM, OpenAI-compatible, open-weights |
| Scrape source | **Phantombuster** Sales Nav Search Export (BYOK API key) | Vendor handles cookies, identities, ban risk — we read the S3 result |
| Parsing | **papaparse** | CSV/JSON, streaming-friendly |
| Validation | **Zod** | Strict runtime schema for agent output, drives retry logic |
| Concurrency | **p-limit** + a custom min-interval gate | Concurrent calls bounded by both N-in-flight and 1-per-`delay_ms` |
| State (client) | **Zustand** with sessionStorage persistence | Scoped to tab, wiped on close — right primitive for BYOK |

---

## Architecture

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
         │  signInWithPassword          │  createServerSupabase
         ▼                              ▼
  ┌─────────────────┐          ┌────────────────────┐
  │  Supabase Auth  │          │  Supabase Postgres │
  │ (shared user)   │          │  + Row-Level Sec.  │
  └─────────────────┘          └──────────┬─────────┘
                                          │
                                  campaigns, leads,
                                  prompt_templates,
                                  prompt_template_versions
                                          │
                    ┌─────────────────────┴──────────────────────┐
                    │ Worker (spawned by POST …/run)              │
                    │                                             │
                    │   p-limit(concurrency)                      │
                    │   ├─ gate(delay_ms) ─▶ Groq API (user key)  │
                    │   ├─ JSON-mode response                     │
                    │   ├─ Zod validate → retry once on invalid   │
                    │   └─ UPDATE leads SET … (status=processed)  │
                    │                                             │
                    │   Groq key lives ONLY in closure,           │
                    │   dropped when run promise settles.         │
                    └─────────────────────────────────────────────┘
```

### Data flow per campaign

```
LinkedIn CSV/JSON
      │
      ▼  papaparse + alias map → 9 input cols (pass-through)
Supabase: campaigns INSERT + leads INSERT (status='pending')
      │
      ▼  POST /api/campaigns/:id/run  (X-Groq-Key header)
      │    - atomic DB claim: status='pending' → 'running'
      │    - worker spawned (fire-and-forget), key in closure
      │
      ▼  per lead, under p-limit + rate gate:
Groq openai/gpt-oss-120b (JSON mode)
      │
      ▼  Zod(AgentOutputSchema).safeParse()
      │    ├─ ok: UPDATE lead SET (agent cols…) status='processed'
      │    └─ invalid: retry once with error echoed, then fail
      │
      ▼  UPDATE campaigns SET status='completed', qualified_count=…
      │
      └─▶  CSV export  ·  (planned) Google Sheets batch append
```

### BYOK invariants

- Groq key is accepted by the browser, **validated** with a direct
  `GET /models` ping to Groq (no server round-trip for validation), then
  stored in **sessionStorage** via Zustand.
- Any run request forwards the key in the **`X-Groq-Key`** header. The
  server never writes this to the DB, never logs it, and emits a
  `redact()` pass over any error string to strip `gsk_…` patterns
  defensively.
- The worker holds the key in the closure of its async function. When
  the promise resolves (success or failure), the closure is dereferenced
  and the key is garbage-collected along with it.
- There is **no** env var for a Groq key. Anywhere. The absence is the
  guarantee.

### Dynamic system prompts

Campaigns take one of three paths at creation:

1. **Default template** (Robotics / Manufacturing AI — Deccan's ICP).
2. **Saved template** picked from the list.
3. **Ad-hoc prompt** typed into the wizard.

Whichever path is used, the *resolved* system prompt is snapshotted onto
`campaigns.system_prompt_snapshot` at creation. Template edits afterward
do **not** alter in-flight or historical runs — crucial for prompt
experiments where "which prompt produced this result" has to stay
answerable.

---

## Data model

```sql
prompt_templates
  id, name, slug (unique), description,
  system_prompt, is_default, version, timestamps

prompt_template_versions
  id, template_id → prompt_templates, version,
  name, system_prompt, saved_by, saved_at      -- append-only audit

campaigns
  id, name, source_filename,
  prompt_template_id, prompt_template_version,
  system_prompt_snapshot,            -- frozen at creation
  model (default 'openai/gpt-oss-120b'),
  concurrency (default 5),
  delay_ms (default 1000),
  google_sheet_id, google_sheet_tab,
  total_leads, qualified_count, failed_count,
  status ∈ {pending, running, completed, failed, canceled},
  created_by, timestamps

leads
  id, campaign_id → campaigns (CASCADE),
  -- pass-through input (9 cols from the scraper)
  default_profile_url, full_name, first_name, last_name,
  company_name, title, summary, title_description, location,
  -- agent output (8 cols, nullable until processed)
  agent_full_name, function_qualification, function_reasoning,
  icp_qualification, seniority_scoring, priority_level,
  product_area, lead_summary,
  -- ops
  status ∈ {pending, running, processed, failed, skipped},
  error, llm_prompt_tokens, llm_completion_tokens, llm_latency_ms,
  created_at, processed_at,
  UNIQUE (campaign_id, default_profile_url)
```

Row-level security: currently "authenticated users see all rows"
(single-workspace mode). Adding a `workspace_id` column + tightening
the `USING` clauses is how we'd go multi-tenant without a data
migration.

The 9/8 column split matches `Lead data format.csv` — cols 1–9 are
scraper input, cols 10–17 are the agent's response. The CSV export
endpoint preserves that exact order.

---

## Project structure

```
lead-qualifier/
├── src/
│   ├── app/
│   │   ├── (app)/                 ← authed routes (sidebar layout)
│   │   │   ├── scrape/            ← Phantombuster fetch page
│   │   │   ├── campaigns/
│   │   │   │   ├── new/           ← 3-step run wizard
│   │   │   │   ├── [id]/          ← campaign detail + live progress
│   │   │   │   └── actions.ts     ← createCampaign, deleteCampaign
│   │   │   ├── templates/         ← prompt template cards
│   │   │   ├── analytics/         ← KPIs + charts
│   │   │   └── settings/
│   │   ├── api/
│   │   │   ├── campaigns/[id]/
│   │   │   │   ├── run/           ← POST: kicks off the worker
│   │   │   │   └── export.csv/    ← GET: streams merged CSV
│   │   │   ├── pb-agents/         ← GET: list phantoms on PB account
│   │   │   └── pb-fetch/          ← POST: fetch + trim a phantom run
│   │   ├── auth/signout/
│   │   ├── login/                 ← shared-password sign-in form
│   │   └── layout.tsx             ← html shell, fonts, gradient
│   ├── components/
│   │   ├── app-sidebar.tsx
│   │   ├── connect-groq-dialog.tsx
│   │   ├── groq-connect-pill.tsx
│   │   ├── connect-pb-dialog.tsx
│   │   ├── pb-connect-pill.tsx
│   │   ├── run-wizard.tsx         ← upload OR auto-load from /scrape
│   │   ├── campaign-detail.tsx
│   │   ├── analytics-charts.tsx
│   │   ├── delete-campaign-button.tsx
│   │   └── ui/                    ← shadcn generated
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── browser.ts         ← anon key, client
│   │   │   ├── server.ts          ← anon key, cookies, server RSC
│   │   │   └── service.ts         ← service-role, server-only worker
│   │   ├── groq-config.ts         ← plain constants, any runtime
│   │   ├── groq-store.ts          ← Zustand, sessionStorage (client)
│   │   ├── pb-api-key-store.ts    ← Zustand, sessionStorage (PB BYOK)
│   │   ├── pb-fetch.ts            ← PB API helpers + trim/timestamp filter
│   │   ├── lead-parser.ts         ← CSV/JSON → ParsedLead[]
│   │   ├── agent-schema.ts        ← Zod schema for LLM output
│   │   ├── rate-gate.ts           ← min-interval gate, promise chain
│   │   └── worker.ts              ← the campaign worker (server-only)
│   └── proxy.ts                   ← Next 16 session refresh + guard
├── supabase/
│   ├── schema.sql                 ← tables, indexes, seed templates
│   ├── rls.sql                    ← row-level security policies
│   └── migrations/
│       └── 0001_add_delay_ms.sql
├── scripts/
│   ├── debug-leads.mjs            ← CLI dump of recent lead errors
│   └── phantombuster-scrape.mjs   ← CLI proof-of-chain for PB API
├── DEPLOY.md                      ← Railway deployment guide
├── DOCS.md                        ← product + architecture overview
└── README.md                      ← this file
```

---

## Local development

Requirements: Node 20.9+, a Supabase project.

```bash
# 1. Install
npm install

# 2. Supabase
#    In the Supabase SQL editor, run in order:
#      supabase/schema.sql
#      supabase/rls.sql

# 3. Env
cp .env.example .env.local
#    Then paste:
#      NEXT_PUBLIC_SUPABASE_URL
#      NEXT_PUBLIC_SUPABASE_ANON_KEY
#      SUPABASE_SERVICE_ROLE_KEY

# 4. Dev server
npm run dev
#    http://localhost:3000 → redirects to /login
```

---

## Deployment

See [DEPLOY.md](./DEPLOY.md) for the Railway walkthrough. **Do not
deploy to Vercel** — the worker is a long-running in-process pattern
that serverless runtimes will kill mid-run.

---

## Roadmap

- [x] **M1 — Skeleton** · scaffold, theme, Supabase schema, app shell
- [x] **M2 — Run wizard** · BYOK Groq, upload/parse, worker, CSV export,
      delay control, delete action, analytics v1
- [x] **Phantombuster fetch ingestion** · agent dropdown, trim + timestamp
      filter, Push to Campaign handoff into the existing wizard
- [ ] **M3 — Prompt templates CRUD + domain analytics** · `/templates`
      forms, `domain` enum on agent output, stacked-bar by domain
- [ ] **M4 — Clay webhook integration** · `clay_webhook_url` per campaign,
      batched push of qualified leads on completion

See `lead-iq-roadmap.md` (local-only) for the full living roadmap.

---

## Design notes worth keeping in mind

- **Why no n8n.** The pipeline is a single-purpose "form → LLM → sheet"
  flow that users trigger on demand. A workflow engine sitting in the
  middle adds indirection without solving the actual friction (JSON
  cleanup, per-user execution, sharing the agent logic with non-devs via
  a UI instead of a visual DAG). Direct code is simpler and ships
  faster.
- **Why BYOK.** Avoids the operator paying for every tenant's tokens and
  keeps the trust boundary tight — even if the server is compromised,
  there's no bulk key to exfiltrate. The tradeoff is a small UX hit
  (reconnect once per session) and no offline scheduled runs.
- **Why structured output over regex cleaning.** Open-weight models
  occasionally emit malformed JSON under json-mode, but much less often
  than they emit `\n`-escaped prose. Treating schema failure as a retry
  signal (with the validation error echoed back) is more robust than
  chasing specific malformations after the fact.
- **Why not serverless.** Campaign runs routinely take minutes. A 5-min
  run at 1 s delay with concurrency 5 ≈ 1500 leads; serverless function
  timeouts cap that arbitrarily. A persistent Node process on Railway or
  Fly is the right scale primitive for this workload.
- **Why snapshot the system prompt.** If you edit the "Robotics" template
  next month, last month's campaign analytics must still reflect the
  prompt that actually ran. `campaigns.system_prompt_snapshot` is a
  copy, not a reference.

---

## License

Internal. Not published.
