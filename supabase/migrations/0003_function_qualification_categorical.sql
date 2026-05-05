-- Run in the Supabase SQL editor.
-- Drops the YES/NO check on function_qualification so custom prompts can
-- return free-form categorical values (e.g. "Decision Maker", "Champion",
-- "Influencer"). Mirrors the icp_qualification relaxation from
-- 0002_agent_domain_fields.sql.
--
-- Column type stays text, nullable. Old rows with 'YES'/'NO' values stay
-- valid; new rows can carry any string the prompt produces. Analytics +
-- worker.qualified_count still key off === "YES" for now (legacy
-- semantics); a future revamp will make those predicate-driven.

alter table public.leads
  drop constraint if exists leads_function_qualification_check;
