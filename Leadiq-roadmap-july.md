# Lead-IQ — July scale-up brainstorm (multi-source intent engine)

*Created 2026-07-08. A brainstorm / planning doc — options and leans, not committed decisions. Feeds future milestones in [`lead-iq-roadmap.md`](./lead-iq-roadmap.md). Scope: evolve Lead-IQ from outbound-only into a multi-source lead + intent engine (MQLs, website leads, and the cron signal-agents), and decide how those leads get stored, stamped, routed, and synced to HubSpot.*

---

## 0. Where we are today (context)
Current funnel: **outbound scrape → qualify (Groq, 12-field) → temperature/reply-status → `/opportunities`**.
- `/opportunities` shipped (Scope B + pending deals): surfaces genuine-interest Smartlead conversations (`meeting`/`interested`) + open HubSpot deals as cards, sourced from the read-only `crm` schema.
- `/analytics` was removed (2026-06-22).
- **Lead-IQ is currently read-only toward HubSpot** — the `crm` schema is *ingested into* Lead-IQ by a **separate team's sync**; Lead-IQ pushes nothing to HubSpot today.
- New cron agent skills already exist and route to **Google Sheet + Slack** (human reviews, never auto-sends): `sentra` (engagement→qualified SDR), `databiz-signals` (buying-signal monitoring), `new-entrants` (newly-funded-startup discovery). These are additional *lead/signal sources* that need the same storage/routing answer.

---

## 1. The unifying idea
Today leads enter one way (PB scrape) and the qualifier/temperature/opportunities machinery is reusable but hard-wired to that source. The scale-up is to make Lead-IQ **source-agnostic**: add a `lead_source` dimension + a **signals** model, then let the *same* qualifier + scoring + opportunities surface everything. Every avenue below plugs into that one spine rather than being a separate app. Critically, **all the agents** (MQL, website, sentra, databiz-signals, new-entrants) should feed **one shared intake + routing layer** — not each invent their own.

---

## 2. Part A — scaling avenues

### 2.1 MQLs — content-engagement tracked by scheduled agents *(primary)*
"MQL" = **engaged AND fits ICP** (engagement alone is noise). Content-engagement sources for Deccan:
- LinkedIn post likers/commenters (Deccan's + founders' posts) — PB has a "Post Likers/Commenters" phantom, reuses existing ingest.
- Newsletter opens/clicks, gated-content downloads, webinar/event signups, blog/YouTube engagement.

**Cron-agent design (the LangChain-on-cron idea):** one scheduled agent per source → *fetch new engagers → dedup → enrich (LinkedIn profile) → run existing qualification pipeline → compute MQL score → route.*
- **MQL score = fit (qualifier verdict/ICP/priority) × decayed engagement (recency + frequency).** Recompute on each new signal.
- First source to build: **LinkedIn post likers/commenters** (reuses PB muscle).
- Route hot MQLs → `/opportunities` (new signal type) or `/mql` view + Slack ping.
- Why: MQLs convert far better than cold scrapes; "I built the inbound MQL engine" is a revenue story.

### 2.2 Website leads *(highest intent — prioritize)*
- **Form-fills** (demo/contact) — already flow into HubSpot, which is already in the `crm` schema. Near-zero-lift v1: pull recent HubSpot contacts with a website-form source → qualify → surface as the **hottest** opportunity type. Add a **HubSpot form webhook → qualify → instant Slack** path for real-time.
- **De-anonymized visitors** (browsing without a form) — via RB2B / Koala / Clearbit Reveal / Common Room. Higher effort (needs a vendor); later add.
- Website leads should **jump the queue** in opportunity ranking (self-identified intent beats everything).

### 2.3 Competitor content *(low priority)*
Same engager-scraping mechanic pointed at competitors' posts/followers → category-interested people → qualify + flag `competitor-intent`. Noisy, lower-signal, ToS caveat — build last.

### 2.4 Avenues not originally raised (worth considering)
- **Unified intent score + identity resolution** — one person appears across scrape + MQL + website + Smartlead + HubSpot; resolve identity and blend all signals into one intent score → the master ranking for `/opportunities`. This is the real backbone.
- **In-app scheduled-agents framework** (the "cron runs" backlog item) — a generic runner (source config → fetch → qualify → route) that MQL/website/competitor/the skills all share. Build once.
- **Conversion feedback loop (Deccan-native evals)** — track which MQLs/opportunities became meetings/deals → feed back to tune the qualifier + MQL score. Evals applied to our own funnel.
- **Real-time Slack routing** for top-intent events (website form, hot MQL) — speed-to-lead wins inbound.

---

## 3. Part A — routing & storage architecture

### 3.1 Core question: who is the system of record?
Keep three systems in their lanes:
- **Lead-IQ = the brain / staging layer** — discovery, dedup, qualification, scoring, and the audit trail of *why* something surfaced. **Not a second CRM.**
- **HubSpot = system of record for sales action** — contacts, lifecycle stage, deals.
- **Slack + Google Sheet = routing surface** — where a human sees + approves (matches the existing agent-skill pattern: route → human reviews → nothing auto-sent).

**Lean:** Lead-IQ stores everything it sources (with stamps), routes to Slack/Sheet for review, and pushes **only approved** records to HubSpot. Don't skip the Lead-IQ copy (needed for dedup + scoring + not re-alerting); don't dump unreviewed scraped leads into HubSpot (CRM hygiene + sales trust).

