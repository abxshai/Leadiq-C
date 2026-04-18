# Lead-IQ — Product & Architecture Documentation

*Last updated: 2026-04-18*

Lead-IQ is an internal self-serve tool at Deccan AI that qualifies
LinkedIn leads against a target Ideal Customer Profile (ICP) using a
Groq-hosted LLM, and exports the merged result as CSV or (planned)
pushes it to Google Sheets.

This document is the single-source overview of what Lead-IQ is, why it
exists, how it works, and what's next. It's intended for anyone —
GTM, engineering, leadership — who needs a clear picture without
reading the codebase.

---

## 1. Why this exists

Sales / BDR / GTM teams sit on LinkedIn exports they can't easily
triage. Our existing workflow for qualifying leads had three concrete
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

Lead-IQ collapses those three problems into a single browser
workflow: upload → configure → run → export. No terminal, no hand
editing, no n8n handoff.

---

## 2. How it works (user's view)

The product is three screens:

**(a) Campaigns — the home screen.** Shows every run you've done,
with status (pending, running, completed, failed), total leads,
qualified count, failed count, and the source file. Click a row to
open its detail view; click the delete icon to remove a failed run
cleanly.

**(b) New campaign — a three-step wizard.**
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

**(c) Campaign detail — watch it run.** Progress bar, KPI tiles
(processed / qualified / failed), a live-updating table of every lead
with its status, qualification verdict, seniority score, priority
level, and a direct link back to the LinkedIn profile. Export CSV
whenever you want, or delete the campaign with a confirmation dialog.

**(d) Analytics — the monthly recap.** KPI cards (leads processed,
qualified, qualification rate, avg seniority, campaigns this month,
failed), a stacked-area chart of qualified vs. not-qualified per day
over 30 days, a horizontal bar chart of the top product areas among
qualified leads, and a seniority distribution bar chart.

**(e) Templates and Settings** — placeholders for the roadmap work
(versioned prompt CRUD, Google Sheets setup).

---

## 3. Key features

- **Dynamic ICPs per campaign.** Versioned prompt templates, snapshotted
  on the campaign row at run time. You can tune a template next month
  without retroactively changing last month's analytics.
- **No manual JSON cleanup.** The agent's output is treated as
  structured JSON (Groq's `response_format: json_object`), normalized
  for key-naming variants and YES/NO casing, then strictly validated
  with Zod. If the model fumbles the schema, we retry once echoing the
  validation error; past that, the lead is marked failed with the error
  stored for debugging.
- **Bring Your Own Key (BYOK) for Groq.** Every teammate pastes their
  own Groq API key when they start a session. The key lives only in
  the browser tab (sessionStorage) and in the worker process memory
  for the duration of a run. It is **never** persisted server-side, is
  never written to logs, and is stripped defensively from error
  messages. No operator-held bulk key means no bulk-key risk.
- **Rate-limit-aware.** A per-campaign `delay_ms` plus a global
  min-interval gate ensures at most one Groq call starts per
  `delay_ms` regardless of how many concurrent workers are running.
- **Campaign analytics.** Qualification rates, seniority distribution,
  per-product-area breakdowns — all pulling directly from Supabase
  with no pre-aggregation job.

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
| Theme | Dark, pure black + sky-blue radial gradient, **Space Mono** font | Calm, identifiable, developer-adjacent feel |
| Charts | **Recharts** via shadcn Chart | Declarative, themable via CSS vars |
| Auth | **Supabase Auth — shared password** (single shared user) | 5-person team, OAuth / per-user auth would be overkill |
| Database | **Supabase Postgres** with row-level security | Managed, auth-integrated, cheap |
| LLM | **Groq** `openai/gpt-oss-120b` via the OpenAI SDK (BYOK) | 250k tokens/min, OpenAI-compatible API, open-weights |
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
                                  prompt_template_versions
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
LinkedIn CSV/JSON
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
      ▼  UPDATE campaigns SET status='completed', qualified_count=…
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
- **Groq keys are the only real secret.** By design, Lead-IQ never
  holds one. Any leak from the server side — compromise, log
  exposure, SQL injection (blocked by RLS but hypothetically) — does
  not give an attacker a Groq key, because there's none to leak. The
  blast radius of a server compromise is confined to the data in
  Supabase, which is internal lead lists.
- **Supabase anon key is public.** That key is designed to be shipped
  to browsers and is not a secret. The security comes from RLS.
- **Supabase service-role key is secret.** Held only in
  Railway's environment, used only by the worker for bulk inserts.
  Rotate if ever exposed.

---

## 8. Current state

**Shipped:**
- Full campaign creation → run → export loop
- Analytics dashboard with live data
- Delete with confirmation
- Rate-limit-aware worker
- BYOK Groq with validation ping
- Space Mono + ASCII hero login page
- Password-based shared auth
- Agent output key-variant normalizer (so `"Function Qualification"`,
  `"functionQualification"`, and `"function_qualification"` all work)

**Not yet shipped (roadmap):**
- **Google Sheets batched push** — the Sheet ID field exists on the
  campaign row, but no push endpoint yet. Requires a Google Cloud
  service account. ~4 hours of work.
- **Analytics filters** — date range, per-template A/B comparison,
  per-campaign drilldown. ~6 hours.
- **Prompt templates CRUD UI** — currently the two seeded templates
  are read-only in the UI; editing requires SQL. ~4 hours.
- **Scheduled / cron runs** — today everything is user-triggered.
- **Multi-tenant** — single-workspace mode for now, by choice.

**Known limitations:**
- A server restart while a campaign is running abandons the run (the
  worker is in-process, not persisted). Mitigation: pause → resume
  works, you'd click Resume after the restart.
- Agent output quality depends on the prompt — ad-hoc prompts that
  don't describe the expected JSON schema clearly will cause
  validation failures. Use the seeded templates as a reference.

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
