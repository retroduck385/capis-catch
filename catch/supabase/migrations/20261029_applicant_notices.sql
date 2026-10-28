-- CATCH — Applicant outcome notices, sent by the Account Officer (the bank's answers to Q-42, visit 2026-10-26)
-- Run after 20261028_messages.sql. Re-runnable, no drops of data.
--
-- What it does
--   * The applicant is told the outcome (Approved / Rejected / Deferred) and a reason, by the assigned AO, not automatically:
--     send_applicant_notice(app, reason). Rejected: the policy they most likely didn't pass. Deferred: what's missing.
--     Approved: the reason is optional (default: "Your Account Officer will contact you about the next steps.").
--     One notice per outcome, plus corrections. Every notice is kept: applicant_notices is append-only (like messages).
--   * Each notice goes in-app (send_notification, kind APPLICANT_OUTCOME), and is queued for SMS and email in
--     applicant_notice_deliveries. The notice-service worker (service role) sends them; it logs instead of sending until
--     it is switched to live. SMS and email never contain a link: send_applicant_notice() refuses a reason with one.
--     Staff notifications stay in-app only.
--   * Applicants see Approved / Rejected / Deferred only after the AO has sent the notice for that outcome; until then
--     "Under review" (my_application_statuses()). FOR_CLARIFICATION stays "Incomplete submission".
--   * The automatic APPLICANT_DECISION / APPLICANT_DEFERRED notices (built 20261024, switched off, never sent) are removed.
--     The other automatic applicant notices (Submitted, Under review, Incomplete submission) are unchanged.
--   * Changes three of 20261024_notifications.sql's own functions (applicant_status_bucket, applicant_notification_kinds,
--     notify_on_applicant_status). No groupmate function, migration or trigger is changed.
--
-- Who can do what
--   send_applicant_notice / preview_applicant_notice   the assigned Account Officer only (active application_assignments),
--                                                      once the status is APPROVED, REJECTED or DEFERRED
--   applicant_notice_context(app)                      staff who can read the file: outcome, reason suggestions, masked
--                                                      destinations, earlier notices and their delivery status
--   my_application_statuses()                          the applicant: their own applications and what they may see
--   claim_notice_deliveries / finish_notice_delivery   the service role (notice-service worker) only
--
-- Reasons: nothing records an approver's reason or a policy flag yet (no approver decision step, no RAG / MRAC).
--   The AO gets suggestions from what exists (FP V. Exceptions, the CO's justification and deferrals, KYC checks marked
--   Needs clarification, required documents not uploaded) and writes the final text: plain text, at most 300 characters.
--   Link check (notice_link_in): http(s)://, www., email addresses and names ending in a common top-level domain
--   (example.com, bit.ly, x.com.ph). Abbreviations without a space ("St.Francis", "Brgy.Malate") pass.
--
-- Run order / re-runs
--   * Needs 20260928 .. 20261024_notifications.sql (the file stops with an error naming what's missing).
--   * Re-running 20261024_notifications.sql puts its old versions of the three functions back: run this file again after it.
--   * Re-running 20260928_application_side.sql drops loan_applications / users with CASCADE: this file's trigger and foreign
--     keys go. Run every later migration in order, then this file: it puts them back and removes notices and deliveries
--     whose application no longer exists (the only delete its guards allow, and only inside this file as the table owner).
--   * Nothing sets APPROVED / REJECTED / DEFERRED yet (no approver decision step). This file only reacts to the status.

-- ============================================================
-- 0. Dependencies: stop before creating anything if an earlier migration is missing
-- ============================================================
do $$
declare
  v_missing text;
begin
  select string_agg(distinct m, ', ') into v_missing
  from (values ('public.loan_applications', '20260928_application_side.sql'),
               ('public.application_requirements', '20260928_application_side.sql'),
               ('public.application_assignments', '20261005_work_tray.sql'),
               ('public.kyc_checks', '20261007_ao_kyc_verification.sql'),
               ('public.financial_packages', '20261020_financial_package.sql'),
               ('public.fp_exceptions', '20261020_financial_package.sql'),
               ('public.notifications', '20261024_notifications.sql')) d (t, m)
  where to_regclass(t) is null;
  if v_missing is null and to_regprocedure('public.send_notification(text, text, text, bigint, uuid[], text[], '
                                           'text[], text, text, boolean, boolean)') is null then
    v_missing := '20261024_notifications.sql';
  end if;
  if v_missing is not null then
    raise exception 'Run these migrations first, then this file again: %', v_missing;
  end if;
end $$;

-- ============================================================
-- 1. What the applicant sees (replaces the 20261024 versions)
-- ============================================================
create or replace function public.applicant_status_bucket(p_status text)
returns text language sql immutable as $$
  select case
    when p_status = 'SUBMITTED' then 'SUBMITTED'
    when p_status = 'FOR_CLARIFICATION' then 'INCOMPLETE'
    when p_status in ('UNDER_CI', 'UNDER_CREDIT_EVALUATION', 'UNDER_REVIEW', 'FOR_APPROVAL') then 'UNDER_REVIEW'
    when p_status in ('APPROVED', 'REJECTED', 'DEFERRED') then p_status end;
$$;

-- The only kinds an applicant can receive (APPLICANT_DECISION / APPLICANT_DEFERRED were never sent: switched off)
create or replace function public.applicant_notification_kinds()
returns text[] language sql immutable as $$
  select array['APPLICANT_SUBMITTED', 'APPLICANT_UNDER_REVIEW', 'APPLICANT_INCOMPLETE', 'APPLICANT_OUTCOME'];
$$;

delete from public.notification_switches where kind in ('APPLICANT_DECISION', 'APPLICANT_DEFERRED');

-- Automatic applicant notices: Submitted, Under review, Incomplete submission. Outcomes are sent by the AO.
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
-- 2. Tables
-- ============================================================
-- Plain text types (not application_status / user_role) so a re-run of 20260928 can't cascade into them.

-- One row each time the status changes INTO an outcome. A notice belongs to one of these.
create table if not exists public.applicant_outcomes (
  id bigint generated always as identity primary key,
  application_id bigint not null,
  status text not null check (status in ('APPROVED', 'REJECTED', 'DEFERRED')),
  set_at timestamptz not null default now(),
  set_by uuid                -- whoever changed the status (null = SQL Editor / service role)
);
create index if not exists applicant_outcomes_application on public.applicant_outcomes (application_id, id);

-- What the applicant was told, by whom. Append-only.
create table if not exists public.applicant_notices (
  id bigint generated always as identity primary key,
  application_id bigint not null,
  outcome_id bigint not null,
  outcome text not null check (outcome in ('APPROVED', 'REJECTED', 'DEFERRED')),
  reason text check (reason = btrim(reason) and length(reason) between 1 and 300),
  correction_of bigint,
  in_app_title text not null,
  in_app_body text not null,
  sms_text text not null,
  email_subject text not null,
  email_body text not null,
  sent_by uuid not null,
  sent_role text not null,
  sent_at timestamptz not null default now(),
  check (outcome = 'APPROVED' or reason is not null)
);
create index if not exists applicant_notices_application on public.applicant_notices (application_id, id);
create unique index if not exists one_first_notice_per_outcome
  on public.applicant_notices (outcome_id) where correction_of is null;

-- One row per channel; the worker updates the status. Never deleted.
create table if not exists public.applicant_notice_deliveries (
  id bigint generated always as identity primary key,
  notice_id bigint not null,
  channel text not null check (channel in ('SMS', 'EMAIL')),
  destination text,          -- normalised; null = nowhere to send (status SKIPPED)
  subject text,
  body text not null,
  status text not null default 'QUEUED' check (status in ('QUEUED', 'RUNNING', 'LOGGED', 'SENT', 'FAILED', 'SKIPPED')),
  attempts smallint not null default 0,
  provider text,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  finished_at timestamptz,
  unique (notice_id, channel)
);
create index if not exists notice_deliveries_queue on public.applicant_notice_deliveries (id) where status in ('QUEUED', 'RUNNING');

-- ============================================================
-- 3. Append-only guards (everyone, owner and service role included)
-- ============================================================
-- The one exception: section 4, run by the table owner inside this file, removes rows whose application no longer
-- exists (after a 20260928 re-run). It sets catch.notices_purge for its own transaction.
create or replace function public.applicant_notices_append_only() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE'
     and current_setting('catch.notices_purge', true) = 'orphans'
     and current_user not in ('anon', 'authenticated', 'service_role')
     and not exists (select 1 from loan_applications la where la.id = old.application_id) then
    return old;
  end if;
  raise exception 'Applicant notices can''t be edited or deleted (append-only record of what the applicant was told)';
end $$;

create or replace function public.notice_deliveries_no_delete() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE'
     and current_setting('catch.notices_purge', true) = 'orphans'
     and current_user not in ('anon', 'authenticated', 'service_role')
     and not exists (select 1 from applicant_notices n join loan_applications la on la.id = n.application_id
                     where n.id = old.notice_id) then
    return old;
  end if;
  raise exception 'Notice deliveries can''t be deleted';
end $$;

revoke execute on function public.applicant_notices_append_only() from public, anon, authenticated;
revoke execute on function public.notice_deliveries_no_delete() from public, anon, authenticated;

drop trigger if exists applicant_notices_append_only on public.applicant_notices;
create trigger applicant_notices_append_only before update or delete on public.applicant_notices
  for each row execute function public.applicant_notices_append_only();
drop trigger if exists applicant_notices_no_truncate on public.applicant_notices;
create trigger applicant_notices_no_truncate before truncate on public.applicant_notices
  for each statement execute function public.applicant_notices_append_only();

drop trigger if exists notice_deliveries_no_delete on public.applicant_notice_deliveries;
create trigger notice_deliveries_no_delete before delete on public.applicant_notice_deliveries
  for each row execute function public.notice_deliveries_no_delete();
drop trigger if exists notice_deliveries_no_truncate on public.applicant_notice_deliveries;
create trigger notice_deliveries_no_truncate before truncate on public.applicant_notice_deliveries
  for each statement execute function public.notice_deliveries_no_delete();

-- ============================================================
-- 4. Foreign keys, added by name so a re-run puts them back after 20260928 dropped them
-- ============================================================
do $$
declare
  v_notices integer;
  v_deliveries integer;
begin
  perform set_config('catch.notices_purge', 'orphans', true);
  delete from public.applicant_notice_deliveries d
  where not exists (select 1 from public.applicant_notices n join public.loan_applications la on la.id = n.application_id
                    where n.id = d.notice_id);
  get diagnostics v_deliveries = row_count;
  delete from public.applicant_notices n
  where not exists (select 1 from public.loan_applications la where la.id = n.application_id);
  get diagnostics v_notices = row_count;
  perform set_config('catch.notices_purge', '', true);
  if v_notices + v_deliveries > 0 then
    raise notice 'Removed % notice(s) and % delivery row(s) whose application no longer exists', v_notices, v_deliveries;
  end if;
  delete from public.applicant_outcomes o
  where not exists (select 1 from public.loan_applications la where la.id = o.application_id);

  if not exists (select 1 from pg_constraint where conname = 'applicant_outcomes_application_fk') then
    alter table public.applicant_outcomes add constraint applicant_outcomes_application_fk
      foreign key (application_id) references public.loan_applications(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'applicant_notices_application_fk') then
    alter table public.applicant_notices add constraint applicant_notices_application_fk
      foreign key (application_id) references public.loan_applications(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'applicant_notices_outcome_fk') then
    alter table public.applicant_notices add constraint applicant_notices_outcome_fk
      foreign key (outcome_id) references public.applicant_outcomes(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'applicant_notices_correction_fk') then
    alter table public.applicant_notices add constraint applicant_notices_correction_fk
      foreign key (correction_of) references public.applicant_notices(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'applicant_notices_sender_fk') then
    if exists (select 1 from public.applicant_notices n where not exists (select 1 from public.users u where u.id = n.sent_by)) then
      raise notice 'applicant_notices_sender_fk not added: some senders no longer exist';
    else
      alter table public.applicant_notices add constraint applicant_notices_sender_fk
        foreign key (sent_by) references public.users(id);
    end if;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notice_deliveries_notice_fk') then
    alter table public.applicant_notice_deliveries add constraint notice_deliveries_notice_fk
      foreign key (notice_id) references public.applicant_notices(id) on delete restrict;
  end if;
end $$;

-- ============================================================
-- 5. Outcome events (own trigger on loan_applications; a failure never blocks the status change)
-- ============================================================
create or replace function public.record_applicant_outcome() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into applicant_outcomes (application_id, status, set_by) values (new.id, new.status::text, auth.uid());
  exception when others then
    raise warning 'record_applicant_outcome failed: %', sqlerrm;
  end;
  return null;
end $$;

revoke execute on function public.record_applicant_outcome() from public, anon, authenticated;

drop trigger if exists applicant_outcome_event on public.loan_applications;
create trigger applicant_outcome_event after update of status on public.loan_applications
  for each row when (old.status is distinct from new.status and new.status::text in ('APPROVED', 'REJECTED', 'DEFERRED'))
  execute function public.record_applicant_outcome();

-- Applications already in an outcome when this file runs get their event now
insert into public.applicant_outcomes (application_id, status)
select la.id, la.status::text from public.loan_applications la
where la.status::text in ('APPROVED', 'REJECTED', 'DEFERRED')
  and not exists (select 1 from public.applicant_outcomes o where o.application_id = la.id and o.status = la.status::text);

-- ============================================================
-- 6. RLS: staff who can read the file see its outcomes and notices; nobody reads deliveries directly; no client writes
-- ============================================================
alter table public.applicant_outcomes enable row level security;
alter table public.applicant_notices enable row level security;
alter table public.applicant_notice_deliveries enable row level security;
revoke insert, update, delete, truncate on public.applicant_outcomes from anon, authenticated;
revoke insert, update, delete, truncate on public.applicant_notices from anon, authenticated;
revoke all on public.applicant_notice_deliveries from anon, authenticated;

drop policy if exists "staff read outcomes" on public.applicant_outcomes;
create policy "staff read outcomes" on public.applicant_outcomes
  for select to authenticated using (public.staff_can_access(application_id));

drop policy if exists "staff read applicant notices" on public.applicant_notices;
create policy "staff read applicant notices" on public.applicant_notices
  for select to authenticated using (public.staff_can_access(application_id));

-- ============================================================
-- 7. Helpers: link check, contact details, text
-- ============================================================
-- The part of the text that looks like a link, or null. Catches http(s)://, www., email addresses and names that end in
-- a common top-level domain. "St.Francis" / "Brgy.Malate" pass because Francis / Malate aren't top-level domains.
create or replace function public.notice_link_in(p_text text)
returns text language sql immutable as $$
  select coalesce(
    (regexp_match(p_text, '(https?://[^[:space:]]*|https?:[^[:space:]]*)', 'i'))[1],
    (regexp_match(p_text, '(\mwww\.[^[:space:]]*)', 'i'))[1],
    (regexp_match(p_text, '([a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+)', 'i'))[1],
    (regexp_match(p_text,
       '(\m([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+(com|net|org|ph|gov|edu|io|co|me|info|biz|app|dev|xyz|ly|gl|to|us|uk|sg'
       '|ai|tv|cc|asia|site|online|link|click|shop)\M(/[^[:space:]]*)?)', 'i'))[1]);
$$;

-- Philippine mobile numbers as +639XXXXXXXXX (09.., 639.., 9.., with spaces / dashes); anything else = null
create or replace function public.notice_sms_number(p_number text)
returns text language sql immutable as $$
  select case when d ~ '^09[0-9]{9}$' then '+63' || substr(d, 2)
              when d ~ '^639[0-9]{9}$' then '+' || d
              when d ~ '^9[0-9]{9}$' then '+63' || d end
  from (select regexp_replace(coalesce(p_number, ''), '[^0-9]', '', 'g') as d) x;
$$;

create or replace function public.notice_email_address(p_email text)
returns text language sql immutable as $$
  select case when btrim(p_email) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then lower(btrim(p_email)) end;
$$;

-- Where the principal borrower is reached: their mobile; their email, else the login email
create or replace function public.notice_destinations(p_application_id bigint)
returns table (sms text, email text) language sql stable security definer set search_path = public as $$
  select notice_sms_number(a.mobile_number),
         coalesce(notice_email_address(a.email_address), notice_email_address(au.email))
  from loan_applications la
  left join applicants a on a.application_id = la.id and a.role = 'PRINCIPAL'
  left join auth.users au on au.id = la.user_id
  where la.id = p_application_id;
$$;

create or replace function public.notice_mask(p_value text)
returns text language sql immutable as $$
  select case when p_value is null then null
              when p_value like '%@%' then left(p_value, 1) || '•••@' || split_part(p_value, '@', 2)
              else '•••' || right(p_value, 4) end;
$$;

-- The exact texts for every channel. No links, no portal, no names, never the bank's name.
create or replace function public.compose_applicant_notice(p_app_no text, p_outcome text, p_reason text,
                                                          p_correction boolean default false)
returns table (in_app_title text, in_app_body text, sms_text text, email_subject text, email_body text)
language sql immutable as $$
  with t as (
    select initcap(p_outcome) as label,
           nullif(btrim(p_reason), '') as reason,
           case p_outcome when 'APPROVED' then 'Note: ' when 'REJECTED' then 'Reason: ' else 'What we need: ' end as reason_label
  ), b as (
    select label, reason,
           case when reason is null then 'Your Account Officer will contact you about the next steps.'
                else reason_label || reason || case when right(reason, 1) in ('.', '!', '?') then '' else '.' end
                     || ' Your Account Officer will contact you.' end as tail
    from t
  )
  select (case when p_correction then 'Correction: your application ' else 'Your application ' end) || p_app_no || ': ' || label,
         'Status: ' || label || '. ' || tail,
         'CATCH: ' || (case when p_correction then 'Correction. ' else '' end) || 'Update on your housing loan application '
           || p_app_no || '. Status: ' || label || '. ' || tail,
         'CATCH: ' || (case when p_correction then 'Correction: ' else '' end) || 'Update on your housing loan application ' || p_app_no,
         concat_ws(E'\n',
           'Good day,', '',
           'This is an update on your housing loan application ' || p_app_no || '.',
           case when p_correction then 'It corrects our earlier message about this application.' end,
           '',
           'Status: ' || label,
           tail, '',
           'This is an automated message from CATCH. Please do not reply to this email.')
  from b;
$$;

revoke execute on function public.notice_destinations(bigint) from public, anon, authenticated;

-- The signed-in user is the assigned Account Officer of this file
create or replace function public.notice_is_assigned_ao(p_application_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(current_user_role()::text = 'ACCOUNT_OFFICER' and exists (
    select 1 from application_assignments aa
    where aa.application_id = p_application_id and aa.user_id = auth.uid()
      and aa.assignee_role::text = 'ACCOUNT_OFFICER' and aa.unassigned_at is null), false);
$$;

-- The outcome event the current status belongs to (null if the status isn't an outcome)
create or replace function public.current_applicant_outcome(p_application_id bigint)
returns bigint language sql stable security definer set search_path = public as $$
  select o.id from loan_applications la
  join applicant_outcomes o on o.application_id = la.id and o.status = la.status::text
  where la.id = p_application_id
  order by o.id desc limit 1;
$$;

-- What the applicant may see: an outcome only once its notice was sent, else Under review
create or replace function public.applicant_visible_status(p_application_id bigint)
returns text language sql stable security definer set search_path = public as $$
  select case when applicant_status_bucket(la.status::text) in ('APPROVED', 'REJECTED', 'DEFERRED')
                   and not exists (select 1 from applicant_notices n
                                   where n.outcome_id = current_applicant_outcome(la.id))
              then 'UNDER_REVIEW'
              else applicant_status_bucket(la.status::text) end
  from loan_applications la where la.id = p_application_id;
$$;

revoke execute on function public.notice_is_assigned_ao(bigint) from public, anon, authenticated;
revoke execute on function public.current_applicant_outcome(bigint) from public, anon, authenticated;
revoke execute on function public.applicant_visible_status(bigint) from public, anon, authenticated;

-- The applicant's own applications: raw status, what they may see, whether the outcome notice was sent
create or replace function public.my_application_statuses()
returns table (application_id bigint, status text, visible_status text, notice_sent boolean)
language sql stable security definer set search_path = public as $$
  select la.id, la.status::text, case when la.status::text = 'DRAFT' then 'DRAFT' else applicant_visible_status(la.id) end,
         exists (select 1 from applicant_notices n where n.outcome_id = current_applicant_outcome(la.id))
  from loan_applications la where la.user_id = auth.uid()
  order by la.id;
$$;

revoke execute on function public.my_application_statuses() from public, anon;
grant execute on function public.my_application_statuses() to authenticated;

-- ============================================================
-- 8. The AO's panel: context, preview, send
-- ============================================================
-- Reason suggestions from what exists today (internal staff text: the AO rewrites it for the applicant)
create or replace function public.notice_reason_suggestions(p_application_id bigint, p_outcome text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('source', s.source, 'text', s.text) order by s.ord), '[]'::jsonb)
  from (
    select 1 as ord, 'Financial Package V. Exceptions: policy' as source, btrim(e.policy) as text
    from fp_exceptions e
    where e.application_id = p_application_id and p_outcome = 'REJECTED' and nullif(btrim(e.policy), '') is not null
    union all
    select 2, 'Credit Officer justification (' || initcap(replace(fp.credit_result::text, '_', ' ')) || ')', btrim(fp.justification)
    from financial_packages fp
    where fp.application_id = p_application_id and p_outcome in ('REJECTED', 'DEFERRED')
      and nullif(btrim(fp.justification), '') is not null
    union all
    select 3, 'Credit Officer deferrals (Financial Package)', btrim(fp.deferrals)
    from financial_packages fp
    where fp.application_id = p_application_id and p_outcome = 'DEFERRED' and nullif(btrim(fp.deferrals), '') is not null
    union all
    select 4, 'KYC check marked Needs clarification: ' || k.section, btrim(k.remarks)
    from (select distinct on (section) section, result, remarks from kyc_checks
          where application_id = p_application_id order by section, checked_at desc, id desc) k
    where p_outcome = 'DEFERRED' and k.result::text = 'NEEDS_CLARIFICATION' and nullif(btrim(k.remarks), '') is not null
    union all
    select 5, 'Required documents not uploaded',
           'Missing documents: ' || string_agg(m.label, ', ' order by m.label)
    from (select requirement_label(ar.requirement_type) || ' (' ||
                 case a.role::text when 'PRINCIPAL' then 'principal borrower' when 'SPOUSE' then 'spouse'
                      when 'CO_BORROWER' then 'co-borrower ' || a.party_no else lower(a.role::text) end || ')' as label
          from application_requirements ar
          join applicants a on a.id = ar.applicant_id and a.application_id = p_application_id
          left join documents d on d.requirement_id = ar.id
          group by ar.id, ar.requirement_type, a.role, a.party_no
          having count(d.id) < required_document_min(ar.requirement_type)) m
    where p_outcome = 'DEFERRED'
    having count(*) > 0
  ) s;
$$;

revoke execute on function public.notice_reason_suggestions(bigint, text) from public, anon, authenticated;

create or replace function public.applicant_notice_context(p_application_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_status text;
  v_outcome bigint;
  v_dest record;
  v_why text;
  v_sent boolean;
begin
  if not staff_can_access(p_application_id) then
    raise exception 'You don''t have access to this application';
  end if;
  select status::text into v_status from loan_applications where id = p_application_id;
  v_outcome := current_applicant_outcome(p_application_id);
  v_sent := exists (select 1 from applicant_notices where outcome_id = v_outcome);
  select * into v_dest from notice_destinations(p_application_id);

  -- A missing outcome row (the trigger failed, warning only) doesn't stop the AO: send_applicant_notice() records it
  v_why := case
    when v_status not in ('APPROVED', 'REJECTED', 'DEFERRED')
      then 'The notice can be sent once the application is Approved, Rejected or Deferred.'
    when not notice_is_assigned_ao(p_application_id) then 'Only the assigned Account Officer can send this notice.' end;

  return jsonb_build_object(
    'application_no', notification_app_no(p_application_id),
    'status', v_status,
    'outcome', case when v_status in ('APPROVED', 'REJECTED', 'DEFERRED') then v_status end,
    'can_send', v_why is null,
    'why_not', v_why,
    'already_sent', v_sent,
    'reason_required', v_status in ('REJECTED', 'DEFERRED'),
    'max_length', 300,
    'sms_to', notice_mask(v_dest.sms),
    'email_to', notice_mask(v_dest.email),
    'suggestions', case when v_why is null then notice_reason_suggestions(p_application_id, v_status) else '[]'::jsonb end,
    'notices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.id, 'outcome', n.outcome, 'reason', n.reason, 'correction_of', n.correction_of,
        'sent_at', n.sent_at, 'sent_by', staff_name(n.sent_by),
        'in_app_body', n.in_app_body, 'sms_text', n.sms_text,
        'deliveries', (select coalesce(jsonb_agg(jsonb_build_object(
                         'channel', d.channel, 'to', notice_mask(d.destination), 'status', d.status,
                         'attempts', d.attempts, 'error', d.last_error, 'finished_at', d.finished_at) order by d.channel), '[]'::jsonb)
                       from applicant_notice_deliveries d where d.notice_id = n.id))
        order by n.id desc)
      from applicant_notices n where n.application_id = p_application_id), '[]'::jsonb));
