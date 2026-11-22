-- CATCH — KYC "Needs clarification" becomes a question-and-answer thread with the applicant (2026-12-03)
-- Run after 20261202_review_complete_report_link.sql (needs 20261007_ao_kyc_verification.sql,
-- 20261029_applicant_notices.sql, 20261112_document_requests.sql and 20261119_document_request_reminders.sql).
-- Re-runnable, no drops of data.
--
-- What it does
--   * The assigned AO marks a KYC section "Needs clarification" with ask_kyc_clarification(app, section, question):
--     one call records the KYC check (result NEEDS_CLARIFICATION, remarks = the question), opens a thread for that
--     section and sends the question to the applicant: in-app at once (APPLICANT_CLARIFICATION) and SMS / email
--     through the notice-service queue (applicant_notices outcome CLARIFICATION). SMS / email say to reply in the
--     CATCH portal only (replies to them are not read); no links. Only while the AO can record KYC checks
--     (ao_can_edit: Intake or Credit Investigation). The question is the only text: 1-300 characters, no links.
--   * One OPEN thread per section; the AO asks section by section.
--   * The applicant replies with text (1-1000 characters) and optionally one file (JPG, PNG or PDF), uploaded first
--     into {user_id}/{application_id}/clarifications/{thread_id}/ of the same bucket: reply_kyc_clarification().
--     The assigned AO gets KYC_CLARIFICATION_REPLY (in-app) for each reply and answers in the same thread with
--     answer_kyc_clarification(); the applicant gets APPLICANT_CLARIFICATION_ANSWER (in-app only).
--   * Marking the section Verified (the existing direct insert into kyc_checks, unchanged) closes the thread: a
--     trigger closes it and tells the applicant in-app (APPLICANT_CLARIFICATION_CLOSED, a neutral line). The applicant
--     then no longer sees it; staff still read it (kyc_clarification_threads()), read only.
--   * A NEEDS_CLARIFICATION check can no longer be inserted directly by a client (it would leave a question that was
--     never sent): only through ask_kyc_clarification(). Verified inserts are untouched.
--   * Attachments are not documents rows: the checklist, the Document check, OCR and the counts don't change.
--   * Nothing here changes loan_applications.status, the stages, TAT, the applicant's status label or tracker,
--     my_loan_applications() or my_application_statuses().
--   * Threads and messages are append-only (messages, files never edited or deleted; a thread only goes OPEN ->
--     CLOSED). Everyone, owner and service role included; rows go only when their application is deleted.
--   * Each new notification kind has an on/off row in notification_switches (all on).
--
-- Changes to the notice module's own objects (20261029 / 20261112 / 20261119):
--   applicant_notices: outcome may be CLARIFICATION; new clarification_id; the outcome / request check is replaced
--   applicant_notification_kinds() replaced (the 20261119 list + the three APPLICANT_CLARIFICATION* kinds)
-- Teammates' tables: kyc_checks gets two triggers (a guard before insert, the close after insert). Its policies,
--   its columns and the AO's Verified insert are unchanged.
--
-- Re-runs of earlier files: 20261029_applicant_notices.sql, 20261112_document_requests.sql or
-- 20261119_document_request_reminders.sql re-run -> run this file again afterwards (they put back their versions of
-- applicant_notification_kinds() and of the applicant_notices checks).

-- ============================================================
-- 0. Dependencies
-- ============================================================
do $$
declare
  v_missing text;
begin
  select string_agg(distinct m, ', ') into v_missing
  from (values ('public.kyc_checks', '20261007_ao_kyc_verification.sql'),
               ('public.applicant_notices', '20261029_applicant_notices.sql'),
               ('public.document_requests', '20261112_document_requests.sql'),
               ('public.document_request_reminders', '20261119_document_request_reminders.sql')) d (t, m)
  where to_regclass(t) is null;
  if v_missing is not null then
    raise exception 'Run these migrations first, then this file again: %', v_missing;
  end if;
end $$;

