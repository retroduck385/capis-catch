-- CATCH — reminders for document requests the applicant hasn't answered (group meeting follow-ups, part B, 2026-11-18)
-- Run after 20261118_request_uploads_ocr.sql (needs 20261112_document_requests.sql, 20261029_applicant_notices.sql
-- and 20261024_notifications.sql). Re-runnable, no drops of data.
--
-- What it does
--   * A document request that is still OPEN (the applicant hasn't pressed "Send to my Account Officer") gets
--     reminder 1 after first_after_days and reminder 2 after second_after_days, counted in calendar days from when
--     the AO sent it (like the TAT count). Then nothing more. Defaults 2 and 4, kept in ONE settings row
--     (document_reminder_settings) that the bank changes in the SQL editor, e.g.
--       update document_reminder_settings set first_after_days = 3, second_after_days = 6;
--   * Reminders go out only from 8 AM to 8 PM Philippine time (send_from_hour / send_until_hour in the same row);
--     one that falls due at night goes out the next morning. The in-app alert follows the same rule.
--   * Reminders stop when the applicant sends the documents, the AO closes the request, or the file leaves Intake,
--     Credit Investigation, Credit Evaluation and Review.
--   * The applicant gets: in-app APPLICANT_DOCUMENTS_REMINDER ("... Upload them under Documents needed on your home
--     page."), and SMS + email "We're still waiting for your documents for HL-.... Your Account Officer will contact
--     you." (no links, no portal). Same destinations as the request (notice_destinations()).
--     The assigned AO gets DOCUMENT_REQUEST_OVERDUE in the bell.
--   * If both reminders are due at once (the notice worker was off), only ONE message is sent, recorded as reminder 2,
--     and reminder 1 is recorded as SKIPPED "Skipped (worker was off)".
--   * Never twice: one row per request and reminder number (unique), made under a row lock.
--   * The notice-service worker calls queue_document_reminders() on its loop and sends the SMS / email from
--     document_reminder_deliveries (claim_reminder_deliveries / finish_reminder_delivery, same rules as notices).
--   * Switches (notification_switches, both on): APPLICANT_DOCUMENTS_REMINDER off = no reminders at all (nothing is
--     recorded or sent); DOCUMENT_REQUEST_OVERDUE off = only the AO's bell alert stops.
--
-- Tables: RLS on. Staff who can open the file read the reminders (the request box shows them); nobody reads the
-- deliveries directly (document_reminder_status() returns them with masked destinations); no client writes anywhere.
-- Reminders can't be edited or deleted (they go only with their application) and are logged in audit_log.
--
-- Changes to this module's own objects: applicant_notification_kinds() gets APPLICANT_DOCUMENTS_REMINDER
-- (replaces the 20261112 version). No teammate's function, trigger or table changes.
-- Re-runs of earlier files: 20261024_notifications.sql, 20261029_applicant_notices.sql or
-- 20261112_document_requests.sql re-run -> run this file again afterwards (they put back their kinds list).
--
-- Calls
--   queue_document_reminders(p_now default now())    -> reminders made (service role: the notice worker)
--   claim_reminder_deliveries / finish_reminder_delivery   service role only
--   document_reminder_status(p_application_id)        -> jsonb for the request box (staff who can open the file)

-- ============================================================
-- 0. Dependencies
-- ============================================================
do $$
declare
  v_missing text;
begin
  select string_agg(m, ', ') into v_missing
  from (values ('public.document_requests', '20261112_document_requests.sql'),
               ('public.applicant_notice_deliveries', '20261029_applicant_notices.sql'),
               ('public.notification_switches', '20261024_notifications.sql'),
               ('public.audit_log', '20261007_ao_kyc_verification.sql')) d (t, m)
  where to_regclass(t) is null;
  if v_missing is not null then
    raise exception 'Run these migrations first, then this file again: %', v_missing;
  end if;
end $$;

-- ============================================================
-- 1. Settings: one row
-- ============================================================
create table if not exists public.document_reminder_settings (
  id boolean primary key default true check (id),
  first_after_days smallint not null default 2,
  second_after_days smallint not null default 4,
  send_from_hour smallint not null default 8,     -- Philippine time, inclusive
  send_until_hour smallint not null default 20,   -- Philippine time, exclusive
  check (first_after_days between 1 and 60 and second_after_days between 1 and 60
         and second_after_days > first_after_days),
  check (send_from_hour between 0 and 23 and send_until_hour between 1 and 24 and send_until_hour > send_from_hour)
);
insert into public.document_reminder_settings (id) values (true) on conflict (id) do nothing;

-- ============================================================
-- 2. Reminders and their SMS / email deliveries
-- ============================================================
create table if not exists public.document_request_reminders (
  id bigint generated always as identity primary key,
  application_id bigint not null,
  request_id bigint not null,
  reminder_no smallint not null check (reminder_no in (1, 2)),
  status text not null check (status in ('SENT', 'SKIPPED')),
  note text,                      -- SKIPPED: why
  due_at timestamptz not null,
  created_at timestamptz not null default now(),
  in_app_title text,
  in_app_body text,
  sms_text text,
  email_subject text,
  email_body text,
  check ((status = 'SENT') = (sms_text is not null and email_body is not null and in_app_body is not null)),
  unique (request_id, reminder_no)
);
create index if not exists document_request_reminders_application on public.document_request_reminders (application_id, id);

create table if not exists public.document_reminder_deliveries (
  id bigint generated always as identity primary key,
  reminder_id bigint not null references public.document_request_reminders(id) on delete cascade,
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
  unique (reminder_id, channel)
);
create index if not exists reminder_deliveries_queue on public.document_reminder_deliveries (id) where status in ('QUEUED', 'RUNNING');

-- Foreign keys by name, so a re-run puts them back after a 20260928 reset dropped them
do $$ begin
  delete from public.document_request_reminders r
  where not exists (select 1 from public.document_requests q where q.id = r.request_id);
  if not exists (select 1 from pg_constraint where conname = 'document_request_reminders_application_fk') then
    alter table public.document_request_reminders add constraint document_request_reminders_application_fk
      foreign key (application_id) references public.loan_applications(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'document_request_reminders_request_fk') then
    alter table public.document_request_reminders add constraint document_request_reminders_request_fk
      foreign key (request_id) references public.document_requests(id) on delete cascade;
  end if;
end $$;

insert into public.notification_switches (kind, enabled, note) values
  ('APPLICANT_DOCUMENTS_REMINDER', true, 'Reminders for unanswered document requests (in-app, SMS, email). Off = no reminders at all'),
  ('DOCUMENT_REQUEST_OVERDUE', true, 'The assigned Account Officer hears when a document request reminder went out')
on conflict (kind) do nothing;

-- ============================================================
-- 3. Guards: reminders never change; deliveries are only updated (by the worker), never deleted
-- ============================================================
-- panel_history_guard() comes from 20261116_findings_and_file_marks.sql: a row goes only with its application
drop trigger if exists history_guard on public.document_request_reminders;
create trigger history_guard before update or delete on public.document_request_reminders
  for each row execute function public.panel_history_guard();
drop trigger if exists history_no_truncate on public.document_request_reminders;
create trigger history_no_truncate before truncate on public.document_request_reminders
  for each statement execute function public.panel_history_guard();

create or replace function public.reminder_deliveries_no_delete() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from document_request_reminders r where r.id = old.reminder_id) then
    return old;   -- its reminder went with the application
  end if;
  raise exception 'Reminder deliveries can''t be deleted';
end $$;
revoke execute on function public.reminder_deliveries_no_delete() from public, anon, authenticated;
drop trigger if exists reminder_deliveries_no_delete on public.document_reminder_deliveries;
create trigger reminder_deliveries_no_delete before delete on public.document_reminder_deliveries
  for each row execute function public.reminder_deliveries_no_delete();
drop trigger if exists reminder_deliveries_no_truncate on public.document_reminder_deliveries;
create trigger reminder_deliveries_no_truncate before truncate on public.document_reminder_deliveries
  for each statement execute function public.reminder_deliveries_no_delete();

drop trigger if exists log_application_change on public.document_request_reminders;
create trigger log_application_change after insert on public.document_request_reminders
  for each row execute function public.log_application_change('application_id');

-- ============================================================
-- 4. RLS
-- ============================================================
alter table public.document_reminder_settings enable row level security;
alter table public.document_request_reminders enable row level security;
alter table public.document_reminder_deliveries enable row level security;
revoke all on public.document_reminder_settings from anon, authenticated;
revoke all on public.document_request_reminders from anon, authenticated;
revoke all on public.document_reminder_deliveries from anon, authenticated;
grant select on public.document_reminder_settings to authenticated;
grant select on public.document_request_reminders to authenticated;

drop policy if exists "staff read reminder settings" on public.document_reminder_settings;
create policy "staff read reminder settings" on public.document_reminder_settings
  for select to authenticated using (coalesce(current_user_role()::text, 'APPLICANT') <> 'APPLICANT');

drop policy if exists "staff read document request reminders" on public.document_request_reminders;
create policy "staff read document request reminders" on public.document_request_reminders
  for select to authenticated using (public.staff_can_access(application_id));

-- ============================================================
-- 5. The applicant kinds (replaces the 20261112 version: + APPLICANT_DOCUMENTS_REMINDER)
-- ============================================================
create or replace function public.applicant_notification_kinds()
returns text[] language sql immutable as $$
  select array['APPLICANT_SUBMITTED', 'APPLICANT_UNDER_REVIEW', 'APPLICANT_INCOMPLETE', 'APPLICANT_OUTCOME',
               'APPLICANT_DOCUMENTS_NEEDED', 'APPLICANT_REQUEST_CLOSED', 'APPLICANT_DOCUMENTS_REMINDER'];
$$;

-- ============================================================
-- 6. When a reminder may go out: due, then moved into the 8 AM - 8 PM Philippine-time window
-- ============================================================
create or replace function public.reminder_send_time(p_due timestamptz)
returns timestamptz language sql stable set search_path = public as $$
  select case
    when extract(hour from l) < s.send_from_hour
      then (date_trunc('day', l) + make_interval(hours => s.send_from_hour)) at time zone 'Asia/Manila'
    when extract(hour from l) >= s.send_until_hour
      then (date_trunc('day', l) + interval '1 day' + make_interval(hours => s.send_from_hour)) at time zone 'Asia/Manila'
    else p_due end
  from document_reminder_settings s, (select p_due at time zone 'Asia/Manila' as l) x;
$$;

-- ============================================================
-- 7. queue_document_reminders(): run by the notice worker on its loop (service role)
-- ============================================================
create or replace function public.queue_document_reminders(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = public as $$
declare
  s document_reminder_settings;
  r document_requests;
  v_local timestamp := p_now at time zone 'Asia/Manila';
  v_due1 timestamptz;
  v_due2 timestamptz;
  v_has1 boolean;
  v_no smallint;
  v_due timestamptz;
  v_app text;
  v_sentence text;
  v_rem bigint;
  v_dest record;
  v_made integer := 0;
begin
  if exists (select 1 from notification_switches where kind = 'APPLICANT_DOCUMENTS_REMINDER' and not enabled) then
    return 0;
  end if;
  select * into s from document_reminder_settings;
  if not found then return 0; end if;
  if extract(hour from v_local) < s.send_from_hour or extract(hour from v_local) >= s.send_until_hour then
    return 0;   -- quiet hours: whatever is due goes out in the morning
  end if;

  for r in select q.* from document_requests q
           where q.status = 'OPEN' and document_request_stage_ok(q.application_id)
             and not exists (select 1 from document_request_reminders x where x.request_id = q.id and x.reminder_no = 2)
             and q.opened_at + make_interval(days => s.first_after_days) <= p_now
           order by q.id
           for update of q skip locked loop
    v_due1 := r.opened_at + make_interval(days => s.first_after_days);
    v_due2 := r.opened_at + make_interval(days => s.second_after_days);
    v_has1 := exists (select 1 from document_request_reminders x where x.request_id = r.id and x.reminder_no = 1);

    if p_now >= v_due2 then
      if not v_has1 then   -- both due at once: one message only
        insert into document_request_reminders (application_id, request_id, reminder_no, status, note, due_at)
        values (r.application_id, r.id, 1, 'SKIPPED', 'Skipped (worker was off)', v_due1);
      end if;
      v_no := 2; v_due := v_due2;
    elsif not v_has1 then
      v_no := 1; v_due := v_due1;
    else
      continue;
    end if;

    v_app := notification_app_no(r.application_id);
    v_sentence := 'We''re still waiting for your documents for ' || v_app || '. Your Account Officer will contact you.';
    insert into document_request_reminders (application_id, request_id, reminder_no, status, due_at,
                                            in_app_title, in_app_body, sms_text, email_subject, email_body)
    values (r.application_id, r.id, v_no, 'SENT', v_due,
            'Reminder: documents for ' || v_app,
            v_sentence || ' Upload them under Documents needed on your home page.',
            'CATCH: ' || v_sentence,
            'Reminder: documents for your housing loan application ' || v_app,
            v_sentence)
    returning id into v_rem;

    select * into v_dest from notice_destinations(r.application_id);
    insert into document_reminder_deliveries (reminder_id, channel, destination, subject, body, status, last_error, finished_at)
    select v_rem, 'SMS', v_dest.sms, null, x.sms_text,
           case when v_dest.sms is null then 'SKIPPED' else 'QUEUED' end,
           case when v_dest.sms is null then 'No valid Philippine mobile number for the principal borrower' end,
           case when v_dest.sms is null then now() end
    from document_request_reminders x where x.id = v_rem
    union all
    select v_rem, 'EMAIL', v_dest.email, x.email_subject, x.email_body,
           case when v_dest.email is null then 'SKIPPED' else 'QUEUED' end,
           case when v_dest.email is null then 'No valid email address for the principal borrower' end,
           case when v_dest.email is null then now() end
    from document_request_reminders x where x.id = v_rem;

    perform send_notification('APPLICANT_DOCUMENTS_REMINDER', 'Reminder: documents for ' || v_app,
      v_sentence || ' Upload them under Documents needed on your home page.', r.application_id,
      p_assigned => array['APPLICANT'], p_source => 'notices');
    perform send_notification('DOCUMENT_REQUEST_OVERDUE', 'The document request for ' || v_app || ' is overdue',
      'Reminder ' || v_no || ' of 2 was sent to the applicant' || case when v_no = 2 then ' (the last one).' else '.' end,
      r.application_id, p_assigned => array['ACCOUNT_OFFICER'], p_link => '/loanFolderPage?id=' || r.application_id,
      p_source => 'notices');
    v_made := v_made + 1;
  end loop;
  return v_made;
end $$;
revoke execute on function public.queue_document_reminders(timestamptz) from public, anon, authenticated;
grant execute on function public.queue_document_reminders(timestamptz) to service_role;

-- ============================================================
-- 8. The worker's queue (same rules as claim_notice_deliveries / finish_notice_delivery)
-- ============================================================
create or replace function public.claim_reminder_deliveries(p_limit integer default 10)
returns setof public.document_reminder_deliveries language sql security definer set search_path = public as $$
  update document_reminder_deliveries d
  set status = 'RUNNING', attempts = d.attempts + 1, claimed_at = now()
  where d.id in (select id from document_reminder_deliveries
                 where status = 'QUEUED' or (status = 'RUNNING' and claimed_at < now() - interval '15 minutes')
                 order by id limit greatest(p_limit, 1) for update skip locked)
  returning d.*;
$$;

-- LOGGED (test mode) / SENT / FAILED. A failure goes back to QUEUED until the third attempt. Returns the new status.
create or replace function public.finish_reminder_delivery(p_id bigint, p_status text, p_provider text default null,
                                                           p_provider_message_id text default null, p_error text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_row document_reminder_deliveries;
  v_new text;
begin
  if p_status not in ('LOGGED', 'SENT', 'FAILED') then
    raise exception 'Delivery status must be LOGGED, SENT or FAILED, got %', coalesce(p_status, 'null');
  end if;
  select * into v_row from document_reminder_deliveries where id = p_id for update;
  if not found or v_row.status <> 'RUNNING' then
    raise exception 'Delivery % is not running', p_id;
  end if;
  v_new := case when p_status = 'FAILED' and v_row.attempts < 3 then 'QUEUED' else p_status end;
  update document_reminder_deliveries
  set status = v_new, provider = coalesce(p_provider, provider), provider_message_id = p_provider_message_id,
      last_error = left(p_error, 500), finished_at = case when v_new = 'QUEUED' then null else now() end
  where id = p_id;
  return v_new;
end $$;

revoke execute on function public.claim_reminder_deliveries(integer) from public, anon, authenticated;
grant execute on function public.claim_reminder_deliveries(integer) to service_role;
revoke execute on function public.finish_reminder_delivery(bigint, text, text, text, text) from public, anon, authenticated;
grant execute on function public.finish_reminder_delivery(bigint, text, text, text, text) to service_role;
revoke execute on function public.reminder_send_time(timestamptz) from public, anon, authenticated;

-- ============================================================
-- 9. For the request box: every reminder of the file (deliveries with masked destinations) and the next one due
-- ============================================================
create or replace function public.document_reminder_status(p_application_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s document_reminder_settings;
  r document_requests;
  v_next jsonb := null;
  v_last smallint;
begin
  if coalesce(current_user_role()::text, 'APPLICANT') = 'APPLICANT' or not staff_can_access(p_application_id) then
    raise exception 'No access to this application';
  end if;
  select * into s from document_reminder_settings;
  select * into r from document_requests where application_id = p_application_id and status = 'OPEN';
  if found and s.id is not null and document_request_stage_ok(p_application_id) then
    select max(reminder_no) into v_last from document_request_reminders where request_id = r.id;
    if coalesce(v_last, 0) < 2 then
      v_next := jsonb_build_object('reminder_no', coalesce(v_last, 0) + 1,
        'at', reminder_send_time(r.opened_at + make_interval(days =>
              case when coalesce(v_last, 0) = 0 then s.first_after_days else s.second_after_days end)));
    end if;
  end if;
  return jsonb_build_object(
    'first_after_days', s.first_after_days, 'second_after_days', s.second_after_days,
    'next', v_next,
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
