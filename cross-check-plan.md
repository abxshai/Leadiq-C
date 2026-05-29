# Lead-IQ — Touchpoint cross-check + lead temperature plan

*Last updated: 2026-05-28*

Companion docs: [`lead-iq-roadmap.md`](./lead-iq-roadmap.md), [`DOCS.md`](./DOCS.md), [`UI.md`](./UI.md).

---

## 0. Why this exists

Lead-IQ produces a qualified-lead verdict per row but is blind to whether the GTM team has already engaged that person — through a Smartlead campaign, a HubSpot deal, a meeting, or anywhere else. The new common-DB project (Smartlead + HubSpot + future sources ingested into one Supabase/Postgres instance) gives us the data; this plan describes how Lead-IQ pushes its qualified leads into that DB, classifies each one's relationship temperature (hot / warm / cold) from the returned touchpoint history, and surfaces the result in the campaign-detail UI.

**Handoff boundary:** the common-DB itself — schema, Smartlead ingest, HubSpot ingest — is owned by another team. This doc treats it as a remote HTTP service Lead-IQ depends on, and defines the contract Lead-IQ needs from them.

---

## 1. Scope

**In scope (Lead-IQ side):**
- Push every qualified lead's JSON payload to the common-DB
- Consume the returned touchpoint history
- Classify each lead as `hot` / `warm` / `cold` from the touchpoints
- New **Temperature** column on the campaign-detail lead table
- Inline expand for hot / warm leads showing the touchpoint context (same UX as today's `function_reasoning` / `lead_summary` expand, shipped 2026-05-01)

**Out of scope (handoff to the common-DB team):**
- Common-DB schema design
- Smartlead → common-DB ingest
- HubSpot → common-DB ingest
- Server-side matching / dedup logic inside the common-DB
- The chat / agents milestone (separate plan — see roadmap M-CX2)
- M3.5 `/leads` drilldown (separate; will inherit the Temperature column for free once shipped)

---

## 2. The push contract

This is what Lead-IQ depends on from the common-DB team. Internals of the common-DB are free to evolve as long as these shapes hold.

### 2.1 Endpoint

```
POST {COMMON_DB_BASE_URL}/api/leads
Headers:
  Content-Type: application/json
  X-API-Key: <Lead-IQ's BYOK key for the common DB>
```

### 2.2 Request payload (Lead-IQ → common-DB)

```json
{
  "lead": {
    "source": "lead-iq",
    "source_lead_id": "<lead.id from Lead-IQ>",
    "source_campaign_id": "<campaign.id from Lead-IQ>",
    "source_campaign_name": "Robotics Q2 2026",
    "full_name": "Jane Doe",
    "first_name": "Jane",
    "last_name": "Doe",
    "company_name": "Acme Robotics",
    "job_title": "VP Engineering",
    "linkedin_url": "https://www.linkedin.com/in/janedoe",
    "location": "San Francisco, CA",
    "function_qualification": "Decision Maker",
    "icp_qualification": "Influencer",
    "domain_classification": "Robotics",
    "qualified_at": "2026-05-28T10:14:00Z"
  },
  "include_touchpoints": true,
  "max_touchpoints": 20
}
```

The payload is the full qualified-lead record — sufficient for the common-DB to upsert the contact, link it to existing Smartlead / HubSpot records, and return any matching history in a single round trip.

### 2.3 Response shape (common-DB → Lead-IQ)

```json
{
  "contact_id": "c_abc123",
  "match_status": "found" | "created" | "ambiguous",
  "match_confidence": 0.97,
  "matched_on": ["full_name", "company_name"],
  "touchpoints": [
    {
      "id": "tp_xyz",
      "source": "smartlead" | "hubspot",
      "type": "outbound_email" | "inbound_reply" | "bounced" | "opened" | "clicked" | "deal_stage_change" | "meeting_booked" | "meeting_attended" | "note",
      "campaign_or_pipeline_name": "Q1 Robotics Outbound",
      "status": "replied" | "bounced" | "negotiation" | "closed-won" | "...",
      "occurred_at": "2026-03-14T11:24:00Z",
      "summary": "Replied: 'interested but next quarter'",
      "payload": { /* source-specific raw data */ }
    }
  ],
  "lookup_id": "lkp_abc"
}
```

`touchpoints` are sorted most-recent-first; capped at `max_touchpoints`.

`match_status` values:

| Value | Meaning |
|---|---|
| `found` | Common-DB had a prior record for this person via Smartlead or HubSpot ingest |
| `created` | New contact — no prior touchpoints (the Cold case) |
| `ambiguous` | Multiple matches; common-DB returned the top one but flagged uncertainty |

### 2.4 Failure / fallback behavior

| Common-DB response | Lead-IQ behavior |
|---|---|
| 2xx with `touchpoints` | Classify temperature; store full response + temperature on the lead row |
| 4xx auth / payload | Log error; surface "Cross-check connection unhealthy" in Settings; leave `temperature` null |
| 5xx server | Same as 4xx, but trigger one retry after 5 s |
| 429 rate-limited | Honor `Retry-After` header; requeue the lead within the worker's pending-checks set |
| Timeout (>10 s) | Same as 5xx |

**Critical invariant:** common-DB failure NEVER fails the lead's qualification status. Temperature is enrichment on top, not a gate. A flaky cross-check service cannot cascade into Lead-IQ campaigns being marked `failed`.

### 2.5 Auth model

- BYOK via `X-API-Key` header
- Stored client-side in sessionStorage (mirrors Groq / Phantombuster pattern at `src/lib/groq-store.ts` / `src/lib/pb-api-key-store.ts`)
- Validated against `GET /api/health` in the Connect dialog before save
- Never persisted server-side; never logged; stripped defensively from error messages (same pattern as Groq)

### 2.6 Rate limits (assumed)

Lead-IQ defaults to **50 req/min** (headroom under an assumed Standard tier of 60). Implementation reuses the existing `createRateGate` utility at `src/lib/rate-gate.ts:1-32`, composed with `p-limit` alongside the existing Groq gate in `src/lib/worker.ts:158-171`. Common-DB team to confirm or override; the limit is env-configurable on the Lead-IQ side.

---

## 3. Temperature classification

### 3.1 The three states

| Temperature | Meaning | Badge styling (Tailwind) |
|---|---|---|
| **Hot** | Past conversation, interaction, or active traction | `border-red-500/40 bg-red-500/10 text-red-400` |
| **Warm** | Replied or attended at least once before | `border-amber-500/40 bg-amber-500/10 text-amber-400` |
| **Cold** | No past context | `border-muted-foreground/30 text-muted-foreground` |
| _null_ | Not yet cross-checked / common-DB error | muted "—" |

### 3.2 Classification rules (proposed)

Computed Lead-IQ-side via a new pure function `src/lib/touchpoint-classifier.ts: classify(touchpoints) → 'hot' | 'warm' | 'cold'`. Rules ordered — first match wins.

**Hot** — any of:
1. HubSpot deal in any non-final-loss stage (`negotiation`, `proposal`, `closed-won`, ongoing)
2. HubSpot meeting booked OR attended (`type IN ('meeting_booked', 'meeting_attended')`)
3. Smartlead `positive_reply` lead category
4. ≥2 inbound replies on the same Smartlead campaign (multi-turn thread = "conversation")
5. Any touchpoint with `occurred_at` in the last 30 days (recency signal)

**Warm** — any of (and none of the Hot rules match):
1. ≥1 inbound reply on Smartlead (any sentiment)
2. ≥1 email opened or clicked event
3. Single past meeting attendance
4. Any historical interaction not severe (no bounce-or-unsubscribe-only history)

**Cold** — when none of Hot / Warm match:
1. No touchpoints (`match_status = "created"` or empty `touchpoints[]`)
2. Only outbound emails with no engagement back
3. Only bounces or unsubscribes (with no positive signal anywhere)

Keeping classification in Lead-IQ product code (not in the common-DB) means the rules can be tuned without coordinating with the other team — temperature is a Lead-IQ UX concept, not a CRM data field.

---

## 4. Campaign-detail UI changes

### 4.1 New column

The lead table at `src/components/campaign-detail.tsx:343-356` adds a **Temperature** column between **Qualified** and **ICP**:

```
| Lead | Role | Status | Qualified | Temperature | ICP | Seniority | Domain | Priority | Area | ⤴ |
```

Empty / null state renders muted "—". Otherwise the badge per §3.1.

### 4.2 Inline expand (mirrors the existing prose-expand pattern)

Today, clicking a row expands inline to show `function_reasoning`, `subdomain_justification`, `domain_reasoning`, `lead_summary` (shipped 2026-05-01). The new pattern adds a **Touchpoint history** section **below** the existing prose, visible only when temperature is `hot` or `warm`.

Schematic of the expanded row for a hot lead:

```
┌────────────────────────────────────────────────────────────┐
│ Function reasoning                                         │
│   <existing prose>                                         │
│                                                            │
│ Subdomain justification                                    │
│   <existing prose>                                         │
│                                                            │
│ Lead summary                                               │
│   <existing prose>                                         │
│                                                            │
│ ───────────────────────────────────────────────────────── │
│ Touchpoint history (3)                       [hot badge]   │
│                                                            │
│  ● 2026-05-18 · HubSpot meeting                            │
│    Discovery call attended                                 │
│                                                            │
│  ● 2026-04-22 · HubSpot deal "Acme — POC"                  │
│    Stage moved to Negotiation                              │
│                                                            │
│  ● 2026-03-14 · Smartlead "Q1 Robotics Outbound"           │
│    Replied: "interested but next quarter"                  │
└────────────────────────────────────────────────────────────┘
```

Cold leads still expand to show the existing prose; the Touchpoint section just doesn't render (no data to show).

### 4.3 Filter chip

A new filter on the campaign-detail header: **Temperature: All / Hot / Warm / Cold**. Same UX as the existing status filters per `UI.md` §6.

### 4.4 Where it propagates later (stretch, not part of this milestone)

- **`/leads` view (M3.5)** — same column + filter, no extra work, just consumed from `leads.temperature`
- **Analytics** — new KPI "% hot+warm of qualified" + filter by temperature
- **CSV export** — append `temperature` and `touchpoint_count` columns

---

## 5. Schema additions (Lead-IQ side)

Migration `supabase/migrations/0006_lead_temperature.sql` — manual apply via the Supabase SQL editor, per project convention (see roadmap 2026-05-07 entry and prior migrations 0001–0004). Note: `0005` is reserved for the Agent section migration (`0005_chat_and_embeddings.sql`) per the locked Agent-first sequencing — see [`agent-section-plan.md`](./agent-section-plan.md) §12.

```sql
alter table public.leads
  add column temperature text
    check (temperature in ('hot','warm','cold') or temperature is null),
  add column touchpoint_match jsonb,             -- full response from common-DB
  add column touchpoint_checked_at timestamptz,
  add column touchpoint_error text;

create index leads_temperature_idx
  on public.leads (campaign_id, temperature)
  where temperature is not null;
```

All columns are nullable so the migration is safe against existing rows; the worker populates them at qualification time, and the backfill button (§6.4) handles historical campaigns.

**Supabase Data API grants — note for future migrations.** This migration is `alter table` only; no new table is created, so it's unaffected by Supabase's Oct 30, 2026 Data API default change (new tables on existing projects will need explicit `GRANT` statements after that date). For future migrations that DO create new tables (the next case is M-CX2 chat tables), follow the convention already established by `supabase/migrations/0004_campaign_stats_view.sql:32`:

```sql
grant select, insert, update, delete on public.<new_table> to authenticated;
grant all                            on public.<new_table> to service_role;
-- anon grant only if unauthenticated reads are intended; RLS denies anon by default.
```

Run **Security Advisor → Exposed Tables** in the Supabase dashboard before Oct 30, 2026 to audit which existing tables are currently exposed to the Data API — two-minute check, no code.

---

## 6. Worker integration

### 6.1 Hook point

`src/lib/worker.ts:205` — immediately after the success UPDATE on the lead row, gated by the existing qualified predicate at `worker.ts:209-210`:

```ts
// Existing qualified counter (worker.ts:209-210)
if (fq != null && fq.trim().toUpperCase() !== "NO") {
  qualified += 1;
  // NEW: fire-and-forget cross-check, tracked in pendingChecks
  if (lookupKey) {
    pendingChecks.push(
      runTouchpointCrossCheck(lead, supabase, lookupKey).catch(logSoftFail)
    );
  }
}

// At end of worker — await all pending checks before the post-run completion gate
await Promise.allSettled(pendingChecks);
```

Awaiting `pendingChecks` before the existing completion gate ensures temperature is populated for every qualified lead by the time the campaign flips to `completed`. The check runs in parallel with subsequent leads (doesn't block per-lead throughput) but is awaited before the campaign-level transition.

### 6.2 New files

| Path | Purpose |
|---|---|
| `src/lib/touchpoint-client.ts` | Typed HTTP wrapper for the common-DB endpoint |
| `src/lib/touchpoint-classifier.ts` | Pure function: `touchpoints[] → 'hot' \| 'warm' \| 'cold'` |
| `src/lib/touchpoint-store.ts` | Zustand store for the BYOK common-DB key (mirror of `groq-store.ts`) |
| `src/components/connect-touchpoint-dialog.tsx` | Connect dialog (mirror of `connect-pb-dialog.tsx`) |
| `src/components/touchpoint-connect-pill.tsx` | Header pill (mirror of `pb-connect-pill.tsx`) |

### 6.3 Modified files

| Path | Change |
|---|---|
| `src/lib/worker.ts:205` | Hook the cross-check after lead UPDATE; await `pendingChecks` before the completion gate |
| `src/app/api/campaigns/[id]/run/route.ts:11` | Read `X-Lookup-Key` header from request, pass into worker alongside the existing `X-Groq-Key` |
| `src/components/campaign-detail.tsx:343-356` | New Temperature column header + cell + filter chip; touchpoint section inside the existing inline-expand block |
| `src/app/(app)/layout.tsx:30-32` | Mount `<TouchpointConnectPill />` after `<PbConnectPill />` |

### 6.4 Backfill

A "Re-cross-check" button on the campaign-detail header re-runs the cross-check for all qualified leads in the campaign. Idempotent — overwrites `touchpoint_match`, `temperature`, `touchpoint_checked_at`. Useful for:
- Past campaigns from before this feature shipped
- Campaigns run when the common-DB was unavailable
- Re-classifying after the temperature rules in §3.2 are tuned

---

## 7. Open questions

1. **Push frequency** — per-lead at qualification (current plan), or batched per campaign at completion? Per-lead lets the UI surface temperature in real-time; batched is gentler on the common-DB. **Lean: per-lead.**
2. **Push every qualified lead, or only literal YES verdicts?** Current plan: every lead with `function_qualification IS NOT NULL AND != 'NO'` — includes "Decision Maker", "Champion", "Influencer", etc. (per the categorical relaxation shipped 2026-05-05). **Lean: yes, every non-NO verdict.**
3. **Per-row failure indicator** — when the common-DB push fails for a single lead, render a small icon in the Temperature cell with hover-tooltip "Cross-check failed — retry"? **Lean: yes; click triggers a single-row retry.**
4. **Ambiguous matches** — when common-DB returns `match_status: ambiguous`, do we still classify temperature? **Lean: yes, using the top match's touchpoints, but render a "?" indicator next to the badge and surface the ambiguity in the expanded view.**
5. **DNC / unsubscribed tier** — the three-tier model collapses unsubscribed leads into Cold. If the GTM team needs to actively avoid them, we'd add a "do-not-contact" fourth state or a flag on Cold. **Open — needs a product call before implementation.**
6. **Recency window for "recent activity = hot"** — currently 30 days in §3.2 rule 5. Could be 60 or 90. **Lean: 30, tune after first campaign.**
7. **Multi-team push concurrency** — if two Lead-IQ teammates run campaigns simultaneously, both share the same 50/min Standard-tier gate. Acceptable at 5-person scale; flag if usage grows. **Lean: no action.**

---

## 8. Estimate

| Piece | Hours |
|---|---|
| Schema migration (0006) | 0.5 |
| BYOK trio (store + dialog + pill) | 1 |
| `touchpoint-client.ts` + classifier (unit-tested) | 1.5 |
| Worker hook + rate-gate composition + `pendingChecks` await | 1 |
| Campaign-detail UI (column + filter chip + expand section) | 2 |
| Backfill button + idempotent re-cross-check path | 1 |
| Connect-flow polish + QA against stub endpoint | 1 |
| **Total** | **8** |

Excludes the agents/chat milestone (separate plan).

---

## 9. Dependencies on the common-DB team

To unblock Lead-IQ implementation, the common-DB team needs to provide:

- [ ] `POST /api/leads` endpoint accepting the §2.2 payload and returning the §2.3 shape (stub data — even a hard-coded response — is sufficient to start Lead-IQ-side work)
- [ ] `GET /api/health` endpoint for Connect-dialog validation
- [ ] API key issuance — keys teammates can paste into the Lead-IQ Connect dialog
- [ ] Confirmed rate limits + 429 `Retry-After` behavior
- [ ] Enumerated `touchpoint.type` values — the exact set Lead-IQ should expect, so the classifier rules in §3.2 stay accurate as the ingest grows

A 30-min joint integration test once stubs are up — Lead-IQ POSTs a known lead, common-DB returns a known response — would catch contract drift early.

---

## 10. Implementation notes

- This is **Next.js 16 with breaking changes from training data** — per `AGENTS.md`, the implementer must consult `node_modules/next/dist/docs/` for the current route handler / Server Action patterns before writing code. The worker is a long-running in-process Node loop (not a route handler), so this matters mostly for the `POST /api/campaigns/[id]/run` entry where the new `X-Lookup-Key` header is read.
- Soft-fail discipline is critical: a flaky common-DB must not cascade into Lead-IQ campaign failures. See §2.4. The `pendingChecks` pattern in §6.1 uses `Promise.allSettled` (not `Promise.all`) precisely to enforce this.
- The BYOK pattern is well-trodden (Groq, Phantombuster); the new Touchpoint key is the third instance and should reuse the existing dialog/pill/store skeleton verbatim.
- Migration `0005` follows the manual-apply-via-Supabase-SQL-editor convention. If the team decides to move to programmatic migration apply (open question §7.7-equivalent in roadmap backlog), this migration is a candidate to be the first one applied that way — but is not part of this milestone's scope.
