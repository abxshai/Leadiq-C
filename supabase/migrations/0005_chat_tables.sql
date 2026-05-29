-- Run in the Supabase SQL editor.
-- M-AG1 (LeadQuery agent) schema additions. See agent-section-plan.md
-- for context.
--
-- Two tables land here for the agent surface:
--   1. chat_conversations
--   2. chat_messages
-- Plus RLS + Data API grants per project convention (rls.sql + 0004:32).
--
-- pgvector + embeddings are intentionally deferred to M-AG2 — the
-- M-AG1 LeadQuery agent uses MCP-style raw SQL tools against existing
-- structured data, which covers ~90% of GTM queries. Semantic similarity
-- (concept-match without shared keywords) lands later as a follow-up
-- via a separate `0007_pgvector_embeddings.sql` migration.

------------------------------------------------------------------
-- 1. Chat conversations + messages (agent surface)
------------------------------------------------------------------

create table if not exists public.chat_conversations (
  id          uuid primary key default gen_random_uuid(),
  agent_id    text not null,
  title       text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists public.chat_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
                  references public.chat_conversations(id) on delete cascade,
  role            text not null check (role in ('user','assistant','tool','system')),
  content         text,
  tool_calls      jsonb,
  tool_results    jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists chat_messages_conversation_idx
  on public.chat_messages (conversation_id, created_at);

------------------------------------------------------------------
-- 2. RLS — mirrors rls.sql convention (per-action policies)
------------------------------------------------------------------

alter table public.chat_conversations enable row level security;
alter table public.chat_messages       enable row level security;

-- chat_conversations: full CRUD
create policy "auth read chat conversations"
  on public.chat_conversations for select
  using (auth.role() = 'authenticated');

create policy "auth write chat conversations"
  on public.chat_conversations for insert
  with check (auth.role() = 'authenticated');

create policy "auth update chat conversations"
  on public.chat_conversations for update
  using (auth.role() = 'authenticated');

create policy "auth delete chat conversations"
  on public.chat_conversations for delete
  using (auth.role() = 'authenticated');

-- chat_messages: append-only (select + insert). Deletes happen via the
-- FK cascade when the parent conversation is deleted; that runs as the
-- table owner and bypasses RLS, so no DELETE policy needed here.
create policy "auth read chat messages"
  on public.chat_messages for select
  using (auth.role() = 'authenticated');

create policy "auth write chat messages"
  on public.chat_messages for insert
  with check (auth.role() = 'authenticated');

------------------------------------------------------------------
-- 3. Data API grants
--    Per Supabase Oct 30, 2026 changelog (cross-check-plan.md §5).
--    Convention from 0004_campaign_stats_view.sql:32.
------------------------------------------------------------------

grant select, insert, update, delete on public.chat_conversations to authenticated;
grant select, insert                 on public.chat_messages       to authenticated;
grant all on public.chat_conversations to service_role;
grant all on public.chat_messages       to service_role;
