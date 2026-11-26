-- CATCH Demo Application #8 (Evangelista): delete Ramon's applications so the demo can start over.
-- Run in the Supabase SQL Editor (as postgres, the table owner). Re-runnable. Synthetic data only.
--
--   * Deletes every application owned by the account below: drafts and submitted / in-progress ones alike.
--     Set v_keep_draft := true to leave the current DRAFT alone.
--   * Everything under an application goes with it (on delete cascade): parties, addresses, documents, KYC, CI,
--     FP, credit score, reviews, approvals, notifications, MRAC runs, AI suggestions, clarifications...
--   * Messages, applicant notices and notice deliveries are append-only AND "on delete restrict", so the cascade
--     can't reach them. Their guard triggers are switched off for this transaction only, the rows are deleted,
--     and the triggers are switched back on before the application is deleted. If anything fails, the whole
--     block rolls back, triggers included.
--   * The application's audit_log rows are removed after (the delete itself is logged), like
--     catch/supabase/seed/seed_applications_cleanup.sql. Set v_keep_audit := true to keep them.
--   * NOT done here: the account itself (Ramon can still log in) and the uploaded files in Storage (SQL can't delete
--     them; remove them in Storage if needed).
-- Afterwards: run seed_application_TEST_Evangelista.sql to make a fresh draft.
do $$
declare
  v_email      text    := 'ramon.evangelista042177@gmail.com';   -- the applicant account
  v_keep_draft boolean := false;
  v_keep_audit boolean := false;

  v_user       uuid;
  v_apps       bigint[];
  v_list       text;
  v_deliveries int := 0;
  v_notices    int := 0;
  v_messages   int := 0;
  v_audit      int := 0;
begin
  select id into v_user from auth.users where lower(email) = lower(v_email);
  if v_user is null then raise exception 'No account with email %', v_email; end if;

  select array_agg(id order by id),
         string_agg(id || ' (' || status || ')', ', ' order by id)
    into v_apps, v_list
  from loan_applications
  where user_id = v_user and (not v_keep_draft or status <> 'DRAFT');

  if v_apps is null then
    raise notice 'Nothing to delete: % has no applications%', v_email,
      case when v_keep_draft then ' besides the draft' else '' end;
    return;
  end if;

  -- 1. Append-only rows that block the cascade
  alter table public.applicant_notice_deliveries disable trigger notice_deliveries_no_delete;
  alter table public.applicant_notices disable trigger applicant_notices_append_only;
  alter table public.messages disable trigger messages_append_only;

  delete from applicant_notice_deliveries d
  using applicant_notices n
  where n.id = d.notice_id and n.application_id = any (v_apps);
  get diagnostics v_deliveries = row_count;

  delete from applicant_notices where application_id = any (v_apps);
  get diagnostics v_notices = row_count;

  delete from messages where application_id = any (v_apps);
  get diagnostics v_messages = row_count;

  alter table public.applicant_notice_deliveries enable trigger notice_deliveries_no_delete;
  alter table public.applicant_notices enable trigger applicant_notices_append_only;
  alter table public.messages enable trigger messages_append_only;

  -- 2. The applications (everything else cascades)
  delete from loan_applications where id = any (v_apps);

  -- 3. Their audit trail (after: the cascade above is logged too)
  if not v_keep_audit then
    delete from audit_log where application_id = any (v_apps);
    get diagnostics v_audit = row_count;
  end if;

  raise notice 'Deleted application(s) % for %: % message(s), % notice(s), % delivery row(s), % audit row(s). Storage files stay in the bucket.',
    v_list, v_email, v_messages, v_notices, v_deliveries, v_audit;
end $$;
