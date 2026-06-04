# Lead-IQ — Roadmap

Living doc of what's shipped, what's queued, and what's parked. Update
it every time something lands or a new request comes in. Keep sections
short.

Companion docs: [`DOCS.md`](./DOCS.md) (product + architecture), [`UI.md`](./UI.md) (design system: fonts, color tokens, component conventions, refresh candidates).

*Last updated: 2026-06-04*

---

## Conventions

- Status tags: `[ ]` todo · `[~]` in progress · `[x]` shipped · `[-]` dropped / deferred indefinitely
- When something ships: move it up to **Shipped**, add the date, keep the description tight.
- When scope shifts: edit in place, don't rewrite history.
- New idea → drop in **Backlog** first. Promote to **Next up** only when there's a clear trigger.
- Feature-level open questions stay **inline under the feature** so they don't get separated from their context.

---

## Next up (active milestones)

### M-CX1 — Smartlead/HubSpot cross-check + lead temperature

**Why:** every qualified lead gets enriched with prior touchpoint history (last campaign + status + date) by POSTing to the common-DB, and tagged **hot** / **warm** / **cold** based on the returned touchpoints. New Temperature column on the campaign-detail lead table; existing inline-expand pattern (function reasoning, lead summary) extended with a "Touchpoint history" section for hot/warm leads.

**Dependency:** the common-DB owners (other team) need to ship `POST /api/leads` per the plan doc §2.2. Lead-IQ-side work can start against a stub once the contract is confirmed.

**Plan doc:** [`cross-check-plan.md`](./cross-check-plan.md) — push contract, classifier rules, schema (`0006_lead_temperature.sql`), UI, worker hook.

**Note (2026-06-04):** the HubSpot/Smartlead data now lives in the `crm` schema *inside this same Supabase project* (LeadQuery already reads it). That likely collapses the plan's external `POST /api/leads` round-trip into a **direct local JOIN** against `crm.gtm_contact_data` / `crm.smartlead_email_stats` to compute temperature — no common-DB HTTP contract, no BYOK key, no rate gate. Revisit the plan's §2 (push contract) and §6 (worker hook) against this before building; the classifier rules (§3) and UI (§4) are unaffected. Estimate below predates this simplification.

**Estimate:** ~8 hours once the common-DB endpoint is reachable.

---

### M3.5 — Leads drilldown + analytics deep-links

**Why:** Analytics now slices qualified leads by business unit / ICP / company / campaign, but there's no way to follow a slice down to the actual lead rows that make it up. The next product step is `/leads` — a view-only cross-campaign lead browser whose filter state comes from URL params, so clicking a chart slice in `/analytics` becomes a deep-link.

**To build:**
- [ ] New `/leads` route — paginated lead list joined to `campaigns!inner` (filters orphans, surfaces campaign name)
- [ ] Six-column table: **Name · Function · Domain · Seniority · ICP · LinkedIn** (campaign attribution shows as a subtitle under Name, not a 7th column — locked decision, see `user_memory/project_lead_iq_leads_view_schema.md`)
- [ ] Filter bar mirroring `/analytics` (time range, campaign, business unit, ICP, company), state driven by URL params (`/leads?range=30d&bu=Robotics&company=Acme`)
- [ ] Analytics bar/area charts become clickable — click a business-unit bar → `/leads?bu=<value>` etc.
- [ ] Inline expand rows for prose (function reasoning, etc.) — same UX as the campaign-detail table
- [ ] CSV export of the filtered set (All / Qualified-only)

**Open questions:**
1. Free-text search by name / company / title — add now or defer? I lean add (cheap, high utility).
2. Does the time-series area chart's click drill into a per-day filtered view, or just to the bucket's underlying leads? Lean per-bucket → `/leads?range=custom&from=...&to=...`.

**Out of scope for v1:** action buttons on lead rows (re-run, push to Clay, edit). `/leads` stays view-only — actions live on `/campaigns/[id]` until proven otherwise.

**Estimate:** 4–5 hours.

---

### M-AG2 — Semantic similarity follow-up to M-AG1

**Status:** deferred follow-up to M-AG1.

