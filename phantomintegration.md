# Phantom Integration — Feature Spec

> **⚠️ HISTORICAL — this spec is NOT what shipped.** Kept for reference.
>
> This document describes the original "launch phantoms from Lead-IQ"
> design (cookie BYOK, `/agents/save` + `/agents/launch` per run, shared
> phantom mutex, two-phase scrape-then-qualify campaigns). On 2026-04-22
> we pivoted to a **fetch-only** flow: teammates run scrapes in PB's UI,
> Lead-IQ pulls the result CSV via the PB API and pushes it through the
> existing campaign pipeline. The launch-from-Lead-IQ surface (cookies,
> mutex, identity overrides, scrape status columns on `campaigns`) was
> never built.
>
> **What actually shipped is documented in:**
> - `DOCS.md` §2(a), §3, §6 — product flow and architecture
> - `lead-iq-roadmap.md` 2026-04-22 entry — including the rationale for
>   the pivot
> - `src/lib/pb-fetch.ts`, `src/app/api/pb-fetch/route.ts`,
>   `src/app/api/pb-agents/route.ts`, `src/app/(app)/scrape/page.tsx`
>
> Re-read this spec only if reviving the native-launch idea (listed in
> the roadmap backlog).
>
> ---

Handoff doc for a fresh Claude session. Purpose: adding Phantombuster
Sales Navigator Search Export + auto-feed into qualification, as a new
campaign type inside Lead-IQ.

Everything here is current as of 2026-04-21. Paste this whole file into
the new conversation so Claude doesn't re-derive context we've already
settled.

---

## 1. What Lead-IQ is (one-paragraph context)

Lead-IQ is Deccan AI's internal self-serve dashboard for qualifying
LinkedIn leads against an ICP (manufacturing robotics, by default) using
Groq's `openai/gpt-oss-120b`. Live at <https://lead-iq.up.railway.app>,
repo at <https://github.com/abxshai/Lead-IQ>. Today's flow: a teammate
uploads a CSV/JSON of LinkedIn profiles → picks a prompt template → runs
→ watches progress → exports CSV. BYOK for Groq (per-user keys, in
sessionStorage + worker closure, never persisted). Shared-password auth
(single Supabase user `team@lead-iq.local`, five-person team).

Three docs in the repo root describe it:
- `DOCS.md` — product + architecture overview
- `README.md` — developer setup (note: still mentions magic-link auth, stale on that point)
- `DEPLOY.md` — Railway walkthrough
- `lead-iq-roadmap.md` — living roadmap (local only, not committed)

Tech stack: Next.js 16 App Router, shadcn/ui on Base UI, Tailwind v4,
Supabase Postgres + Auth, OpenAI SDK pointed at Groq, Zustand (BYOK
state), p-limit + custom rate gate, deployed on Railway.

Critical invariants to preserve:
- **BYOK for Groq must not regress.** Groq keys never leave the browser
  except forwarded in the `X-Groq-Key` header for the duration of a run.
  Nothing in this feature should add a server-held Groq key.
- **Prompt snapshot is sacred.** `campaigns.system_prompt_snapshot` is
  frozen at campaign creation; never mutate it on historical rows.

---

## 2. The feature in one sentence

Add a **Scrape** entry point that lets teammates launch a Sales Navigator
Search Export via Phantombuster using a chosen LinkedIn account's
cookie, then automatically pipes the scraped CSV into the existing
qualification pipeline as one continuous two-phase campaign.

---

## 3. Design decisions already locked in

These were settled in the planning conversation. Don't re-litigate unless
something forces a rethink.

**Topology**
- One Phantombuster workspace (one API key, stored in env as
  `PHANTOMBUSTER_API_KEY`).
- **Option A: one shared Sales Navigator Search Export agent.** We
  overwrite its `sessionCookie` + `userAgent` per run via
  `POST /agents/save`. A mutex serializes scrape launches across the
  whole team.
- Multiple LinkedIn accounts stored per teammate. Each account has its
  own `li_at` cookie + user-agent.
- Option B (one phantom per LinkedIn account) is the future upgrade if
  scrape queuing becomes a real bottleneck. Not day-one.

**Cookies**
- Can't be fetched via any API. Must be pasted by a human once per
  account, every 2–30 days when LinkedIn expires them.
