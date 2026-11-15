-- CATCH — CI findings flags, staff marks on uploaded files, and "can I ask the applicant?" (panel feedback, 2026-11-16)
-- Run after 20261115_message_mentions_topics.sql (needs 20261108_ci_results.sql, 20261024_notifications.sql and
-- 20261112_document_requests.sql). Re-runnable, no drops of data.
--
-- What it does
--   1. ci_finding_flags: a Credit Investigator flags the findings of a file with a short note
--      (flag_ci_findings). Allowed for any active CI on a file with a CI request, once a saved CI result is
--      "With findings", during Credit Investigation and after CI Done. A CI can flag again; every flag is kept.
--      Alert CI_FINDINGS_FLAGGED (switch row, on): the assigned Account Officer always; the assigned Credit Officer,
--      or the Dispatch Admins while no Credit Officer is assigned. Application number only: the note is read on the
--      page. The alert opens the Financial Package at IV. Credit Checking, where every one of them can read the results.
--   2. document_file_marks: staff mark an uploaded applicant document Cleared or Needs a new copy, with a comment
--      (mark_document_file). One row per mark: the newest row of a document is its current mark, the older rows are
--      the history of who marked what. Only the assigned Account Officer and the assigned Credit Officer can mark;
--      everyone who can open the file reads. Applicant documents only (not the CI's NFIS / TU / BRAS reports).
--      "Needs a new copy" needs a comment (it becomes the note of a document request).
--   3. document_request_can_open(app): true when the caller is the assigned AO and may open a document request now
--      (same rules as document_request_context). The pages use it to show or hide "Ask the applicant".
--
-- Both new tables: RLS on, staff who can open the file read, applicants and anon read nothing, no client writes.
-- Rows can't be changed, and can only go when their application is deleted. Inserts are logged in audit_log.
-- No existing function, trigger or table of another module is changed.
--
-- Browser calls (authenticated)
--   flag_ci_findings(p_application_id, p_note)            -> the new flag
--   mark_document_file(p_document_id, p_mark, p_comment)  -> the new mark ('CLEARED' | 'NEEDS_NEW_COPY')
--   document_file_can_mark(p_application_id)              -> boolean
--   document_request_can_open(p_application_id)           -> boolean
--   select from ci_finding_flags / document_file_marks (RLS)

-- ============================================================
-- 0. Dependencies
-- ============================================================
do $$
declare
  v_missing text;
begin
  select string_agg(m, ', ') into v_missing
  from (values ('public.ci_checks', '20261108_ci_results.sql'),
               ('public.notifications', '20261024_notifications.sql'),
               ('public.audit_log', '20261007_ao_kyc_verification.sql'),
               ('public.document_requests', '20261112_document_requests.sql')) d (t, m)
  where to_regclass(t) is null;
  if v_missing is not null then
    raise exception 'Run these migrations first, then this file again: %', v_missing;
  end if;
end $$;

-- ============================================================
-- 1. Tables
-- ============================================================
create table if not exists public.ci_finding_flags (
  id bigint generated always as identity primary key,
  application_id bigint not null,
  note text not null check (note = btrim(note, E' \t\r\n') and length(note) between 1 and 500),
  flagged_by uuid not null,
  flagged_at timestamptz not null default now()
);
create index if not exists ci_finding_flags_application on public.ci_finding_flags (application_id, id);

-- document_id has no foreign key on purpose: the history stays when the file itself is replaced or removed
create table if not exists public.document_file_marks (
  id bigint generated always as identity primary key,
  application_id bigint not null,
  document_id bigint not null,
  applicant_id bigint,
  requirement_type text,            -- the checklist document it was uploaded for (null = an "Other" requested document)
  file_name text not null,
  mark text not null check (mark in ('CLEARED', 'NEEDS_NEW_COPY')),
  comment text check (comment = btrim(comment, E' \t\r\n') and length(comment) between 1 and 500),
  marked_by uuid not null,
  marked_role text not null check (marked_role in ('ACCOUNT_OFFICER', 'CREDIT_OFFICER')),
  marked_at timestamptz not null default now(),
  check (mark <> 'NEEDS_NEW_COPY' or comment is not null)
);
create index if not exists document_file_marks_document on public.document_file_marks (document_id, id);
create index if not exists document_file_marks_application on public.document_file_marks (application_id, id);

-- Foreign keys by name, so a re-run puts them back after a 20260928 reset dropped them
do $$ begin
  delete from public.ci_finding_flags f where not exists (select 1 from public.loan_applications la where la.id = f.application_id);
  delete from public.document_file_marks m where not exists (select 1 from public.loan_applications la where la.id = m.application_id);
  if not exists (select 1 from pg_constraint where conname = 'ci_finding_flags_application_fk') then
    alter table public.ci_finding_flags add constraint ci_finding_flags_application_fk
      foreign key (application_id) references public.loan_applications(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'document_file_marks_application_fk') then
    alter table public.document_file_marks add constraint document_file_marks_application_fk
      foreign key (application_id) references public.loan_applications(id) on delete cascade;
  end if;
end $$;

insert into public.notification_switches (kind, enabled, note) values
  ('CI_FINDINGS_FLAGGED', true, 'A Credit Investigator flagged CI findings: the assigned AO and CO (Dispatch Admins while no CO is assigned)')
on conflict (kind) do nothing;

-- ============================================================
-- 2. History guard: no edits; a row goes only with its application
-- ============================================================
create or replace function public.panel_history_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE'
     and not exists (select 1 from loan_applications la where la.id = old.application_id) then
    return old;   -- the application itself was deleted (cascade), or the cleanup in section 1
  end if;
  raise exception 'This history can''t be edited or deleted';
end $$;
revoke execute on function public.panel_history_guard() from public, anon, authenticated;

drop trigger if exists history_guard on public.ci_finding_flags;
create trigger history_guard before update or delete on public.ci_finding_flags
  for each row execute function public.panel_history_guard();
drop trigger if exists history_no_truncate on public.ci_finding_flags;
create trigger history_no_truncate before truncate on public.ci_finding_flags
  for each statement execute function public.panel_history_guard();

drop trigger if exists history_guard on public.document_file_marks;
create trigger history_guard before update or delete on public.document_file_marks
  for each row execute function public.panel_history_guard();
drop trigger if exists history_no_truncate on public.document_file_marks;
create trigger history_no_truncate before truncate on public.document_file_marks
  for each statement execute function public.panel_history_guard();

-- Logged in the application's change history (audit_log), like every other change after submission
drop trigger if exists log_application_change on public.ci_finding_flags;
create trigger log_application_change after insert on public.ci_finding_flags
  for each row execute function public.log_application_change('application_id');
drop trigger if exists log_application_change on public.document_file_marks;
create trigger log_application_change after insert on public.document_file_marks
  for each row execute function public.log_application_change('application_id');

-- ============================================================
-- 3. RLS: staff who can open the file read; no client writes
-- ============================================================
alter table public.ci_finding_flags enable row level security;
alter table public.document_file_marks enable row level security;
revoke all on public.ci_finding_flags from anon, authenticated;
revoke all on public.document_file_marks from anon, authenticated;
grant select on public.ci_finding_flags to authenticated;
grant select on public.document_file_marks to authenticated;

drop policy if exists "staff read ci finding flags" on public.ci_finding_flags;
create policy "staff read ci finding flags" on public.ci_finding_flags
  for select to authenticated using (public.staff_can_access(application_id));

drop policy if exists "staff read document file marks" on public.document_file_marks;
create policy "staff read document file marks" on public.document_file_marks
  for select to authenticated using (public.staff_can_access(application_id));

-- ============================================================
-- 4. flag_ci_findings()
-- ============================================================
create or replace function public.flag_ci_findings(p_application_id bigint, p_note text)
returns public.ci_finding_flags language plpgsql security definer set search_path = public as $$
declare
  v_note text := btrim(coalesce(p_note, ''), E' \t\r\n');
  v_row ci_finding_flags;
  v_no text;
  v_link text := '/financialPackagePage?id=' || p_application_id || '#fp-iv';
  v_body text := 'The Credit Investigator flagged the findings. Open IV. Credit Checking to read them.';
begin
  if coalesce(current_user_role()::text, '') <> 'CREDIT_INVESTIGATOR'
     or not exists (select 1 from users u where u.id = auth.uid() and u.is_active)
     or not staff_can_access(p_application_id) then
    raise exception 'Only a Credit Investigator can flag CI findings, on a file with a CI request';
  end if;
  if not exists (select 1 from ci_checks c join applicants a on a.id = c.applicant_id
                 where a.application_id = p_application_id and c.result::text = 'WITH_FINDINGS') then
    raise exception 'No saved CI result on this file is "With findings". Save the findings first.';
  end if;
  if v_note = '' then raise exception 'Write a short note about the findings'; end if;
  if length(v_note) > 500 then raise exception 'The note is longer than 500 characters'; end if;
  if staff_name(auth.uid()) is null then
    raise exception 'Fill in your staff profile (first and last name) first';
  end if;

  insert into ci_finding_flags (application_id, note, flagged_by)
  values (p_application_id, v_note, auth.uid())
  returning * into v_row;

  -- A failed notification never blocks the flag
  begin
    v_no := notification_app_no(p_application_id);
    perform send_notification('CI_FINDINGS_FLAGGED', 'CI findings flagged on ' || v_no, v_body, p_application_id,
      p_assigned => array['ACCOUNT_OFFICER'], p_link => v_link, p_source => 'ci');
    if exists (select 1 from application_assignments where application_id = p_application_id
               and assignee_role::text = 'CREDIT_OFFICER' and unassigned_at is null) then
      perform send_notification('CI_FINDINGS_FLAGGED', 'CI findings flagged on ' || v_no, v_body, p_application_id,
        p_assigned => array['CREDIT_OFFICER'], p_link => v_link, p_source => 'ci');
    else
      perform send_notification('CI_FINDINGS_FLAGGED', 'CI findings flagged on ' || v_no,
        v_body || ' No Credit Officer is assigned yet.', p_application_id,
        p_roles => array['DISPATCH_ADMIN'], p_link => v_link, p_source => 'ci');
    end if;
  exception when others then
    raise warning 'CI findings notification failed: %', sqlerrm;
  end;

  return v_row;
end $$;
revoke execute on function public.flag_ci_findings(bigint, text) from public, anon;
grant execute on function public.flag_ci_findings(bigint, text) to authenticated;

-- ============================================================
-- 5. Marks on uploaded files
-- ============================================================
-- The assigned Account Officer or the assigned Credit Officer of the file
create or replace function public.document_file_can_mark(p_application_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(staff_can_access(p_application_id)
    and current_user_role()::text in ('ACCOUNT_OFFICER', 'CREDIT_OFFICER')
    and exists (select 1 from users u where u.id = auth.uid() and u.is_active)
    and exists (select 1 from application_assignments aa
                where aa.application_id = p_application_id and aa.user_id = auth.uid()
                  and aa.assignee_role::text = current_user_role()::text and aa.unassigned_at is null), false);
$$;
revoke execute on function public.document_file_can_mark(bigint) from public, anon;
grant execute on function public.document_file_can_mark(bigint) to authenticated;

create or replace function public.mark_document_file(p_document_id bigint, p_mark text, p_comment text default null)
returns public.document_file_marks language plpgsql security definer set search_path = public as $$
declare
  v_doc documents;
  v_comment text := nullif(btrim(coalesce(p_comment, ''), E' \t\r\n'), '');
  v_row document_file_marks;
begin
  select * into v_doc from documents where id = p_document_id;
  if v_doc.id is null or not document_file_can_mark(v_doc.application_id) then
    raise exception 'Only the assigned Account Officer or the assigned Credit Officer can mark a file';
  end if;
  if p_mark is null or p_mark not in ('CLEARED', 'NEEDS_NEW_COPY') then
    raise exception 'Mark the file Cleared or Needs a new copy';
  end if;
  if p_mark = 'NEEDS_NEW_COPY' and v_comment is null then
    raise exception 'Say what is wrong with the file, so the applicant can be asked for a new copy';
  end if;
  if length(v_comment) > 500 then raise exception 'The comment is longer than 500 characters'; end if;

  insert into document_file_marks (application_id, document_id, applicant_id, requirement_type, file_name,
                                   mark, comment, marked_by, marked_role)
  values (v_doc.application_id, v_doc.id, v_doc.applicant_id,
          (select ar.requirement_type::text from application_requirements ar where ar.id = v_doc.requirement_id),
          v_doc.file_name, p_mark, v_comment, auth.uid(), current_user_role()::text)
  returning * into v_row;
  return v_row;
end $$;
revoke execute on function public.mark_document_file(bigint, text, text) from public, anon;
grant execute on function public.mark_document_file(bigint, text, text) to authenticated;

-- ============================================================
-- 6. May I open a document request now? (the assigned AO, no request in progress, a stage that allows it)
-- ============================================================
create or replace function public.document_request_can_open(p_application_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(staff_can_access(p_application_id)
    and notice_is_assigned_ao(p_application_id)
    and document_request_stage_ok(p_application_id)
    and not exists (select 1 from document_requests r
                    where r.application_id = p_application_id and r.status <> 'CLOSED'), false);
$$;
revoke execute on function public.document_request_can_open(bigint) from public, anon;
grant execute on function public.document_request_can_open(bigint) to authenticated;