**Why:** M-AG1's LeadQuery agent answers natural-language → SQL filtering cleanly via MCP-style tools, but can't handle concept-similarity questions like *"find leads about AI infrastructure even if their title says 'ML platform engineer'."* M-AG2 adds pgvector + Supabase gte-small embeddings + a `semantic_search_leads` tool that wraps embed-then-vector-op into one call.

**When:** after the GTM team uses M-AG1 in anger for a couple of weeks and either asks for "find similar to X" workflows or doesn't.

**Plan doc:** [`agent-section-plan.md`](./agent-section-plan.md) §4 (Embeddings) and §8 (Worker hook) — both tagged **[M-AG2 — DEFERRED]** in that doc.

**Estimate:** ~6 hours (migration `0007_pgvector_embeddings.sql` + edge function + worker hook + backfill + semantic tool).

---

### M4 — Clay webhook integration

**Status: parked 2026-05-28.** Smartlead/HubSpot via the common-DB (M-CX1) now covers the outreach push pattern from a different angle (enrichment, not push). Re-evaluate after M-CX1 lands and we see whether there's still a Clay-shaped gap.

**Why:** Qualified leads have to land in Clay for outreach; today that's a manual CSV import. Push model, not pull — simpler both sides.

**To build:**
- [ ] Schema: `campaigns.clay_webhook_url`, `clay_push_status`, `clay_push_error`, `clay_pushed_count`
- [ ] `POST /api/campaigns/:id/push-clay` — validates URL, batches ~100 leads/call, updates counters
- [ ] Campaign detail: "Push to Clay" button (enabled only when `status='completed'`)
- [ ] Wizard step 2: optional Clay webhook URL field
- [ ] Optional "auto-push on completion" checkbox (default OFF to avoid spamming Clay on test runs)
- [ ] Settings page: default Clay URL for the workspace, so most campaigns don't need to paste

**Open questions for you:**
1. **Which leads push** — only `function_qualification='YES'`, or all processed leads? I default to qualified-only.
2. **Auto-push** — default OFF, user ticks a box in the wizard? Or default ON? I lean OFF.
3. **Clay table schema** — I need the target table's column list before I build the mapping. Can you share a sample Clay webhook URL + the expected field names?
4. **Rate limits** — do you know Clay's inbound-webhook rate limits? If not, I'll check docs but worth asking your contact.
5. **Retry on failure** — if batch 7 of 10 fails mid-push, do we want auto-retry, manual-retry-from-where-it-failed, or fail-the-whole-push?

**Estimate:** 4 hours once Clay-side setup is confirmed.

---

## Backlog (not promised, not ordered)

On the radar, not committed. Promote when a real trigger appears.

