# Lead-IQ — Queryable agent section plan

*Last updated: 2026-05-29*

Companion docs: [`cross-check-plan.md`](./cross-check-plan.md), [`lead-iq-roadmap.md`](./lead-iq-roadmap.md), [`DOCS.md`](./DOCS.md), [`UI.md`](./UI.md).

> **Scope split (decided 2026-05-29):** M-AG1 ships the chat surface + LeadQuery agent with **MCP-style raw SQL tools** — no embeddings. M-AG2 follows up later with pgvector + concept-similarity search. Sections in this doc tagged **[M-AG2 — DEFERRED]** describe design that's kept here as the eventual record but is not in M-AG1's scope.

---

## 0. Why this exists

GTM teammates can answer "show me qualified leads from Robotics in May" by clicking through filters in `/analytics`, but anything more conversational ("find me leads conceptually similar to this one I just talked to" or "which campaigns produced the highest-seniority decision-makers in companies with deep-tech subdomains") requires CSV-export and spreadsheet work. A queryable chat agent over Lead-IQ data closes that gap.

This is the **first agent of an intentionally multi-agent architecture**. Future agents (Touchpoint Retrieval from the common-DB once cross-check ships; ICP-tuning suggestions; etc.) drop in as config + tool definitions, not new infrastructure.

Decoupled from `cross-check-plan.md` — ships without depending on the common-DB team's timeline. Agent goes first in the new roadmap order: **Agent → Cross-check (M-CX1) → /leads (M3.5)**.

---

## 1. Scope

**In scope (M-AG1):**
- New `/chat` route + sidebar entry
- Multi-agent registry (typed config — agents = code-level config, not user-editable yet)
- First agent: **"LeadQuery"** with MCP-style raw SQL tools (`execute_sql`, `list_tables`, `get_table_schema`)
- Read-only enforcement at the Postgres transaction level (`SET LOCAL transaction read only`) so the LLM can't write even if it emits a non-SELECT statement
- Conversation persistence with per-user `created_by` tagging + a "show all" toggle
- Streaming responses (SSE)

**Deferred to M-AG2 (follow-up milestone):**
- pgvector extension + `embedding vector(384)` column on `leads`
- Supabase gte-small embedding generation (edge function + worker hook)
- `semantic_search_leads` tool for concept-similarity ("find leads about AI infra even if their title says 'ML platform engineer'")
- Backfill of existing 44k leads' embeddings
- See §4 and §8 (both tagged **[M-AG2 — DEFERRED]**) for the eventual design

**Out of scope (further future):**
- Touchpoint / Smartlead / HubSpot tools (third agent — added after `cross-check-plan.md` M-CX1 ships)
- Write-capable agents (re-run campaigns, push to Clay, etc.) — v1 read-only
- User-editable agent configuration UI — agents stay code-level for now
- Embeddings for sources beyond `leads` (campaign descriptions, prompt templates)

---

## 2. Architecture

```
┌──────────────┐     ┌──────────────────────────────┐
│   Browser    │     │   Next.js server             │
│              │     │                              │
│  /chat UI    │◀───▶│   POST /api/chat/[id]/msgs   │
│  (SSE)       │     │     │                        │
│              │     │     ├─ Groq tool-call loop  ─┼──▶  Groq (gpt-oss-120b, BYOK)
│              │     │     │                        │
│              │     │     └─ tool handler ────────┐│
└──────────────┘     │           │                 ││
                     │           ▼                 ▼│
                     │     ┌──────────────┐  ┌──────────────────────┐
                     │     │  Supabase    │  │  Supabase Edge Fn    │
                     │     │  Postgres    │  │  embed-text          │
                     │     │  + pgvector  │  │  (gte-small, 384-d)  │
                     │     └──────────────┘  └──────────────────────┘
                     └──────────────────────────────┘
```

