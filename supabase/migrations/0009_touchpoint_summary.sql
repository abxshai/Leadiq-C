-- 0009_touchpoint_summary.sql
-- On-demand LLM summary of a hot/warm lead's Smartlead reply thread.
--
-- Apply via the Supabase SQL editor (project convention; see 0002–0008).
-- (0007 stays reserved for M-AG2 pgvector.)
--
-- Background: M-CX1 (0006) tags leads hot/warm/cold and cites Smartlead email
-- *metadata* (subject/action/date) in the inline-expand. The new
-- crm.smartlead_reply_threads table now holds the actual message *bodies*
-- (message_type SENT/REPLY, email_body, subject, message_time, ...), joinable
-- by lead_email. This migration:
--   (1) adds leads.touchpoint_summary jsonb — the cached LLM summary,
--   (2) teaches classify_campaign_temperature to record how many thread
--       messages a lead has (reply_thread_count) so the UI shows the
--       "Summarize" button only when there's content to summarize,
--   (3) adds get_lead_reply_threads(uuid) so the summarize route can fetch a
--       lead's thread without re-deriving the join client-side.
--
-- Summaries are generated on demand (BYOK Groq), per-lead, never in bulk — so
-- we don't burn tokens classifying every lead. The summary is ENRICHMENT, like
-- temperature: nothing here can fail a campaign's qualification.

-- ---------------------------------------------------------------------------
-- 1. Cached-summary column (nullable; written only by the summarize route).
--    Shape: { summary, signal, thread_count, generated_at, model }
-- ---------------------------------------------------------------------------
alter table public.leads
  add column if not exists touchpoint_summary jsonb;

-- ---------------------------------------------------------------------------
-- 2. Re-create the classifier (unchanged from 0006 except the reply-thread
--    count). New CTE `rt` counts thread messages per contact email; the count
--    is surfaced inside touchpoint_match.smartlead.reply_thread_count so the
--    client can gate the Summarize button. Threads imply Smartlead engagement,
--    so the count lives in the smartlead object (built only when matched).
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
  qlead as (
    select
      id,
      lower(regexp_replace(regexp_replace(default_profile_url, '^https?://(www\.)?', ''), '/+$', '')) as nu
    from public.leads
    where campaign_id = p_campaign_id
      and function_qualification is not null
      and upper(btrim(function_qualification)) <> 'NO'
  ),
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
  -- NEW: count of actual thread messages (sent + reply bodies) per email.
  -- Drives the "Summarize touchpoints" button visibility in the UI.
  rt as (
    select lower(lead_email) as email, count(*)::int as thread_count
    from crm.smartlead_reply_threads
    where lead_email is not null
    group by 1
  ),
  joined as (
    select
      q.id                                          as lead_id,
      ct.hs_object_id,
      ct.lifecyclestage,
      ct.hs_sales_email_last_replied,
      ct.notes_last_updated,
      ct.email,
      sl.last_reply, sl.last_open, sl.last_click, sl.last_sent,
      sl.bounced, sl.unsubscribed, sl.campaigns, sl.events,
      coalesce(rt.thread_count, 0)                  as reply_thread_count
    from qlead q
    left join contact ct on ct.lead_id = q.id
    left join sl on sl.email = ct.email
    left join rt on rt.email = ct.email
  ),
  classified as (
    select
      j.*,
      greatest(j.last_sent, j.last_open, j.last_click, j.last_reply,
               j.hs_sales_email_last_replied)        as last_activity,
      case
        when j.lifecyclestage in ('opportunity', 'customer', 'evangelist') then 'hot'
        when j.hs_sales_email_last_replied >= now() - interval '90 days'   then 'hot'
        when j.last_reply                  >= now() - interval '90 days'   then 'hot'
        when greatest(j.last_sent, j.last_open, j.last_click, j.last_reply,
                      j.hs_sales_email_last_replied) >= now() - interval '6 months' then 'warm'
        else 'cold'
      end as temperature
    from joined j
  )
  update public.leads l
  set
    temperature = c.temperature,
    touchpoint_checked_at = now(),
    touchpoint_match = case
      when c.hs_object_id is null and c.campaigns is null then null
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
          'reply_thread_count', c.reply_thread_count,
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
-- 3. Fetch a single lead's Smartlead reply thread (most-recent-last) for
--    summarization. Same join chain as the classifier:
--      leads.default_profile_url -> normalize -> gtm_contact_data.hs_linkedin_url
--      -> gtm_contact_data.email -> smartlead_reply_threads.lead_email
--    SECURITY DEFINER so the summarize route (service role) can read crm.
-- ---------------------------------------------------------------------------
create or replace function public.get_lead_reply_threads(p_lead_id uuid)
returns table(
  message_type  text,
  message_time  timestamptz,
  subject       text,
  email_body    text,
  campaign_name text,
  campaign_id   bigint,
  seq           text
)
language sql
security definer
set search_path = public, crm
as $$
  select distinct
    t.message_type,
    t.message_time,
    t.subject,
    t.email_body,
    t.email_campaign_name,
    t.email_campaign_id,
    t.email_seq_number
  from public.leads l
  join crm.gtm_contact_data c
    on c.hs_linkedin_url is not null
   and lower(regexp_replace(regexp_replace(c.hs_linkedin_url, '^https?://(www\.)?', ''), '/+$', ''))
     = lower(regexp_replace(regexp_replace(l.default_profile_url, '^https?://(www\.)?', ''), '/+$', ''))
  join crm.smartlead_reply_threads t
    on lower(t.lead_email) = lower(c.email)
  where l.id = p_lead_id
  order by t.message_time;
$$;

grant execute on function public.get_lead_reply_threads(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Backfill reply_thread_count onto existing rows by re-running the
--    classifier for every campaign (idempotent; leaves touchpoint_summary
--    untouched).
-- ---------------------------------------------------------------------------
do $$
declare
  c record;
  n integer;
begin
  for c in select id from public.campaigns loop
    n := public.classify_campaign_temperature(c.id);
    raise notice '[0009] campaign % -> % leads reclassified', c.id, n;
  end loop;
end $$;
