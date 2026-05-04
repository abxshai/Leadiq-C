# Lead-IQ — Roadmap

Living doc of what's shipped, what's queued, and what's parked. Update
it every time something lands or a new request comes in. Keep sections
short.

*Last updated: 2026-05-01*

---

## Conventions

- Status tags: `[ ]` todo · `[~]` in progress · `[x]` shipped · `[-]` dropped / deferred indefinitely
- When something ships: move it up to **Shipped**, add the date, keep the description tight.
- When scope shifts: edit in place, don't rewrite history.
- New idea → drop in **Backlog** first. Promote to **Next up** only when there's a clear trigger.
- Feature-level open questions stay **inline under the feature** so they don't get separated from their context.

---

## Next up (active milestones)

### M3 — Prompt templates CRUD + domain analytics

**Why:** Teammates can't add new ICPs without SQL. Analytics group on free-text fields, so the charts get noisy at scale.
**Blocks:** domain chart is useless until we have a stable category column.

**To build:**
- [ ] `/templates/new` page — form: name, description, system_prompt textarea, is_default toggle
- [ ] `/templates/[id]` edit page — same form, pre-filled, saves bump `version` + append to `prompt_template_versions`
- [ ] Duplicate action on template cards → opens `/templates/new` with "Copy of X" pre-filled
- [ ] Archive (not delete) — sets `archived_at`, hides from wizard picker, keeps old campaign snapshots valid
- [ ] Version history drawer with "Restore this version" action
- [x] ~~Add `domain` enum column to agent output~~ — shipped 2026-04-30 as 4 nullable text columns (classification + subdomain + their justifications); free-form rather than enum so prompts can evolve their categorisation without migrations.
- [x] ~~Update normalizer + AgentOutputSchema to validate `domain`~~ — shipped 2026-04-30.
- [ ] Analytics: "Qualified leads by domain" chart (stacked bar) — column exists, just needs the chart wired up.
- [ ] Analytics filters: date range, template multi-select, qualified-only toggle

**Open questions for you:**
1. **Domain enum values** — my starter set: `robotics`, `autonomous-vehicles`, `llm-infra`, `manufacturing`, `enterprise-saas`, `other`. Anything to add / drop / rename?
2. **Backfill strategy** — do we re-run old leads through a backfill job to populate `domain`, or let historical leads show `domain = null` and only new leads get it? Backfill costs Groq tokens; null is free but splits analytics.
3. **Who gets edit rights** — anyone signed in can edit every template (matches current RLS), or do we scope editing to whoever created it? I lean "anyone edits, history preserved" for a 5-person team.

**Estimate:** 4–6 hours.

---

### M4 — Clay webhook integration

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
- [ ] **Groq 400 "Parsing failed" retry.** The current Zod-failure retry doesn't catch this — it's thrown by Groq's JSON-mode parser before we ever see a string. Catch the 400 + re-prompt with the malformed `failed_generation` echoed back, same shape as the existing schema-failure retry. Plan in `lead-iq-roadmap.md` notes; observed on long lead summaries (~big inputs → bigger outputs → more truncation/quote-escape errors).
- [ ] Scrape history — persist each fetched PB run to a `scrapes` table (sales nav URL, agent, row count, pushed-to-campaign IDs) so teammates can see what's been pulled without re-fetching. Today each fetch re-downloads from PB on demand.
- [ ] Native phantom launching from Lead-IQ — revisit the original phantomintegration.md spec (`/agents/save` + `/agents/launch` + cookie BYOK + mutex) if GTM wants "click and scrape" without PB's UI. Deferred; current fetch-only flow covers the need.
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
- [ ] Zombie-campaign auto-reset on server boot. Deferred — operator discipline + coordinated deploys neutralize this at current scale.
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
