-- CATCH — Messages (F7 Streamlined Internal Messaging Panel): one staff thread per loan application,
-- replacing Messenger / Viber / GChat for the file.
-- Run after 20261024_notifications.sql. Re-runnable, no drops of data.
--
-- What it does
--   * messages: one row per message, tagged with the sender's role and the stage it was posted in.
--     Staff only (the bank, 2026-10-26): applicants can't read or post.
--   * Append-only: nobody can edit or delete a message, not even the table owner or the service role
--     (trigger messages_append_only). The table is its own audit trail of who said what, as which role, when;
--     messages are NOT copied into audit_log (they aren't changes to the record).
--   * New messages appear instantly: the table is added to the supabase_realtime publication.
--   * A new message notifies the people on the file (MESSAGE_POSTED, application number only, no text).
--   * No existing function, migration or trigger is changed.
--
-- Who reads: everyone staff_can_access() lets read the file (every AO, CO, Dispatch Admin, Reviewer,
--   Approver and Dept Head; a CI once the file has a CI request).
-- Who posts (post_message), at every stage, Decided included (the AO sends the final notice after the decision):
--   Account Officer / Credit Officer   only while assigned to the file (application_assignments)
--   Credit Investigator                once the file has a CI request
--   Reviewer / Approver                only while routed on the file (review_assignments)
--   Dispatch Admin / Dept Head         always
--   Everyone else with access reads only. Posters need a staff profile name. Plain text, 1-2000 characters.
--
-- Who is notified (MESSAGE_POSTED, one unread per person per file, never the sender):
--   the assigned AO and CO, the routed reviewers and approvers, and earlier posters who can still read the file.
--   message_user_can_access() mirrors staff_can_access() for another user: if staff_can_access() changes in a
--   later migration, change it here too.
--
-- Browser calls (authenticated)
--   select from messages (RLS) / message_reads (own rows)
--   post_message(app, body)            -> the new row
--   message_can_post(app)              -> boolean (shows or hides the text box)
--   mark_messages_read(app)            -> moves my read marker to the newest message and marks my MESSAGE_POSTED
--                                         notifications for that file read
--   message_unread_counts(app_ids[])   -> my unread count per file (my own messages don't count)
--
-- Run order / re-runs
--   * Needs 20260928 .. 20261024_notifications.sql already run (the file stops with an error naming what's
--     missing, before creating anything).
--   * Re-running ANY other migration except 20260928: nothing to do.
--   * Re-running 20260928_application_side.sql drops loan_applications and users with CASCADE, which removes this
--     file's foreign keys (not the messages). Afterwards run every later migration in order, then
--     20261024_notifications.sql, then this file: it deletes messages whose application no longer exists
--     (the only delete the guard ever allows, and only inside this file as the table owner), puts the keys back
--     and says how many it removed.
--   * Staff accounts with messages can't be deleted (messages_sender_fk), the same as accounts with assignments.

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
               ('public.application_assignments', '20261005_work_tray.sql'),
               ('public.ci_requests', '20261020_ci_request.sql'),
               ('public.review_assignments', '20261021_review_routing.sql'),
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
-- 1. Tables
-- ============================================================
-- Types are plain text (not user_role / workflow_stage) so a re-run of 20260928 can't cascade into them.
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  application_id bigint not null,
  sender_id uuid not null,
  sender_role text not null check (sender_role in ('ACCOUNT_OFFICER', 'CREDIT_INVESTIGATOR', 'DISPATCH_ADMIN',
                                                   'CREDIT_OFFICER', 'REVIEWER', 'APPROVER', 'DEPT_HEAD')),
  stage text,                -- the open stage when it was posted
  body text not null check (body = btrim(body, E' \t\r\n') and length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists messages_application on public.messages (application_id, id);
create index if not exists messages_sender on public.messages (sender_id);

-- My read marker per file (not part of the trail: it moves)
create table if not exists public.message_reads (
  user_id uuid not null,
  application_id bigint not null,
  last_read_id bigint not null,
  read_at timestamptz not null default now(),
  primary key (user_id, application_id)
);

-- ============================================================
-- 2. Append-only guard (everyone, owner and service role included)
-- ============================================================
-- The one exception: section 3 below, run by the table owner inside this file, deletes messages whose
-- application no longer exists (after a 20260928 re-run). It sets catch.messages_purge for its own transaction.
create or replace function public.messages_append_only() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE'
     and current_setting('catch.messages_purge', true) = 'orphans'
     and current_user not in ('anon', 'authenticated', 'service_role')
     and not exists (select 1 from loan_applications la where la.id = old.application_id) then
    return old;
  end if;
  raise exception 'Messages can''t be edited or deleted (append-only trail)';
end $$;

revoke execute on function public.messages_append_only() from public, anon, authenticated;

drop trigger if exists messages_append_only on public.messages;
create trigger messages_append_only before update or delete on public.messages
  for each row execute function public.messages_append_only();

drop trigger if exists messages_no_truncate on public.messages;
create trigger messages_no_truncate before truncate on public.messages
  for each statement execute function public.messages_append_only();

-- ============================================================
-- 3. Foreign keys, added by name so a re-run puts them back after 20260928 dropped them
-- ============================================================
do $$
declare
  v_purged integer;
begin
  perform set_config('catch.messages_purge', 'orphans', true);
  delete from public.messages m
  where not exists (select 1 from public.loan_applications la where la.id = m.application_id);
  get diagnostics v_purged = row_count;
  perform set_config('catch.messages_purge', '', true);
  if v_purged > 0 then
    raise notice 'Removed % message(s) whose application no longer exists', v_purged;
  end if;

  delete from public.message_reads r
  where not exists (select 1 from public.loan_applications la where la.id = r.application_id)
     or not exists (select 1 from public.users u where u.id = r.user_id);

  if not exists (select 1 from pg_constraint where conname = 'messages_application_fk') then
    alter table public.messages add constraint messages_application_fk
      foreign key (application_id) references public.loan_applications(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'messages_sender_fk') then
    if exists (select 1 from public.messages m where not exists (select 1 from public.users u where u.id = m.sender_id)) then
      raise notice 'messages_sender_fk not added: some senders no longer exist';
    else
      alter table public.messages add constraint messages_sender_fk
        foreign key (sender_id) references public.users(id);
    end if;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'message_reads_user_fk') then
    alter table public.message_reads add constraint message_reads_user_fk
      foreign key (user_id) references public.users(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'message_reads_application_fk') then
    alter table public.message_reads add constraint message_reads_application_fk
      foreign key (application_id) references public.loan_applications(id) on delete cascade;
  end if;
end $$;

-- ============================================================
-- 4. RLS: staff with access to the file read its messages; each user reads their own markers; no client writes
-- ============================================================
alter table public.messages enable row level security;
alter table public.message_reads enable row level security;
revoke insert, update, delete, truncate on public.messages from anon, authenticated;
revoke insert, update, delete, truncate on public.message_reads from anon, authenticated;

drop policy if exists "staff read messages" on public.messages;
create policy "staff read messages" on public.messages
  for select to authenticated using (public.staff_can_access(application_id));

drop policy if exists "read own message markers" on public.message_reads;
create policy "read own message markers" on public.message_reads
  for select to authenticated using (user_id = auth.uid());

-- ============================================================
-- 5. Helpers
-- ============================================================
-- Can the signed-in user post on this file? (rules in the header)
create or replace function public.message_can_post(p_application_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(staff_can_access(p_application_id) and (
    current_user_role()::text in ('DISPATCH_ADMIN', 'DEPT_HEAD')
    or (current_user_role()::text = 'CREDIT_INVESTIGATOR'
        and exists (select 1 from ci_requests r where r.application_id = p_application_id))
    or (current_user_role()::text in ('ACCOUNT_OFFICER', 'CREDIT_OFFICER')
        and exists (select 1 from application_assignments aa
                    where aa.application_id = p_application_id and aa.user_id = auth.uid()
                      and aa.assignee_role::text = current_user_role()::text and aa.unassigned_at is null))
    or (current_user_role()::text in ('REVIEWER', 'APPROVER')
        and exists (select 1 from review_assignments ra
                    where ra.application_id = p_application_id and ra.user_id = auth.uid()
                      and ra.assignee_role::text = current_user_role()::text and ra.unassigned_at is null))), false);
$$;

-- Could this (other) user read the file? Mirrors staff_can_access() (20261020_financial_package.sql).
create or replace function public.message_user_can_access(p_user_id uuid, p_application_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from loan_applications la
    join users u on u.id = p_user_id and u.is_active
    where la.id = p_application_id
      and la.status <> 'DRAFT'
      and (u.role::text in ('ACCOUNT_OFFICER', 'CREDIT_OFFICER', 'DISPATCH_ADMIN', 'REVIEWER', 'APPROVER', 'DEPT_HEAD')
           or (u.role::text = 'CREDIT_INVESTIGATOR'
               and exists (select 1 from ci_requests r where r.application_id = la.id))
           or exists (select 1 from application_assignments aa
                      where aa.application_id = la.id and aa.user_id = p_user_id and aa.unassigned_at is null)));
$$;

revoke execute on function public.message_can_post(bigint) from public, anon;
grant execute on function public.message_can_post(bigint) to authenticated;
revoke execute on function public.message_user_can_access(uuid, bigint) from public, anon, authenticated;

-- ============================================================
-- 6. post_message(): the one way to write a message
-- ============================================================
create or replace function public.post_message(p_application_id bigint, p_body text)
returns public.messages language plpgsql security definer set search_path = public as $$
declare
  v_body text := btrim(p_body, E' \t\r\n');
  v_row messages;
  v_posters uuid[];
begin
  if not message_can_post(p_application_id) then
    raise exception 'You can''t post on this application: only the assigned Account Officer / Credit Officer, '
                    'the Credit Investigator once CI is requested, routed reviewers / approvers, '
                    'the Dispatch Admin and the Dept Head can';
  end if;
  if v_body is null or v_body = '' then raise exception 'The message is empty'; end if;
  if length(v_body) > 2000 then raise exception 'The message is longer than 2000 characters'; end if;
  if staff_name(auth.uid()) is null then
    raise exception 'Fill in your staff profile (first and last name) before posting';
  end if;

  insert into messages (application_id, sender_id, sender_role, stage, body)
  values (p_application_id, auth.uid(), current_user_role()::text,
          (select stage::text from application_stages where application_id = p_application_id and left_at is null),
          v_body)
  returning * into v_row;

  -- A failed notification never blocks the message
  begin
    select array_agg(distinct m.sender_id) into v_posters
    from messages m
    where m.application_id = p_application_id and m.sender_id <> auth.uid()
      and message_user_can_access(m.sender_id, p_application_id);

    perform send_notification('MESSAGE_POSTED', 'New message on ' || notification_app_no(p_application_id), null,
      p_application_id, p_users => v_posters,
      p_assigned => array['ACCOUNT_OFFICER', 'CREDIT_OFFICER', 'REVIEWER', 'APPROVER'],
      p_source => 'messages', p_dedupe => true);
  exception when others then
    raise warning 'message notification failed: %', sqlerrm;
  end;

  return v_row;
end $$;

revoke execute on function public.post_message(bigint, text) from public, anon;
grant execute on function public.post_message(bigint, text) to authenticated;

-- ============================================================
-- 7. Read markers
-- ============================================================
-- Moves my marker to the newest message on the file (never backwards) and marks my MESSAGE_POSTED
-- notifications for it read. Returns the marker (null = no messages yet).
create or replace function public.mark_messages_read(p_application_id bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_last bigint;
begin
  if not staff_can_access(p_application_id) then
    raise exception 'You don''t have access to this application';
  end if;
  select max(id) into v_last from messages where application_id = p_application_id;
  if v_last is not null then
    insert into message_reads (user_id, application_id, last_read_id)
    values (auth.uid(), p_application_id, v_last)
    on conflict (user_id, application_id) do update
      set last_read_id = greatest(message_reads.last_read_id, excluded.last_read_id), read_at = now();
  end if;
  update notifications set read_at = now()
  where recipient_id = auth.uid() and kind = 'MESSAGE_POSTED' and application_id = p_application_id
    and read_at is null;
  return v_last;
end $$;

-- My unread count per file (files I can't read are left out; my own messages don't count)
create or replace function public.message_unread_counts(p_application_ids bigint[])
returns table (application_id bigint, unread integer)
language sql stable security definer set search_path = public as $$
  select a.id, count(m.id)::integer
  from unnest(p_application_ids) as a (id)
  left join message_reads r on r.user_id = auth.uid() and r.application_id = a.id
  left join messages m on m.application_id = a.id and m.id > coalesce(r.last_read_id, 0)
                      and m.sender_id <> auth.uid()
  where staff_can_access(a.id)
  group by a.id;
$$;

revoke execute on function public.mark_messages_read(bigint) from public, anon;
grant execute on function public.mark_messages_read(bigint) to authenticated;
revoke execute on function public.message_unread_counts(bigint[]) from public, anon;
grant execute on function public.message_unread_counts(bigint[]) to authenticated;

-- ============================================================
-- 8. Realtime: new messages reach the open panels instantly (RLS still applies)
-- ============================================================
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
