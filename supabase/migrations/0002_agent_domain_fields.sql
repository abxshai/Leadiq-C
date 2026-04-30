-- Run in the Supabase SQL editor.
-- Adds 4 agent-output columns (domain classification + subdomain + their
-- justifications) and relaxes the icp_qualification check constraint so
-- it accepts categorical values like "Influencer", "Decision Maker",
-- "Champion", etc. — the prompt now treats ICP fit as a category rather
-- than a strict YES/NO.

alter table public.leads
  add column if not exists domain_classification    text,
  add column if not exists subdomain                text,
  add column if not exists subdomain_justification  text,
  add column if not exists domain_reasoning         text;

-- Drop the YES/NO check on icp_qualification (column type stays text,
-- nullable). Old rows with 'YES'/'NO' values stay valid; new rows can
-- carry "Influencer", "Champion", etc.
alter table public.leads
  drop constraint if exists leads_icp_qualification_check;

create index if not exists leads_domain_classification_idx
  on public.leads(domain_classification);
