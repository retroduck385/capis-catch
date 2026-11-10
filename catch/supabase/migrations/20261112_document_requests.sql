-- CATCH — "What we need": the assigned AO asks the applicant for specific documents after submission (deferral loop)
-- Run after 20261110_approver_decision.sql. Independent of the 20261111_* files (any order with them).
-- Re-runnable, no drops of data.
--
-- What it does
--   * When a file is deferred at the AO, CO or reviewer step (a KYC section marked Needs clarification, a missing
--     document, the CO's Credit Result Deferred, a reviewer return), the assigned AO sends the applicant a request:
--     a short message (1-300 characters, no links) plus the specific documents needed, per borrower.
--     open_document_request(app, message, items). Only while the file is in Intake, Credit Investigation, Credit
--     Evaluation or Review; never in Approval or Decided (approvers only approve or disapprove). One request at a time.
--   * The message is an applicant notice (outcome DOCUMENTS_NEEDED, request_id set): append-only like every
--     notice, same link check, and its SMS / email go through applicant_notice_deliveries (the notice-service worker
--     needs no change). In-app at once: APPLICANT_DOCUMENTS_NEEDED. SMS / email say what is needed and which
--     documents and end "Your Account Officer will contact you." (no portal, no links); only the in-app notice and
--     the "Documents needed" card say how to upload.
--   * The applicant uploads only the requested documents, into {user_id}/{application_id}/requests/{request_id}/ in
--     the same bucket (same file types and 10 MB limit as the form: the bucket enforces them, and
--     add_requested_document() also checks the extension). add_requested_document() adds the documents row, so the
--     existing triggers OCR it and queue the AI check. Nothing else becomes editable (documents RLS is unchanged).
--   * "Send to my Account Officer" (send_requested_documents) needs every item to have its files. The assigned AO gets
--     DOCUMENTS_SENT (in-app). The AO checks the files and closes the request (close_document_request): the applicant
--     gets an in-app "We received your documents" (APPLICANT_REQUEST_CLOSED; no SMS / email). Closing an unanswered
--     request withdraws it (in-app: "no longer needed").
--   * What the applicant sees: "Documents needed" while OPEN, "Documents sent" while SENT, then back to what the
--     status gives (normally "Under review"). An outcome the AO already sent wins. loan_applications.status and the
--     stages never change here (one status path). While a request is OPEN or SENT, the automatic "Under review"
--     notice is not sent (it would contradict "Documents needed").
--   * Reviewer returns: the assigned AO now also gets REVIEW_RETURNED (in-app), so they can decide whether the
--     applicant needs to be asked for something. The CO's STAGE_RETURNED is unchanged.
--   * Left dormant and documented (nothing sets them): the DEFERRED outcome notice and FOR_CLARIFICATION
--     ("Incomplete submission"). Deferral is told to the applicant with this request.
--
-- Changes to this module's own objects (20261024_notifications.sql / 20261029_applicant_notices.sql):
--   applicant_notices: outcome may be DOCUMENTS_NEEDED; outcome_id may be null; new request_id
--   applicant_notification_kinds(), applicant_visible_status(), notify_on_applicant_status() replaced
-- Teammates' tables: a new trigger on review_decisions (REVIEW_RETURNED); nothing else in their files changes.
--
-- Re-runs of earlier files: 20261024_notifications.sql or 20261029_applicant_notices.sql re-run -> run this file
-- again afterwards (they put back their versions of the functions above).

-- ============================================================
-- 0. Dependencies
-- ============================================================
do $$
declare
  v_missing text;
begin
  select string_agg(distinct m, ', ') into v_missing
  from (values ('public.applicant_notices', '20261029_applicant_notices.sql'),
               ('public.review_decisions', '20261108_reviewer_signoff.sql'),
               ('public.approval_decisions', '20261110_approver_decision.sql'),
               ('public.kyc_checks', '20261007_ao_kyc_verification.sql'),
               ('public.financial_packages', '20261020_financial_package.sql')) d (t, m)
  where to_regclass(t) is null;
  if v_missing is not null then
    raise exception 'Run these migrations first, then this file again: %', v_missing;
  end if;
end $$;

-- ============================================================
-- 1. Tables
-- ============================================================
create table if not exists public.document_requests (
  id bigint generated always as identity primary key,
  application_id bigint not null references public.loan_applications(id) on delete cascade,
  message text not null check (message = btrim(message) and length(message) between 1 and 300),
  status text not null default 'OPEN' check (status in ('OPEN', 'SENT', 'CLOSED')),
  opened_by uuid not null references public.users(id),
  opened_at timestamptz not null default now(),
  sent_at timestamptz,                         -- the applicant pressed "Send to my Account Officer"
  closed_by uuid references public.users(id),
  closed_at timestamptz,
  closed_as text check (closed_as in ('RECEIVED', 'WITHDRAWN')),
  close_note text check (close_note is null or (close_note = btrim(close_note) and length(close_note) between 1 and 500)),
  check ((status = 'CLOSED') = (closed_at is not null) and (closed_at is null) = (closed_as is null)
         and (closed_at is null) = (closed_by is null)),
  check ((sent_at is not null) = (status = 'SENT' or coalesce(closed_as, '') = 'RECEIVED'))
);
create unique index if not exists one_open_document_request
  on public.document_requests (application_id) where status <> 'CLOSED';
create index if not exists document_requests_application on public.document_requests (application_id, id);

-- The documents asked for: one borrower each; a checklist type, or "Other" with a label
create table if not exists public.document_request_items (
  id bigint generated always as identity primary key,
  request_id bigint not null references public.document_requests(id) on delete cascade,
  applicant_id bigint not null references public.applicants(id) on delete cascade,
  requirement_type requirement_type,           -- null = Other
  label text not null check (label = btrim(label) and length(label) between 1 and 80),
  min_files smallint not null default 1 check (min_files between 1 and 5),
  unique nulls not distinct (request_id, applicant_id, requirement_type, label)
);
create index if not exists document_request_items_request on public.document_request_items (request_id);

-- Which uploaded documents answer which item
create table if not exists public.document_request_uploads (
  item_id bigint not null references public.document_request_items(id) on delete cascade,
  document_id bigint not null unique references public.documents(id) on delete cascade,
  primary key (item_id, document_id)
);

-- The request message is an applicant notice (append-only, same delivery queue)
alter table public.applicant_notices add column if not exists request_id bigint;
do $$ begin
  alter table public.applicant_notices add constraint applicant_notices_request_fk
    foreign key (request_id) references public.document_requests(id) on delete restrict;
exception when duplicate_object then null; end $$;
alter table public.applicant_notices alter column outcome_id drop not null;
alter table public.applicant_notices drop constraint if exists applicant_notices_outcome_check;
alter table public.applicant_notices add constraint applicant_notices_outcome_check
  check (outcome in ('APPROVED', 'REJECTED', 'DEFERRED', 'DOCUMENTS_NEEDED'));
do $$ begin
  alter table public.applicant_notices add constraint applicant_notices_outcome_or_request
    check (case when outcome = 'DOCUMENTS_NEEDED' then request_id is not null and outcome_id is null
                else request_id is null and outcome_id is not null end);
exception when duplicate_object then null; end $$;
create unique index if not exists one_notice_per_document_request
  on public.applicant_notices (request_id) where request_id is not null;

-- Audit trail (audit_log), like the other application tables
drop trigger if exists log_application_change on public.document_requests;
create trigger log_application_change after insert or update or delete on public.document_requests
  for each row execute function public.log_application_change('application_id');
drop trigger if exists log_application_change on public.document_request_items;
create trigger log_application_change after insert or update or delete on public.document_request_items
  for each row execute function public.log_application_change('applicant_id');

-- ============================================================
-- 2. Helpers
-- ============================================================
-- Where the file is, for the request rules
create or replace function public.document_request_stage_ok(p_application_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select stage::text in ('INTAKE', 'CREDIT_INVESTIGATION', 'CREDIT_EVALUATION', 'REVIEW')
                   from application_stages where application_id = p_application_id and left_at is null), false);
