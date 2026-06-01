-- crm_ingest — dedicated Postgres role for the HubSpot / Smartlead ingest service.
--
-- Run MANUALLY in the Supabase SQL editor (it executes as `postgres`, which has
-- CREATEROLE + BYPASSRLS + CREATE on the database — all of this is permitted).
--
-- ⚠️  SECRET HANDLING: replace the placeholder password below with a strong
--     secret AT RUN TIME. Do NOT commit the real password to this file or the
--     repo. Store it only in the ingest service's environment / secrets manager.
--     This file is a sanitized reference of the access model, not a credential.
--
-- Access model:
--   • Owns its own `crm` schema  → full read/write/DDL for HubSpot + Smartlead
--     tables (crm.contacts, crm.touchpoints, …). The ingest service runs its
--     own migrations here without touching the app's core tables.
--   • Read-only on `public`      → can match leads ↔ contacts, cannot mutate
--     campaigns / leads / templates / chat.
--   • BYPASSRLS                   → required so a direct (non-PostgREST) DB
--     connection gets past the public-table RLS policies, which gate on
--     auth.role() = 'authenticated' (NULL on a raw connection → zero rows).
--     The bypass only matters for reads here — there are no write grants on
--     public, so blast radius stays contained.

-- 1. Login role for the ingest service.
create role crm_ingest with login password 'CHANGE_ME_STRONG_SECRET' bypassrls;

-- 2. Schema owned by `postgres`, with crm_ingest granted CREATE so it can make
--    its own tables here. NOTE: we do NOT use `AUTHORIZATION crm_ingest` —
--    on Supabase, `postgres` (CREATEROLE, non-superuser) lacks SET ROLE on a
--    freshly-created role, so CREATE SCHEMA ... AUTHORIZATION fails with
--    "must be able to SET ROLE". Granting CREATE on a postgres-owned schema
--    is equivalent for our purposes: every table the ingest creates here it
--    owns outright (full read/write/DDL on its own data); it just can't DROP
--    the schema object itself — which a service shouldn't do anyway.
create schema if not exists crm;
grant usage, create on schema crm to crm_ingest;

-- 3. Read-only access to the app's existing data for matching.
grant usage on schema public to crm_ingest;
grant select on all tables in schema public to crm_ingest;
alter default privileges for role postgres in schema public
  grant select on tables to crm_ingest;

-- Connection (Supabase pooler — direct host is IPv6-only on this project;
-- custom-role username through Supavisor is "<role>.<project_ref>"):
--
--   postgresql://crm_ingest.dmvyfnxgmmltxwrauwpn:YOUR_PASSWORD@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres
--
-- The service writes to schema-qualified tables (crm.<table>) or sets
-- `search_path = crm, public` on connect. Port 6543 = transaction pooler;
-- with postgres.js set `prepare: false`.
--
-- TO REVOKE LATER:
--   reassign owned by crm_ingest to postgres;  -- or: drop schema crm cascade;
--   drop owned by crm_ingest;
--   drop role crm_ingest;
