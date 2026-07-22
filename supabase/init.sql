-- =============================================================================
-- init.sql — CONSOLIDATED, CRM-FREE lean-core schema for a fresh clone.
--
-- Run ONCE against a brand-new Supabase project (SQL editor or `supabase db
-- push` after `supabase db reset`). Builds the entire application database from
-- zero: tables, indexes, views, functions, RLS, Data-API grants, and seed
-- templates. Idempotent — every statement is `if not exists` / `or replace`, so
-- re-running is safe.
--
-- This is the canonical "build a new DB" artifact for the lead-qualifier clone.
-- It deliberately OMITS the entire `crm` schema and every object that depended
-- on it (Smartlead/HubSpot cross-check, lead temperature classifier, reply
-- status, /opportunities). Those features belonged to Lead-IQ's separate CRM
-- ingest service and are not part of this clone. The numbered files in
-- ./migrations/ are retained as the ORIGINAL Lead-IQ history for reference;
-- a fresh clone does NOT replay them — it runs this file, then starts its own
-- forward migration chain. See ./README.md.
--
-- A few columns that the CRM features wrote to (temperature, touchpoint_match,
-- touchpoint_summary) are kept as harmless nullable columns so the deduped
-- views and any residual display code stay valid; nothing in the clone
-- populates them.
-- =============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Prompt templates (dynamic system prompts per campaign type)
-- ---------------------------------------------------------------------------
create table if not exists public.prompt_templates (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,
  description   text,
  system_prompt text not null,
  is_default    boolean not null default false,
  version       int not null default 1,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  archived_at   timestamptz
);

create index if not exists prompt_templates_is_default_idx
  on public.prompt_templates(is_default) where archived_at is null;

-- Append-only version history for rollback / audit.
create table if not exists public.prompt_template_versions (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid not null references public.prompt_templates(id) on delete cascade,
  version       int not null,
  name          text not null,
  system_prompt text not null,
  saved_by      uuid,
  saved_at      timestamptz not null default now(),
  unique(template_id, version)
);

-- ---------------------------------------------------------------------------
-- Campaigns (one execution run over a lead list)
-- ---------------------------------------------------------------------------
create table if not exists public.campaigns (
  id                        uuid primary key default gen_random_uuid(),
  name                      text not null,
  source_filename           text,

  -- Prompt: either a saved template (snapshotted at run time) or ad-hoc.
  prompt_template_id        uuid references public.prompt_templates(id) on delete set null,
  prompt_template_version   int,
  system_prompt_snapshot    text not null,

  -- Model / runtime config (no API key stored here — BYOK).
  model                     text not null default 'openai/gpt-oss-120b',
  concurrency               int not null default 5,
  delay_ms                  int not null default 1000
                            check (delay_ms between 0 and 60000),

  -- Optional Sheets push target.
  google_sheet_id           text,
  google_sheet_tab          text,

  -- Counters + status.
  total_leads               int not null default 0,
  qualified_count           int not null default 0,
  failed_count              int not null default 0,
  status                    text not null default 'pending'
                            check (status in ('pending','running','completed','failed','canceled')),

  created_by                uuid,
  created_at                timestamptz not null default now(),
  started_at                timestamptz,
  completed_at              timestamptz
);

create index if not exists campaigns_status_idx        on public.campaigns(status);
create index if not exists campaigns_created_at_idx     on public.campaigns(created_at desc);
create index if not exists campaigns_template_id_idx    on public.campaigns(prompt_template_id);