**Product**
- [ ] **Analytics performance — push aggregations to SQL once data warrants.** Today `/analytics` fetches every processed + failed lead across all campaigns and filters in-memory. Works fine for ~3k leads (current scale); will be visibly slow ~50k, will timeout ~200k. Right fix when needed: pre-aggregated SQL views / RPC that return bucketed series and per-(bu/ICP/company/campaign) counts with the filter set passed as params. Two cheap intermediate wins if scale demands: cap the server fetch to the active time range (server-side `processed_at >= cutoff`), and drop columns we don't visualize.
- [ ] **BI offload (Looker Studio / Metabase) — deferred.** Decision 2026-05-08: keep in-app analytics for now. BI tools are great for analytical / cross-source rollups but bad for operational drilldowns (read-only, no action buttons, Looker's 12-min cache TTL kills real-time). Right shape when Smartlead / HubSpot integrations land: per-source SQL views shaped like `campaign_stats`, then point Metabase/Looker at those views for exec / cross-source reports while keeping operational dashboards in-app. The view layer (which we're already building) is the unified data contract — zero migration cost when the time comes.
- [ ] Scrape history — persist each fetched PB run to a `scrapes` table (sales nav URL, agent, row count, pushed-to-campaign IDs) so teammates can see what's been pulled without re-fetching. Today each fetch re-downloads from PB on demand.
- [ ] Native phantom launching from Lead-IQ — revisit the original phantomintegration.md spec (`/agents/save` + `/agents/launch` + cookie BYOK + mutex) if GTM wants "click and scrape" without PB's UI. Deferred; current fetch-only flow covers the need.
- [x] **Lead sourcing — stay on Phantombuster + Sales Nav, no native scraper, no DB migration.** Decision 2026-06-03 (explored, settled): do **not** build a native LinkedIn scraper (it just pulls LinkedIn's ban surface + legal liability in-house — reverses the original fetch-only call) and do **not** migrate to a static B2B database (Apollo / Clay — they're stale and weak on prose fields like `summary`, which is exactly what qualification needs). Also evaluated **GetSales.io** and passed: it's an outreach-automation platform with scraping bolted on, carries the same session/cookie ban surface as PB, and its advertised extract fields omit the profile About/summary. **Direction:** upgrade to **LinkedIn Sales Navigator Enterprise/Advanced** (allows list exports), and extract via **Phantombuster (or Exa)** — favour *profile* scraping over Sales Nav *search export* because profile pages carry the About/summary that search-export rows don't (and it's a gentler detection vector, trading search-export fingerprinting for profile-view-velocity limits). PB continues to carry the ban-risk surface, consistent with the original fetch-only decision.
- [ ] Google Sheets push — service-account auth, batched `values.append`. Sheet ID field already exists on campaigns. Was originally M4; Clay took priority.
  - *Question:* is this still wanted once Clay is in, or obsolete?
- [ ] Resume button in UI when a campaign is `failed` (today it's a backend capability with no UI entry point).
- [ ] Search / filter on the Campaigns list (by name, date, status).
- [ ] Per-lead retry button on the detail page (retry just the failed rows).
- [ ] Scheduled / cron runs — campaigns that re-run on a schedule pulling a new file from somewhere.
  - *Question:* where does the new file come from? S3 / Drive / URL?
- [ ] Multi-workspace mode — `workspace_id` column + tighter RLS. Zero-migration when needed.
- [ ] Token spend meter — sum `llm_prompt_tokens + llm_completion_tokens` per campaign, estimate $ cost.

**Developer experience**
- [x] ~~Zombie-campaign auto-reset on server boot.~~ Shipped 2026-05-09 via `instrumentation.ts`.
- [x] ~~Update `README.md` — still references magic-link auth.~~ Shipped 2026-04-23 as part of the docs refresh.
- [ ] Move hard-coded shared email `team@lead-iq.local` to an env var.
- [ ] Chunked route handler for createCampaign — current 10 MB Server Action body limit covers ~2k row campaigns; switching to a streaming/chunked route handler would scale arbitrarily and unlock proper progress feedback for huge uploads.

**Security / hardening**
- [ ] Tighten RLS: delete/update on `leads` + `campaigns` checks `created_by = auth.uid()`. Deferred; 5-person trusted team.
- [ ] Login captcha or IP allowlist. Low priority — Supabase throttles by default.
- [ ] Confirm Supabase service-role key was rotated (flagged 2026-04-17 after chat-transcript exposure).

**Polish**
- [ ] Empty states for Campaigns / Templates / Analytics.
- [ ] Toast notifications for create / delete / push-to-clay success.
- [ ] Confirm-on-navigate-away when a run is in flight.

---

## Shipped

**2026-06-04**
- [x] **LeadQuery CRM access — agent reads the `crm` schema (HubSpot + Smartlead).** Extends M-AG1: the three SQL tools (`execute_sql`, `list_tables`, `get_table_schema`) are no longer scoped to `public` — they now also cover the `crm` schema synced by the separate ingest service: `crm.gtm_company_data` (~2.7k), `crm.gtm_contact_data` (~21k), `crm.gtm_deal_data` (~350), `crm.smartlead_email_stats` (~17k). Single source of truth `QUERYABLE_SCHEMAS = ['public','crm']` in `pg-pool.ts`; `execute_sql` sets `SET LOCAL search_path = public, crm` inside the existing read-only txn (so bare names hit `public` first, `crm.<table>` always works); `list_tables` / `get_table_schema` scan both schemas and surface `schema_name`. **No migration or grants** — the `postgres` pooler role the agent connects as already has `SELECT` on the `crm` tables (verified via `has_table_privilege`) and RLS is disabled there. **Read-only is unchanged** — `SET LOCAL transaction read only` is still the boundary; this only widens visibility. No FK columns exist between the CRM tables or to `leads`, so the prompt documents best-effort join keys (validated: the `hs_linkedin_url ↔ leads.default_profile_url` join matches 5,225 leads). Strictly inbound — Lead-IQ still pushes nothing to HubSpot. Deployed to Railway via commit `c8d8c15`.

**2026-05-29**
- [x] **M-AG1 — LeadQuery agent (chat + read-only SQL tools).** New `/chat` route + multi-agent registry; first agent **LeadQuery** answers natural-language questions with raw read-only SQL against `campaigns` / `leads` / `campaign_stats` via three MCP-style tools (`execute_sql`, `list_tables`, `get_table_schema`). Read-only enforced at the Postgres transaction level (`SET LOCAL transaction read only`); 10s statement timeout; 50-row result cap. SSE streaming with token-by-token assistant text + collapsible tool-call cards; Groq tool-call loop in `src/app/api/chat/conversations/[id]/messages/route.ts`. Migration `0005_chat_tables.sql` adds `chat_conversations` + `chat_messages` with RLS and Data API grants per project convention. New env var `SUPABASE_DB_URL` (transaction-pooler URI) — `DEPLOY.md` §8 documents the connection-string lookup. Embeddings + semantic similarity intentionally deferred to M-AG2; migration numbering reflects that (0006 = M-CX1, 0007 = M-AG2). Sidebar entry between Analytics and Settings (MessageSquare icon). Plan doc: [`agent-section-plan.md`](./agent-section-plan.md). Deployed to Railway via commit `e11b9c5`.

**2026-05-13**
- [x] **Brand refresh — #4E8CFA primary.** Iterated through #59afff / #2596be / #BDF6FE / #276DF9 before landing on **#4E8CFA** (`oklch(0.65 0.18 262)`) — a slightly-lighter true blue with one OKLCH triplet shared across light and dark. Every brand-hue token (primary, border, ring, chart-1, accent, sidebar-primary / -border / -ring / -accent) tracks the new color. `--primary-foreground` set to white in both modes (white-on-blue passes WCAG AA at ~4.5:1 in both). Page H1 titles in `PageHeader` now tinted via `text-primary`. Cards gain a subtle dark-grey halo via a new `--card-glow` box-shadow token (`shadow-[var(--card-glow)]` in `card.tsx`, identical light/dark value).
- [x] **Sidebar — Lead-IQ wordmark + logo + brand-tinted active tab.** Replaced the Sparkles icon + "Qualifier" wordmark with `<Image src="/logowhite.png">` + "Lead-IQ" in `app-sidebar.tsx`. Logo asset (776 × 240, white-on-transparent — Deccan company mark) ships in `public/`; `invert dark:invert-0` flips it to black in light mode. `--sidebar-accent` rebased from a legacy hue-240 cool grey onto hue 262 with higher chroma, so the active nav row reads as brand-blue rather than near-neutral. `--sidebar-accent-foreground` retuned to keep text contrast.
- [x] **Login page — company logo + VT323 headline + ASCII trickle.** `<Image src="/logowhite.png">` added above the `lead-IQ` headline. Headline swapped to `font-display` (VT323) so it matches in-app PageHeader typography. ASCII hero sized up 7 / 8 / 9 px → 10 / 12 / 14 px. Surrounding grid widened to `sm:gap-32 sm:grid-cols-[1fr_1.5fr]` so the ASCII sits cleanly off to the right of the headline (clipping only `~35px` of leading whitespace via `overflow-hidden` + `justify-end`).
- [x] **Login hero animation — trickle stream replaces breathing pulse.** `animate-hero-breathe` (opacity + brightness, 5s) retired. `animate-hero-stream` uses `background-clip: text` to apply a repeating 9-stop white → grey → black → grey → white linear-gradient (interpolated `in oklab` for perceptually smooth tone ramp) to the ASCII glyphs; tile is `100% 2em`, `background-position-y` animates 0 → 2em at 2s linear infinite. Net effect: a dense fluid wave of light/dark bands streams downward through the glyph shapes. (Iteration: tried uniform hue cycling, then a 135° diagonal stream, then static white — all rolled back in favour of the dense vertical wave.)
- [x] **Background gradient — left-anchored, indigo-family only.** Four radial blobs in `body::before` repositioned to the left half of the viewport (behind the page title, trailing down the left edge). Largest blob (`130% × 100%` at `12% -5%`) anchors the title area; three smaller stops trail down. Cyan accents (hues 200 / 230) retired in favour of a single indigo family (262 → 275 → 270 → 280) with stops 2–4 lighter (L 0.80–0.85) than the brand anchor (L 0.65). Alphas kept subtle (`0.08 / 0.06 / 0.05 / 0.04` light; ~2× heavier dark). Net effect: an atmospheric soft halo around the title rather than a saturated wash.
- [x] **Browser title.** Metadata title in `layout.tsx` flipped `"Qualifier — Lead Qualification Dashboard"` → `"Lead-IQ"`.

**2026-05-09**
- [x] **Zombie-campaign auto-reset on server boot.** `instrumentation.ts` (Next 16's once-per-boot hook) flips any `leads.status='running'` back to `pending` and any `campaigns.status='running'` to `canceled` on startup. Promoted from backlog after a Railway redeploy mid-run left campaign `aa9dd37d` stuck at 147 processed leads with no worker behind it. The route guard already accepts `canceled` for resume, so users just click Resume after the deploy completes — no SQL needed. Skips Edge runtime, build phase, and dev without a service-role key. Boot log lines surface counts: `[instrumentation] reset N zombie lead(s) ...`.
- [x] **Ingest — strip NUL bytes (U+0000) at parse time.** Phantombuster summary fields occasionally carry stray NUL chars from upstream scraping artifacts; Postgres' JSON parser rejects ` ` escapes when PostgREST serializes the INSERT, atomically failing the chunk with `Failed to insert leads: unsupported Unicode escape sequence`. `lead-parser.ts:str()` now strips NULs before trimming, covering both CSV and JSON ingest paths (regex built via `String.fromCharCode(0)` to keep the source itself NUL-free).
- [x] **Atomic campaign creation — rollback orphans on lead-insert failure.** `createCampaign` was non-atomic: it inserted the campaign row, then chunk-inserted leads; if any chunk failed, the campaign row stayed behind with `total_leads = N` and zero (or partial) actual lead rows. Worker would later silently mark these orphans as "completed". Now wraps the insert loop in try/catch and deletes the campaign row before re-throwing. FK cascade sweeps any partial inserts.
- [x] **Worker — orphan-campaign guard.** After pagination returns zero pending/failed leads, the worker now does a `count(*)` over all statuses. If it's still zero, marks failed with `campaign has no lead rows — likely orphaned by a failed import. Delete and recreate.` Genuinely-re-run-after-completion campaigns (which also have zero pending) have a non-zero total count, so the guard only fires on real orphans.
- [x] **Wizard — surface server-action errors in a banner.** `onCreate` used to await `createCampaign` inside `startTransition` with no try/catch; 10 MB body-limit hits, RLS errors, and network blips all disappeared silently and looked like a platform crash. Now catches non-redirect errors and renders them in a red banner next to the Create button.

**2026-05-08**
- [x] **Prompt templates CRUD shipped.** `/templates` list (active + archived), `/templates/new` form, `/templates/[id]` edit page with side-panel version history. Server actions: create, update, archive, unarchive, duplicate, setDefault, restoreVersion. Editing `system_prompt` or `name` bumps `version` and appends to `prompt_template_versions`; description / default-toggle alone don't bump. `setDefault` clears any prior default first (two-statement race window acceptable at 5-person scale, per DOCS §7). Slug auto-derived from name with random-suffix retry on unique-violation; frozen after create. Snapshot contract verified intact end-to-end: wizard fetches `archived_at IS NULL`, `createCampaign` snapshots `system_prompt + version` into the campaign row at run time, and the worker reads `system_prompt_snapshot` (never re-fetches the template) — edits / restores / archives cannot retroactively change historical campaign behavior.

**2026-05-07**
- [x] **`campaign_stats` SQL view — live aggregate counts per campaign.** Migration `0004_campaign_stats_view.sql` (apply via Supabase SQL editor, project convention). `total_leads`, `touched_count`, `processed_count`, `failed_count`, and `qualified_count` are computed live from the leads table using the `function_qualification IS NOT NULL AND upper(btrim(...)) <> 'NO'` predicate — same predicate as analytics, so categorical verdicts and legacy YES count uniformly without any backfill. `security_invoker = true` so the view honors RLS on the underlying tables. Campaigns list, campaign detail page, and detail polling all read from the view; `campaigns.qualified_count` / `failed_count` columns are no longer surfaced (worker still writes them but nothing reads them — slight tech debt). Fixed the 3386-lead campaign showing "0 / 0" because legacy stored counters missed the categorical verdicts.
- [x] **Analytics rewritten — dynamic, filterable, drops deleted-campaign data.** Server fetch uses `campaigns!inner(...)` so any orphaned lead from a deleted campaign automatically drops out (defense-in-depth on top of FK cascade). `force-dynamic` so deletes / new runs are reflected immediately. Pagination handles ≥1k row datasets past the PostgREST default. Client dashboard with filters: time range (7d / 30d / 90d / All), bucket (day / week / month), and multi-select dropdowns for campaign, business unit (`domain_classification`), ICP, company — all compose in-memory. KPI cards: qualified, qualification rate, processed, avg seniority, active campaigns, failed. Charts: time-series area (qualified vs not), per business unit bar, per ICP bar, per company top-10 bar, per campaign top-12 bar. Predicate switch landed everywhere (`!= 'NO'` instead of `=== "YES"`) — worker `qualified_count` increment matches.
- [x] **Categorical verdict display in the lead table.** Campaign-detail "Qualified" column previously hard-coded to YES / NO / — and silently hid categorical prompts like "Decision Maker". Now renders the literal value with the qualified-positive styling for anything not explicitly "NO".
- [x] **Light / dark theme toggle.** `next-themes` was a dep but wasn't wired — `ThemeProvider` in root layout, light tokens added alongside the dark in `globals.css` (gradient stops + chart axis/grid swap by class), Sun / Moon button in the app header. Default = dark, no system flicker, login screen stays dark-locked.

**2026-05-04**
- [x] **Groq 400 "Parsing failed" retry.** Server-side JSON-mode failures (HTTP 400 with `failed_generation`) used to bubble straight to the lead's `failed` row — the existing Zod retry only sees responses that returned 200. Worker now catches `BadRequestError` around the first Groq call, pulls `failed_generation` defensively from either `err.error.error.failed_generation` or `err.error.failed_generation` (gated on `status === 400` so unrelated errors with similarly-named fields don't trigger a retry), and feeds it into the same retry path the schema-mismatch case uses (assistant turn = malformed text, user turn = "rejected, return valid JSON"). Retry budget unchanged (still 1). Other 4xx/5xx still rethrow as before.
- [x] **`temperature: 0` on agent calls.** Both the first attempt and the retry now pin temperature to 0. Was previously unset, so we were running on Groq's default (≈1.0) — the qualification agent should be near-deterministic, not creative.
- [x] **Retry escape from deterministic JSON-mode failures.** Bumped retry temperature to `0.3` (first call stays at `0`) so when Groq's JSON parser rejects the first output, the retry has enough variance to actually produce different text instead of regenerating the same malformed structure under near-identical prompt context. Also set `max_tokens: 4096` on both calls so verbose prose outputs (4 long reasoning fields × multi-sentence) don't silently truncate mid-JSON.
- [x] **Normalizer hardening: array-prose + out-of-range seniority.** Two recurring Zod failures observed in production: (1) gpt-oss-120b sometimes returns prose fields as an array of sentences (`["foo", "bar"]`) instead of a joined string — observed on `subdomain_justification`, applied uniformly to all string fields; (2) model occasionally returns `seniority_scoring = 0` (or strings/out-of-band floats) when unsure — out-of-range now coerces to null rather than failing the whole lead. Both are upstream of Zod so the schema stays strict.
- [x] **Relax `function_reasoning` + `lead_summary` to nullable.** Schema had both as required strings, but the model occasionally returns terse "NO" responses with these fields omitted entirely — failing the whole lead instead of just dropping the prose. DB columns are already nullable; Zod now matches. Worker writes `?? null` to keep undefined out of the update payload.

**2026-05-05**
- [x] **`function_qualification` is now free-form (categorical-friendly).** Custom prompts can return `"Decision Maker"` / `"Influencer"` / `"Champion"` / etc. instead of being silently coerced back to `YES`/`NO`. Migration `0003_function_qualification_categorical.sql` drops the DB CHECK constraint (apply via Supabase SQL editor — project convention); Zod relaxed from enum to free string; normalizer's `coerceYesNo` now passes unrecognized strings through unchanged while still mapping known synonyms (`true`, `Y`, `qualified`, …) onto canonical `YES`/`NO` for legacy data. Analytics + `campaigns.qualified_count` still match on `=== "YES"` for now (legacy semantics — the analytics revamp will make these predicate-driven).
- [x] **Export CSV toggle: All leads / Qualified only.** Replaced the bare Export button with a dropdown. "Qualified only" filters out explicit `"NO"` verdicts plus any null `function_qualification` (failed/pending leads), and works prompt-agnostically — any non-`NO` value flows through, so categorical prompts are correctly included. Filename suffix `-qualified.csv` reflects the filter.

**2026-05-06**
- [x] **Dedupe duplicate `default_profile_url` rows on ingest.** Diagnosed via a 1724-row campaign that landed only 1000 leads in the DB. The `leads` table has `unique (campaign_id, default_profile_url)`; whichever INSERT chunk first contained a duplicate URL rolled back atomically and the action threw — but earlier chunks were already committed, leaving a half-imported campaign with `total_leads` lying about the real count. Lead-parser now dedupes by `default_profile_url` (rows with null URL are kept — Postgres treats nulls as distinct in unique constraints) and surfaces a `duplicatesSkipped` count; the wizard preview shows it as a yellow badge so the user sees the reduction *before* creating the campaign. Server-side `createCampaign` switched from `.insert()` to `.upsert(…, { ignoreDuplicates: true })` as defense-in-depth so any future ingest path that bypasses the parser still can't half-import.

**2026-05-01**
- [x] **Inline lead detail in campaign view.** Compact ICP + Domain columns added to the lead-row table; clicking any row with prose content expands it inline to show function reasoning, subdomain justification, domain reasoning, and lead summary. Eliminates the CSV-export round-trip for QA / spot-checking.
- [x] **Refresh-error banner on campaign detail.** The leads SELECT used to silently swallow Supabase errors — empty table with no clue why. Now any error from the campaign-row, lead-list, or count-query refresh surfaces as a red banner with the exact message.

**2026-04-30**
- [x] **Domain classification fields end-to-end.** Added 4 nullable columns to `leads` (`domain_classification`, `subdomain`, `subdomain_justification`, `domain_reasoning`); dropped the YES/NO check on `icp_qualification` so it accepts categorical values like "Influencer" / "Decision Maker"; extended Zod + the agent-output normalizer; worker writes them; CSV export includes them in the right column order. Migration `0002_agent_domain_fields.sql` is local-only — applied manually to prod via Supabase SQL editor (project convention).

**2026-04-28**
- [x] **Worker reliability fixes.** Three layered bugs that were silently misreporting big campaigns as `completed`:
    - Pagination for the pending-lead SELECT (PostgREST's 1000-row default was capping a 1950-row campaign at the first 1000).
    - Post-run gate that counts leftover pending/running leads before flipping status to `completed`; falls back to `failed` with `partial run: N leads still pending` when the math doesn't add up.
    - Try/catch around the per-lead error-write update so a failed update inside the catch block doesn't slip a lead silently back to `pending`.
- [x] **Failed-lead retry on rerun.** Lead SELECT now picks up `status IN ('pending','failed')` so transient errors (Groq 4xx, network, expired cookies) clear on a second attempt; success-path UPDATE overwrites the prior error in place.
- [x] **Read-side pagination.** Same PostgREST cap was clipping the campaign-detail page's lead list and the CSV export. Detail page now uses a server-side count query for KPIs (accurate at any size) + ranges to 5000 for the table; CSV export paginates page-by-page.

**2026-04-23**
- [x] **Server Action body limit raised to 10 MB.** Push to Campaign 413'd in production for ~200+ row scrapes; default of 1 MB was too tight once profile summaries went into the leads array. Bumped via `experimental.serverActions.bodySizeLimit` in `next.config.ts`. Headroom for ~2k row campaigns; bigger pushes will need a chunked route handler eventually.

**2026-04-22**
- [x] **Phantombuster scrape ingestion.** Scrape entry in the sidebar above Campaigns. BYOK for the PB API key (sessionStorage, header-forwarded, never persisted — same pattern as Groq). Dropdown of phantoms on the connected account (live from `/agents/fetch-all`) with optional container-ID override for older runs. Fetch pulls the latest finished container's result CSV, resolves the URL via log-scan → `result-object` → `orgS3Folder/s3Folder` fallbacks, timestamp-filters to the container's own run, and trims to the 9 qualification-input columns. Download CSV and Push to Campaign buttons on the result card; Push hands the CSV to the existing RunWizard which auto-skips to the Configure step.
  - **Pivot from the original spec:** phantomintegration.md proposed launching phantoms from Lead-IQ (`/agents/save` + `/agents/launch` + mutex + cookie BYOK). We shipped the simpler fetch-only flow — teammates drive scrapes in PB's UI, Lead-IQ just pulls the output. No ban-risk surface added (PB carries that either way), no cookie/UA plumbing, no launch clobbering identity.
- [x] `scripts/phantombuster-scrape.mjs` — local CLI reference for the PB API chain (save → launch → poll → fetch result), kept for future phase-2 work if we ever revisit native launching.

**2026-04-20**
- [x] Fixed open-redirect on login (rejects external `next` query params)
- [x] Removed dead `/auth/callback` route + references (leftover from magic-link era)

**2026-04-18**
- [x] Agent-output key normalizer — title-case, camelCase, wrapper objects, loose YES/NO casing. Fixed the 494-lead schema-mismatch failure.
- [x] `DOCS.md` — product + architecture overview for non-devs.

**2026-04-17**
- [x] **M2** — end-to-end campaign loop: run wizard, Groq BYOK worker, analytics, delete action, CSV export.
- [x] Password-based shared auth (`team@lead-iq.local`).
- [x] Space Mono font + black + sky-blue gradient theme.
- [x] Custom ASCII hero on login with breathing animation.
- [x] Extended left-edge gradient behind the login form.
- [x] Per-campaign `delay_ms` + global rate gate for Groq's 250k TPM ceiling.
- [x] Analytics v1: KPIs, 30-day trend area chart, top product areas, seniority distribution.
- [x] Rolled back from Resend SMTP; rolled back from magic link to shared password.
- [x] Deployed to Railway: <https://lead-iq.up.railway.app/>
- [x] Repo: <https://github.com/abxshai/Lead-IQ>
- [x] `DEPLOY.md` — Railway walkthrough.
- [x] Supabase schema + seed templates (Robotics, General B2B) + RLS policies.

**2026-04-17 (earlier)**
- [x] **M1** — Next.js 16 scaffold, shadcn/ui, Supabase schema, app shell with sidebar.

---

## How to maintain this doc

- After shipping something, delete the `[ ]` line from **Next up** / **Backlog** and add a `[x]` line to **Shipped** with today's date.
- When a milestone fully wraps, roll its sub-items up into one line under Shipped.
- If a backlog item sits untouched for 3+ months, reconsider: delete, tag `[-]` deferred, or promote to Next up.
- Every commit that changes the feature set should bump `Last updated` at the top.
