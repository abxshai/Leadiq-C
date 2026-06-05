-- 0006_lead_temperature.sql
-- M-CX1 — Smartlead/HubSpot cross-check + lead temperature.
--
-- Apply via the Supabase SQL editor (project convention; see migrations
-- 0002–0005 and the roadmap 2026-05-07 entry).
--
-- Architecture note (2026-06-05): the original cross-check-plan.md assumed an
-- external common-DB reached over HTTP. That data now lives in the `crm`
-- schema *inside this same project* (gtm_contact_data, smartlead_email_stats,
-- synced by a separate ingest service), so the cross-check is a pure local
-- JOIN — no HTTP contract, no BYOK key, no rate gate. Temperature is computed
-- set-based per campaign by the function below, called once at campaign
-- completion (worker) and on demand (the "Cross-check leads" button).
--
-- Temperature is ENRICHMENT, never a gate: a CRM-side problem must never fail a
-- campaign's qualification. The worker calls the function in a try/catch and
-- swallows errors.

-- ---------------------------------------------------------------------------
-- 1. Columns on public.leads (all nullable — safe against existing rows).
-- ---------------------------------------------------------------------------
alter table public.leads
  add column if not exists temperature text
    check (temperature in ('hot', 'warm', 'cold') or temperature is null),
  add column if not exists touchpoint_match jsonb,        -- evidence for the inline-expand UI
  add column if not exists touchpoint_checked_at timestamptz;

-- Partial index: campaign-detail filters by (campaign_id, temperature) and
-- only ever cares about rows that have been cross-checked.
create index if not exists leads_temperature_idx
  on public.leads (campaign_id, temperature)
  where temperature is not null;

