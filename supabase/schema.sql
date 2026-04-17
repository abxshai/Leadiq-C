-- Qualifier — Supabase schema (v0.1)
-- Run once in the Supabase SQL editor.

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
create index if not exists campaigns_created_at_idx    on public.campaigns(created_at desc);
create index if not exists campaigns_template_id_idx   on public.campaigns(prompt_template_id);

-- ---------------------------------------------------------------------------
-- Leads (one row per LinkedIn profile per campaign, merged input + output)
-- ---------------------------------------------------------------------------
create table if not exists public.leads (
  id                      uuid primary key default gen_random_uuid(),
  campaign_id             uuid not null references public.campaigns(id) on delete cascade,

  -- Input (pass-through from LinkedIn scraper — matches Lead data format.csv cols 1-9)
  default_profile_url     text,
  full_name               text,
  first_name              text,
  last_name               text,
  company_name            text,
  title                   text,
  summary                 text,
  title_description       text,
  location                text,

  -- Agent output (nullable until processed — matches cols 10-17)
  agent_full_name         text,
  function_qualification  text check (function_qualification in ('YES','NO') or function_qualification is null),
  function_reasoning      text,
  icp_qualification       text check (icp_qualification in ('YES','NO') or icp_qualification is null),
  seniority_scoring       int  check (seniority_scoring between 1 and 5 or seniority_scoring is null),
  priority_level          text,
  product_area            text,
  lead_summary            text,

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

-- ---------------------------------------------------------------------------
-- Seed: two default templates
-- ---------------------------------------------------------------------------
insert into public.prompt_templates (name, slug, description, system_prompt, is_default)
values
(
  'Robotics / Manufacturing AI',
  'robotics-manufacturing-ai',
  'Deccan AI''s default ICP — targets AI-driven robotics, manipulation, defect inspection, and manufacturing training-data pipelines.',
  $$You are a senior B2B sales analyst qualifying leads for Deccan AI, a company providing training-data services for AI-driven manufacturing robotics — pose estimation, manipulation trajectory labeling, defect inspection, and robotics data pipelines.

Given a LinkedIn profile (company, title, summary, description), return a strict JSON object with these fields:
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
  $$You are a senior B2B sales analyst. Given a LinkedIn profile (company, title, summary, description), qualify the lead against the ICP the user provides in the user message.

Return a strict JSON object with these fields:
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

-- Seed initial version rows
insert into public.prompt_template_versions (template_id, version, name, system_prompt)
select id, version, name, system_prompt from public.prompt_templates
on conflict do nothing;