-- ---------------------------------------------------------------------------
-- Leads (one row per LinkedIn profile per campaign, merged input + output)
--
-- function_qualification / icp_qualification are free-form text (categorical
-- verdicts like "Decision Maker" / "Influencer" are allowed) — the original
-- YES/NO CHECK constraints from Lead-IQ v0.1 were dropped in migrations
-- 0002/0003 and are intentionally absent here.
-- ---------------------------------------------------------------------------
create table if not exists public.leads (
  id                      uuid primary key default gen_random_uuid(),
  campaign_id             uuid not null references public.campaigns(id) on delete cascade,

  -- Input (pass-through from the LinkedIn scraper — 9 canonical input cols)
  default_profile_url     text,
  full_name               text,
  first_name              text,
  last_name               text,
  company_name            text,
  title                   text,
  summary                 text,
  title_description       text,
  location                text,

  -- Agent output (nullable until processed)
  agent_full_name         text,
  function_qualification  text,
  function_reasoning      text,
  icp_qualification       text,
  seniority_scoring       int  check (seniority_scoring between 1 and 5 or seniority_scoring is null),
  priority_level          text,
  product_area            text,
  lead_summary            text,

  -- Domain-classification bundle (migration 0002)
  domain_classification   text,
  subdomain               text,
  subdomain_justification text,
  domain_reasoning        text,

  -- Enrichment columns (kept nullable; the CRM features that populated these
  -- are not part of this clone, so they stay NULL). Retained so the deduped
  -- view + campaign_stats definitions below are unchanged from Lead-IQ.
  temperature             text
                          check (temperature in ('hot','warm','cold') or temperature is null),
  touchpoint_match        jsonb,
  touchpoint_checked_at   timestamptz,
  touchpoint_summary      jsonb,

  -- Ops / observability
  status                  text not null default 'pending'
                          check (status in ('pending','running','processed','failed','skipped')),
  error                   text,
  llm_prompt_tokens       int,
  llm_completion_tokens   int,
  llm_latency_ms          int,

  created_at              timestamptz not null default now(),
  processed_at            timestamptz,

  unique (campaign_id, default_profile_url)
);

create index if not exists leads_campaign_id_idx           on public.leads(campaign_id);
create index if not exists leads_status_idx                on public.leads(status);
create index if not exists leads_function_qual_idx         on public.leads(function_qualification);
create index if not exists leads_seniority_idx             on public.leads(seniority_scoring);
create index if not exists leads_processed_at_idx          on public.leads(processed_at desc);
create index if not exists leads_product_area_idx          on public.leads(product_area);
create index if not exists leads_domain_classification_idx on public.leads(domain_classification);

-- ---------------------------------------------------------------------------
-- Chat (LeadQuery agent surface — M-AG1)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- campaign_stats — live per-campaign aggregate counts (migration 0004).
-- "qualified" = any processed lead whose function_qualification isn't "NO".
-- security_invoker so RLS on the underlying tables still applies.
-- ---------------------------------------------------------------------------
create or replace view public.campaign_stats
with (security_invoker = true)
as
select
  c.id as campaign_id,
  count(l.id)                                                as total_leads,
  count(l.id) filter (
    where l.status in ('processed','failed','skipped')
  )                                                          as touched_count,
  count(l.id) filter (where l.status = 'processed')          as processed_count,
  count(l.id) filter (where l.status = 'failed')             as failed_count,
  count(l.id) filter (
    where l.status = 'processed'
      and l.function_qualification is not null
      and upper(btrim(l.function_qualification)) <> 'NO'
  )                                                          as qualified_count
from public.campaigns c
left join public.leads l on l.campaign_id = c.id
group by c.id;

grant select on public.campaign_stats to authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- distinct_leads — deduped-per-person snapshot for the /leads browser
-- (migrations 0010 + 0017). MATERIALIZED so the DISTINCT ON sort runs once per
-- mutation, not on every read. One row per person keyed on the normalized
-- LinkedIn URL (protocol/www/trailing-slash stripped, lowercased); url-less
-- rows fall back to their id. Tiebreak: most recently processed row.
-- ---------------------------------------------------------------------------
create materialized view if not exists public.distinct_leads as
select distinct on (dedupe_key)
  l.*,
  c.name as campaign_name
from public.leads l
join public.campaigns c on c.id = l.campaign_id
cross join lateral (
  select coalesce(
    nullif(
      lower(
        regexp_replace(
          regexp_replace(l.default_profile_url, '^https?://(www\.)?', ''),
          '/+$', ''
        )
      ),
      ''
    ),
    'id:' || l.id::text
  ) as dedupe_key
) k
where l.status = 'processed'
order by dedupe_key, l.processed_at desc nulls last, l.id
with data;

