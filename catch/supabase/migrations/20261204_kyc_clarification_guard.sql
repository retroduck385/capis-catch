-- CATCH — KYC clarifications: no stage move while one is open, the AO can withdraw a question, new wording (2026-12-04)
-- Run after 20261203_kyc_clarifications.sql. Re-runnable, no drops of data.
--
-- What it does
--   * Stage guard: while any KYC clarification on the file is OPEN, the file can't move on from Intake to Credit
--     Investigation (request_ci) or from Credit Investigation to Credit Evaluation (complete_ci). A trigger before
--     insert on application_stages refuses the new stage row ("Resolve the open clarification on Employment first."),
--     so the whole move is rolled back. Teammates' functions (request_ci, complete_ci) are not changed. A reviewer's
--     return to Credit Evaluation (from Review) is not affected.
--   * Withdraw: the assigned AO, while the file is in Intake or Credit Investigation, can withdraw an open question
--     (withdraw_kyc_clarification). The thread closes (withdrawn = true, no KYC check) and the applicant gets the same
--     neutral in-app line as when the section is verified (APPLICANT_CLARIFICATION_CLOSED, same switch). The KYC
--     result of the section is not changed (Verified logic untouched).
--   * Wording: the applicant's in-app notification for a new question is titled "Clarification requested: <section>".
--     SMS and email are unchanged.
--
-- Changes to 20261203_kyc_clarifications.sql's own objects: kyc_clarifications gets withdrawn (default false) and a
--   replaced close check; kyc_clarification_append_only(), kyc_clarification_json() and compose_kyc_clarification()
--   are replaced. 20261203 re-run -> run this file again afterwards.
-- Teammates' tables: application_stages gets one trigger (the guard). Nothing else in their files changes.

-- ============================================================
-- 0. Dependencies
-- ============================================================
do $$
begin
  if to_regclass('public.kyc_clarifications') is null then
    raise exception 'Run these migrations first, then this file again: 20261203_kyc_clarifications.sql';
  end if;
end $$;

-- ============================================================
-- 1. Withdrawn threads
-- ============================================================
alter table public.kyc_clarifications add column if not exists withdrawn boolean not null default false;

-- A closed thread was closed by a Verified check, or withdrawn (no check)
alter table public.kyc_clarifications drop constraint if exists kyc_clarifications_check;
alter table public.kyc_clarifications drop constraint if exists kyc_clarifications_close_ok;
alter table public.kyc_clarifications add constraint kyc_clarifications_close_ok
  check (case when status = 'OPEN'
              then closed_at is null and closed_by is null and closed_check_id is null and not withdrawn
              else closed_at is not null and closed_by is not null and (withdrawn = (closed_check_id is null)) end);

-- Same guard as 20261203, plus the withdrawn flag among the fields the close may set
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
       and (to_jsonb(new) - array['status', 'closed_check_id', 'closed_by', 'closed_at', 'withdrawn'])
           = (to_jsonb(old) - array['status', 'closed_check_id', 'closed_by', 'closed_at', 'withdrawn']) then
      return new;
    end if;
  end if;
  raise exception 'KYC clarifications can''t be edited or deleted';
end $$;

-- ============================================================
-- 2. Open clarifications of a file, by section name ("Employment, Loan Details"; null = none)
-- ============================================================
create or replace function public.kyc_open_clarification_sections(p_application_id bigint)
returns text language sql stable security definer set search_path = public as $$
  select string_agg(kyc_section_label(section), ', ' order by id)
  from kyc_clarifications where application_id = p_application_id and status = 'OPEN';
$$;
revoke execute on function public.kyc_open_clarification_sections(bigint) from public, anon, authenticated;

-- ============================================================
-- 3. The stage guard (teammates' table application_stages: a trigger only)
-- ============================================================
-- Intake -> Credit Investigation, and Credit Investigation -> Credit Evaluation, wait for open clarifications.
-- The stage just left is the file's latest row before this one (request_ci / complete_ci close it, then insert).
create or replace function public.kyc_clarification_stage_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_from text;
  v_open text;
begin
  if new.stage::text not in ('CREDIT_INVESTIGATION', 'CREDIT_EVALUATION') then return new; end if;
  if new.stage::text = 'CREDIT_EVALUATION' then
    select stage::text into v_from from application_stages
    where application_id = new.application_id order by id desc limit 1;
    if v_from is distinct from 'CREDIT_INVESTIGATION' then return new; end if;   -- e.g. a reviewer's return
  end if;
  v_open := kyc_open_clarification_sections(new.application_id);
  if v_open is not null then
    raise exception 'Resolve the open clarification on % first.', v_open;
  end if;
  return new;
end $$;
revoke execute on function public.kyc_clarification_stage_guard() from public, anon, authenticated;

drop trigger if exists kyc_clarification_stage_guard on public.application_stages;
create trigger kyc_clarification_stage_guard before insert on public.application_stages
  for each row execute function public.kyc_clarification_stage_guard();

-- ============================================================
-- 4. Withdraw a question (assigned AO, Intake or Credit Investigation)
-- ============================================================
create or replace function public.withdraw_kyc_clarification(p_clarification_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_thread kyc_clarifications;
begin
  select * into v_thread from kyc_clarifications where id = p_clarification_id for update;
  if not found then raise exception 'Question not found'; end if;
  if not coalesce(ao_can_edit(v_thread.application_id), false) then
    raise exception 'Only the assigned Account Officer can withdraw a question, while the file is in Intake or Credit Investigation';
  end if;
  if v_thread.status <> 'OPEN' then raise exception 'This question is already closed'; end if;

  update kyc_clarifications
  set status = 'CLOSED', withdrawn = true, closed_by = auth.uid(), closed_at = now()
  where id = v_thread.id;

  begin
    perform send_notification('APPLICANT_CLARIFICATION_CLOSED',
      'Question closed on ' || notification_app_no(v_thread.application_id),
      'Your Account Officer has closed the question on ' || kyc_section_label(v_thread.section) || '. No further action is needed.',
      v_thread.application_id, p_assigned => array['APPLICANT'], p_source => 'notices',
      p_link => '/applicationFormPage?id=' || v_thread.application_id);
  exception when others then
    raise warning 'withdraw_kyc_clarification: notification failed: %', sqlerrm;
  end;
end $$;
revoke execute on function public.withdraw_kyc_clarification(bigint) from public, anon;
grant execute on function public.withdraw_kyc_clarification(bigint) to authenticated;

-- ============================================================
-- 5. Reading: + withdrawn (replaces the 20261203 version)
-- ============================================================
create or replace function public.kyc_clarification_json(p_id bigint, p_staff boolean)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', c.id, 'application_id', c.application_id, 'section', c.section, 'section_label', kyc_section_label(c.section),
    'status', c.status, 'withdrawn', c.withdrawn, 'opened_check_id', case when p_staff then c.opened_check_id end,
    'opened_at', c.opened_at, 'closed_at', c.closed_at,
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

-- ============================================================
-- 6. Wording: "Clarification requested: <section>" in-app (replaces the 20261203 version; SMS / email unchanged)
-- ============================================================
create or replace function public.compose_kyc_clarification(p_app_no text, p_section_label text, p_question text)
returns table (in_app_title text, in_app_body text, sms_text text, email_subject text, email_body text)
language sql immutable as $$
  with t as (select btrim(p_question) || case when right(btrim(p_question), 1) in ('.', '!', '?') then '' else '.' end as q)
  select 'Clarification requested: ' || p_section_label,
         'Your application ' || p_app_no || ': ' || q || ' Open this application to reply.',
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