- Store encrypted in Supabase (`pgcrypto`).
- Never send decrypted cookies to the browser. Decrypt server-side at
  scrape time only.
- Track `last_verified_at` (bump on successful scrape) and detect
  expiry from Phantombuster's error output.

**Campaign model**
- One campaign = one scrape + one qualification. Not two campaigns.
  Preserves lineage (`sales_nav_search_url` → qualified leads).
- Status transitions: `pending_scrape → scraping → scraped → running
  → completed` (or `failed` at any step with a stored reason).
- `scraping → scraped` does parse + bulk insert the CSV automatically.
  Then **pause for preview** by default (user clicks "Continue" to
  start qualification). A per-campaign "auto-continue" toggle lets
  power users skip the preview.

**Progress UX**
- Two separate progress bars, visible based on current phase.
  - Scrape: driven by Phantombuster's `progress` field when present,
    falls back to indeterminate shimmer with live status text.
  - Qualify: existing `processed / total_leads` bar.
- Queue UX: if a scrape is queued, show
  *"Waiting in scrape queue: N ahead (~X min)"*. Let the user cancel
  their own queued scrape.

**Qualification is NOT serialized.** Only scrape is. Two teammates can
qualify in parallel (each on their own Groq key) even if scrape had to
queue. The mutex releases the moment the scrape phase ends.

---

## 4. Open decisions (user hasn't answered yet)

These four need user input before writing code. If the new Claude session
starts without answers, ask first.

1. **Phantombuster plan limits** — does the current plan allow enough
   phantoms to later move to Option B (one-phantom-per-account)? Not
   blocking Phase 0, but informs whether we need to design the data
   model around one phantom or N phantoms from the start.
2. **Auto-continue vs manual preview** — default is manual preview with
   a toggle. Confirm this matches user intent.
3. **Cookie refresh UX** — teammates paste their own cookies (instructions
   + dialog), or one admin centrally manages all cookies? Leaning
   self-service per teammate.
4. **Simultaneous scrape tolerance** — is a 5-ish minute queue wait
   actually acceptable for the team, or is that a dealbreaker?

---

## 5. Phantombuster API surface we'll touch

All under `https://api.phantombuster.com/api/v2/`. Auth header:
`X-Phantombuster-Key-1: <api-key>`.

**The 5 endpoints:**

- `POST /agents/save` — overwrite agent's stored argument JSON. We call
  this to inject the active teammate's `sessionCookie` + `userAgent` +
  the Sales Nav search URL before launch.
- `POST /agents/launch` — start a run. Returns `containerId`.
- `GET /containers/fetch-output?id=<containerId>` — polls the run's
  log stream. Includes `status` (`running`/`finished`/`error`) and
  `progress` (0–100, not always reliable). Poll every 5s.
- `GET /agents/fetch?id=<agentId>` — returns `orgS3Folder` +
  `s3Folder`. Needed once per run to build the result URL.
- S3 direct download — construct URL as
  `https://phantombuster.s3.amazonaws.com/<orgS3Folder>/<s3Folder>/result.csv`.
  Download, parse with existing `papaparse + alias map` from
  `src/lib/lead-parser.ts`.

**Arguments we'll send on `/agents/save`:**
```json
{
  "id": "<AGENT_ID>",
  "argument": {
    "sessionCookie": "<li_at>",
    "userAgent": "<UA string>",
    "searches": "<sales-nav-search-url>",
    "numberOfResultsPerLaunch": 250,
    "numberOfResultsPerSearch": 500
  }
}
```
Ranges on `numberOfResultsPerLaunch` / `numberOfResultsPerSearch` need
tuning; defaults here are safe starters.

**Expiry detection.** Phantombuster's log output for a bad session
cookie contains strings like `"LinkedIn session cookie is invalid or
expired"`. Match on that in the polled output to flag the account as
`needs_refresh` immediately.

---

## 6. Schema changes

