-- Run in the Supabase SQL editor to add per-campaign Groq call spacing.
-- Default 1000ms stays within Groq's 250k TPM rate limit at typical
-- concurrency settings.

alter table public.campaigns
  add column if not exists delay_ms int not null default 1000
    check (delay_ms between 0 and 60000);