-- ============================================================
-- 1. Section names (the form step keys the loan folder uses for KYC checks)
-- ============================================================
create or replace function public.kyc_section_label(p_section text)
returns text language sql immutable as $$
  select case
    when p_section ~ '^coBorrower-[0-9]{1,2}$' then 'Co-borrower ' || substring(p_section from 12)
    else case p_section
      when 'loan' then 'Loan Details'
      when 'principalInfo' then 'Principal Borrower'
      when 'principalAddress' then 'Address'
      when 'principalEmployment' then 'Employment'
      when 'spouse' then 'Spouse'
      when 'coBorrowers' then 'Co-borrowers'
      when 'mortgagor' then 'Mortgagor / Attorney-in-Fact'
      when 'obligations' then 'Financial Obligations'
      when 'references' then 'Character References'
      when 'collateral' then 'Collateral & Referral'
      when 'documents' then 'Documents' end end;
$$;

-- ============================================================
-- 2. Tables
-- ============================================================
create table if not exists public.kyc_clarifications (
  id bigint generated always as identity primary key,
  application_id bigint not null references public.loan_applications(id) on delete cascade,
  section text not null check (public.kyc_section_label(section) is not null),
  opened_check_id bigint not null unique references public.kyc_checks(id) on delete cascade,
  status text not null default 'OPEN' check (status in ('OPEN', 'CLOSED')),
  opened_by uuid not null references public.users(id),
  opened_at timestamptz not null default now(),
  closed_check_id bigint unique references public.kyc_checks(id) on delete cascade,
  closed_by uuid references public.users(id),
  closed_at timestamptz,
  check ((status = 'CLOSED') = (closed_at is not null)
         and (closed_at is null) = (closed_by is null)
         and (closed_at is null) = (closed_check_id is null))
);
create unique index if not exists one_open_kyc_clarification
  on public.kyc_clarifications (application_id, section) where status = 'OPEN';
create index if not exists kyc_clarifications_application on public.kyc_clarifications (application_id, id);