```sql
-- Encryption key setup (one-time, in Supabase SQL editor)
create extension if not exists pgcrypto;

-- Encrypted LinkedIn cookies, one row per connected account.
create table public.linkedin_accounts (
  id uuid primary key default gen_random_uuid(),
  label text not null,                       -- e.g. "Abishai — Sales Nav Premium"
  session_cookie_enc bytea,                  -- pgp_sym_encrypt of li_at
  user_agent text,
  cookie_expires_at_est timestamptz,         -- optimistic, for UI hinting
  last_verified_at timestamptz,
  status text not null default 'ok'
    check (status in ('ok', 'needs_refresh', 'disabled')),
  last_error text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Two new optional columns on campaigns
alter table public.campaigns
  add column if not exists linkedin_account_id uuid
    references public.linkedin_accounts(id) on delete set null,
  add column if not exists sales_nav_search_url text,
  add column if not exists scrape_status text
    check (scrape_status in
      ('none','pending','scraping','scraped','failed') or scrape_status is null),
  add column if not exists scrape_container_id text,
  add column if not exists scrape_progress_pct int,
  add column if not exists scrape_error text,
  add column if not exists scrape_started_at timestamptz,
  add column if not exists scrape_finished_at timestamptz,
  add column if not exists auto_qualify_after_scrape boolean
    not null default false;

-- Global scrape lock table (simpler than pg_advisory_lock for this shape)
create table public.scrape_mutex (
  id int primary key default 1,
  locked_by_campaign_id uuid references public.campaigns(id) on delete set null,
  locked_at timestamptz,
  constraint single_row check (id = 1)
);
insert into public.scrape_mutex (id) values (1) on conflict do nothing;

-- Encryption / decryption helper functions (executed with definer rights,
-- encryption key stored in a Supabase vault — set up separately)
-- Pseudo:
--   create function encrypt_cookie(raw text) returns bytea ...
--   create function decrypt_cookie(enc bytea) returns text ...
```

Index additions: `linkedin_accounts(status)`,
`campaigns(scrape_status)`.

**RLS:** same pattern as existing tables (authenticated can read/write).
Tighten later when multi-tenant.

---

## 7. Env vars

Add to Railway + `.env.local`:

```
PHANTOMBUSTER_API_KEY=...
PHANTOMBUSTER_SALES_NAV_AGENT_ID=...
# For pgcrypto: the symmetric key for cookie encryption
COOKIE_ENC_KEY=<32-byte random string>
```

---

## 8. Build phases

### Phase 0 — local throwaway CLI (1–2 hrs)

Script: `scripts/phantombuster-scrape.mjs`. Takes a Sales Nav search URL
as argv, plus env-loaded API key + agent ID + a test cookie.
End-to-end:
1. `POST /agents/save` with search URL + cookie
2. `POST /agents/launch`
3. Poll `fetch-output` until `status !== 'running'`
4. Download CSV from S3
5. Print row count + file path

**Purpose:** prove the API chain works before touching Lead-IQ. No UI.
No Supabase. Pure CLI.

**Needs from user:** Phantombuster API key, agent ID, and one valid
`li_at` cookie + user-agent string for testing.

### Phase 1 — LinkedIn accounts UI + encrypted storage (2–3 hrs)

- SQL migration for `linkedin_accounts` + pgcrypto + encrypt/decrypt
  functions.
- New route `/settings/linkedin-accounts`.
- Card list of connected accounts with label, `last_verified_at`,
  cookie age indicator (green/yellow/red), status badge.
- "Add account" dialog — paste `li_at` + auto-detect user-agent via
  `navigator.userAgent` + optional label.
- "Refresh cookie" dialog — same as add, for existing account.
- Server actions: `createLinkedInAccount`, `updateLinkedInAccount`,
  `archiveLinkedInAccount`. All server-side only touch decrypted
  cookies.

**Deliverable:** a teammate can add + maintain their LinkedIn accounts.
No scraping yet.

### Phase 2 — scrape worker + mutex (3–4 hrs)

- Port the Phase 0 CLI into `src/lib/scrape-worker.ts`.
- Acquire `scrape_mutex` via atomic UPDATE — first to set
  `locked_by_campaign_id` wins, others queue.
- State transitions: `pending_scrape → scraping → scraped`.
- Poll every 5s, update `scrape_progress_pct` + phantom output log
  snippet on the campaign row.
- On finish: download S3 CSV, parse with existing `lead-parser`,
  bulk-insert into `leads`, set `scrape_status = 'scraped'`, release
  mutex.
- Detect cookie-expired errors from phantom output, flag the
  `linkedin_accounts` row as `needs_refresh`, fail the campaign with
  a clear message.

**Deliverable:** server-side worker can scrape + parse. Kicked off by
an API route but no UI yet.

### Phase 3 — scrape wizard + nav entry (2–3 hrs)