-- REFRESH ... CONCURRENTLY requires a unique index.
create unique index if not exists distinct_leads_id_uidx
  on public.distinct_leads (id);
create index if not exists distinct_leads_processed_at_idx
  on public.distinct_leads (processed_at desc);
create index if not exists distinct_leads_campaign_idx
  on public.distinct_leads (campaign_id);

grant select on public.distinct_leads to authenticated, service_role;

-- SECURITY DEFINER so app roles can trigger a concurrent refresh without
-- owning the MV. Called after every mutation to a processed lead.
create or replace function public.refresh_distinct_leads()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view concurrently public.distinct_leads;
end;
$$;

grant execute on function public.refresh_distinct_leads()
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- lead_filter_facets — distinct low-cardinality facet values for the /leads
-- filter dropdowns in one round trip (migration 0008). SECURITY INVOKER.
-- ---------------------------------------------------------------------------
create or replace function public.lead_filter_facets()
returns jsonb
language sql
stable
security invoker
as $$
  select jsonb_build_object(
    'domains', (
      select coalesce(jsonb_agg(v order by v), '[]'::jsonb)
      from (
        select distinct btrim(domain_classification) as v
        from public.leads
        where status = 'processed'
          and nullif(btrim(domain_classification), '') is not null
      ) t
    ),
    'icps', (
      select coalesce(jsonb_agg(v order by v), '[]'::jsonb)
      from (
        select distinct btrim(icp_qualification) as v
        from public.leads
        where status = 'processed'
          and nullif(btrim(icp_qualification), '') is not null
      ) t
    ),
    'priorities', (
      select coalesce(jsonb_agg(v order by v), '[]'::jsonb)
      from (
        select distinct btrim(priority_level) as v
        from public.leads
        where status = 'processed'
          and nullif(btrim(priority_level), '') is not null
      ) t
    )
  );
$$;

grant execute on function public.lead_filter_facets() to authenticated, anon, service_role;

-- =============================================================================
-- Row-Level Security (single-workspace mode — from rls.sql + 0005).
-- Any valid auth session can read/write all rows. Multi-tenant isolation is a
-- future workspace_id column + tighter USING/WITH CHECK clauses.
-- =============================================================================
alter table public.prompt_templates         enable row level security;
alter table public.prompt_template_versions enable row level security;
alter table public.campaigns                enable row level security;
alter table public.leads                    enable row level security;
alter table public.chat_conversations       enable row level security;
alter table public.chat_messages            enable row level security;

-- prompt_templates
create policy "auth read templates"   on public.prompt_templates for select using (auth.role() = 'authenticated');
create policy "auth write templates"  on public.prompt_templates for insert with check (auth.role() = 'authenticated');
create policy "auth update templates" on public.prompt_templates for update using (auth.role() = 'authenticated');
create policy "auth delete templates" on public.prompt_templates for delete using (auth.role() = 'authenticated');

-- prompt_template_versions
create policy "auth read template versions"  on public.prompt_template_versions for select using (auth.role() = 'authenticated');
create policy "auth write template versions" on public.prompt_template_versions for insert with check (auth.role() = 'authenticated');

-- campaigns
create policy "auth read campaigns"   on public.campaigns for select using (auth.role() = 'authenticated');
create policy "auth write campaigns"  on public.campaigns for insert with check (auth.role() = 'authenticated');
create policy "auth update campaigns" on public.campaigns for update using (auth.role() = 'authenticated');
create policy "auth delete campaigns" on public.campaigns for delete using (auth.role() = 'authenticated');

-- leads
create policy "auth read leads"   on public.leads for select using (auth.role() = 'authenticated');
create policy "auth write leads"  on public.leads for insert with check (auth.role() = 'authenticated');
create policy "auth update leads" on public.leads for update using (auth.role() = 'authenticated');
create policy "auth delete leads" on public.leads for delete using (auth.role() = 'authenticated');