end $$;

-- Checks a reason (null = fine), shared by preview and send
create or replace function public.notice_reason_problem(p_outcome text, p_reason text)
returns text language plpgsql immutable as $$
declare
  v_reason text := nullif(btrim(p_reason), '');
  v_link text;
begin
  if v_reason is null and p_outcome in ('REJECTED', 'DEFERRED') then
    return case p_outcome when 'REJECTED' then 'Write the reason: the policy the applicant most likely didn''t pass.'
                          else 'Write what is missing.' end;
  end if;
  if length(v_reason) > 300 then
    return 'The reason is ' || length(v_reason) || ' characters; the limit is 300.';
  end if;
  v_link := notice_link_in(v_reason);
  if v_link is not null then
    return 'SMS and email can''t contain links. This part looks like a link: "' || left(v_link, 60) || '"';
  end if;
  return null;
end $$;

create or replace function public.preview_applicant_notice(p_application_id bigint, p_reason text, p_correction boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_status text;
  v_c record;
begin
  if not notice_is_assigned_ao(p_application_id) then
    raise exception 'Only the assigned Account Officer can send this notice';
  end if;
  select status::text into v_status from loan_applications where id = p_application_id;
  if v_status not in ('APPROVED', 'REJECTED', 'DEFERRED') then
    raise exception 'The notice can be sent once the application is Approved, Rejected or Deferred';
  end if;
  select * into v_c from compose_applicant_notice(notification_app_no(p_application_id), v_status, p_reason, p_correction);
  return jsonb_build_object('problem', notice_reason_problem(v_status, p_reason), 'in_app_title', v_c.in_app_title,
    'in_app_body', v_c.in_app_body, 'sms_text', v_c.sms_text, 'email_subject', v_c.email_subject, 'email_body', v_c.email_body);
end $$;

-- Sends the notice: in-app now, SMS + email queued for the worker. Returns the notice id.
create or replace function public.send_applicant_notice(p_application_id bigint, p_reason text, p_correction boolean default false)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_outcome bigint;
  v_first bigint;
  v_problem text;
  v_c record;
  v_dest record;
  v_id bigint;
begin
  if not notice_is_assigned_ao(p_application_id) then
    raise exception 'Only the assigned Account Officer can send this notice';
  end if;
  select status::text into v_status from loan_applications where id = p_application_id;
  if v_status not in ('APPROVED', 'REJECTED', 'DEFERRED') then
    raise exception 'The notice can be sent once the application is Approved, Rejected or Deferred';
  end if;
  if staff_name(auth.uid()) is null then
    raise exception 'Fill in your staff profile (first and last name) before sending';
  end if;

  v_outcome := current_applicant_outcome(p_application_id);
  if v_outcome is null then     -- the trigger failed earlier: record the outcome now
    insert into applicant_outcomes (application_id, status, set_by) values (p_application_id, v_status, null)
    returning id into v_outcome;
  end if;
  select id into v_first from applicant_notices where outcome_id = v_outcome and correction_of is null;
  if v_first is not null and not p_correction then
    raise exception 'The notice for this outcome was already sent. Send a correction instead';
  end if;
  if v_first is null and p_correction then
    raise exception 'There is no notice for this outcome to correct yet';
  end if;

  v_problem := notice_reason_problem(v_status, p_reason);
  if v_problem is not null then raise exception '%', v_problem; end if;

  select * into v_c from compose_applicant_notice(notification_app_no(p_application_id), v_status, p_reason, p_correction);
  if coalesce(notice_link_in(v_c.sms_text), notice_link_in(v_c.email_subject), notice_link_in(v_c.email_body),
              notice_link_in(v_c.in_app_body)) is not null then
    raise exception 'The notice text contains something that looks like a link; it was not sent';
  end if;

  insert into applicant_notices (application_id, outcome_id, outcome, reason, correction_of, in_app_title, in_app_body,
                                 sms_text, email_subject, email_body, sent_by, sent_role)
  values (p_application_id, v_outcome, v_status, nullif(btrim(p_reason), ''),
          case when p_correction then (select max(id) from applicant_notices where outcome_id = v_outcome) end,
          v_c.in_app_title, v_c.in_app_body, v_c.sms_text, v_c.email_subject, v_c.email_body,
          auth.uid(), current_user_role()::text)
  returning id into v_id;

  select * into v_dest from notice_destinations(p_application_id);
  insert into applicant_notice_deliveries (notice_id, channel, destination, subject, body, status, last_error, finished_at)
  values (v_id, 'SMS', v_dest.sms, null, v_c.sms_text,
          case when v_dest.sms is null then 'SKIPPED' else 'QUEUED' end,
          case when v_dest.sms is null then 'No valid Philippine mobile number for the principal borrower' end,
          case when v_dest.sms is null then now() end),
         (v_id, 'EMAIL', v_dest.email, v_c.email_subject, v_c.email_body,
          case when v_dest.email is null then 'SKIPPED' else 'QUEUED' end,
          case when v_dest.email is null then 'No valid email address for the principal borrower' end,
          case when v_dest.email is null then now() end);

  -- In-app (a failure here rolls the whole send back: the AO sees the error and nothing half-sent remains)
  perform send_notification('APPLICANT_OUTCOME', v_c.in_app_title, v_c.in_app_body, p_application_id,
    p_assigned => array['APPLICANT'], p_source => 'notices');

  return v_id;
end $$;

revoke execute on function public.applicant_notice_context(bigint) from public, anon;
grant execute on function public.applicant_notice_context(bigint) to authenticated;
revoke execute on function public.preview_applicant_notice(bigint, text, boolean) from public, anon;
grant execute on function public.preview_applicant_notice(bigint, text, boolean) to authenticated;
revoke execute on function public.send_applicant_notice(bigint, text, boolean) from public, anon;
grant execute on function public.send_applicant_notice(bigint, text, boolean) to authenticated;
revoke execute on function public.notice_reason_problem(text, text) from public, anon, authenticated;
revoke execute on function public.compose_applicant_notice(text, text, text, boolean) from public, anon, authenticated;

-- ============================================================
-- 9. The worker (service role): claim, then finish
-- ============================================================
-- Up to p_limit queued deliveries (and RUNNING ones stuck for 15 minutes), marked RUNNING
create or replace function public.claim_notice_deliveries(p_limit integer default 10)
returns setof public.applicant_notice_deliveries language sql security definer set search_path = public as $$
  update applicant_notice_deliveries d
  set status = 'RUNNING', attempts = d.attempts + 1, claimed_at = now()
  where d.id in (select id from applicant_notice_deliveries
                 where status = 'QUEUED' or (status = 'RUNNING' and claimed_at < now() - interval '15 minutes')
                 order by id limit greatest(p_limit, 1) for update skip locked)
  returning d.*;
$$;

-- LOGGED (test mode) / SENT / FAILED. A failure goes back to QUEUED until the third attempt. Returns the new status.
create or replace function public.finish_notice_delivery(p_id bigint, p_status text, p_provider text default null,
                                                         p_provider_message_id text default null, p_error text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_row applicant_notice_deliveries;
  v_new text;
begin
  if p_status not in ('LOGGED', 'SENT', 'FAILED') then
    raise exception 'Delivery status must be LOGGED, SENT or FAILED, got %', coalesce(p_status, 'null');
  end if;
  select * into v_row from applicant_notice_deliveries where id = p_id for update;
  if not found or v_row.status <> 'RUNNING' then
    raise exception 'Delivery % is not running', p_id;
  end if;
  v_new := case when p_status = 'FAILED' and v_row.attempts < 3 then 'QUEUED' else p_status end;
  update applicant_notice_deliveries
  set status = v_new, provider = coalesce(p_provider, provider), provider_message_id = p_provider_message_id,
      last_error = left(p_error, 500), finished_at = case when v_new = 'QUEUED' then null else now() end
  where id = p_id;
  return v_new;
end $$;

revoke execute on function public.claim_notice_deliveries(integer) from public, anon, authenticated;
grant execute on function public.claim_notice_deliveries(integer) to service_role;
revoke execute on function public.finish_notice_delivery(bigint, text, text, text, text) from public, anon, authenticated;
grant execute on function public.finish_notice_delivery(bigint, text, text, text, text) to service_role;
-- The worker re-checks the final text with the same rule before sending
revoke execute on function public.notice_link_in(text) from public, anon, authenticated;
grant execute on function public.notice_link_in(text) to service_role;
