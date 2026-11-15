-- CATCH — Messages: @mentions and a topic per message (panel feedback, 2026-11-15)
-- Run after 20261112_document_requests.sql (needs 20261028_messages.sql and 20261024_notifications.sql).
-- Re-runnable, no drops of data.
--
-- What it does
--   * messages gets two columns, both written once when the message is created (the append-only guard is unchanged:
--     nobody can edit or delete a message, so a mention or a topic can never be added or removed afterwards):
--       mentions  the staff mentioned with @ in the text
--       topic     the section the message is about (the page section's id, e.g. fp-iv, rv-ci, kyc-spouse);
--                 the drawer shows it as a chip that opens that section
--   * post_message(app, body, mentions, topic): the four-argument way to post. The two-argument post_message(app, body)
--     stays and now just calls it with no mentions and no topic.
--       - Only staff who can open the file can be mentioned (message_user_can_access), never yourself, never an
--         applicant, never someone inactive or without a staff profile name. At most 20 per message.
--       - A mention counts only if "@Their Name" is in the text (no silent pings).
--   * message_mention_candidates(app): the people the @ list offers, the ones working on the file first.
--   * MESSAGE_MENTION: a new notification kind, "You were mentioned on <application no.>" (no names, no message text).
--     A mentioned person does NOT also get MESSAGE_POSTED for the same message.
--     Switch: notification_switches row MESSAGE_MENTION (on). While it is off, mentioned people are treated like
--     everyone else and get the ordinary MESSAGE_POSTED.
--   * mark_messages_read() also marks my MESSAGE_MENTION notifications for the file read.
--   * Staff only, as before: the columns live on messages, which applicants cannot read (RLS "staff read messages").
--
-- Browser calls (authenticated)
--   post_message(p_application_id, p_body, p_mentions uuid[], p_topic text) -> the new row
--   message_mention_candidates(p_application_id) -> (user_id, name, role, on_file)
--
-- Run order / re-runs
--   * Re-running 20261028_messages.sql puts back its own post_message(app, body) and mark_messages_read():
--     run this file again afterwards.
--   * No other module's function, trigger or table is changed.

-- ============================================================
-- 0. Dependencies
-- ============================================================
do $$
begin
  if to_regclass('public.messages') is null
     or to_regprocedure('public.message_user_can_access(uuid, bigint)') is null then
    raise exception 'Run 20261028_messages.sql first, then this file again';
  end if;
  if to_regprocedure('public.send_notification(text, text, text, bigint, uuid[], text[], text[], text, text, boolean, boolean)') is null then
    raise exception 'Run 20261024_notifications.sql first, then this file again';
  end if;
end $$;

-- ============================================================
-- 1. Columns (set at insert only; adding a column is not an UPDATE, so the guard does not fire)
-- ============================================================
alter table public.messages add column if not exists mentions uuid[] not null default '{}';
alter table public.messages add column if not exists topic text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'messages_topic_format') then
    alter table public.messages add constraint messages_topic_format
      check (topic is null or topic ~ '^(fp|cs|rv|ds|kyc)-[A-Za-z0-9_-]{1,40}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'messages_mentions_max') then
    alter table public.messages add constraint messages_mentions_max
      check (coalesce(array_length(mentions, 1), 0) <= 20);
  end if;
end $$;

insert into public.notification_switches (kind, enabled, note) values
  ('MESSAGE_MENTION', true, 'Staff mentioned with @ in a loan-file message get their own alert')
on conflict (kind) do nothing;

-- ============================================================
-- 2. Who can be mentioned
-- ============================================================
-- People working on the file: the assigned AO / CO, routed reviewers / approvers, and earlier posters
create or replace function public.message_people_on_file(p_application_id bigint)
returns setof uuid language sql stable security definer set search_path = public as $$
  select user_id from application_assignments
  where application_id = p_application_id and unassigned_at is null
    and assignee_role::text in ('ACCOUNT_OFFICER', 'CREDIT_OFFICER')
  union
  select user_id from review_assignments
  where application_id = p_application_id and unassigned_at is null
    and assignee_role::text in ('REVIEWER', 'APPROVER')
  union
  select sender_id from messages where application_id = p_application_id;
$$;
revoke execute on function public.message_people_on_file(bigint) from public, anon, authenticated;

-- The @ list: every active, named staff member who can open this file, except me. On the file first, then by name.
create or replace function public.message_mention_candidates(p_application_id bigint)
returns table (user_id uuid, name text, role text, on_file boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not staff_can_access(p_application_id) then
    raise exception 'You don''t have access to this application';
  end if;
  return query
  select u.id, staff_name(u.id), u.role::text,
         u.id in (select message_people_on_file(p_application_id))
  from users u
  where u.is_active and u.role::text <> 'APPLICANT' and u.id <> auth.uid()
    and staff_name(u.id) is not null
    and message_user_can_access(u.id, p_application_id)
  order by 4 desc, 2, 1;
end $$;
revoke execute on function public.message_mention_candidates(bigint) from public, anon;
grant execute on function public.message_mention_candidates(bigint) to authenticated;

-- ============================================================
-- 3. post_message() with mentions and a topic
-- ============================================================
create or replace function public.post_message(p_application_id bigint, p_body text, p_mentions uuid[], p_topic text)
returns public.messages language plpgsql security definer set search_path = public as $$
declare
  v_body text := btrim(p_body, E' \t\r\n');
  v_topic text := nullif(btrim(coalesce(p_topic, '')), '');
  v_mentions uuid[];
  v_bad text;
  v_row messages;
  v_others uuid[];
  v_mention_on boolean;
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
  if v_topic is not null and v_topic !~ '^(fp|cs|rv|ds|kyc)-[A-Za-z0-9_-]{1,40}$' then
    raise exception 'That topic is not a section of a loan file page';
  end if;

  -- Mentions: distinct, never me, only people who can open the file
  select coalesce(array_agg(distinct m), '{}') into v_mentions from unnest(coalesce(p_mentions, '{}')) m where m is not null;
  if auth.uid() = any (v_mentions) then raise exception 'You can''t mention yourself'; end if;
  if coalesce(array_length(v_mentions, 1), 0) > 20 then
    raise exception 'A message can mention at most 20 people';
  end if;
  select string_agg(coalesce(staff_name(m), 'someone'), ', ') into v_bad
  from unnest(v_mentions) m
  where not exists (select 1 from users u where u.id = m and u.is_active and u.role::text <> 'APPLICANT')
     or staff_name(m) is null
     or not message_user_can_access(m, p_application_id);
  if v_bad is not null then
    raise exception 'Only staff who can open this loan file can be mentioned (not: %)', v_bad;
  end if;
  -- A mention counts only when "@Name" is in the text
  select coalesce(array_agg(m), '{}') into v_mentions
  from unnest(v_mentions) m where position('@' || staff_name(m) in v_body) > 0;

  insert into messages (application_id, sender_id, sender_role, stage, body, mentions, topic)
  values (p_application_id, auth.uid(), current_user_role()::text,
          (select stage::text from application_stages where application_id = p_application_id and left_at is null),
          v_body, v_mentions, v_topic)
  returning * into v_row;

  -- A failed notification never blocks the message
  begin
    v_mention_on := not exists (select 1 from notification_switches where kind = 'MESSAGE_MENTION' and not enabled);

    if v_mention_on and coalesce(array_length(v_mentions, 1), 0) > 0 then
      perform send_notification('MESSAGE_MENTION', 'You were mentioned on ' || notification_app_no(p_application_id),
        null, p_application_id, p_users => v_mentions, p_source => 'messages');
    end if;

    -- Everyone else on the file (as before), minus the people who just got the mention alert
    select array_agg(x) into v_others
    from (select message_people_on_file(p_application_id) as x) s
    where x <> auth.uid()
      and message_user_can_access(x, p_application_id)
      and not (v_mention_on and x = any (v_mentions));

    perform send_notification('MESSAGE_POSTED', 'New message on ' || notification_app_no(p_application_id), null,
      p_application_id, p_users => v_others, p_source => 'messages', p_dedupe => true);
  exception when others then
    raise warning 'message notification failed: %', sqlerrm;
  end;

  return v_row;
end $$;

revoke execute on function public.post_message(bigint, text, uuid[], text) from public, anon;
grant execute on function public.post_message(bigint, text, uuid[], text) to authenticated;

-- The two-argument call keeps working (no mentions, no topic)
create or replace function public.post_message(p_application_id bigint, p_body text)
returns public.messages language sql security definer set search_path = public as $$
  select * from post_message(p_application_id, p_body, null::uuid[], null::text);
$$;
revoke execute on function public.post_message(bigint, text) from public, anon;
grant execute on function public.post_message(bigint, text) to authenticated;

-- ============================================================
-- 4. Opening the thread also clears my mention alerts for the file
-- ============================================================
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
  where recipient_id = auth.uid() and kind in ('MESSAGE_POSTED', 'MESSAGE_MENTION')
    and application_id = p_application_id and read_at is null;
  return v_last;
end $$;
revoke execute on function public.mark_messages_read(bigint) from public, anon;
grant execute on function public.mark_messages_read(bigint) to authenticated;