$$;

-- The caller's own request, still OPEN, for this application (used by the storage policies)
create or replace function public.document_request_open_for_me(p_application_id bigint, p_request_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from document_requests r join loan_applications la on la.id = r.application_id
                 where r.id = p_request_id and r.application_id = p_application_id and r.status = 'OPEN'
                   and la.user_id = auth.uid());
$$;

-- Safe text -> bigint for storage paths (a malformed path is simply refused)
create or replace function public.document_request_path_id(p_text text)
returns bigint language sql immutable as $$
  select case when p_text ~ '^[0-9]{1,18}$' then p_text::bigint end;
$$;

create or replace function public.party_label_text(p_applicant_id bigint)
returns text language sql stable security definer set search_path = public as $$
  select case a.role::text when 'PRINCIPAL' then 'principal borrower' when 'SPOUSE' then 'spouse'
              when 'CO_BORROWER' then 'co-borrower ' || a.party_no else lower(replace(a.role::text, '_', ' ')) end
  from applicants a where a.id = p_applicant_id;
$$;

-- "COE / ITR (principal borrower); Payslips (spouse)"
create or replace function public.document_request_items_text(p_request_id bigint)
returns text language sql stable security definer set search_path = public as $$
  select string_agg(i.label || ' (' || party_label_text(i.applicant_id) || ')', '; ' order by i.id)
  from document_request_items i where i.request_id = p_request_id;