- New sidebar entry: **Scrape** → `/scrape/new`.
- 3-step wizard:
  1. Pick LinkedIn account + Sales Nav search URL + results-limit
  2. Pick prompt template + concurrency + delay_ms (same as
     qualify wizard, re-used components)
  3. Confirm + launch
- Routes to campaign detail page as usual.
- Auto-continue checkbox on step 2, default off (respects user
  preference per campaign).

### Phase 4 — progress UI on campaign detail (1–2 hrs)

- Show scrape progress bar when `scrape_status in ('pending','scraping')`.
- Queue message when `scrape_status = 'pending'` and mutex held by
  another campaign: *"Waiting in scrape queue. 1 campaign ahead (~3
  min remaining)."*
- On `scraped → running`, transition seamlessly to existing qualify
  progress bar.
- If `auto_qualify_after_scrape = false`, show a "Continue to
  qualify" button instead of auto-starting.
- "Cancel queued scrape" action when campaign is in `pending_scrape`
  and not yet acquired.

### Phase 5 — polish & safety (2–3 hrs, optional)

- Cookie age warning toasts when account hasn't been verified in >10d.
- Show Phantombuster's live log tail in an expandable drawer for debug.
- Rate-limiting between scrape jobs using the same account (e.g.,
  reject if same account scraped in the last 5 min).
- Analytics filter: "source = scraped | uploaded".

**Total estimate: 12–15 hrs for Phases 0–4. Phase 5 is ~3 more.**

---

## 9. Risks & mitigations

- **LinkedIn page structure changes.** Phantombuster phantoms break for
  a day or two when this happens. Not our problem to fix — surface
  Phantombuster's error clearly so users blame the right party.
- **LinkedIn account bans.** Real risk with Sales Nav scraping. Document
  in the "Add account" dialog: *"Use this account at your own risk.
  LinkedIn may flag accounts used for automated scraping."* Recommend a
  dedicated "scraper" LinkedIn account over personal accounts.
- **Cookie rotation burden.** Expect once-per-~10-day paste per
  account. Mitigate with clear expiry UI + (eventually) a Chrome
  extension that can read the cookie directly.
- **Mutex starvation.** If scrape A hangs, B is stuck waiting
  indefinitely. Mitigation: enforce a max scrape duration (e.g.,
  20 min). If exceeded, auto-release the mutex + fail A.
- **Phantombuster API downtime.** We depend on it for the whole scrape
  phase. If it's down, show a clear error + don't block other
  qualifications (they don't use Phantombuster).

---

## 10. Non-goals for v1

Explicitly not doing:
- Chrome extension for auto-cookie capture.
- Per-phantom-per-account (Option B).
- Advanced Sales Nav filters (location / seniority / industry built into
  the UI — users paste a full Sales Nav URL that already has filters).
- Multiple searches per run (batch mode). Phase 5 or later.
- Scheduled / cron scraping.
- Non-Sales-Nav Phantombuster phantoms (LinkedIn Profile Scraper, etc.).
  Could be added but not requested.

---

## 11. Handoff checklist for the new Claude session

Paste this whole file. Then tell Claude:

> I want to build the Phantombuster integration described in this spec.
> Start with Phase 0 (the local CLI). Before you write code, confirm my
> answers to the four open decisions in §4 and ask for the
> Phantombuster credentials you'll need.

Claude should not re-derive the design. It should just execute.

---

## 12. What's shipped so far (so you don't re-ask)

From `lead-iq-roadmap.md`, current state (2026-04-21):

**Shipped:**
- Next.js 16 scaffold, shadcn/ui, Tailwind v4, Supabase schema + seed templates + RLS
- Password-based shared auth
- Run wizard (upload CSV/JSON → configure → launch)
- Groq BYOK worker with rate gate
- Campaign detail page with live progress + CSV export + delete
- Analytics v1 (KPIs, trend, product-area, seniority distribution)
- Agent-output key normalizer (handles title-case/camelCase variants)
- Login page with Space Mono + ASCII hero + breathing animation
- Railway deployment at <https://lead-iq.up.railway.app>
- DOCS.md, DEPLOY.md

**Queued (not started):**
- M3: Prompt templates CRUD + domain analytics
- M4: Clay webhook integration
- This spec: Phantombuster scrape-and-qualify

---

*End of spec. 640-ish lines; paste wholesale into the new Claude session.*