### 3.2 Decision — store in Lead-IQ: yes, with a signals model
The current `leads` table is **campaign-scoped** (unique per `campaign_id`+URL); MQLs/website/signal leads aren't campaigns.
- **Pragmatic (ship fast):** add `source`, `source_detail`, `first_seen_at`, `last_engaged_at`, `engagement_count`, `mql_score`, `routed_at`, `hubspot_synced_at` to `leads`; allow `campaign_id` null or use synthetic per-source pseudo-campaigns ("MQL – LinkedIn", "Website").
- **Clean (right long-term):** a source-agnostic **`people`** table (one row per person, canonical key) + a **`signals`** table (one row per engagement *event*: source, type, `occurred_at`, ref, payload).

**Lean:** build the **`signals` table now** (event history can't be reconstructed later; recency/frequency scoring needs the events) + a lightweight `people` upsert; keep pragmatic stamps on `leads` for continuity.

### 3.3 Decision — stamps: what to record
- **Per person:** canonical key (normalized LinkedIn URL primary, email secondary), sources seen, `first_seen_at`, `last_engaged_at`, qualification verdict (reuse pipeline), `mql_score`, status, `hubspot_contact_id` (once synced).
- **Per signal/event:** person key, `source` (linkedin_post / newsletter / website_form / webinar / competitor_post / databiz / new-entrant), `type` (like/comment/open/click/formfill/attend), `occurred_at`, `source_ref` (post/form URL), raw payload.
- Stamps enable **recency scoring, dedup, and "don't re-alert" logic** — not optional.

### 3.4 Decision — push to HubSpot? *(the big one)*
Flips Lead-IQ from read-only to a writer, so handle with care.
- **(A) Don't write** — route via Slack + Sheet only. Matches existing skills, zero write scope, human decides what enters the CRM. Lowest risk.
- **(B) Write to HubSpot** — create/update contact, set `lifecyclestage = marketingqualifiedlead`, stamp source + `mql_score` in custom properties, log an engagement. Single pane for sales + **closes the loop** (syncs back into `crm` → temperature/opportunities pick it up). Risks: dedup vs existing contacts, API rate limits, and a **sync loop** (Lead-IQ writes → ingest syncs back → Lead-IQ re-sees → don't double-count/re-route).
- **(C) Staged / human-in-the-loop** — Lead-IQ stages + Slack-alerts → on approval, push to HubSpot.

**Lean: start (A), design toward (C).** Slack + Sheet now (consistent with the other agents); add the HubSpot write behind an "approve → sync" action once a source is trusted. **Coordinate the write direction with the ingest team** — they own HubSpot↔Supabase; a two-way flow needs an agreed contract (which properties Lead-IQ owns, how to avoid the loop, the dedup key).

### 3.5 Decision — dedup / identity resolution
One person arrives from scrape + LinkedIn engagement + website + HubSpot. **Canonical key = normalized LinkedIn URL** (primary; scrape + LinkedIn MQL have it), **email secondary** (website/HubSpot), reconciled via the existing `gtm_contact_data` bridge. **Upsert on the canonical key** → 3 sources = 1 person + 3 signals. Reuse the temperature-join normalization.

### 3.6 Decision — routing rules (recency- & dedup-aware)
- **Real-time** Slack ping for the hottest: website form-fills, high `mql_score` crossings.
- **Digest** (daily Sheet/Slack) for the long tail.
- **Don't re-alert** the same person for the same signal — only on new meaningful engagement or a score-threshold crossing.
- Lifecycle state machine: `discovered → qualified → MQL → routed → synced` (sales owns after).

### 3.7 The loop closes itself
Once MQLs are in HubSpot (or engaged in Smartlead), downstream replies/deals flow back through the `crm` schema, and **`/opportunities` already surfaces genuine-interest conversations + pending deals** — so a converting MQL shows up in opportunities automatically. Capture at the top, opportunities at the bottom, one loop.

---

## 4. Proposed end-to-end shape
```
Any source-agent (MQL / website / databiz-signals / new-entrants / sentra)
      ↓ normalize + dedup on canonical key (LinkedIn URL ↔ email)
Lead-IQ: upsert person + append signal (stamped) → qualify (reuse pipeline) → mql_score
      ↓ route
Slack (real-time hot) + Google Sheet (digest)  → human review
      ↓ on approval
HubSpot (contact + lifecyclestage=MQL + source/score props)   [Phase 2, coord w/ ingest team]
      ↓ ingest sync
crm schema → /opportunities surfaces the ones that convert
```

---

## 5. Suggested sequencing
1. **Foundation:** source-agnostic ingest + `signals`/`people` model + the shared intake/routing layer (all agents feed it).
2. **Website form-fills** (near-zero lift via HubSpot) → surface as top-priority opportunities.
3. **LinkedIn-engagement MQLs** (the cron agent) → route Slack/Sheet.
4. **Unified intent score + identity resolution** (the backbone for ranking).
5. **HubSpot write-back** (staged, human-in-loop) — after ingest-team contract.
6. **De-anon visitors** → then **competitor content** (last).

---

## 6. Open questions (these gate the build)
1. **HubSpot write — in scope now, or Slack/Sheet-only first?** (Depends on the ingest team's appetite for a two-way contract.)
2. **`signals` + `people` tables now, or bolt stamps onto `leads`?** (Lean: new tables — cheap now, painful to retrofit.)
3. **Do `databiz-signals` / `new-entrants` / `sentra` route through this shared layer**, or stay standalone Sheet/Slack? (Unifying them is the higher-leverage play.)
4. **Canonical key when a source has only email** (website) and no LinkedIn URL — accept email-only people, or require enrichment to a profile first?
