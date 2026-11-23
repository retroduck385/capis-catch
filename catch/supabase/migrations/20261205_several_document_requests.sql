-- CATCH — "Ask the applicant for documents": several requests can be open at once (2026-12-05)
-- Run after 20261204_kyc_clarification_guard.sql (needs 20261112_document_requests.sql,
-- 20261116_findings_and_file_marks.sql and 20261119_document_request_reminders.sql). Re-runnable, no drops of data.
--
-- What it does
--   * The assigned AO no longer has to close or withdraw a request before asking for something else. Each request
--     keeps its own message, items, uploads, "Send to my Account Officer", reminders and close / withdraw, exactly as
--     before; there can just be more than one that is not CLOSED.
--   * The same document can't be asked for twice while it is still owed: a checklist document (same person, same
--     type) or an "Other" document (same person, same name, any case) that is on a request still OPEN or SENT is
--     refused by preview_document_request (as its problem) and open_document_request.
--   * What the applicant sees (applicant_visible_status): "Documents needed" while any request is OPEN, else
--     "Documents sent" while any is SENT, else what the status gives (unchanged rules otherwise).
--   * document_request_context: 'open' = every request not closed, oldest first (replaces 'current'); can_open no
--     longer depends on a request being in progress.
--   * document_reminder_status: 'next_by_request' = { request_id: { reminder_no, at } } for every OPEN request
--     (replaces 'next').
--   * document_request_can_open: no longer false while a request is in progress.
--   * close_document_request: while another request is still in progress, the applicant's in-app line after a close
--     doesn't say "Status: Under review" or "No documents are needed for now".
--
-- Unchanged: the tables' columns, every applicant function (my_document_requests already returns a list), uploads,
--   send, queue_document_reminders (it already loops over every OPEN request), notices and deliveries.
--
-- Re-runs of earlier files: 20261112_document_requests.sql, 20261116_findings_and_file_marks.sql or
--   20261119_document_request_reminders.sql re-run -> run this file again afterwards (they put back their versions of
--   the functions below). 20261112 no longer creates the one-open-request index.

-- ============================================================
-- 0. Dependencies
-- ============================================================
do $$
begin
  if to_regclass('public.document_requests') is null
     or to_regprocedure('public.document_request_can_open(bigint)') is null
     or to_regprocedure('public.document_reminder_status(bigint)') is null then
    raise exception 'Run these migrations first, then this file again: 20261112_document_requests.sql, '
                    '20261116_findings_and_file_marks.sql, 20261119_document_request_reminders.sql';
  end if;
end $$;

-- ============================================================
-- 1. More than one request in progress per application
-- ============================================================
drop index if exists public.one_open_document_request;
create index if not exists document_requests_in_progress
  on public.document_requests (application_id) where status <> 'CLOSED';

-- ============================================================
-- 2. Helpers
-- ============================================================
-- The first picked document that is already on a request still in progress, as a problem sentence; null if none
create or replace function public.document_request_already_asked(p_application_id bigint, p_items jsonb)
returns text language sql stable security definer set search_path = public as $$
  select c.label || ' for the ' || party_label_text(c.applicant_id)
         || ' is already on a request that is still open. Wait for it or close it first.'
  from document_request_items_checked(p_application_id, p_items) c
  where exists (
    select 1 from document_request_items i join document_requests r on r.id = i.request_id
    where r.application_id = p_application_id and r.status <> 'CLOSED' and i.applicant_id = c.applicant_id
      and (case when c.requirement_type is null
                then i.requirement_type is null and lower(i.label) = lower(c.label)
                else i.requirement_type = c.requirement_type end))
  limit 1;
$$;
revoke execute on function public.document_request_already_asked(bigint, jsonb) from public, anon, authenticated;

