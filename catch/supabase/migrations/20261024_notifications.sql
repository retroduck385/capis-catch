-- CATCH — in-app notifications (F6 Timely Workspace Notification Alerts; applicant status notices)
-- Run after 20261021_review_routing.sql. Re-runnable, no drops of data.
--
-- What it does
--   * notifications: one row per recipient. Each user reads only their own (RLS). Clients can't insert,
--     update or delete; they mark rows read with mark_notifications_read(ids) (null = all of mine).
--   * New rows appear instantly: the table is added to the supabase_realtime publication.
--   * Triggers on the workflow tables create the notifications. No existing function or migration is changed.
--   * In-app only (no email / SMS).
--
-- Run order / re-runs
--   * Needs 20260928 .. 20261021_review_routing.sql already run (the file stops with an error naming
--     what's missing, before creating anything).
--   * Re-running ANY other migration (work tray, AO KYC, CI request, FP, credit scoring, review routing, ...):
--     nothing to do. Their tables are "create table if not exists" and the triggers below are named
--     notify_*, which no other migration drops. Please never name your own triggers notify_*.
--   * Re-running 20260928_application_side.sql drops loan_applications, users and the user_role /
--     application_status types with CASCADE. That removes the notify_applicant_status trigger and this
--     table's foreign keys. (It also removes user_role columns from later tables, e.g.
--     application_assignments.assignee_role, so 20261005 then fails on the leftover table: a real reset
--     means dropping the later tables too.) Afterwards: run every later migration in order, then this
--     file again (it puts the trigger and the keys back and deletes notifications whose recipient is gone).
--   * Order of the 1020 files is by their headers, not by name: ci_request, then ao_view_all, then financial_package.
--
-- Triggers (all AFTER, one per table; each catches its own errors and only raises a WARNING, so a failed
-- notification never blocks a stage move)
--   notify_stage_status      on stage_status_changes    NEW_APPLICATION (Intake opened -> every active AO),
--                                                       STAGE_CREDIT_EVALUATION (assigned CO, else Dispatch Admins),
--                                                       APPROVAL_ROUTED (Approval opened -> routed approvers),
--                                                       DECIDED (AO, CO, Dispatch Admins),
--                                                       STAGE_RETURNED (status RETURNED -> who owns that stage),
--                                                       DONE_REVERTED (a Done status reopened -> owner + Dispatch Admins)
--   notify_assignment        on application_assignments ASSIGNED / UNASSIGNED (only when someone else did it)
--   notify_ci_request        on ci_requests             CI_REQUESTED (every active CI)
--   notify_credit_result     on financial_packages      CREDIT_RESULT_DEFERRED (assigned AO)
--   notify_deferred_update   on audit_log               DEFERRED_ACCOUNT_UPDATED (assigned CO, when the assigned AO
--                                                       edits a file whose Credit Result is Deferred; one unread at a time)
--   notify_review_routing    on review_assignments      REVIEW_ROUTED / REVIEW_UNROUTED (reviewers; approvers only
--                                                       once the file is in Approval)
--   notify_applicant_status  on loan_applications       APPLICANT_* (below)
--   STAGE_CREDIT_EVALUATION, APPROVAL_ROUTED, DECIDED, STAGE_RETURNED and DONE_REVERTED have no source yet:
--   they start firing when the moves into Credit Evaluation / Approval / Decided and the returns are built.
--
-- Applicants see four statuses only, never internal detail (meeting 2026-10-23):
--   Submitted (SUBMITTED) / Incomplete submission (FOR_CLARIFICATION, DEFERRED) /
--   Under review (UNDER_CI, UNDER_CREDIT_EVALUATION, UNDER_REVIEW, FOR_APPROVAL) / Decision (APPROVED, REJECTED)
--   Reserved applicant kinds (the only kinds an applicant can ever receive, and only applicants get them):
--     APPLICANT_SUBMITTED, APPLICANT_UNDER_REVIEW (once per change into "Under review", not per internal move),
--     APPLICANT_INCOMPLETE (FOR_CLARIFICATION), APPLICANT_DEFERRED (DEFERRED, OFF), APPLICANT_DECISION (OFF).
--   The decision notice never states the outcome or a reason. Both OFF kinds wait for the bank's rules.
--
-- Switches: notification_switches (kind, enabled). No row = on. Toggle in the SQL Editor, e.g.
--   update public.notification_switches set enabled = true where kind = 'APPLICANT_DECISION';
--   insert into public.notification_switches (kind, enabled) values ('NEW_APPLICATION', false)
--     on conflict (kind) do update set enabled = excluded.enabled;
--
-- Sending from another module (OCR, RAG, fraud detection, summary page, messages)
--   send_notification() can be run by SQL (triggers, security definer functions) and the service role
--   (OCR worker, FastAPI). Not by the browser: a frontend module needs its own security definer RPC that
--   checks permission and then calls it.
--
--   perform public.send_notification(
--     p_kind           => 'SUMMARY_READY',                -- UPPER_SNAKE_CASE, your own name
--     p_title          => 'Summary report ready for ' || v_app_no,   -- max 120 chars
--     p_body           => null,                           -- optional, max 500 chars
--     p_application_id => v_app,                          -- optional
--     p_users          => null,                           -- uuid[]: these people
--     p_roles          => null,                           -- text[]: every active user with these staff roles
--     p_assigned       => array['REVIEWER', 'APPROVER'],  -- text[]: people on this application:
--                                                         --   ACCOUNT_OFFICER, CREDIT_OFFICER, REVIEWER, APPROVER, APPLICANT
--     p_link           => null,                           -- in-app path starting with '/'; null = the page that
--                                                         --   person opens from the work tray
--     p_source         => 'summary',                      -- your module: ocr, rag, fraud, summary, messages, ...
--     p_skip_actor     => true,                           -- don't notify whoever caused it (auth.uid())
--     p_dedupe         => false);                         -- true = skip people who still have an unread one
--                                                         --   of this kind for this application
--   Python (service role): sb.rpc("send_notification", {"p_kind": "OCR_DONE", "p_title": f"Document text ready for {app_no}",
--     "p_application_id": app_id, "p_assigned": ["ACCOUNT_OFFICER"], "p_source": "ocr"}).execute()
--   Returns the number of notifications created (0 if the kind is switched off or nobody qualifies).
--   Rules: only the application number in staff text, never borrower names or amounts (a notification stays
--   readable after its recipient loses access to the file). APPLICANT is refused in p_roles. Kinds starting
--   APPLICANT_ are reserved (list above); other kinds never reach an applicant.