$$;

-- The exact texts for every channel. No links, no names, never the bank's name. SMS and email never point to the
-- portal (the bank: no links, "more on open portal"): what we need, which documents, "Your Account Officer will contact
-- you." The upload instructions are only in the app (this in-app notice and the "Documents needed" card).
create or replace function public.compose_document_request(p_app_no text, p_message text, p_items text)
returns table (in_app_title text, in_app_body text, sms_text text, email_subject text, email_body text)
language sql immutable as $$
  with t as (select btrim(p_message) || case when right(btrim(p_message), 1) in ('.', '!', '?') then '' else '.' end as msg)
  select 'Your application ' || p_app_no || ': documents needed',
         'What we need: ' || msg || ' Please upload: ' || p_items || '. Open this application to upload them.',
         'CATCH: Update on your housing loan application ' || p_app_no || '. What we need: ' || msg
           || ' Documents: ' || p_items || '. Your Account Officer will contact you.',
         'CATCH: Documents needed for your housing loan application ' || p_app_no,
         concat_ws(E'\n',
           'Good day,', '',
           'This is an update on your housing loan application ' || p_app_no || '.', '',
           'What we need: ' || msg, '',
           'Documents: ' || p_items || '.', '',
           'Your Account Officer will contact you.', '',
           'This is an automated message from CATCH. Please do not reply to this email.')
  from t;
$$;

-- Checks a message and the items (null = fine), shared by preview and open
create or replace function public.document_request_problem(p_message text, p_items jsonb)
returns text language plpgsql immutable as $$
declare
  v_message text := nullif(btrim(p_message), '');
  v_link text;
  i jsonb;
begin
  if v_message is null then return 'Write what you need from the applicant.'; end if;
  if length(v_message) > 300 then
    return 'The message is ' || length(v_message) || ' characters; the limit is 300.';
  end if;
  v_link := notice_link_in(v_message);
  if v_link is not null then
    return 'SMS and email can''t contain links. This part looks like a link: "' || left(v_link, 60) || '"';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return 'Pick at least one document.';
  end if;
  if jsonb_array_length(p_items) > 20 then return 'Ask for at most 20 documents at a time.'; end if;
  for i in select * from jsonb_array_elements(p_items) loop
    if nullif(i->>'requirement_type', '') is null then
      if nullif(btrim(i->>'label'), '') is null then return 'Name each "Other" document.'; end if;
      if length(btrim(i->>'label')) > 80 then return 'Keep each document name under 80 characters.'; end if;
      v_link := notice_link_in(i->>'label');
      if v_link is not null then
        return 'Document names can''t contain links. This part looks like a link: "' || left(v_link, 60) || '"';
      end if;
    end if;
  end loop;
  return null;
end $$;

revoke execute on function public.document_request_stage_ok(bigint) from public, anon, authenticated;
revoke execute on function public.document_request_open_for_me(bigint, bigint) from public, anon;
grant execute on function public.document_request_open_for_me(bigint, bigint) to authenticated;
revoke execute on function public.party_label_text(bigint) from public, anon, authenticated;
revoke execute on function public.document_request_items_text(bigint) from public, anon, authenticated;
revoke execute on function public.compose_document_request(text, text, text) from public, anon, authenticated;
revoke execute on function public.document_request_problem(text, jsonb) from public, anon, authenticated;