-- ============================================================
-- 3. What the applicant sees (replaces the 20261112 version): OPEN wins over SENT
-- ============================================================
create or replace function public.applicant_visible_status(p_application_id bigint)
returns text language sql stable security definer set search_path = public as $$
  select case
    when applicant_status_bucket(la.status::text) in ('APPROVED', 'REJECTED', 'DEFERRED')
         and exists (select 1 from applicant_notices n where n.outcome_id = current_applicant_outcome(la.id))
      then applicant_status_bucket(la.status::text)
    when exists (select 1 from document_requests r where r.application_id = la.id and r.status = 'OPEN')
      then 'DOCUMENTS_NEEDED'
    when exists (select 1 from document_requests r where r.application_id = la.id and r.status = 'SENT')
      then 'DOCUMENTS_SENT'
    when applicant_status_bucket(la.status::text) in ('APPROVED', 'REJECTED', 'DEFERRED') then 'UNDER_REVIEW'
    else applicant_status_bucket(la.status::text) end
  from loan_applications la
  where la.id = p_application_id;
$$;
revoke execute on function public.applicant_visible_status(bigint) from public, anon, authenticated;

-- ============================================================
-- 4. The AO's panel (replace the 20261112 / 20261116 versions)
-- ============================================================
create or replace function public.document_request_context(p_application_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_why text;
  v_dest record;
begin
  if not staff_can_access(p_application_id) then
    raise exception 'You don''t have access to this application';
  end if;
  select * into v_dest from notice_destinations(p_application_id);
  v_why := case
    when not notice_is_assigned_ao(p_application_id) then 'Only the assigned Account Officer can ask the applicant for documents.'
    when not document_request_stage_ok(p_application_id)
      then 'Documents can be requested while the file is in Intake, Credit Investigation, Credit Evaluation or Review.' end;
  return jsonb_build_object(
    'application_no', notification_app_no(p_application_id),
    'is_assigned_ao', notice_is_assigned_ao(p_application_id),
    'can_open', v_why is null,
    'why_not', v_why,
    'max_length', 300,
    'sms_to', notice_mask(v_dest.sms),
    'email_to', notice_mask(v_dest.email),
    'open', coalesce((select jsonb_agg(document_request_json(r.id, true) order by r.id)
                      from document_requests r where r.application_id = p_application_id and r.status <> 'CLOSED'), '[]'::jsonb),
    'suggestions', case when notice_is_assigned_ao(p_application_id) then document_request_suggestions(p_application_id) end,
    'history', coalesce((select jsonb_agg(document_request_json(r.id, true) order by r.id desc)
                         from document_requests r where r.application_id = p_application_id and r.status = 'CLOSED'), '[]'::jsonb));
end $$;

create or replace function public.preview_document_request(p_application_id bigint, p_message text, p_items jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_problem text;
  v_items text;
  v_c record;
begin
  if not notice_is_assigned_ao(p_application_id) then
    raise exception 'Only the assigned Account Officer can ask the applicant for documents';
  end if;
  v_problem := document_request_problem(p_message, p_items);
  if v_problem is null then
    v_problem := document_request_already_asked(p_application_id, p_items);
  end if;
  if v_problem is null then
    select string_agg(c.label || ' (' || party_label_text(c.applicant_id) || ')', '; ') into v_items
    from document_request_items_checked(p_application_id, p_items) c;
  end if;
  select * into v_c from compose_document_request(notification_app_no(p_application_id),
    coalesce(nullif(btrim(p_message), ''), '…'), coalesce(v_items, '…'));
  return jsonb_build_object('problem', v_problem, 'in_app_title', v_c.in_app_title, 'in_app_body', v_c.in_app_body,
    'sms_text', v_c.sms_text, 'email_subject', v_c.email_subject, 'email_body', v_c.email_body);
end $$;

-- Opens the request and sends it: in-app now, SMS + email queued for the worker. Returns the request id.
create or replace function public.open_document_request(p_application_id bigint, p_message text, p_items jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_problem text;
  v_id bigint;
  v_notice bigint;
  v_c record;
  v_dest record;
begin
  -- the row lock also serialises two sends on the same file, so the "already asked" check below holds
  perform 1 from loan_applications where id = p_application_id and status <> 'DRAFT' for update;
  if not found then raise exception 'Application not found'; end if;
  if not notice_is_assigned_ao(p_application_id) then
    raise exception 'Only the assigned Account Officer can ask the applicant for documents';
  end if;
  if staff_name(auth.uid()) is null then
    raise exception 'Fill in your staff profile (first and last name) before sending';
  end if;
  if not document_request_stage_ok(p_application_id) then
    raise exception 'Documents can be requested while the file is in Intake, Credit Investigation, Credit Evaluation or Review';
  end if;
  v_problem := coalesce(document_request_problem(p_message, p_items), document_request_already_asked(p_application_id, p_items));
  if v_problem is not null then raise exception '%', v_problem; end if;

  insert into document_requests (application_id, message, opened_by)
  values (p_application_id, btrim(p_message), auth.uid()) returning id into v_id;
  begin
    insert into document_request_items (request_id, applicant_id, requirement_type, label, min_files)
    select v_id, c.applicant_id, c.requirement_type, c.label, c.min_files
    from document_request_items_checked(p_application_id, p_items) c;
  exception when unique_violation then
    raise exception 'The same document is picked twice for the same person';
  end;

  select * into v_c from compose_document_request(notification_app_no(p_application_id), p_message,
                                                  document_request_items_text(v_id));
  if coalesce(notice_link_in(v_c.sms_text), notice_link_in(v_c.email_subject), notice_link_in(v_c.email_body),
              notice_link_in(v_c.in_app_body)) is not null then
    raise exception 'The request text contains something that looks like a link; it was not sent';
  end if;

  insert into applicant_notices (application_id, outcome_id, request_id, outcome, reason, in_app_title, in_app_body,
                                 sms_text, email_subject, email_body, sent_by, sent_role)
  values (p_application_id, null, v_id, 'DOCUMENTS_NEEDED', btrim(p_message), v_c.in_app_title, v_c.in_app_body,
          v_c.sms_text, v_c.email_subject, v_c.email_body, auth.uid(), current_user_role()::text)
  returning id into v_notice;

  select * into v_dest from notice_destinations(p_application_id);
  insert into applicant_notice_deliveries (notice_id, channel, destination, subject, body, status, last_error, finished_at)
  values (v_notice, 'SMS', v_dest.sms, null, v_c.sms_text,
          case when v_dest.sms is null then 'SKIPPED' else 'QUEUED' end,
          case when v_dest.sms is null then 'No valid Philippine mobile number for the principal borrower' end,
          case when v_dest.sms is null then now() end),
         (v_notice, 'EMAIL', v_dest.email, v_c.email_subject, v_c.email_body,
          case when v_dest.email is null then 'SKIPPED' else 'QUEUED' end,
          case when v_dest.email is null then 'No valid email address for the principal borrower' end,
          case when v_dest.email is null then now() end);

  perform send_notification('APPLICANT_DOCUMENTS_NEEDED', v_c.in_app_title, v_c.in_app_body, p_application_id,
    p_assigned => array['APPLICANT'], p_source => 'notices');
  return v_id;
end $$;

-- May I open a document request now? (the assigned AO, a stage that allows it; other requests in progress are fine)
create or replace function public.document_request_can_open(p_application_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(staff_can_access(p_application_id)
    and notice_is_assigned_ao(p_application_id)
    and document_request_stage_ok(p_application_id), false);
$$;

-- The assigned AO closes one request: SENT -> RECEIVED, OPEN -> WITHDRAWN. Same as 20261112, except the applicant's
-- in-app line doesn't say "no documents are needed" / "Under review" while another request is still in progress.
create or replace function public.close_document_request(p_request_id bigint, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_req document_requests;
  v_as text;
  v_no text;
  v_others boolean;
begin
  select * into v_req from document_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if not notice_is_assigned_ao(v_req.application_id) then
    raise exception 'Only the assigned Account Officer can close this request';
  end if;
  if v_req.status = 'CLOSED' then raise exception 'This request is already closed'; end if;
  if p_note is not null and length(btrim(p_note)) > 500 then raise exception 'Keep the note under 500 characters'; end if;

  v_as := case v_req.status when 'SENT' then 'RECEIVED' else 'WITHDRAWN' end;
  update document_requests
  set status = 'CLOSED', closed_by = auth.uid(), closed_at = now(), closed_as = v_as, close_note = nullif(btrim(p_note), '')
  where id = p_request_id;

  v_others := exists (select 1 from document_requests
                      where application_id = v_req.application_id and status <> 'CLOSED' and id <> p_request_id);
  v_no := notification_app_no(v_req.application_id);
  perform send_notification('APPLICANT_REQUEST_CLOSED',
    case when v_as = 'RECEIVED' then 'We received your documents for ' || v_no
         when v_others then 'A document request for ' || v_no || ' was withdrawn'
         else 'No documents are needed for ' || v_no || ' for now' end,
    case when v_as = 'RECEIVED' and v_others then 'Your Account Officer checked them.'
         when v_as = 'RECEIVED' then 'Your Account Officer checked them. Status: Under review.'
         when v_others then 'Your Account Officer no longer needs those documents. Your other requests are still open.'
         else 'Your Account Officer withdrew the document request.' end,
    v_req.application_id, p_assigned => array['APPLICANT'], p_source => 'notices');
  return v_as;
end $$;
revoke execute on function public.close_document_request(bigint, text) from public, anon;
grant execute on function public.close_document_request(bigint, text) to authenticated;

revoke execute on function public.document_request_context(bigint) from public, anon;
grant execute on function public.document_request_context(bigint) to authenticated;
revoke execute on function public.preview_document_request(bigint, text, jsonb) from public, anon;
grant execute on function public.preview_document_request(bigint, text, jsonb) to authenticated;
revoke execute on function public.open_document_request(bigint, text, jsonb) from public, anon;
grant execute on function public.open_document_request(bigint, text, jsonb) to authenticated;
revoke execute on function public.document_request_can_open(bigint) from public, anon;
grant execute on function public.document_request_can_open(bigint) to authenticated;

-- ============================================================
-- 5. Reminders for the request box (replaces the 20261119 version): the next one due per OPEN request
-- ============================================================
create or replace function public.document_reminder_status(p_application_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s document_reminder_settings;
  r document_requests;
  v_next jsonb := '{}'::jsonb;
  v_last smallint;
begin
  if coalesce(current_user_role()::text, 'APPLICANT') = 'APPLICANT' or not staff_can_access(p_application_id) then
    raise exception 'No access to this application';
  end if;
  select * into s from document_reminder_settings;
  if s.id is not null and document_request_stage_ok(p_application_id) then
    for r in select * from document_requests where application_id = p_application_id and status = 'OPEN' order by id loop
      select max(reminder_no) into v_last from document_request_reminders where request_id = r.id;
      if coalesce(v_last, 0) < 2 then
        v_next := v_next || jsonb_build_object(r.id::text, jsonb_build_object('reminder_no', coalesce(v_last, 0) + 1,
          'at', reminder_send_time(r.opened_at + make_interval(days =>
                case when coalesce(v_last, 0) = 0 then s.first_after_days else s.second_after_days end))));
      end if;
    end loop;
  end if;
  return jsonb_build_object(
    'first_after_days', s.first_after_days, 'second_after_days', s.second_after_days,
    'next_by_request', v_next,
    'reminders', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id, 'request_id', x.request_id, 'reminder_no', x.reminder_no, 'status', x.status,
               'note', x.note, 'due_at', x.due_at, 'created_at', x.created_at,
               'deliveries', (select coalesce(jsonb_agg(jsonb_build_object(
                                'channel', d.channel, 'status', d.status, 'to', notice_mask(d.destination),
                                'error', d.last_error) order by d.channel desc), '[]'::jsonb)
                              from document_reminder_deliveries d where d.reminder_id = x.id))
             order by x.request_id, x.reminder_no)
      from document_request_reminders x where x.application_id = p_application_id), '[]'::jsonb));
end $$;
revoke execute on function public.document_reminder_status(bigint) from public, anon;
grant execute on function public.document_reminder_status(bigint) to authenticated;