-- ============================================================
-- 0. Dependencies: stop before creating anything if an earlier migration is missing
-- ============================================================
do $$
declare
  v_missing text;
begin
  select string_agg(m, ', ') into v_missing
  from (values ('public.loan_applications', '20260928_application_side.sql'),
               ('public.application_stages', '20261005_work_tray.sql'),
               ('public.audit_log', '20261007_ao_kyc_verification.sql'),
               ('public.ci_requests', '20261020_ci_request.sql'),
               ('public.financial_packages', '20261020_financial_package.sql'),
               ('public.review_assignments', '20261021_review_routing.sql')) d (t, m)
  where to_regclass(t) is null;
  if v_missing is not null then
    raise exception 'Run these migrations first, then this file again: %', v_missing;
  end if;
end $$;

-- ============================================================
-- 1. Tables
-- ============================================================
-- Types are plain text (not user_role / application_status) so a re-run of 20260928 can't cascade into them.
create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  recipient_id uuid not null,
  application_id bigint,
  kind text not null check (kind ~ '^[A-Z][A-Z0-9_]*$'),
  source text not null default 'workflow',
  title text not null check (length(trim(title)) between 1 and 120),
  body text check (length(body) <= 500),
  link text check (link ~ '^/[A-Za-z]'),
  created_by uuid,           -- who caused it; null = worker / system
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_recipient on public.notifications (recipient_id, created_at desc);
create index if not exists notifications_unread on public.notifications (recipient_id) where read_at is null;