-- The question, the applicant's replies and the AO's answers, in order
create table if not exists public.kyc_clarification_messages (
  id bigint generated always as identity primary key,
  clarification_id bigint not null references public.kyc_clarifications(id) on delete cascade,
  application_id bigint not null references public.loan_applications(id) on delete cascade,
  author_id uuid not null references public.users(id),
  author_role text not null check (author_role in ('APPLICANT', 'ACCOUNT_OFFICER')),
  body text not null check (body = btrim(body) and length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists kyc_clarification_messages_thread on public.kyc_clarification_messages (clarification_id, id);

-- A file the applicant attached to a reply (storage path in the application-documents bucket)
create table if not exists public.kyc_clarification_files (
  id bigint generated always as identity primary key,
  message_id bigint not null references public.kyc_clarification_messages(id) on delete cascade,
  application_id bigint not null references public.loan_applications(id) on delete cascade,
  file_name text not null check (length(file_name) between 1 and 255),
  file_path text not null unique,
  uploaded_at timestamptz not null default now()
);
create index if not exists kyc_clarification_files_message on public.kyc_clarification_files (message_id);

-- The question is an applicant notice too (append-only, same SMS / email queue)
alter table public.applicant_notices add column if not exists clarification_id bigint;
do $$ begin
  alter table public.applicant_notices add constraint applicant_notices_clarification_fk
    foreign key (clarification_id) references public.kyc_clarifications(id) on delete restrict;
exception when duplicate_object then null; end $$;
alter table public.applicant_notices drop constraint if exists applicant_notices_outcome_check;
alter table public.applicant_notices add constraint applicant_notices_outcome_check
  check (outcome in ('APPROVED', 'REJECTED', 'DEFERRED', 'DOCUMENTS_NEEDED', 'CLARIFICATION'));
alter table public.applicant_notices drop constraint if exists applicant_notices_outcome_or_request;
alter table public.applicant_notices add constraint applicant_notices_outcome_or_request
  check (case when outcome = 'DOCUMENTS_NEEDED' then request_id is not null and outcome_id is null and clarification_id is null
              when outcome = 'CLARIFICATION' then clarification_id is not null and outcome_id is null and request_id is null
              else request_id is null and clarification_id is null and outcome_id is not null end);
create unique index if not exists one_notice_per_kyc_clarification
  on public.applicant_notices (clarification_id) where clarification_id is not null;

-- Audit trail (audit_log), like the other application tables
drop trigger if exists log_application_change on public.kyc_clarifications;
create trigger log_application_change after insert or update or delete on public.kyc_clarifications
  for each row execute function public.log_application_change('application_id');
drop trigger if exists log_application_change on public.kyc_clarification_messages;
create trigger log_application_change after insert or update or delete on public.kyc_clarification_messages
  for each row execute function public.log_application_change('application_id');
drop trigger if exists log_application_change on public.kyc_clarification_files;
create trigger log_application_change after insert or update or delete on public.kyc_clarification_files
  for each row execute function public.log_application_change('application_id');

-- ============================================================
-- 3. Append-only guards (everyone, owner and service role included)
-- ============================================================
-- A row goes only when its application is deleted (the cascade); a thread may only go OPEN -> CLOSED.
create or replace function public.kyc_clarification_append_only() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'KYC clarifications can''t be edited or deleted';
  end if;
  if tg_op = 'DELETE' then
    if not exists (select 1 from loan_applications la where la.id = old.application_id) then return old; end if;
    raise exception 'KYC clarifications can''t be edited or deleted';
  end if;
  -- UPDATE: only kyc_clarifications, only the close (read as jsonb: the other two tables have no status column)
  if tg_table_name = 'kyc_clarifications' then
    if to_jsonb(old)->>'status' = 'OPEN' and to_jsonb(new)->>'status' = 'CLOSED'
       and (to_jsonb(new) - array['status', 'closed_check_id', 'closed_by', 'closed_at'])
           = (to_jsonb(old) - array['status', 'closed_check_id', 'closed_by', 'closed_at']) then
      return new;
    end if;
  end if;
  raise exception 'KYC clarifications can''t be edited or deleted';
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['kyc_clarifications', 'kyc_clarification_messages', 'kyc_clarification_files'] loop
    execute format('drop trigger if exists append_only on public.%I', t);
    execute format('create trigger append_only before update or delete on public.%I
                    for each row execute function public.kyc_clarification_append_only()', t);
    execute format('drop trigger if exists append_only_truncate on public.%I', t);
    execute format('create trigger append_only_truncate before truncate on public.%I
                    for each statement execute function public.kyc_clarification_append_only()', t);
  end loop;
end $$;

-- ============================================================
-- 4. Texts (no links, no names, never the bank's name)
-- ============================================================
create or replace function public.compose_kyc_clarification(p_app_no text, p_section_label text, p_question text)
returns table (in_app_title text, in_app_body text, sms_text text, email_subject text, email_body text)
language sql immutable as $$
  with t as (select btrim(p_question) || case when right(btrim(p_question), 1) in ('.', '!', '?') then '' else '.' end as q)
  select 'Your application ' || p_app_no || ': a question from your Account Officer',
         'Question on ' || p_section_label || ': ' || q || ' Open this application to reply.',
         'CATCH: Your Account Officer has a question about the ' || p_section_label || ' part of your housing loan application '
           || p_app_no || ': ' || q || ' Please reply in the CATCH portal only. Replies to this SMS are not read.',
         'CATCH: A question about your housing loan application ' || p_app_no,
         concat_ws(E'\n',
           'Good day,', '',
           'Your Account Officer has a question about the ' || p_section_label || ' part of your housing loan application '
             || p_app_no || '.', '',
           'Question: ' || q, '',
           'Please reply in the CATCH portal only. Replies to this email are not read.', '',
           'This is an automated message from CATCH. Please do not reply to this email.')
  from t;
$$;
revoke execute on function public.compose_kyc_clarification(text, text, text) from public, anon, authenticated;

-- ============================================================
-- 5. Notification kinds and switches
-- ============================================================
-- Replaces the 20261119 version: + APPLICANT_CLARIFICATION, APPLICANT_CLARIFICATION_ANSWER, APPLICANT_CLARIFICATION_CLOSED
create or replace function public.applicant_notification_kinds()
returns text[] language sql immutable as $$
  select array['APPLICANT_SUBMITTED', 'APPLICANT_UNDER_REVIEW', 'APPLICANT_INCOMPLETE', 'APPLICANT_OUTCOME',
               'APPLICANT_DOCUMENTS_NEEDED', 'APPLICANT_REQUEST_CLOSED', 'APPLICANT_DOCUMENTS_REMINDER',
               'APPLICANT_CLARIFICATION', 'APPLICANT_CLARIFICATION_ANSWER', 'APPLICANT_CLARIFICATION_CLOSED'];
$$;

insert into public.notification_switches (kind, enabled, note) values
  ('APPLICANT_CLARIFICATION', true, 'The applicant hears about a KYC question in-app (SMS / email go through the notice worker)'),
  ('APPLICANT_CLARIFICATION_ANSWER', true, 'The applicant hears when the Account Officer answers in a KYC question thread'),
  ('APPLICANT_CLARIFICATION_CLOSED', true, 'The applicant hears when a KYC question is closed (the section was verified)'),
  ('KYC_CLARIFICATION_REPLY', true, 'The assigned Account Officer hears about each applicant reply to a KYC question')
on conflict (kind) do nothing;

-- ============================================================
-- 6. kyc_checks: the guard and the close (teammates' table; its policies and the Verified insert are unchanged)
-- ============================================================
-- A client (the browser) can't insert Needs clarification directly: ask_kyc_clarification() does it (as the owner),
-- so every such check has its thread and its notice. Table owner / service role inserts are not affected.
create or replace function public.kyc_checks_clarification_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.result::text = 'NEEDS_CLARIFICATION' and current_user in ('anon', 'authenticated') then
    raise exception 'Use "Needs clarification" in the loan folder: it sends your question to the applicant';
  end if;
  return new;
end $$;

drop trigger if exists kyc_checks_clarification_guard on public.kyc_checks;
create trigger kyc_checks_clarification_guard before insert on public.kyc_checks
  for each row execute function public.kyc_checks_clarification_guard();

-- Verified closes the section's open thread and tells the applicant (in-app, a neutral line)
create or replace function public.close_kyc_clarification_on_verified() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_thread kyc_clarifications;
begin
  if new.result::text <> 'VERIFIED' then return null; end if;
  update kyc_clarifications
  set status = 'CLOSED', closed_check_id = new.id, closed_by = new.checked_by, closed_at = now()
  where application_id = new.application_id and section = new.section and status = 'OPEN'
  returning * into v_thread;
  if v_thread.id is null then return null; end if;
  begin
    perform send_notification('APPLICANT_CLARIFICATION_CLOSED',
      'Question closed on ' || notification_app_no(new.application_id),
      'Your Account Officer has closed the question on ' || kyc_section_label(new.section) || '. No further action is needed.',
      new.application_id, p_assigned => array['APPLICANT'], p_source => 'notices',
      p_link => '/applicationFormPage?id=' || new.application_id);
  exception when others then
    raise warning 'close_kyc_clarification_on_verified: notification failed: %', sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists close_kyc_clarification_on_verified on public.kyc_checks;
create trigger close_kyc_clarification_on_verified after insert on public.kyc_checks
  for each row execute function public.close_kyc_clarification_on_verified();

revoke execute on function public.close_kyc_clarification_on_verified() from public, anon, authenticated;

-- ============================================================
-- 7. Asking, replying, answering
-- ============================================================
-- The assigned AO asks one section's question. Returns the thread id.
create or replace function public.ask_kyc_clarification(p_application_id bigint, p_section text, p_question text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_question text := nullif(btrim(p_question), '');
  v_label text := kyc_section_label(p_section);
  v_check bigint;
  v_id bigint;
  v_notice bigint;
  v_c record;
  v_dest record;
begin
  perform 1 from loan_applications where id = p_application_id and status <> 'DRAFT' for update;
  if not found then raise exception 'Application not found'; end if;
  if not coalesce(ao_can_edit(p_application_id), false) then
    raise exception 'Only the assigned Account Officer can ask, while the file is in Intake or Credit Investigation';
  end if;
  if staff_name(auth.uid()) is null then
    raise exception 'Fill in your staff profile (first and last name) before sending';
  end if;
  if v_label is null then raise exception 'Unknown section'; end if;
  if v_question is null then raise exception 'Write your question for the applicant.'; end if;
  if length(v_question) > 300 then
    raise exception 'The question is % characters; the limit is 300.', length(v_question);
  end if;
  if notice_link_in(v_question) is not null then
    raise exception 'SMS and email can''t contain links. This part looks like a link: "%"', left(notice_link_in(v_question), 60);
  end if;
  if exists (select 1 from kyc_clarifications where application_id = p_application_id and section = p_section and status = 'OPEN') then
    raise exception 'A question on % is still open. Answer it here, or mark the section Verified to close it.', v_label;
  end if;

  insert into kyc_checks (application_id, section, result, remarks, checked_by)
  values (p_application_id, p_section, 'NEEDS_CLARIFICATION', v_question, auth.uid())
  returning id into v_check;
  insert into kyc_clarifications (application_id, section, opened_check_id, opened_by)
  values (p_application_id, p_section, v_check, auth.uid()) returning id into v_id;
  insert into kyc_clarification_messages (clarification_id, application_id, author_id, author_role, body)
  values (v_id, p_application_id, auth.uid(), 'ACCOUNT_OFFICER', v_question);

  select * into v_c from compose_kyc_clarification(notification_app_no(p_application_id), v_label, v_question);
  if coalesce(notice_link_in(v_c.sms_text), notice_link_in(v_c.email_subject), notice_link_in(v_c.email_body),
              notice_link_in(v_c.in_app_body)) is not null then
    raise exception 'The question contains something that looks like a link; it was not sent';
  end if;

  insert into applicant_notices (application_id, outcome_id, clarification_id, outcome, reason, in_app_title, in_app_body,
                                 sms_text, email_subject, email_body, sent_by, sent_role)
  values (p_application_id, null, v_id, 'CLARIFICATION', v_question, v_c.in_app_title, v_c.in_app_body,
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

  perform send_notification('APPLICANT_CLARIFICATION', v_c.in_app_title, v_c.in_app_body, p_application_id,
    p_assigned => array['APPLICANT'], p_source => 'notices',
    p_link => '/applicationFormPage?id=' || p_application_id || '&clarify=' || p_section);
  return v_id;
end $$;

-- The applicant's file path for a thread: {user_id}/{application_id}/clarifications/{thread_id}/...
create or replace function public.kyc_clarification_open_for_me(p_application_id bigint, p_thread_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from kyc_clarifications c join loan_applications la on la.id = c.application_id
                 where c.id = p_thread_id and c.application_id = p_application_id and c.status = 'OPEN'
                   and la.user_id = auth.uid());
$$;

-- A file in the thread folder that no reply uses yet (the page removes it when the reply fails)
create or replace function public.kyc_clarification_file_unused(p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from kyc_clarification_files where file_path = p_path);
$$;

-- The applicant replies (text, optionally one file already uploaded to the thread's folder). Returns the message id.
create or replace function public.reply_kyc_clarification(p_clarification_id bigint, p_body text,
                                                         p_file_name text default null, p_file_path text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_thread kyc_clarifications;
  v_owner uuid;
  v_body text := nullif(btrim(p_body), '');
  v_ext text := lower(substring(coalesce(p_file_name, '') from '\.([A-Za-z0-9]+)$'));
  v_msg bigint;
begin
  select * into v_thread from kyc_clarifications where id = p_clarification_id for update;
  if not found then raise exception 'Question not found'; end if;
  select user_id into v_owner from loan_applications where id = v_thread.application_id;
  if v_owner is distinct from auth.uid() then raise exception 'Question not found'; end if;
  if v_thread.status <> 'OPEN' then raise exception 'This question is closed. No further action is needed.'; end if;
  if v_body is null then raise exception 'Write your reply.'; end if;
  if length(v_body) > 1000 then raise exception 'Keep your reply under 1000 characters.'; end if;
  if p_file_path is not null then
    if p_file_path not like v_owner || '/' || v_thread.application_id || '/clarifications/' || v_thread.id || '/%' then
      raise exception 'File is not in this question''s folder';
    end if;
    if v_ext is null or v_ext not in ('jpg', 'jpeg', 'png', 'pdf') then
      raise exception 'Attach a JPG, PNG or PDF file';
    end if;
    if not exists (select 1 from storage.objects where bucket_id = 'application-documents' and name = p_file_path) then
      raise exception 'Upload the file first';
    end if;
  end if;

  insert into kyc_clarification_messages (clarification_id, application_id, author_id, author_role, body)
  values (v_thread.id, v_thread.application_id, auth.uid(), 'APPLICANT', v_body) returning id into v_msg;
  if p_file_path is not null then
    insert into kyc_clarification_files (message_id, application_id, file_name, file_path)
    values (v_msg, v_thread.application_id, left(btrim(p_file_name), 255), p_file_path);
  end if;

  perform send_notification('KYC_CLARIFICATION_REPLY',
    'The applicant replied to your question on ' || kyc_section_label(v_thread.section) || ' ('
      || notification_app_no(v_thread.application_id) || ')',
    left(v_body, 300), v_thread.application_id, p_assigned => array['ACCOUNT_OFFICER'],
    p_link => '/loanFolderPage?id=' || v_thread.application_id || '#kyc-' || v_thread.section);
  return v_msg;
end $$;

-- The assigned AO answers in an open thread (in-app only). Returns the message id.
create or replace function public.answer_kyc_clarification(p_clarification_id bigint, p_body text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_thread kyc_clarifications;
  v_body text := nullif(btrim(p_body), '');
  v_msg bigint;
begin
  select * into v_thread from kyc_clarifications where id = p_clarification_id for update;
  if not found then raise exception 'Question not found'; end if;
  if not notice_is_assigned_ao(v_thread.application_id) then
    raise exception 'Only the assigned Account Officer can answer';
  end if;
  if v_thread.status <> 'OPEN' then raise exception 'This question is closed'; end if;
  if v_body is null then raise exception 'Write your answer.'; end if;
  if length(v_body) > 1000 then raise exception 'Keep your answer under 1000 characters.'; end if;

  insert into kyc_clarification_messages (clarification_id, application_id, author_id, author_role, body)
  values (v_thread.id, v_thread.application_id, auth.uid(), 'ACCOUNT_OFFICER', v_body) returning id into v_msg;
  perform send_notification('APPLICANT_CLARIFICATION_ANSWER',
    'Your Account Officer answered your question thread on ' || notification_app_no(v_thread.application_id),
    'About ' || kyc_section_label(v_thread.section) || '. Open this application to read it and reply.',
    v_thread.application_id, p_assigned => array['APPLICANT'], p_source => 'notices',
    p_link => '/applicationFormPage?id=' || v_thread.application_id || '&clarify=' || v_thread.section);
  return v_msg;
end $$;

-- ============================================================
-- 8. Reading
-- ============================================================
-- One thread with its messages and files. p_staff: names of the staff who wrote and closed (the applicant sees roles only)
create or replace function public.kyc_clarification_json(p_id bigint, p_staff boolean)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', c.id, 'application_id', c.application_id, 'section', c.section, 'section_label', kyc_section_label(c.section),
    'status', c.status, 'opened_at', c.opened_at, 'closed_at', c.closed_at,
    'opened_by', case when p_staff then staff_name(c.opened_by) end,
    'closed_by', case when p_staff then staff_name(c.closed_by) end,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id, 'from', m.author_role, 'body', m.body, 'created_at', m.created_at,
               'by', case when p_staff and m.author_role = 'ACCOUNT_OFFICER' then staff_name(m.author_id) end,
               'files', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'file_name', f.file_name, 'file_path', f.file_path)
                                                   order by f.id)
                                  from kyc_clarification_files f where f.message_id = m.id), '[]'::jsonb))
             order by m.id)
      from kyc_clarification_messages m where m.clarification_id = c.id), '[]'::jsonb))
  from kyc_clarifications c where c.id = p_id;
$$;
revoke execute on function public.kyc_clarification_json(bigint, boolean) from public, anon, authenticated;

-- The applicant: their OPEN threads only (a closed one disappears), oldest first
create or replace function public.my_kyc_clarifications()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(kyc_clarification_json(c.id, false)
                            || jsonb_build_object('application_no', la.application_no, 'user_id', la.user_id)
                            order by c.id), '[]'::jsonb)
  from kyc_clarifications c join loan_applications la on la.id = c.application_id
  where la.user_id = auth.uid() and c.status = 'OPEN';
$$;

-- Staff with access to the file: every thread, open and closed (history), oldest first
create or replace function public.kyc_clarification_threads(p_application_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(staff_can_access(p_application_id), false) then raise exception 'Application not found'; end if;
  return (select coalesce(jsonb_agg(kyc_clarification_json(c.id, true) order by c.id), '[]'::jsonb)
          from kyc_clarifications c where c.application_id = p_application_id);
end $$;

-- ============================================================
-- 9. Access: staff read the file's threads; the applicant reads through my_kyc_clarifications(); writes only above
-- ============================================================
alter table public.kyc_clarifications enable row level security;
alter table public.kyc_clarification_messages enable row level security;
alter table public.kyc_clarification_files enable row level security;
revoke insert, update, delete, truncate on public.kyc_clarifications, public.kyc_clarification_messages,
  public.kyc_clarification_files from anon, authenticated;

drop policy if exists "staff read kyc clarifications" on public.kyc_clarifications;
create policy "staff read kyc clarifications" on public.kyc_clarifications
  for select to authenticated using (public.staff_can_access(application_id));
drop policy if exists "staff read kyc clarification messages" on public.kyc_clarification_messages;
create policy "staff read kyc clarification messages" on public.kyc_clarification_messages
  for select to authenticated using (public.staff_can_access(application_id));
drop policy if exists "staff read kyc clarification files" on public.kyc_clarification_files;
create policy "staff read kyc clarification files" on public.kyc_clarification_files
  for select to authenticated using (public.staff_can_access(application_id));

-- Storage: the applicant uploads / removes (unused files only) in an OPEN thread's folder
-- {user_id}/{application_id}/clarifications/{thread_id}/ (bucket limits: JPG, PNG or PDF, 10 MB).
-- Reading is covered by the existing "applicant reads own files" / "staff reads files" policies.
drop policy if exists "applicant uploads clarification files" on storage.objects;
create policy "applicant uploads clarification files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'application-documents'
              and (storage.foldername(name))[1] = auth.uid()::text
              and (storage.foldername(name))[3] = 'clarifications'
              and public.kyc_clarification_open_for_me(public.document_request_path_id((storage.foldername(name))[2]),
                                                       public.document_request_path_id((storage.foldername(name))[4])));

drop policy if exists "applicant removes unused clarification files" on storage.objects;
create policy "applicant removes unused clarification files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'application-documents'
         and (storage.foldername(name))[1] = auth.uid()::text
         and (storage.foldername(name))[3] = 'clarifications'
         and public.kyc_clarification_open_for_me(public.document_request_path_id((storage.foldername(name))[2]),
                                                  public.document_request_path_id((storage.foldername(name))[4]))
         and public.kyc_clarification_file_unused(name));

revoke execute on function public.ask_kyc_clarification(bigint, text, text) from public, anon;
grant execute on function public.ask_kyc_clarification(bigint, text, text) to authenticated;
revoke execute on function public.reply_kyc_clarification(bigint, text, text, text) from public, anon;
grant execute on function public.reply_kyc_clarification(bigint, text, text, text) to authenticated;
revoke execute on function public.answer_kyc_clarification(bigint, text) from public, anon;
grant execute on function public.answer_kyc_clarification(bigint, text) to authenticated;
revoke execute on function public.my_kyc_clarifications() from public, anon;
grant execute on function public.my_kyc_clarifications() to authenticated;
revoke execute on function public.kyc_clarification_threads(bigint) from public, anon;
grant execute on function public.kyc_clarification_threads(bigint) to authenticated;
revoke execute on function public.kyc_clarification_open_for_me(bigint, bigint) from public, anon;
grant execute on function public.kyc_clarification_open_for_me(bigint, bigint) to authenticated;
revoke execute on function public.kyc_clarification_file_unused(text) from public, anon;
grant execute on function public.kyc_clarification_file_unused(text) to authenticated;
