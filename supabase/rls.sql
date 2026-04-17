-- Qualifier — Row-Level Security policies (single-workspace mode)
-- Run AFTER schema.sql in the Supabase SQL editor.
--
-- Policy: anyone with a valid auth session can read/write all rows.
-- Multi-tenant isolation can be added later by introducing a workspace_id
-- column and tightening the USING / WITH CHECK clauses below.

alter table public.prompt_templates         enable row level security;
alter table public.prompt_template_versions enable row level security;
alter table public.campaigns                enable row level security;
alter table public.leads                    enable row level security;

-- prompt_templates
create policy "auth read templates"
  on public.prompt_templates for select
  using (auth.role() = 'authenticated');

create policy "auth write templates"
  on public.prompt_templates for insert
  with check (auth.role() = 'authenticated');

create policy "auth update templates"
  on public.prompt_templates for update
  using (auth.role() = 'authenticated');

create policy "auth delete templates"
  on public.prompt_templates for delete
  using (auth.role() = 'authenticated');

-- prompt_template_versions
create policy "auth read template versions"
  on public.prompt_template_versions for select
  using (auth.role() = 'authenticated');

create policy "auth write template versions"
  on public.prompt_template_versions for insert
  with check (auth.role() = 'authenticated');

-- campaigns
create policy "auth read campaigns"
  on public.campaigns for select
  using (auth.role() = 'authenticated');

create policy "auth write campaigns"
  on public.campaigns for insert
  with check (auth.role() = 'authenticated');

create policy "auth update campaigns"
  on public.campaigns for update
  using (auth.role() = 'authenticated');

create policy "auth delete campaigns"
  on public.campaigns for delete
  using (auth.role() = 'authenticated');

-- leads
create policy "auth read leads"
  on public.leads for select
  using (auth.role() = 'authenticated');

create policy "auth write leads"
  on public.leads for insert
  with check (auth.role() = 'authenticated');

create policy "auth update leads"
  on public.leads for update
  using (auth.role() = 'authenticated');

create policy "auth delete leads"
  on public.leads for delete
  using (auth.role() = 'authenticated');