-- Foreign keys added by name so a re-run puts them back after 20260928 dropped them
delete from public.notifications n where not exists (select 1 from public.users u where u.id = n.recipient_id);
delete from public.notifications n where n.application_id is not null
  and not exists (select 1 from public.loan_applications la where la.id = n.application_id);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'notifications_recipient_fk') then
    alter table public.notifications add constraint notifications_recipient_fk
      foreign key (recipient_id) references public.users(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notifications_application_fk') then
    alter table public.notifications add constraint notifications_application_fk
      foreign key (application_id) references public.loan_applications(id) on delete cascade;
  end if;
end $$;

-- Per-kind on/off. No row = on.
create table if not exists public.notification_switches (
  kind text primary key check (kind ~ '^[A-Z][A-Z0-9_]*$'),
  enabled boolean not null,
  note text
);
insert into public.notification_switches (kind, enabled, note) values
  ('APPLICANT_DECISION', false, 'Off until the bank confirms what applicants are told about decisions'),
  ('APPLICANT_DEFERRED', false, 'Off until the bank confirms what applicants are told about deferrals'),
  ('NEW_APPLICATION', true, 'Every active Account Officer hears about each new submission')
on conflict (kind) do nothing;

-- ============================================================
-- 2. RLS: each user reads only their own notifications; no client writes
-- ============================================================
alter table public.notifications enable row level security;
alter table public.notification_switches enable row level security;
revoke insert, update, delete, truncate on public.notifications from anon, authenticated;
revoke all on public.notification_switches from anon, authenticated;

drop policy if exists "read own notifications" on public.notifications;
create policy "read own notifications" on public.notifications
  for select to authenticated using (recipient_id = auth.uid());

-- ============================================================
-- 3. Helpers
-- ============================================================
-- The four statuses an applicant sees
create or replace function public.applicant_status_bucket(p_status text)
returns text language sql immutable as $$
  select case
    when p_status = 'SUBMITTED' then 'SUBMITTED'
    when p_status in ('FOR_CLARIFICATION', 'DEFERRED') then 'INCOMPLETE'
    when p_status in ('UNDER_CI', 'UNDER_CREDIT_EVALUATION', 'UNDER_REVIEW', 'FOR_APPROVAL') then 'UNDER_REVIEW'
    when p_status in ('APPROVED', 'REJECTED') then 'DECISION' end;
$$;

create or replace function public.applicant_notification_kinds()
returns text[] language sql immutable as $$
  select array['APPLICANT_SUBMITTED', 'APPLICANT_UNDER_REVIEW', 'APPLICANT_INCOMPLETE',
               'APPLICANT_DEFERRED', 'APPLICANT_DECISION'];
$$;

-- The page a person opens for an application from the work tray (mirrors folderPath() in workTray.jsx)
create or replace function public.notification_link(p_user_id uuid, p_application_id bigint)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p_application_id is null then null
    when u.role::text = 'APPLICANT' then '/applicationFormPage?id=' || p_application_id
    when u.role::text = 'CREDIT_INVESTIGATOR' then '/ciRequestPage?id=' || p_application_id
    when u.role::text = 'CREDIT_OFFICER' then '/financialPackagePage?id=' || p_application_id
    when u.role::text in ('REVIEWER', 'APPROVER')
         and exists (select 1 from review_assignments ra where ra.application_id = p_application_id
                     and ra.user_id = p_user_id and ra.unassigned_at is null)
      then '/reviewSummaryPage?id=' || p_application_id
    else '/loanFolderPage?id=' || p_application_id end
  from users u where u.id = p_user_id;
$$;

create or replace function public.notification_app_no(p_application_id bigint)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(application_no, 'application #' || id) from loan_applications where id = p_application_id;
$$;

create or replace function public.stage_label(p_stage text)
returns text language sql immutable as $$
  select case p_stage when 'INTAKE' then 'Intake' when 'CREDIT_INVESTIGATION' then 'Credit Investigation'
                      when 'CREDIT_EVALUATION' then 'Credit Evaluation' when 'REVIEW' then 'Review'
                      when 'APPROVAL' then 'Approval' when 'DECIDED' then 'Decided' else p_stage end;
$$;

revoke execute on function public.notification_link(uuid, bigint) from public, anon, authenticated;
revoke execute on function public.notification_app_no(bigint) from public, anon, authenticated;

-- ============================================================
-- 4. send_notification(): the one way to create notifications (any module)
-- ============================================================
create or replace function public.send_notification(
  p_kind text,
  p_title text,
  p_body text default null,
  p_application_id bigint default null,
  p_users uuid[] default null,
  p_roles text[] default null,
  p_assigned text[] default null,
  p_link text default null,
  p_source text default 'workflow',
  p_skip_actor boolean default true,
  p_dedupe boolean default false)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_applicant_kind boolean := p_kind = any (applicant_notification_kinds());
  v_count integer;
begin
  if p_kind is null or p_kind !~ '^[A-Z][A-Z0-9_]*$' then
    raise exception 'Notification kind must be UPPER_SNAKE_CASE, got %', coalesce(p_kind, 'null');
  end if;
  if p_kind like 'APPLICANT\_%' and not v_applicant_kind then
    raise exception 'APPLICANT_* kinds are reserved: %', array_to_string(applicant_notification_kinds(), ', ');
  end if;
  if nullif(trim(p_title), '') is null then raise exception 'Notification title is required'; end if;
  if p_link is not null and p_link !~ '^/[A-Za-z]' then
    raise exception 'Notification link must be an in-app path starting with /';
  end if;
  if 'APPLICANT' = any (coalesce(p_roles, '{}')) then
    raise exception 'Applicants can only be notified about their own application: use p_assigned => array[''APPLICANT'']';
  end if;
  if exists (select 1 from notification_switches where kind = p_kind and not enabled) then return 0; end if;

  insert into notifications (recipient_id, application_id, kind, source, title, body, link, created_by)
  select r.user_id, p_application_id, p_kind, coalesce(nullif(trim(p_source), ''), 'workflow'),
         trim(p_title), nullif(trim(p_body), ''), coalesce(p_link, notification_link(r.user_id, p_application_id)),
         v_actor
  from (
    select x as user_id from unnest(p_users) x
    union
    select id from users where role::text = any (p_roles)
    union
    select user_id from application_assignments
    where application_id = p_application_id and unassigned_at is null and assignee_role::text = any (p_assigned)
    union
    select user_id from review_assignments
    where application_id = p_application_id and unassigned_at is null and assignee_role::text = any (p_assigned)
    union
    select user_id from loan_applications where id = p_application_id and 'APPLICANT' = any (p_assigned)
  ) r
  join users u on u.id = r.user_id and u.is_active
  -- Applicants get only APPLICANT_* kinds, and those go only to applicants
  where (u.role::text = 'APPLICANT') = v_applicant_kind
    and not (p_skip_actor and r.user_id is not distinct from v_actor)  -- v_actor is null for the worker / service role
    and not (p_dedupe and exists (select 1 from notifications n
                                  where n.recipient_id = r.user_id and n.kind = p_kind and n.read_at is null
                                    and n.application_id is not distinct from p_application_id));

  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke execute on function public.send_notification(text, text, text, bigint, uuid[], text[], text[], text, text, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.send_notification(text, text, text, bigint, uuid[], text[], text[], text, text, boolean, boolean)
  to service_role;

-- Mark my notifications read (p_ids null = all of them). Returns how many changed.
create or replace function public.mark_notifications_read(p_ids bigint[] default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  update notifications set read_at = now()
  where recipient_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke execute on function public.mark_notifications_read(bigint[]) from public, anon;
grant execute on function public.mark_notifications_read(bigint[]) to authenticated;

-- ============================================================
-- 5. Triggers on the workflow tables
-- ============================================================
-- Stage opened / returned / Done reverted (stage_status_changes: the first row of a visit = stage opened)
create or replace function public.notify_on_stage_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_visit application_stages;
  v_prev text;
  v_no text;
  v_stage text;
  v_roles text[];
  v_assigned text[];
begin
  begin
    select * into v_visit from application_stages where id = new.stage_visit_id;
    v_stage := v_visit.stage::text;
    v_no := notification_app_no(v_visit.application_id);
    select status::text into v_prev from stage_status_changes
    where stage_visit_id = new.stage_visit_id and id <> new.id
    order by changed_at desc, id desc limit 1;

    -- Who owns the stage
    v_assigned := case v_stage when 'INTAKE' then array['ACCOUNT_OFFICER']
                               when 'CREDIT_INVESTIGATION' then array['ACCOUNT_OFFICER']
                               when 'CREDIT_EVALUATION' then array['CREDIT_OFFICER']
                               when 'REVIEW' then array['REVIEWER']
                               when 'APPROVAL' then array['APPROVER'] end;
    v_roles := case when v_stage = 'CREDIT_INVESTIGATION' then array['CREDIT_INVESTIGATOR'] end;

    if new.status::text = 'RETURNED' and v_prev is distinct from 'RETURNED' then
      perform send_notification('STAGE_RETURNED', v_no || ' was returned to ' || stage_label(v_stage),
        left(new.note, 500), v_visit.application_id, p_roles => v_roles, p_assigned => v_assigned);

    elsif v_prev = 'DONE' and new.status::text <> 'DONE' then
      perform send_notification('DONE_REVERTED', v_no || ': ' || stage_label(v_stage) || ' is no longer Done',
        left(new.note, 500), v_visit.application_id,
        p_roles => coalesce(v_roles, '{}') || array['DISPATCH_ADMIN'], p_assigned => v_assigned);

    elsif v_prev is null then
      if v_stage = 'INTAKE' then
        perform send_notification('NEW_APPLICATION', 'New application ' || v_no || ' is in the work tray',
          'Open the work tray to claim it.', v_visit.application_id, p_roles => array['ACCOUNT_OFFICER']);
      elsif v_stage = 'CREDIT_EVALUATION' then
        if exists (select 1 from application_assignments where application_id = v_visit.application_id
                   and assignee_role = 'CREDIT_OFFICER' and unassigned_at is null) then
          perform send_notification('STAGE_CREDIT_EVALUATION', v_no || ' is ready for credit evaluation', null,
            v_visit.application_id, p_assigned => array['CREDIT_OFFICER']);
        else
          perform send_notification('STAGE_CREDIT_EVALUATION', v_no || ' is ready for credit evaluation',
            'No Credit Officer is assigned yet.', v_visit.application_id, p_roles => array['DISPATCH_ADMIN']);
        end if;
      elsif v_stage = 'APPROVAL' then
        perform send_notification('APPROVAL_ROUTED', v_no || ' is ready for your approval', null,
          v_visit.application_id, p_assigned => array['APPROVER']);
      elsif v_stage = 'DECIDED' then
        perform send_notification('DECIDED', 'A decision was recorded on ' || v_no, null, v_visit.application_id,
          p_roles => array['DISPATCH_ADMIN'], p_assigned => array['ACCOUNT_OFFICER', 'CREDIT_OFFICER']);
      end if;
      -- Credit Investigation and Review: notified by notify_ci_request / notify_review_routing
    end if;
  exception when others then
    raise warning 'notify_stage_status failed: %', sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists notify_stage_status on public.stage_status_changes;
create trigger notify_stage_status after insert on public.stage_status_changes
  for each row execute function public.notify_on_stage_status();

-- AO / CO assigned or removed by someone else (claiming / releasing yourself sends nothing)
create or replace function public.notify_on_assignment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_no text;
  v_role text := case new.assignee_role::text when 'ACCOUNT_OFFICER' then 'Account Officer' else 'Credit Officer' end;
begin
  begin
    v_no := notification_app_no(new.application_id);
    if tg_op = 'INSERT' and new.assigned_by <> new.user_id then
      perform send_notification('ASSIGNED', 'You were assigned to ' || v_no || ' as ' || v_role,
        'By ' || coalesce(staff_name(new.assigned_by), 'a head'), new.application_id, p_users => array[new.user_id]);
    elsif tg_op = 'UPDATE' and old.unassigned_at is null and new.unassigned_at is not null
          and new.unassigned_by is distinct from new.user_id then
      perform send_notification('UNASSIGNED', 'You were removed from ' || v_no || ' as ' || v_role,
        'By ' || coalesce(staff_name(new.unassigned_by), 'a head'), new.application_id, p_users => array[new.user_id],
        p_link => '/adminHomePage');
    end if;
  exception when others then
    raise warning 'notify_assignment failed: %', sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists notify_assignment on public.application_assignments;
create trigger notify_assignment after insert or update on public.application_assignments
  for each row execute function public.notify_on_assignment();

-- CI request -> every active Credit Investigator
create or replace function public.notify_on_ci_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform send_notification('CI_REQUESTED', 'CI requested for ' || notification_app_no(new.application_id),
      'Requested by ' || coalesce(staff_name(new.requested_by), 'the Account Officer') || '. Open the NFIS / TU request.',
      new.application_id, p_roles => array['CREDIT_INVESTIGATOR']);
  exception when others then
    raise warning 'notify_ci_request failed: %', sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists notify_ci_request on public.ci_requests;
create trigger notify_ci_request after insert on public.ci_requests
  for each row execute function public.notify_on_ci_request();

-- Credit Result saved as Deferred -> assigned AO
create or replace function public.notify_on_credit_result() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.credit_result::text = 'DEFERRED'
       and (tg_op = 'INSERT' or old.credit_result is distinct from new.credit_result) then
      perform send_notification('CREDIT_RESULT_DEFERRED',
        notification_app_no(new.application_id) || ' was deferred by the Credit Officer',
        'See the Credit Result and deferrals in the Financial Package.', new.application_id,
        p_assigned => array['ACCOUNT_OFFICER'], p_link => '/financialPackagePage?id=' || new.application_id);
    end if;
  exception when others then
    raise warning 'notify_credit_result failed: %', sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists notify_credit_result on public.financial_packages;
create trigger notify_credit_result after insert or update of credit_result on public.financial_packages
  for each row execute function public.notify_on_credit_result();

-- The assigned AO changed a file whose Credit Result is Deferred -> assigned CO (one unread at a time)
create or replace function public.notify_on_deferred_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.changed_by is not null
       -- status-only changes come from the stage RPCs, not from the AO's edits
       and not (new.table_name = 'loan_applications'
                and coalesce(new.new_data, '{}') - 'status' - 'submitted_at' - 'application_no' = '{}'::jsonb)
       and exists (select 1 from application_assignments where application_id = new.application_id
                   and assignee_role = 'ACCOUNT_OFFICER' and unassigned_at is null and user_id = new.changed_by)
       and exists (select 1 from financial_packages where application_id = new.application_id
                   and credit_result::text = 'DEFERRED') then
      perform send_notification('DEFERRED_ACCOUNT_UPDATED',
        'The Account Officer updated deferred ' || notification_app_no(new.application_id),
        'The changes are in the loan folder''s change history.', new.application_id,
        p_assigned => array['CREDIT_OFFICER'], p_link => '/loanFolderPage?id=' || new.application_id,
        p_dedupe => true);
    end if;
  exception when others then
    raise warning 'notify_deferred_update failed: %', sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists notify_deferred_update on public.audit_log;
create trigger notify_deferred_update after insert on public.audit_log
  for each row execute function public.notify_on_deferred_update();

-- Reviewers routed / removed; approvers only once the file is in Approval (else when Approval opens)
create or replace function public.notify_on_review_routing() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_no text;
  v_stage text;
  v_label text := case new.assignee_role::text when 'REVIEWER' then 'reviewer' else 'approver' end;
begin
  begin
    v_no := notification_app_no(new.application_id);
    select stage::text into v_stage from application_stages
    where application_id = new.application_id and left_at is null;

    if tg_op = 'INSERT' then
      if new.assignee_role::text = 'REVIEWER' then
        perform send_notification('REVIEW_ROUTED',
          case when v_stage in ('REVIEW', 'APPROVAL')
               then 'You were added as reviewer ' || new.seq || ' on ' || v_no
               else v_no || ' was sent to you for review (you are reviewer ' || new.seq || ')' end,
          'By ' || coalesce(staff_name(new.assigned_by), 'the Credit Officer'), new.application_id,
          p_users => array[new.user_id], p_link => '/reviewSummaryPage?id=' || new.application_id);
      elsif v_stage = 'APPROVAL' then
        perform send_notification('APPROVAL_ROUTED', 'You were added as approver on ' || v_no,
          'By ' || coalesce(staff_name(new.assigned_by), 'a head'), new.application_id,
          p_users => array[new.user_id], p_link => '/reviewSummaryPage?id=' || new.application_id);
      end if;
    elsif tg_op = 'UPDATE' and old.unassigned_at is null and new.unassigned_at is not null
          and (new.assignee_role::text = 'REVIEWER' or v_stage = 'APPROVAL') then
      perform send_notification('REVIEW_UNROUTED', 'You were removed as ' || v_label || ' on ' || v_no,
        'By ' || coalesce(staff_name(new.unassigned_by), 'a head'), new.application_id,
        p_users => array[new.user_id], p_link => '/adminHomePage');
    end if;
  exception when others then
    raise warning 'notify_review_routing failed: %', sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists notify_review_routing on public.review_assignments;
create trigger notify_review_routing after insert or update on public.review_assignments
  for each row execute function public.notify_on_review_routing();

-- Applicant-facing status: only the four buckets, never internal detail
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
    elsif new.status::text = 'DEFERRED' and old.status::text <> 'DEFERRED' then
      v_kind := 'APPLICANT_DEFERRED';
    elsif v_new is distinct from v_old then
      v_kind := case v_new when 'SUBMITTED' then 'APPLICANT_SUBMITTED' when 'UNDER_REVIEW' then 'APPLICANT_UNDER_REVIEW'
                           when 'DECISION' then 'APPLICANT_DECISION' end;
    end if;

    v_title := case v_kind
      when 'APPLICANT_SUBMITTED' then 'We received your application ' || v_no
      when 'APPLICANT_UNDER_REVIEW' then 'Your application ' || v_no || ' is under review'
      when 'APPLICANT_INCOMPLETE' then 'Your application ' || v_no || ' needs more information'
      when 'APPLICANT_DEFERRED' then 'Your application ' || v_no || ' needs more information'
      when 'APPLICANT_DECISION' then 'A decision has been made on your application ' || v_no end;
    v_body := case v_kind
      when 'APPLICANT_SUBMITTED' then 'Status: Submitted. We will let you know when it moves forward.'
      when 'APPLICANT_UNDER_REVIEW' then 'Status: Under review.'
      when 'APPLICANT_DECISION' then 'Your Account Officer will contact you about the next steps.'
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

drop trigger if exists notify_applicant_status on public.loan_applications;
create trigger notify_applicant_status after update of status on public.loan_applications
  for each row when (old.status is distinct from new.status)
  execute function public.notify_on_applicant_status();

-- Trigger functions aren't for clients
revoke execute on function public.notify_on_stage_status() from public, anon, authenticated;
revoke execute on function public.notify_on_assignment() from public, anon, authenticated;
revoke execute on function public.notify_on_ci_request() from public, anon, authenticated;
revoke execute on function public.notify_on_credit_result() from public, anon, authenticated;
revoke execute on function public.notify_on_deferred_update() from public, anon, authenticated;
revoke execute on function public.notify_on_review_routing() from public, anon, authenticated;
revoke execute on function public.notify_on_applicant_status() from public, anon, authenticated;

-- ============================================================
-- 6. Realtime: new rows reach the browser instantly (RLS still applies)
-- ============================================================
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