**Embedding flow (per lead, at qualification time):**
1. Worker finishes the Groq qualification call + UPDATE leads (existing `worker.ts:205`)
2. Builds the embedding text (name + title + company + reasoning + summary)
3. Calls Supabase edge function `embed-text` → 384-d vector
4. Stores vector in `leads.embedding`
5. Worker waits on all pending embeddings (`Promise.allSettled`) before the campaign-completion gate

**Query flow (per chat message):**
1. User types → `POST /api/chat/[id]/messages`
2. Server loads conversation history, calls Groq with `stream: true` + the agent's tool defs
3. Tool-call loop: Groq emits tool calls → handler runs SQL or vector similarity → result appended as `tool` message → re-call Groq until no more tool calls
4. Final assistant message streams to browser as SSE chunks

---

## 3. Multi-agent registry

`src/lib/agents/registry.ts` — typed config, code-level (not user-editable):

```ts
export type AgentConfig = {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  tools: string[];                  // names from the tool registry
  model: string;                    // groq model id
  byok_required: ('groq' | 'lookup')[];
};

export const AGENTS: AgentConfig[] = [
  {
    id: 'leadquery',
    name: 'LeadQuery',
    description: 'Query qualified leads across all campaigns. Structured filters or semantic search.',
    system_prompt: `You help GTM teammates answer questions about leads that have been qualified in Lead-IQ ...`,
    tools: ['list_campaigns', 'get_campaign_stats', 'search_leads', 'semantic_search_leads', 'get_lead', 'aggregate_leads'],
    model: 'openai/gpt-oss-120b',
    byok_required: ['groq'],
  },
  // Future: 'touchpoint-retrieval' (depends on cross-check-plan.md M-CX1)
];
```

`src/lib/agents/tools.ts` — tool registry. Each tool is `{ name, description, schema (Zod), handler(args, context) }`. Agents reference tools by name. Adding a second agent = add a row to `AGENTS` + register its tools.

---

## 4. Embeddings (Supabase gte-small) — [M-AG2 — DEFERRED]

### 4.1 Schema additions

Migration `supabase/migrations/0005_chat_and_embeddings.sql` (manual SQL editor apply per convention):

```sql
-- pgvector for semantic search
create extension if not exists vector;

alter table public.leads
  add column embedding vector(384),
  add column embedded_at timestamptz;

create index leads_embedding_hnsw_idx
  on public.leads
  using hnsw (embedding vector_cosine_ops);

-- (chat tables continue below — see §6)
```

### 4.2 What to embed

Concatenated text per lead, computed in the worker. Null fields skipped:

```
Name: <full_name>
Title: <title> at <company_name>
Function: <function_qualification>. <function_reasoning>
ICP: <icp_qualification>
Domain: <domain_classification> · <subdomain>. <subdomain_justification>
Summary: <lead_summary>
```

gte-small handles up to 512 tokens; lead prose stays well under.

### 4.3 Generation path

New Supabase Edge Function `supabase/functions/embed-text/index.ts`:

```ts
const session = new Supabase.ai.Session('gte-small');
const embedding = await session.run(req.text, { mean_pool: true, normalize: true });
return Response.json({ embedding });  // length 384
```

Lead-IQ worker calls this edge function via `${SUPABASE_FUNCTIONS_URL}/embed-text` after the per-lead success UPDATE. Edge function deploys via `supabase functions deploy embed-text` — first edge function in the project (small new deploy step).

### 4.4 Cost & latency