-- ============================================================
-- 3. What the applicant sees (replaces the 20261029 versions)
-- ============================================================
create or replace function public.applicant_notification_kinds()
returns text[] language sql immutable as $$
  select array['APPLICANT_SUBMITTED', 'APPLICANT_UNDER_REVIEW', 'APPLICANT_INCOMPLETE', 'APPLICANT_OUTCOME',
               'APPLICANT_DOCUMENTS_NEEDED', 'APPLICANT_REQUEST_CLOSED'];
$$;

-- An outcome only once its notice was sent; else an open request ("Documents needed" / "Documents sent"); else the bucket
create or replace function public.applicant_visible_status(p_application_id bigint)
returns text language sql stable security definer set search_path = public as $$
  select case
    when applicant_status_bucket(la.status::text) in ('APPROVED', 'REJECTED', 'DEFERRED')
         and exists (select 1 from applicant_notices n where n.outcome_id = current_applicant_outcome(la.id))
      then applicant_status_bucket(la.status::text)
    when r.status = 'OPEN' then 'DOCUMENTS_NEEDED'
    when r.status = 'SENT' then 'DOCUMENTS_SENT'
    when applicant_status_bucket(la.status::text) in ('APPROVED', 'REJECTED', 'DEFERRED') then 'UNDER_REVIEW'
    else applicant_status_bucket(la.status::text) end
  from loan_applications la
  left join document_requests r on r.application_id = la.id and r.status <> 'CLOSED'
  where la.id = p_application_id;
$$;
revoke execute on function public.applicant_visible_status(bigint) from public, anon, authenticated;

-- Automatic applicant notices: Submitted, Under review, Incomplete submission (unchanged), except that "Under review"
-- is not sent while a document request is OPEN or SENT
create or replace function public.notify_on_applicant_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old text := applicant_status_bucket(old.status::text);
  v_new text := applicant_status_bucket(new.status::text);
  v_no text := coalesce(new.application_no, 'your application');
  v_kind text;
  v_title text;
  v_body text;
begin
  begin
    if new.status::text = 'FOR_CLARIFICATION' and old.status::text <> 'FOR_CLARIFICATION' then
      v_kind := 'APPLICANT_INCOMPLETE';
    elsif v_new is distinct from v_old then
      v_kind := case v_new when 'SUBMITTED' then 'APPLICANT_SUBMITTED' when 'UNDER_REVIEW' then 'APPLICANT_UNDER_REVIEW' end;
    end if;
    if v_kind = 'APPLICANT_UNDER_REVIEW'
       and exists (select 1 from document_requests where application_id = new.id and status <> 'CLOSED') then
      v_kind := null;
    end if;

    v_title := case v_kind
      when 'APPLICANT_SUBMITTED' then 'We received your application ' || v_no
      when 'APPLICANT_UNDER_REVIEW' then 'Your application ' || v_no || ' is under review'
      when 'APPLICANT_INCOMPLETE' then 'Your application ' || v_no || ' needs more information' end;
    v_body := case v_kind
      when 'APPLICANT_SUBMITTED' then 'Status: Submitted. We will let you know when it moves forward.'
      when 'APPLICANT_UNDER_REVIEW' then 'Status: Under review.'
      else 'Status: Incomplete submission. Your Account Officer will contact you.' end;

    if v_kind is not null then
      perform send_notification(v_kind, v_title, v_body, new.id, p_assigned => array['APPLICANT'],
        p_skip_actor => false);
    end if;
  exception when others then
    raise warning 'notify_applicant_status failed: %', sqlerrm;
  end;
  return null;
end $$;

