-- 0014_detect_instant_autoreplies.sql
-- ---------------------------------------------------------------------------
-- Catch out-of-office auto-replies that have no usable body.
--
-- Some OOO autoresponders land in smartlead_reply_threads as a REPLY with an
-- empty body (our ingest captured the event, not the "I'm away until …" text)
-- and a null lead_category — so neither the category check nor the OOO
-- body-pattern (0011) flags them, and they fall through to 'replied' (hot).
-- Example: a reply arriving 2 SECONDS after our send.
--
-- Fix: a REPLY arriving within 2 minutes of the preceding SENT is mechanically
-- an auto-reply (no human reads + composes a reply that fast), so classify it
-- 'ooo'. Conservative window — genuine replies to cold outreach take far longer,
-- and a real interested reply carries body text the existing pattern would key
-- on first. Everything else is identical to 0013.
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
  rt as (
    select lower(lead_email) as email, count(*)::int as thread_count
    from crm.smartlead_reply_threads
    where lead_email is not null
    group by 1
  ),
  -- Attach, to each message, the most recent SENT at/before it (per person),
  -- so a REPLY's turnaround time can flag instant autoresponders.
  rt_seq as (
    select
      lower(lead_email) as email,
      message_type,
      message_time,
      lead_category,
      email_body,
      max(message_time) filter (where message_type = 'SENT')
        over (partition by lower(lead_email) order by message_time
              rows between unbounded preceding and current row)    as prev_sent
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
        -- Instant auto-reply: a reply within 2 min of our send is an
        -- autoresponder, not a human. Catches empty-body OOO replies.
        when message_type = 'REPLY'
          and prev_sent is not null
          and message_time - prev_sent <= interval '2 minutes'
          then 'ooo'
        when message_type = 'REPLY' then 'replied'
        else null
      end as st
    from rt_seq
  ),
  rt_status as (
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
    group by email
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
