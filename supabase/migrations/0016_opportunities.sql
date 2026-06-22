-- 0016_opportunities.sql
-- ---------------------------------------------------------------------------
-- M-CX3 — the /opportunities surface.
--
-- Apply via the Supabase SQL editor / MCP (project convention; see 0002–0015).
-- (0007 stays reserved for M-AG2 pgvector.)
--
-- Goal: one place listing the *live, positive* opportunities a rep should act
-- on, sourced from BOTH halves of the CRM and surfaced as cards:
--   • Smartlead conversations that captured genuine customer interest — a
--     reply classified meeting/interested (NOT opens/clicks/sends, NOT OOO or
--     negative replies), with the actual reply bodies behind an LLM recap.
--   • HubSpot pending deals — open deals (neither closed-won nor closed-lost)
--     in a live pipeline, with stage / amount / company / owner.
--
-- This migration:
--   (1) crm.smartlead_reply_status — factors the per-person reply-status
--       derivation (previously inlined in classify_campaign_temperature) into
--       one shared view, so the classifier and the opportunities surface can
--       never diverge. Verified bit-identical to the 0014 inline logic before
--       apply (0 mismatches across all thread emails).
--   (2) classify_campaign_temperature — re-created to read reply_status from
--       the shared view instead of inlining it. Every other line is identical
--       to 0014.
--   (3) public.opportunity_summaries — cache for the on-demand thread recap,
--       keyed by lead_email (conversations live in the conference-outreach
--       population that mostly has NO qualified-lead row, so we can't cache on
--       leads.touchpoint_summary like M-CX2 does).
--   (4) get_opportunity_thread(email) — fetch a conversation's messages for
--       summarization, keyed by email (the thread-side analogue of
--       get_lead_reply_threads, which is lead-id keyed).
--   (5) list_opportunities(...) — the server-side, filtered, paginated feed of
--       opportunity cards the page reads (SECURITY DEFINER so it can reach the
--       crm schema, which PostgREST doesn't expose; mirrors lead_filter_facets
--       / get_lead_reply_threads).
--
-- Everything here is read-enrichment over the CRM ingest — nothing writes back
-- to HubSpot or Smartlead, and nothing gates qualification.

-- ---------------------------------------------------------------------------
-- 0. Shared LinkedIn-URL normalizer (same shape used inline by the classifier
--    since 0006). Immutable; used by the conversation→qualified-lead bridge.
-- ---------------------------------------------------------------------------
create or replace function public.norm_linkedin(u text)
  returns text
  language sql
  immutable
as $$
  select lower(regexp_replace(regexp_replace(u, '^https?://(www\.)?', ''), '/+$', ''));
$$;

-- ---------------------------------------------------------------------------
-- 1. Shared reply-status view (one row per thread email).
--    Exact copy of the 0014 inline rt_seq → rt_msg → rt_status logic:
--    Smartlead lead_category first, then an OOO body-pattern, then an
--    instant-auto-reply heuristic (a REPLY within 2 min of our SEND), else a
--    bare 'replied'. Per person the most decision-relevant status wins.
-- ---------------------------------------------------------------------------
create or replace view crm.smartlead_reply_status as
with rt_seq as (
  select
    lower(lead_email) as email,
    message_type, message_time, lead_category, email_body,
    max(message_time) filter (where message_type = 'SENT')
      over (partition by lower(lead_email) order by message_time
            rows between unbounded preceding and current row) as prev_sent
  from crm.smartlead_reply_threads
  where lead_email is not null
),
rt_msg as (
  select
    email,
    case
      when lead_category ilike '%out of office%'  then 'ooo'
      when lead_category ilike '%do not contact%' then 'do_not_contact'
      when lead_category ilike '%not interested%' then 'not_interested'
      when lead_category ilike '%wrong person%'   then 'wrong_person'
      when lead_category ilike '%bounce%'         then 'bounce'
      when lead_category ilike '%meeting%'        then 'meeting'
      when lead_category ilike '%interested%'     then 'interested'
      when message_type = 'REPLY'
        and regexp_replace(coalesce(email_body, ''), '<[^>]*>', '', 'g') ~*
            '(out of office|out of the office|\mooo\M|on (annual |maternity |paternity |sick |)leave|on vacation|on holiday|public holiday|national holiday|away (from|until|on)|will (be back|respond|reply|return)|automatic reply|auto[- ]?reply|currently (away|unavailable|out)|limited access to|back in the office)'
        then 'ooo'
      when message_type = 'REPLY'
        and prev_sent is not null
        and message_time - prev_sent <= interval '2 minutes'
        then 'ooo'
      when message_type = 'REPLY' then 'replied'
      else null
    end as st
  from rt_seq
)
select
  email,
  (array_agg(st order by
    case st
      when 'meeting'        then 1
      when 'interested'     then 2
      when 'do_not_contact' then 3
      when 'not_interested' then 4
      when 'wrong_person'   then 5
      when 'bounce'         then 6
      when 'replied'        then 7
      when 'ooo'            then 8
      else 99
    end
  ) filter (where st is not null))[1] as reply_status