- Hosted by Supabase Edge Functions (gte-small runs on the AI-inference compute backed into the Supabase platform)
- Free on the Supabase Pro plan; included in compute hours otherwise
- Latency ~50–200 ms per embedding (fine at the post-qualification hook — runs in parallel with the next lead's Groq call)
- Backfill of ~3000 existing leads: ~5–10 min total

### 4.5 Backfill

Two paths:
1. **One-shot script** — `scripts/backfill-embeddings.ts` runs locally with `SUPABASE_SERVICE_ROLE_KEY`, paginates all leads where `embedding IS NULL`, embeds, writes. Run once after the feature deploys.
2. **Per-campaign "Re-embed" button** on the campaign-detail header — idempotent. Useful if the embedding-text composition changes (re-build the corpus from scratch).

---

## 5. Tool surface

Six tools registered for the LeadQuery agent. All read-only. All capped at 50 rows per call with a `truncated: true` flag + cursor for pagination (keeps LLM context bounded).

### 5.1 Structured tools (Tier 1)

```
list_campaigns(status?, limit? = 50)
get_campaign_stats(campaign_id_or_name)
search_leads(
  filters: {
    campaign_id?: uuid,
    status?: 'pending'|'processed'|'failed',
    function_qualification?: string,          // matches verbatim or special 'NOT_NO'
    icp_qualification?: string,
    domain?: string,
    subdomain?: string,
    seniority_min?: number,
    seniority_max?: number,
    company_substring?: string,
    date_range?: { from: ISO, to: ISO },
  },
  limit? = 50,
)
get_lead(lead_id: uuid)
aggregate_leads(
  group_by: 'campaign' | 'icp' | 'domain' | 'company' | 'seniority',
  filters?: same shape as search_leads.filters,
  top_k? = 20,
)
```

### 5.2 Semantic search tool (Tier 2)

```
semantic_search_leads(
  query: string,                              // free text, e.g. "AI infrastructure CTOs"
  top_k? = 20,
  filters?: same shape as search_leads.filters,   // hybrid search
)
```

Implementation:
```sql
select id, full_name, ..., 1 - (embedding <=> $1) as similarity
from public.leads
where embedding is not null
  and <structured filters>
order by embedding <=> $1
limit $top_k;
```

The hybrid pattern (semantic similarity + structured filters in the same query) is the GTM gold use case: *"leads similar to 'CTO of AI infra startup' WHERE qualified AND campaign IN (last 3 robotics ones)."*

---

## 6. Chat schema

Continuing migration `0005_chat_and_embeddings.sql`:

```sql
create table public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null,
  title text,
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  archived_at timestamptz
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','tool','system')),
  content text,
  tool_calls jsonb,
  tool_results jsonb,
  created_at timestamptz default now()
);

create index chat_messages_conversation_idx
  on public.chat_messages (conversation_id, created_at);

-- RLS
alter table public.chat_conversations enable row level security;
alter table public.chat_messages       enable row level security;

create policy "auth users can manage chat conversations"
  on public.chat_conversations for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "auth users can manage chat messages"
  on public.chat_messages for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Explicit Data API grants per Supabase Oct 30, 2026 changelog
-- (see cross-check-plan.md §5; convention from 0004_campaign_stats_view.sql:32)
grant select, insert, update, delete on public.chat_conversations to authenticated;
grant select, insert, update, delete on public.chat_messages       to authenticated;
grant all on public.chat_conversations to service_role;
grant all on public.chat_messages       to service_role;
```

Note: under the 5-person shared-workspace model (DOCS.md §7), `created_by` tagging is informational — RLS lets any authenticated user see any conversation. Per-user vs shared filtering is done at the query level (sidebar default = `created_by = current user`, "show all" toggle flips it).

---

## 7. Chat UI

### 7.1 Routes & components

| Path | Purpose |
|---|---|
| `src/app/(app)/chat/page.tsx` | Conversation list (sidebar) + active conversation pane |
| `src/app/(app)/chat/[id]/page.tsx` | Direct link to a conversation (deep-link friendly, sharable URL) |
| `src/components/chat-message.tsx` | User/assistant/tool message bubbles; markdown rendering |
| `src/components/chat-tool-call.tsx` | Collapsible card: tool name + args (truncated) + result count; expandable for full payload |
| `src/components/chat-input.tsx` | Multi-line input + send button |
| `src/components/chat-agent-picker.tsx` | Dropdown to switch agents (only one option for v1) |

### 7.2 Sidebar nav entry

`src/components/app-sidebar.tsx:16-22` — new "Chat" entry between Analytics and Settings. Lucide icon: `MessageSquare`.

### 7.3 Streaming

`POST /api/chat/[id]/messages` — route handler that:
1. Persists the user message
2. Loads full conversation history
3. Calls Groq with `stream: true` + the agent's tool defs
4. Tool-call loop: Groq emits tool call → handler runs → append `tool` message → re-call Groq until no more tool calls
5. Streams the final assistant message as SSE chunks

⚠️ **Implementation gotcha** (per `AGENTS.md`): Next 16 changed route-handler / streaming APIs vs. earlier versions. Implementer must consult `node_modules/next/dist/docs/` before writing this. Pre-16 SSE patterns won't be correct.

Streaming UX:
- Assistant message text streams token-by-token into a single bubble
- Tool calls appear as collapsed cards in the message stream as they fire
- Each tool card shows: name, args (truncated to ~80 chars), result count; click to expand for full payload
- "Stop generating" button cancels the SSE stream + the underlying Groq request

### 7.4 Conversation management

- **New conversation** — agent picker → first message → conversation persisted on first POST
- **Rename** — inline-edit title in the sidebar
- **Archive** — soft-delete via `archived_at`; archived conversations hidden by default, surfaced via "Show archived" toggle
- **Per-user / shared toggle** — sidebar header has a "Show all teammates" toggle (default off; defaults to `created_by = current user`)

---

## 8. Worker integration (embedding generation hook) — [M-AG2 — DEFERRED]

### 8.1 Hook point

`src/lib/worker.ts:205` — post-success-UPDATE, BEFORE the qualified-counter increment (so embedding runs for every successfully-processed lead, qualified or not — useful for semantic search even on non-qualified leads):

```ts
// NEW: fire-and-forget embedding generation
pendingEmbeddings.push(
  generateLeadEmbedding(lead, supabase).catch(logSoftFail)
);

// (existing qualified counter logic at worker.ts:209-210)

// At end of worker, BEFORE the post-run completion gate:
await Promise.allSettled(pendingEmbeddings);
```

Same pattern as the future cross-check hook in `cross-check-plan.md` §6.1. Embedding failure is soft (logged, lead stays `processed`) — never cascades into a campaign-level failure.

### 8.2 New files

| Path | Purpose |
|---|---|
| `src/lib/embedding-client.ts` | Wraps the Supabase edge function call (single-lead + batch helpers) |
| `src/lib/agents/registry.ts` | Agent registry (typed config) |
| `src/lib/agents/tools.ts` | Tool registry + handler implementations |
| `src/lib/agents/chat-loop.ts` | Groq tool-call loop driver (streaming) |
| `supabase/functions/embed-text/index.ts` | Edge function calling `Supabase.ai.Session('gte-small')` |
| `scripts/backfill-embeddings.ts` | One-shot script to embed all existing leads |
| `src/app/api/chat/[id]/messages/route.ts` | SSE-streaming POST endpoint |
| `src/app/(app)/chat/page.tsx` | Chat UI entry |
| (chat components listed in §7.1) | |

### 8.3 Modified files

| Path | Change |
|---|---|
| `src/lib/worker.ts:205` | Add embedding generation hook + `Promise.allSettled(pendingEmbeddings)` await before completion gate |
| `src/components/app-sidebar.tsx:16-22` | Add "Chat" nav entry between Analytics and Settings |

---

## 9. Open questions

1. **Hand-roll the tool loop, or Vercel AI SDK?** AI SDK saves ~3-4h on streaming + tool-call UI components but adds a dep and may need Next 16 verification. **Lean: hand-roll** — full control, no new dep, the loop is ~100 LOC and the UI components are bespoke anyway.
2. **Where else does semantic search appear in the UI?** Just chat, or also as a search box on the future `/leads` page (M3.5)? **Lean: chat only at v1**; bring it into `/leads` if the GTM team asks.
3. **Embedding text composition** — include `function_reasoning` (long prose) or just structured fields? Tradeoff: more prose = more semantic signal but slower to embed and more sensitive to model verbosity. **Lean: include all prose** — gte-small handles up to 512 tokens; lead prose stays well under.
4. **Can the chat query LEADS that are pending / failed (not yet qualified)?** Or strictly the processed ones? **Lean: all leads regardless of status** — semantic search across the full corpus is more useful, and the agent's tool surface can filter on `status` when needed.
5. **Conversation deletion** — only archive, never hard-delete? **Lean: archive only at v1**; hard-delete with a 30-day grace period later if storage becomes a concern.
6. **Edge function deploy step** — Lead-IQ now has its first Supabase edge function (`embed-text`). Deploy via `supabase functions deploy embed-text`; documented in [`DEPLOY.md`](./DEPLOY.md) §8.

---

## 10. Estimate

### M-AG1 (this milestone)

| Piece | Hours |
|---|---|
| Schema migration (chat tables + RLS + grants) | 0.5 |
| Agent registry + tool registry framework | 2 |
| MCP-style tools (`execute_sql` + `list_tables` + `get_table_schema`) + read-only enforcement | 2 |
| Chat tool-call loop (streaming, hand-rolled SSE) | 2 |
| Chat UI (sidebar, message list, input, tool-call cards, agent picker) | 4 |
| QA + connect-flow polish | 1 |
| **Total** | **~11.5** |

### M-AG2 (deferred follow-up)

| Piece | Hours |
|---|---|
| Migration: pgvector + embedding column + HNSW index | 0.5 |
| Supabase edge function `embed-text` (Deno/TS) | 1 |
| Embedding client + worker hook + `Promise.allSettled` | 1.5 |
| `semantic_search_leads` tool (hybrid filters + vector op) | 1.5 |
| Backfill script for 44k existing leads | 1 |
| QA | 0.5 |
| **Total** | **~6** |

---

## 11. Future extensions (deferred)

Natural follow-ups after this milestone ships:

- **Touchpoint Retrieval agent** — second entry in `AGENTS[]`, tools that hit the common-DB endpoint from `cross-check-plan.md` §2.2. Config-only addition once cross-check ships.
- **Cross-source semantic search** — also embed `touchpoints.summary` once data is flowing, enabling *"find leads who replied positively to robotics-themed campaigns."*
- **Write tools (v2)** — `rerun_campaign_failed_leads`, `push_to_clay`, etc. Action-capable agents need separate trust/UX work; deferred.
- **Semantic search on `/leads`** — promote the chat-only feature into the M3.5 view if GTM asks.
- **User-editable agents** — a `/agents` CRUD page in the same shape as `/templates`. Agents become content, not code. Deferred.

---

## 12. Sequencing impact

The agreed roadmap order is now:

| # | Milestone | Doc | Migration |
|---|---|---|---|
| 1 | **M-AG1** — LeadQuery agent (MCP-style tools, no embeddings) | this doc | `0005_chat_tables.sql` |
| 2 | **M-CX1** — Cross-check + temperature (when common-DB ready) | `cross-check-plan.md` | `0006_lead_temperature.sql` |
| 3 | **M3.5** — `/leads` drilldown | roadmap | (no new migration) |
| 4 | **M-AG2** — Semantic similarity (pgvector + embeddings) — deferred follow-up of M-AG1 | this doc, §4 + §8 | `0007_pgvector_embeddings.sql` |
| 5 | Touchpoint Retrieval agent (third agent, after M-CX1) | follow-up | (no new migration; reads from common-DB) |
| — | **M4** — Clay webhook push (parked) | roadmap | — |

Migration filename change: `0005_chat_and_embeddings.sql` → `0005_chat_tables.sql` because embeddings are no longer in M-AG1's migration. The embedding migration becomes `0007` (after M-CX1's `0006`).