-- chat_conversations (full CRUD)
create policy "auth read chat conversations"   on public.chat_conversations for select using (auth.role() = 'authenticated');
create policy "auth write chat conversations"  on public.chat_conversations for insert with check (auth.role() = 'authenticated');
create policy "auth update chat conversations" on public.chat_conversations for update using (auth.role() = 'authenticated');
create policy "auth delete chat conversations" on public.chat_conversations for delete using (auth.role() = 'authenticated');

-- chat_messages (append-only; deletes cascade from the parent conversation)
create policy "auth read chat messages"  on public.chat_messages for select using (auth.role() = 'authenticated');
create policy "auth write chat messages" on public.chat_messages for insert with check (auth.role() = 'authenticated');

-- Data-API grants (per Supabase Oct 30 2026 default-deny; convention from 0004:32)
grant select, insert, update, delete on public.prompt_templates         to authenticated;
grant select, insert                 on public.prompt_template_versions  to authenticated;
grant select, insert, update, delete on public.campaigns                 to authenticated;
grant select, insert, update, delete on public.leads                     to authenticated;
grant select, insert, update, delete on public.chat_conversations        to authenticated;
grant select, insert                 on public.chat_messages             to authenticated;
grant all on public.prompt_templates        to service_role;
grant all on public.prompt_template_versions to service_role;
grant all on public.campaigns               to service_role;
grant all on public.leads                   to service_role;
grant all on public.chat_conversations      to service_role;
grant all on public.chat_messages           to service_role;

-- =============================================================================
-- Seed: two default prompt templates.
-- =============================================================================
insert into public.prompt_templates (name, slug, description, system_prompt, is_default)
values
(
  'Robotics / Manufacturing AI',
  'robotics-manufacturing-ai',
  'Deccan AI''s default ICP — targets AI-driven robotics, manipulation, defect inspection, and manufacturing training-data pipelines.',
  $$You are a senior B2B sales analyst qualifying leads for Deccan AI, a company providing training-data services for AI-driven manufacturing robotics — pose estimation, manipulation trajectory labeling, defect inspection, and robotics data pipelines.

Given a LinkedIn profile (name, company, title, summary, description), return a strict JSON object with these fields:
- full_name: echo back the lead's full name exactly as given in the input. This lets us cross-check that the output row maps to the correct lead if anything gets reordered or misaligned.
- function_qualification: "YES" if the person's function/company is relevant to manufacturing-robotics AI training data, else "NO".
- function_reasoning: one short paragraph justifying the YES/NO.
- icp_qualification: "YES" | "NO" | null. Null if function_qualification is NO.
- seniority_scoring: integer 1-5 (1 = IC, 5 = C-suite / founder).
- priority_level: "P0" | "P1" | "P2" | null. Null if function_qualification is NO.
- product_area: short string, the company or team name.
- lead_summary: a clean prose summary (no literal "\n" escape sequences — use real line breaks where needed).

Do NOT wrap the JSON in markdown. Return ONLY the JSON object.$$,
  true
)
on conflict (slug) do nothing;

insert into public.prompt_templates (name, slug, description, system_prompt, is_default)
values
(
  'General B2B',
  'general-b2b',
  'Neutral qualifier with no vertical bias — useful for lists outside Deccan AI''s robotics ICP.',
  $$You are a senior B2B sales analyst. Given a LinkedIn profile (name, company, title, summary, description), qualify the lead against the ICP the user provides in the user message.

Return a strict JSON object with these fields:
- full_name: echo back the lead's full name exactly as given in the input, so the output can be cross-checked against the correct lead.
- function_qualification: "YES" | "NO".
- function_reasoning: short paragraph.
- icp_qualification: "YES" | "NO" | null.
- seniority_scoring: integer 1-5.
- priority_level: "P0" | "P1" | "P2" | null.
- product_area: short string.
- lead_summary: clean prose (no literal "\n" escape sequences).

Do NOT wrap the JSON in markdown. Return ONLY the JSON object.$$,
  false
)
on conflict (slug) do nothing;

-- Seed initial version rows.
insert into public.prompt_template_versions (template_id, version, name, system_prompt)
select id, version, name, system_prompt from public.prompt_templates
on conflict do nothing;