-- ---------------------------------------------------------------------------
-- 2. The classifier. One set-based pass per campaign.
--
--    Join chain (leads have no email, so the HubSpot contact bridges):
--      leads.default_profile_url
--        -> normalize -> crm.gtm_contact_data.hs_linkedin_url
--        -> crm.gtm_contact_data.email
--        -> crm.smartlead_email_stats.lead_email
--
--    URL normalization is required: leads store https://linkedin.com/...,
--    HubSpot stores http://www.linkedin.com/... — strip protocol + leading
--    www. + trailing slashes, lowercase. Lifts the match count materially.
--
--    SECURITY DEFINER so it can read the `crm` schema and write public.leads
--    regardless of the caller's role (worker uses service_role; the backfill
--    route may call as authenticated). Owner is the migration role (postgres),
--    which already has SELECT on crm and full access to public.
--
--    Idempotent: every qualified lead in the campaign is (re)classified from
--    scratch on each call — unmatched leads resolve to 'cold', so re-running
--    after a CRM resync or a rule change cannot leave stale values behind.
-- ---------------------------------------------------------------------------
create or replace function public.classify_campaign_temperature(p_campaign_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, crm
as $$
declare
  affected integer;
begin
  with
  -- Every qualified lead in the campaign (the only rows we cross-check).
  qlead as (
    select
      id,
      lower(regexp_replace(regexp_replace(default_profile_url, '^https?://(www\.)?', ''), '/+$', '')) as nu
    from public.leads
    where campaign_id = p_campaign_id
      and function_qualification is not null
      and upper(btrim(function_qualification)) <> 'NO'
  ),
  -- Best HubSpot contact per lead (most recently active wins on dupes).
  contact as (
    select distinct on (q.id)
      q.id                          as lead_id,
      c.hs_object_id,
      c.lifecyclestage,
      c.hs_sales_email_last_replied,
      c.notes_last_updated,
      lower(c.email)                as email
    from qlead q
    join crm.gtm_contact_data c
      on c.hs_linkedin_url is not null
     and lower(regexp_replace(regexp_replace(c.hs_linkedin_url, '^https?://(www\.)?', ''), '/+$', '')) = q.nu
    order by q.id,
      c.hs_sales_email_last_replied desc nulls last,
      c.notes_last_updated desc nulls last
  ),
  -- Smartlead engagement aggregated per email (one row per contact email).
  -- One row per Smartlead email-sequence step, with the strongest event it
  -- represents (reply > click > open > sent) and the timestamp of that event.
  sl_raw as (
    select
      lower(s.lead_email)                                          as email,
      s.campaign_id,
      s.campaign_name,
      s.email_subject,
      s.sent_time, s.open_time, s.click_time, s.reply_time,
      coalesce(s.open_count, 0)                                    as open_count,
      coalesce(s.click_count, 0)                                   as click_count,
      coalesce(s.is_bounced, false)                                as is_bounced,
      coalesce(s.is_unsubscribed, false)                           as is_unsubscribed,
      coalesce(s.reply_time, s.click_time, s.open_time, s.sent_time) as event_at,
      case
        when s.reply_time is not null then 'replied'
        when s.click_time is not null then 'clicked'
        when s.open_time  is not null then 'opened'
        else 'sent'
      end                                                          as action
    from crm.smartlead_email_stats s
    where s.lead_email is not null
  ),
  sl_ranked as (
    select *,
      row_number() over (partition by email order by event_at desc nulls last) as rn
    from sl_raw
  ),
  -- Per contact email: classification summary + a capped, most-recent-first
  -- citation list of the actual touchpoints (subject + action + date).
  sl as (
    select
      email,
      max(reply_time)                                              as last_reply,
      max(open_time)                                               as last_open,
      max(click_time)                                              as last_click,
      max(sent_time)                                               as last_sent,
      bool_or(is_bounced)                                          as bounced,
      bool_or(is_unsubscribed)                                     as unsubscribed,
      array_agg(distinct campaign_name)
        filter (where campaign_name is not null)                   as campaigns,
      jsonb_agg(
        jsonb_build_object(
          'date', event_at,
          'action', action,
          'campaign', campaign_name,
          'campaign_id', campaign_id,
          'subject', email_subject,
          'opens', open_count,
          'clicks', click_count
        )
        order by event_at desc nulls last
      ) filter (where rn <= 12)                                    as events
    from sl_ranked
    group by email
  ),
  -- Left-join from ALL qualified leads so unmatched ones fall through to cold.
  joined as (
    select
      q.id                                          as lead_id,
      ct.hs_object_id,
      ct.lifecyclestage,
      ct.hs_sales_email_last_replied,
      ct.notes_last_updated,
      ct.email,
      sl.last_reply, sl.last_open, sl.last_click, sl.last_sent,
      sl.bounced, sl.unsubscribed, sl.campaigns, sl.events
    from qlead q
    left join contact ct on ct.lead_id = q.id
    left join sl on sl.email = ct.email
  ),
  classified as (
    select
      j.*,
      -- Most-recent outreach/engagement timestamp across both sources.
      greatest(j.last_sent, j.last_open, j.last_click, j.last_reply,
               j.hs_sales_email_last_replied)        as last_activity,
      case
        -- HOT: active pipeline stage, or an interest signal in the last 90 days.
        when j.lifecyclestage in ('opportunity', 'customer', 'evangelist') then 'hot'
        when j.hs_sales_email_last_replied >= now() - interval '90 days'   then 'hot'
        when j.last_reply                  >= now() - interval '90 days'   then 'hot'
        -- WARM: any outreach or engagement in the last 6 months.
        when greatest(j.last_sent, j.last_open, j.last_click, j.last_reply,
                      j.hs_sales_email_last_replied) >= now() - interval '6 months' then 'warm'
        -- COLD: no match, or only stale activity.
        else 'cold'
      end as temperature
    from joined j
  )
  update public.leads l
  set
    temperature = c.temperature,
    touchpoint_checked_at = now(),
    touchpoint_match = case
      when c.hs_object_id is null and c.campaigns is null then null  -- no CRM presence at all
      else jsonb_strip_nulls(jsonb_build_object(
        'hubspot', case when c.hs_object_id is null then null else jsonb_build_object(
          'contact_id', c.hs_object_id,
          'lifecyclestage', c.lifecyclestage,
          'last_replied', c.hs_sales_email_last_replied,
          'notes_last_updated', c.notes_last_updated
        ) end,
        'smartlead', case when c.campaigns is null then null else jsonb_build_object(
          'campaigns', to_jsonb(c.campaigns),
          'last_reply', c.last_reply,
          'last_open', c.last_open,
          'last_click', c.last_click,
          'last_sent', c.last_sent,
          'bounced', c.bounced,
          'unsubscribed', c.unsubscribed,
          'events', c.events
        ) end,
        'last_activity', c.last_activity
      ))
    end
  from classified c
  where l.id = c.lead_id;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

grant execute on function public.classify_campaign_temperature(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. One-time backfill of all existing campaigns at apply time.
--    New campaigns are classified automatically by the worker on completion.
-- ---------------------------------------------------------------------------
do $$
declare
  c record;
  n integer;
begin
  for c in select id from public.campaigns loop
    n := public.classify_campaign_temperature(c.id);
    raise notice '[0006] campaign % -> % leads classified', c.id, n;
  end loop;
end $$;