-- ============================================================
-- 4. The AO's panel: suggestions, context, preview, open, close
-- ============================================================
-- Text suggestions from the deferral sources (internal staff text: the AO rewrites it) and the document checklist
create or replace function public.document_request_suggestions(p_application_id bigint)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'texts', coalesce((
      select jsonb_agg(jsonb_build_object('source', s.source, 'text', s.text) order by s.ord, s.at)
      from (
        select 1 as ord, k.checked_at as at, 'KYC check marked Needs clarification: ' || k.section as source, btrim(k.remarks) as text
        from (select distinct on (section) section, result, remarks, checked_at from kyc_checks
              where application_id = p_application_id order by section, checked_at desc, id desc) k
        where k.result::text = 'NEEDS_CLARIFICATION' and nullif(btrim(k.remarks), '') is not null
        union all
        select 2, null, 'Credit Officer justification (Deferred)', btrim(fp.justification)
        from financial_packages fp
        where fp.application_id = p_application_id and fp.credit_result::text = 'DEFERRED'
          and nullif(btrim(fp.justification), '') is not null
        union all
        select 3, null, 'Credit Officer deferrals (Financial Package)', btrim(fp.deferrals)
        from financial_packages fp
        where fp.application_id = p_application_id and fp.credit_result::text = 'DEFERRED'
          and nullif(btrim(fp.deferrals), '') is not null
        union all
        select 4, d.decided_at, 'Reviewer return (' || lower(d.severity::text) || ' revision), not yet answered', btrim(d.remarks)
        from review_decisions d
        where d.application_id = p_application_id and d.action::text = 'RETURNED' and d.response is null
      ) s), '[]'::jsonb),
    -- Every borrower's checklist with files uploaded vs needed; missing ones are pre-ticked on the panel
    'checklist', coalesce((
      select jsonb_agg(jsonb_build_object(
               'applicant_id', a.id, 'party', party_label_text(a.id), 'requirement_type', ar.requirement_type,
               'label', requirement_label(ar.requirement_type),
               'uploaded', (select count(*) from documents d where d.requirement_id = ar.id),
               'needed', required_document_min(ar.requirement_type))
             order by a.role, a.party_no, ar.requirement_type)
      from application_requirements ar join applicants a on a.id = ar.applicant_id
      where a.application_id = p_application_id), '[]'::jsonb),
    'parties', coalesce((
      select jsonb_agg(jsonb_build_object('applicant_id', a.id, 'party', party_label_text(a.id)) order by a.role, a.party_no)
      from applicants a where a.application_id = p_application_id), '[]'::jsonb));
$$;
revoke execute on function public.document_request_suggestions(bigint) from public, anon, authenticated;

-- One request with its items, uploads and (for staff) delivery status
create or replace function public.document_request_json(p_request_id bigint, p_staff boolean)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.id, 'application_id', r.application_id, 'message', r.message, 'status', r.status,
    'opened_at', r.opened_at, 'opened_by', case when p_staff then staff_name(r.opened_by) end,
    'sent_at', r.sent_at, 'closed_at', r.closed_at, 'closed_as', r.closed_as,
    'closed_by', case when p_staff then staff_name(r.closed_by) end, 'close_note', case when p_staff then r.close_note end,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'applicant_id', i.applicant_id, 'party', party_label_text(i.applicant_id),
               'requirement_type', i.requirement_type, 'label', i.label, 'min_files', i.min_files,
               'uploads', coalesce((
                 select jsonb_agg(jsonb_build_object('document_id', d.id, 'file_name', d.file_name,
                          'original_file_name', d.original_file_name, 'file_path', d.file_path, 'uploaded_at', d.uploaded_at)
                        order by d.id)
                 from document_request_uploads u join documents d on d.id = u.document_id where u.item_id = i.id), '[]'::jsonb))
             order by i.id)
      from document_request_items i where i.request_id = r.id), '[]'::jsonb),
    'deliveries', case when p_staff then coalesce((
      select jsonb_agg(jsonb_build_object('channel', d.channel, 'to', notice_mask(d.destination), 'status', d.status,
               'attempts', d.attempts, 'error', d.last_error, 'finished_at', d.finished_at) order by d.channel)
      from applicant_notices n join applicant_notice_deliveries d on d.notice_id = n.id
      where n.request_id = r.id), '[]'::jsonb) end)
  from document_requests r where r.id = p_request_id;
$$;
revoke execute on function public.document_request_json(bigint, boolean) from public, anon, authenticated;