from rt_msg
group by email;

-- ---------------------------------------------------------------------------
-- 2. classify_campaign_temperature — now sources reply_status from the shared
--    view. Identical to 0014 except the rt_seq/rt_msg/rt_status CTEs are
--    replaced by a join to crm.smartlead_reply_status.
-- ---------------------------------------------------------------------------
create or replace function public.classify_campaign_temperature(p_campaign_id uuid)
  returns integer
  language plpgsql
  security definer
  set search_path to 'public', 'crm'
as $function$
declare
  affected integer;
begin
  with
  qlead as (
    select
      id,
      public.norm_linkedin(default_profile_url) as nu
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
     and public.norm_linkedin(c.hs_linkedin_url) = q.nu
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
  rt as (
    select lower(lead_email) as email, count(*)::int as thread_count
    from crm.smartlead_reply_threads
    where lead_email is not null
    group by 1
  ),
  -- reply_status now comes from the shared view (was inline in 0011–0014).
  rt_status as (
    select email, reply_status from crm.smartlead_reply_status
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
      coalesce(rt.thread_count, 0)                  as reply_thread_count,
      rs.reply_status
    from qlead q
    left join contact ct on ct.lead_id = q.id
    left join sl on sl.email = ct.email
    left join rt on rt.email = ct.email
    left join rt_status rs on rs.email = ct.email
  ),
  classified as (
    select
      j.*,
      greatest(j.last_sent, j.last_open, j.last_click, j.last_reply,
               j.hs_sales_email_last_replied)        as last_activity,
      case
        when j.lifecyclestage in ('opportunity', 'customer', 'evangelist') then 'hot'
        when coalesce(j.reply_status, '') in ('ooo', 'not_interested', 'do_not_contact') then
          case
            when greatest(j.last_sent, j.last_open, j.last_click, j.last_reply,
                          j.hs_sales_email_last_replied) >= now() - interval '6 months' then 'warm'
            else 'cold'
          end
        when j.hs_sales_email_last_replied >= now() - interval '90 days' then 'hot'
        when j.last_reply                  >= now() - interval '90 days' then 'hot'
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
          'reply_status', c.reply_status,
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
$function$;

grant execute on function public.classify_campaign_temperature(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Cached LLM recap for an opportunity conversation, keyed by lead_email.
--    Written only by the summarize route (service role) and read only by
--    list_opportunities (SECURITY DEFINER) — both bypass RLS — so RLS is on
--    with no policy: direct PostgREST/anon/authenticated access is denied.
--    Shape mirrors leads.touchpoint_summary: { summary, signal, status,
--    thread_count, generated_at, model }.
-- ---------------------------------------------------------------------------
create table if not exists public.opportunity_summaries (
  email        text primary key,
  summary      jsonb not null,
  generated_at timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.opportunity_summaries enable row level security;
grant all on public.opportunity_summaries to service_role;

-- ---------------------------------------------------------------------------
-- 4. Fetch one conversation's messages (oldest first) for summarization,
--    keyed by email. Thread-side analogue of get_lead_reply_threads.
-- ---------------------------------------------------------------------------
create or replace function public.get_opportunity_thread(p_email text)
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
  select
    t.message_type,
    t.message_time,
    t.subject,
    t.email_body,
    t.email_campaign_name,
    t.email_campaign_id,
    t.email_seq_number
  from crm.smartlead_reply_threads t
  where lower(t.lead_email) = lower(btrim(p_email))
  order by t.message_time;
$$;

grant execute on function public.get_opportunity_thread(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The opportunities feed. One row per card; server-side filtered, sorted
--    newest-engagement-first, and paginated (count(*) over () gives the total
--    for the UI). SECURITY DEFINER so it can read the crm schema.
--
--    Filters:
--      p_kind   'conversation' | 'deal' | null(both)
--      p_window '3m' | '6m' | 'all'   (on last_engaged)
--      p_status text[] of reply_status for conversations
--               (default meeting + interested — the genuine-interest set)
--      p_q      substring over title / company
--      p_limit / p_offset  pagination
-- ---------------------------------------------------------------------------
create or replace function public.list_opportunities(
  p_kind   text      default null,
  p_window text      default '6m',
  p_status text[]    default null,
  p_q      text      default null,
  p_limit  integer   default 24,
  p_offset integer   default 0
)
  returns table (
    opp_id        text,
    kind          text,
    title         text,
    company       text,
    subtitle      text,
    reply_status  text,
    stage_label   text,
    amount        double precision,
    owner_name    text,
    last_engaged  timestamptz,
    thread_count  integer,
    summary       jsonb,
    lead_id       uuid,
    linkedin_url  text,
    hs_contact_id bigint,
    hs_deal_id    bigint,
    email         text,
    smartlead_campaign_id bigint,
    total_count   bigint
  )
  language sql
  stable
  security definer
  set search_path = public, crm
as $$
  with
  cutoff as (
    select case lower(coalesce(p_window, '6m'))
      when '3m'  then now() - interval '3 months'
      when '6m'  then now() - interval '6 months'
      when 'all' then null::timestamptz
      else now() - interval '6 months'
    end as ts
  ),
  want_status as (
    select coalesce(p_status, array['meeting','interested']) as s
  ),
  -- one row per conversation email (email→campaign is 1:1 in the ingest)
  conv_base as (
    select
      lower(t.lead_email)                                          as email,
      max(t.lead_first_name)                                       as fn,
      max(t.lead_last_name)                                        as ln,
      max(t.email_campaign_name)                                   as campaign,
      max(t.email_campaign_id)                                     as campaign_id,
      max(t.message_time) filter (where t.message_type = 'REPLY')  as last_reply,
      count(*)::int                                                as thread_count
    from crm.smartlead_reply_threads t
    where t.lead_email is not null
    group by 1
  ),
  -- best contact match per email (company + linkedin + hubspot id)
  contact_enr as (
    select distinct on (lower(c.email))
      lower(c.email)   as email,
      c.company,
      c.hs_object_id,
      c.hs_linkedin_url
    from crm.gtm_contact_data c
    where c.email is not null
    order by lower(c.email), c.notes_last_updated desc nulls last
  ),
  qlead as (
    select id, default_profile_url,
      public.norm_linkedin(default_profile_url) as nu,
      lower(btrim(full_name))                   as nm
    from public.leads
    where function_qualification is not null
      and upper(btrim(function_qualification)) <> 'NO'
  ),
  conv as (
    select
      'sl:' || b.email                                            as opp_id,
      'conversation'                                              as kind,
      coalesce(nullif(btrim(coalesce(b.fn,'') || ' ' || coalesce(b.ln,'')), ''),
               b.email)                                           as title,
      ce.company                                                  as company,
      b.campaign                                                  as subtitle,
      rs.reply_status                                             as reply_status,
      null::text                                                  as stage_label,
      null::double precision                                      as amount,
      null::text                                                  as owner_name,
      b.last_reply                                                as last_engaged,
      b.thread_count                                              as thread_count,
      os.summary                                                  as summary,
      -- qualified-lead bridge: HubSpot LinkedIn first, then name fallback
      coalesce(ql_url.id, ql_nm.id)                               as lead_id,
      coalesce(ql_url.default_profile_url, ql_nm.default_profile_url) as linkedin_url,
      ce.hs_object_id                                             as hs_contact_id,
      null::bigint                                                as hs_deal_id,
      b.email                                                     as email,
      b.campaign_id                                               as smartlead_campaign_id
    from conv_base b
    join crm.smartlead_reply_status rs on rs.email = b.email
    cross join want_status ws
    left join contact_enr ce on ce.email = b.email
    left join public.opportunity_summaries os on os.email = b.email
    left join lateral (
      select id, default_profile_url from qlead
      where ce.hs_linkedin_url is not null and nu = public.norm_linkedin(ce.hs_linkedin_url)
      limit 1
    ) ql_url on true
    left join lateral (
      select id, default_profile_url from qlead
      where nm = lower(btrim(coalesce(b.fn,'') || ' ' || coalesce(b.ln,'')))
        and btrim(coalesce(b.fn,'') || ' ' || coalesce(b.ln,'')) <> ''
      limit 1
    ) ql_nm on true
    where rs.reply_status = any (ws.s)
  ),
  deal as (
    select
      'deal:' || d.hs_object_id                                   as opp_id,
      'deal'                                                      as kind,
      d.dealname                                                 as title,
      coalesce(d.company_name, co.name)                          as company,
      d.pipeline_label                                           as subtitle,
      null::text                                                 as reply_status,
      d.dealstage_label                                          as stage_label,
      d.amount                                                   as amount,
      d.ownername                                                as owner_name,
      greatest(d.hs_v2_date_entered_current_stage, d.notes_last_updated, d.createdate) as last_engaged,
      null::int                                                  as thread_count,
      null::jsonb                                                as summary,
      null::uuid                                                 as lead_id,
      null::text                                                 as linkedin_url,
      null::bigint                                               as hs_contact_id,
      d.hs_object_id                                             as hs_deal_id,
      null::text                                                 as email,
      null::bigint                                               as smartlead_campaign_id
    from crm.gtm_deal_data d
    left join crm.gtm_company_data co on co.hs_object_id = d.hs_primary_associated_company
    where not coalesce(d.hs_is_closed_won, false)
      and not coalesce(d.hs_is_closed_lost, false)
      and coalesce(d.pipeline_label, '') not ilike '%defunct%'
  ),
  cards as (
    select * from conv
    union all
    select * from deal
  ),
  filtered as (
    select c.*
    from cards c, cutoff
    where (p_kind is null or c.kind = p_kind)
      and (cutoff.ts is null or c.last_engaged >= cutoff.ts)
      and (
        p_q is null or btrim(p_q) = ''
        or c.title   ilike '%' || replace(replace(p_q, '%',''), '\','') || '%'
        or coalesce(c.company,'') ilike '%' || replace(replace(p_q, '%',''), '\','') || '%'
      )
  )
  select
    f.opp_id, f.kind, f.title, f.company, f.subtitle, f.reply_status,
    f.stage_label, f.amount, f.owner_name, f.last_engaged, f.thread_count,
    f.summary, f.lead_id, f.linkedin_url, f.hs_contact_id, f.hs_deal_id, f.email,
    f.smartlead_campaign_id,
    count(*) over ()::bigint as total_count
  from filtered f
  order by f.last_engaged desc nulls last
  limit greatest(p_limit, 1)
  offset greatest(p_offset, 0);
$$;

grant execute on function public.list_opportunities(text, text, text[], text, integer, integer)
  to authenticated, service_role;