create or replace function public.document_request_context(p_application_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_current bigint;
  v_why text;
  v_dest record;
begin
  if not staff_can_access(p_application_id) then
    raise exception 'You don''t have access to this application';
  end if;
  select id into v_current from document_requests where application_id = p_application_id and status <> 'CLOSED';
  select * into v_dest from notice_destinations(p_application_id);
  v_why := case
    when not notice_is_assigned_ao(p_application_id) then 'Only the assigned Account Officer can ask the applicant for documents.'
    when v_current is not null then null
    when not document_request_stage_ok(p_application_id)
      then 'Documents can be requested while the file is in Intake, Credit Investigation, Credit Evaluation or Review.' end;
  return jsonb_build_object(
    'application_no', notification_app_no(p_application_id),
    'is_assigned_ao', notice_is_assigned_ao(p_application_id),
    'can_open', v_why is null and v_current is null,
    'why_not', v_why,
    'max_length', 300,
    'sms_to', notice_mask(v_dest.sms),
    'email_to', notice_mask(v_dest.email),
    'current', case when v_current is not null then document_request_json(v_current, true) end,
    'suggestions', case when notice_is_assigned_ao(p_application_id) then document_request_suggestions(p_application_id) end,
    'history', coalesce((select jsonb_agg(document_request_json(r.id, true) order by r.id desc)
                         from document_requests r where r.application_id = p_application_id and r.status = 'CLOSED'), '[]'::jsonb));
end $$;

-- Items as stored: [{applicant_id, requirement_type | null, label (Other only)}] -> checked, labelled, with min_files
create or replace function public.document_request_items_checked(p_application_id bigint, p_items jsonb)
returns table (applicant_id bigint, requirement_type requirement_type, label text, min_files smallint)
language plpgsql stable security definer set search_path = public as $$
declare
  i jsonb;
  v_party bigint;
  v_type requirement_type;
  v_have int;
begin
  for i in select * from jsonb_array_elements(p_items) loop
    v_party := (i->>'applicant_id')::bigint;
    if not exists (select 1 from applicants a where a.id = v_party and a.application_id = p_application_id) then
      raise exception 'Each document must be for a person on this application';
    end if;
    v_type := nullif(i->>'requirement_type', '')::requirement_type;
    if v_type is null then
      applicant_id := v_party; requirement_type := null; label := btrim(i->>'label'); min_files := 1;
    else
      select count(*) into v_have from documents d
      join application_requirements ar on ar.id = d.requirement_id
      where ar.applicant_id = v_party and ar.requirement_type = v_type;
      applicant_id := v_party; requirement_type := v_type; label := requirement_label(v_type);
      min_files := greatest(1, required_document_min(v_type) - v_have);
    end if;
    return next;
  end loop;
end $$;
revoke execute on function public.document_request_items_checked(bigint, jsonb) from public, anon, authenticated;

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
  if exists (select 1 from document_requests where application_id = p_application_id and status <> 'CLOSED') then
    raise exception 'There is already a request for this application. Close it first';
  end if;
  v_problem := document_request_problem(p_message, p_items);
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

-- The assigned AO closes the request: SENT -> RECEIVED ("We received your documents"), OPEN -> WITHDRAWN
create or replace function public.close_document_request(p_request_id bigint, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_req document_requests;
  v_as text;
  v_no text;
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

  v_no := notification_app_no(v_req.application_id);
  perform send_notification('APPLICANT_REQUEST_CLOSED',
    case v_as when 'RECEIVED' then 'We received your documents for ' || v_no
              else 'No documents are needed for ' || v_no || ' for now' end,
    case v_as when 'RECEIVED' then 'Your Account Officer checked them. Status: Under review.'
              else 'Your Account Officer withdrew the document request.' end,
    v_req.application_id, p_assigned => array['APPLICANT'], p_source => 'notices');
  return v_as;
end $$;

revoke execute on function public.document_request_context(bigint) from public, anon;
grant execute on function public.document_request_context(bigint) to authenticated;
revoke execute on function public.preview_document_request(bigint, text, jsonb) from public, anon;
grant execute on function public.preview_document_request(bigint, text, jsonb) to authenticated;
revoke execute on function public.open_document_request(bigint, text, jsonb) from public, anon;
grant execute on function public.open_document_request(bigint, text, jsonb) to authenticated;
revoke execute on function public.close_document_request(bigint, text) from public, anon;
grant execute on function public.close_document_request(bigint, text) to authenticated;

-- ============================================================
-- 5. The applicant: see, upload, remove, send
-- ============================================================
-- The applicant's own requests that are not closed (one per application at most)
create or replace function public.my_document_requests()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(document_request_json(r.id, false)
                            || jsonb_build_object('application_no', la.application_no, 'user_id', la.user_id)
                            order by r.id), '[]'::jsonb)
  from document_requests r join loan_applications la on la.id = r.application_id
  where la.user_id = auth.uid() and r.status <> 'CLOSED';
$$;

-- Adds a file the applicant already uploaded to the request's folder. Returns the documents id.
create or replace function public.add_requested_document(p_item_id bigint, p_file_name text, p_file_path text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_item document_request_items;
  v_req document_requests;
  v_owner uuid;
  v_ext text := lower(substring(p_file_name from '\.([A-Za-z0-9]+)$'));
  v_req_id bigint;
  v_doc bigint;
begin
  select * into v_item from document_request_items where id = p_item_id;
  if not found then raise exception 'Document request not found'; end if;
  select * into v_req from document_requests where id = v_item.request_id for update;
  select user_id into v_owner from loan_applications where id = v_req.application_id;
  if v_owner is distinct from auth.uid() then raise exception 'Document request not found'; end if;
  if v_req.status <> 'OPEN' then raise exception 'This request is no longer open for uploads'; end if;
  if p_file_path is null or p_file_path not like v_owner || '/' || v_req.application_id || '/requests/' || v_req.id || '/%' then
    raise exception 'File is not in this request''s folder';
  end if;
  if v_ext is null or v_ext not in ('jpg', 'jpeg', 'png', 'pdf') then
    raise exception 'Upload a JPG, PNG or PDF file';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'application-documents' and name = p_file_path) then
    raise exception 'Upload the file first';
  end if;

  insert into documents (application_id, applicant_id, requirement_id, document_type, file_name, file_path, uploaded_by)
  values (v_req.application_id, v_item.applicant_id,
          (select ar.id from application_requirements ar
           where ar.applicant_id = v_item.applicant_id and ar.requirement_type = v_item.requirement_type),
          coalesce(v_item.requirement_type::text, 'OTHER'), coalesce(nullif(btrim(p_file_name), ''), 'file.' || v_ext),
          p_file_path, auth.uid())
  returning id into v_doc;
  insert into document_request_uploads (item_id, document_id) values (p_item_id, v_doc);
  return v_doc;
end $$;

-- Removes one of the applicant's own request uploads while the request is still OPEN. Returns the storage path
-- (the page then deletes the file; the storage policy allows that only in an OPEN request's folder).
create or replace function public.remove_requested_document(p_document_id bigint)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_req document_requests;
  v_path text;
begin
  select r.* into v_req
  from document_request_uploads u join document_request_items i on i.id = u.item_id
  join document_requests r on r.id = i.request_id
  where u.document_id = p_document_id;
  if not found or (select user_id from loan_applications where id = v_req.application_id) is distinct from auth.uid() then
    raise exception 'Upload not found';
  end if;
  if v_req.status <> 'OPEN' then raise exception 'Files can''t be removed after they were sent'; end if;
  delete from documents where id = p_document_id returning file_path into v_path;
  return v_path;
end $$;

-- "Send to my Account Officer": every item needs its files. The assigned AO is alerted.
create or replace function public.send_requested_documents(p_request_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_req document_requests;
  v_short text;
begin
  select * into v_req from document_requests where id = p_request_id for update;
  if not found or (select user_id from loan_applications where id = v_req.application_id) is distinct from auth.uid() then
    raise exception 'Document request not found';
  end if;
  if v_req.status <> 'OPEN' then raise exception 'This request was already sent'; end if;
  select string_agg(i.label || ' (' || party_label_text(i.applicant_id) || ')', '; ' order by i.id) into v_short
  from document_request_items i
  where i.request_id = p_request_id
    and (select count(*) from document_request_uploads u where u.item_id = i.id) < i.min_files;
  if v_short is not null then raise exception 'Upload every requested document first. Still missing: %', v_short; end if;

  update document_requests set status = 'SENT', sent_at = now() where id = p_request_id;
  perform send_notification('DOCUMENTS_SENT',
    'The applicant sent the requested documents for ' || notification_app_no(v_req.application_id),
    'Check them in the loan folder and the document check, then close the request.', v_req.application_id,
    p_assigned => array['ACCOUNT_OFFICER'], p_link => '/loanFolderPage?id=' || v_req.application_id);
end $$;

revoke execute on function public.my_document_requests() from public, anon;
grant execute on function public.my_document_requests() to authenticated;
revoke execute on function public.add_requested_document(bigint, text, text) from public, anon;
grant execute on function public.add_requested_document(bigint, text, text) to authenticated;
revoke execute on function public.remove_requested_document(bigint) from public, anon;
grant execute on function public.remove_requested_document(bigint) to authenticated;
revoke execute on function public.send_requested_documents(bigint) from public, anon;
grant execute on function public.send_requested_documents(bigint) to authenticated;

-- ============================================================
-- 6. Reviewer returns: the assigned AO is told too (in-app)
-- ============================================================
create or replace function public.notify_ao_on_review_return() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.action::text = 'RETURNED' then
      perform send_notification('REVIEW_RETURNED',
        notification_app_no(new.application_id) || ' was returned to the Credit Officer by a reviewer',
        left(initcap(new.severity::text) || ' revision: ' || new.remarks
             || ' If the applicant needs to provide something, send them a document request.', 500),
        new.application_id, p_assigned => array['ACCOUNT_OFFICER'], p_link => '/loanFolderPage?id=' || new.application_id);
    end if;
  exception when others then
    raise warning 'notify_ao_on_review_return failed: %', sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists notify_ao_on_review_return on public.review_decisions;
create trigger notify_ao_on_review_return after insert on public.review_decisions
  for each row execute function public.notify_ao_on_review_return();

-- ============================================================
-- 7. Access: read your own (applicant) or the file's (staff); writes only through the functions above
-- ============================================================
alter table public.document_requests enable row level security;
alter table public.document_request_items enable row level security;
alter table public.document_request_uploads enable row level security;
revoke insert, update, delete, truncate on public.document_requests, public.document_request_items,
  public.document_request_uploads from anon, authenticated;

drop policy if exists "read document requests" on public.document_requests;
create policy "read document requests" on public.document_requests
  for select to authenticated
  using (public.staff_can_access(application_id) or public.owns_application(application_id));

drop policy if exists "read document request items" on public.document_request_items;
create policy "read document request items" on public.document_request_items
  for select to authenticated
  using (exists (select 1 from public.document_requests r where r.id = request_id
                 and (public.staff_can_access(r.application_id) or public.owns_application(r.application_id))));

drop policy if exists "read document request uploads" on public.document_request_uploads;
create policy "read document request uploads" on public.document_request_uploads
  for select to authenticated
  using (exists (select 1 from public.document_request_items i join public.document_requests r on r.id = i.request_id
                 where i.id = item_id
                   and (public.staff_can_access(r.application_id) or public.owns_application(r.application_id))));

-- Storage: the applicant uploads / removes only in an OPEN request's folder {user_id}/{application_id}/requests/{id}/
-- (bucket limits as for the form: JPG, PNG or PDF, 10 MB)
drop policy if exists "applicant uploads requested files" on storage.objects;
create policy "applicant uploads requested files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'application-documents'
              and (storage.foldername(name))[1] = auth.uid()::text
              and (storage.foldername(name))[3] = 'requests'
              and public.document_request_open_for_me(public.document_request_path_id((storage.foldername(name))[2]),
                                                      public.document_request_path_id((storage.foldername(name))[4])));

drop policy if exists "applicant removes requested files" on storage.objects;
create policy "applicant removes requested files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'application-documents'
         and (storage.foldername(name))[1] = auth.uid()::text
         and (storage.foldername(name))[3] = 'requests'
         and public.document_request_open_for_me(public.document_request_path_id((storage.foldername(name))[2]),
                                                 public.document_request_path_id((storage.foldername(name))[4])));
