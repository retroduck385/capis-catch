-- CATCH — copy an application at whatever stage it is in (demo preparation) (2026-11-27)
-- Run after every earlier migration. Re-runnable. Synthetic data only: this is a demo / testing tool.
--
-- clone_application(application, owner e-mail, fresh) makes an exact copy of one application: the parties and the
-- form, the documents, OCR + AI readings and their confirmations, the KYC checks and clarifications, the CI request
-- and results, the Financial Package, credit score, policy-check runs and reviews, AI suggestions, the reviewer and
-- approver sign-offs, messages, document requests, applicant notices and the audit trail. The copy sits at the same
-- stage, with the same status, assignees (same AO / CO / CI / reviewers / approvers) and history, under a new
-- application number. The source is not touched.
--
--   * Run it through catch/scripts/cloneApplication.mjs, not on its own: SQL cannot copy files in Storage, so the
--     script calls this function and then copies each file to the copy's folder ({user}/{new app}/..., ci/{new app}/...).
--     Called from the SQL Editor alone, the copy's rows point at files that don't exist yet (they won't open).
--   * Not copied: notifications (the copy would ring every bell again). Nothing is sent: every trigger on the copied
--     tables is off while the rows are written (ALTER TABLE ... DISABLE TRIGGER USER, back on before the function
--     returns; foreign keys stay checked). So no notices, notifications, audit rows or auto-assignments fire.
--   * Work that was still queued / running when copied (OCR, AI extraction, policy check, AI suggestion) is copied as
--     FAILED with a note, and queued SMS / e-mail deliveries as SKIPPED, so the workers never pick the copy's up.
--   * p_owner_email: the applicant account that owns the copy (null = the same account). A DRAFT can only be copied
--     to another account (one draft per account).
--   * p_fresh = true moves every timestamp of the copy by the same amount so its latest event is "now": turnaround
--     times and SLA colours look like the source did when it was copied. Dates (birth dates, FP date prepared, ...)
--     are not moved.
--   * Text that names the application number (notices, reminders, their SMS / e-mail) gets the new number. JSON
--     snapshots (policy-check facts, AI inputs / outputs, audit old/new data) keep the source's ids: history only.
--   * Guard: before copying, the function checks the database for tables / *_id columns linked to an application that
--     it does not know (e.g. a teammate's new migration) and stops with their names. Add them to v_cfg below.
--   * Only the service role (the script) and the SQL Editor can run it.
--
-- Undo: delete the copy like any application, e.g. the delete script in Test Datas # 8 (by account), or by number:
--   messages / applicant notices / their deliveries are append-only, see that script for the trigger switches.

-- ============================================================
-- 1. Storage key of a copied file: {owner}/{new app}/rest  or  ci/{new app}/rest
-- ============================================================
create or replace function public.clone_application_path(p_path text, p_app bigint, p_owner uuid)
returns text language sql immutable set search_path = public as $$
  select case when split_part(p_path, '/', 1) = 'ci' then 'ci' else p_owner::text end
         || '/' || p_app::text
         || substr(p_path, length(split_part(p_path, '/', 1)) + length(split_part(p_path, '/', 2)) + 2);
$$;

revoke execute on function public.clone_application_path(text, bigint, uuid) from public, anon, authenticated;

-- ============================================================
-- 2. clone_application()
-- ============================================================
create or replace function public.clone_application(p_application_id bigint,
                                                    p_owner_email text default null,
                                                    p_fresh boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  -- Copy order = parents before children. Per table:
  --   t     table
  --   own   the column(s) that tie a row to the source application (a row is copied when one of them points at a
  --         copied row); "where" replaces it with a condition of its own
  --   map   column -> table whose copied id goes in it (columns that point at other copied rows)
  --   set   column -> SQL for the copy's value (s = the source row); {src} {new} {owner} {old_no} {new_no} {note}
  --   no_id the table has no id column (composite key)
  v_cfg jsonb := $cfg$[
    {"t": "loan_applications", "where": "s.id = {src}",
     "set": {"user_id": "{owner}::uuid", "application_no": "{new_no}"}},
    {"t": "applicants", "own": "application_id", "map": {"application_id": "loan_applications"}},
    {"t": "dependents", "own": "applicant_id", "map": {"applicant_id": "applicants"}},
    {"t": "addresses", "own": "applicant_id", "map": {"applicant_id": "applicants"}},
    {"t": "employment_info", "own": "applicant_id", "map": {"applicant_id": "applicants"}},
    {"t": "bank_accounts", "own": "applicant_id", "map": {"applicant_id": "applicants"}},
    {"t": "existing_loans", "own": "applicant_id", "map": {"applicant_id": "applicants"}},
    {"t": "credit_cards", "own": "applicant_id", "map": {"applicant_id": "applicants"}},
    {"t": "character_references", "own": "application_id", "map": {"application_id": "loan_applications"}},
    {"t": "collateral_details", "own": "application_id", "map": {"application_id": "loan_applications"}},
    {"t": "referral_details", "own": "application_id", "map": {"application_id": "loan_applications"}},
    {"t": "application_requirements", "own": "applicant_id", "map": {"applicant_id": "applicants"}},
    {"t": "documents", "own": "application_id",
     "map": {"application_id": "loan_applications", "applicant_id": "applicants",
             "requirement_id": "application_requirements", "superseded_by": "documents",
             "replaced_requirement_id": "application_requirements"},
     "set": {"file_path": "clone_application_path(s.file_path, {new}, {owner}::uuid)"}},
    {"t": "fp_party_details", "own": "applicant_id", "map": {"applicant_id": "applicants"}},
    {"t": "ci_checks", "own": "applicant_id", "map": {"applicant_id": "applicants"}},
    {"t": "ci_report_values", "own": "applicant_id", "map": {"applicant_id": "applicants"}},
    {"t": "application_stages", "own": "application_id", "map": {"application_id": "loan_applications"}},
    {"t": "stage_status_changes", "own": "stage_visit_id", "map": {"stage_visit_id": "application_stages"}},
    {"t": "application_assignments", "own": "application_id", "map": {"application_id": "loan_applications"}},
    {"t": "kyc_checks", "own": "application_id", "map": {"application_id": "loan_applications"}},
    {"t": "kyc_clarifications", "own": "application_id",
     "map": {"application_id": "loan_applications", "opened_check_id": "kyc_checks", "closed_check_id": "kyc_checks"}},
    {"t": "kyc_clarification_messages", "own": "application_id",
     "map": {"application_id": "loan_applications", "clarification_id": "kyc_clarifications"}},
    {"t": "kyc_clarification_files", "own": "application_id",
     "map": {"application_id": "loan_applications", "message_id": "kyc_clarification_messages"},
     "set": {"file_path": "clone_application_path(s.file_path, {new}, {owner}::uuid)"}},
    {"t": "ci_requests", "own": "application_id",
     "map": {"application_id": "loan_applications", "stage_visit_id": "application_stages"}},
    {"t": "ci_documents", "own": "applicant_id", "map": {"applicant_id": "applicants"},
     "set": {"file_path": "clone_application_path(s.file_path, {new}, {owner}::uuid)"}},
    {"t": "ocr_runs", "own": ["document_id", "ci_document_id"],
     "map": {"document_id": "documents", "ci_document_id": "ci_documents"},
     "set": {"status": "case when s.status in ('PENDING', 'RUNNING') then 'FAILED' else s.status end",
             "error": "case when s.status in ('PENDING', 'RUNNING') then {note} else s.error end"}},
    {"t": "ocr_lines", "own": "run_id", "map": {"run_id": "ocr_runs"}},
    {"t": "ocr_pages", "own": "run_id", "map": {"run_id": "ocr_runs"}, "no_id": true},
    {"t": "extraction_runs", "own": "ocr_run_id", "map": {"ocr_run_id": "ocr_runs"},
     "set": {"status": "case when s.status in ('PENDING', 'RUNNING') then 'FAILED' else s.status end",
             "error": "case when s.status in ('PENDING', 'RUNNING') then {note} else s.error end"}},
    {"t": "extraction_fields", "own": "run_id", "map": {"run_id": "extraction_runs"}},
    {"t": "extraction_field_lines", "own": "field_id",
     "map": {"field_id": "extraction_fields", "line_id": "ocr_lines"}, "no_id": true},
    {"t": "ci_nfis_records", "own": "applicant_id",
     "map": {"applicant_id": "applicants", "full_payment_doc_id": "ci_documents", "extraction_run_id": "extraction_runs"}},
    {"t": "ci_tu_accounts", "own": "applicant_id",
     "map": {"applicant_id": "applicants", "extraction_run_id": "extraction_runs"}},
    {"t": "financial_packages", "own": "application_id", "map": {"application_id": "loan_applications"}},
    {"t": "fp_exceptions", "own": "application_id", "map": {"application_id": "loan_applications"}},
    {"t": "fp_deposit_checks", "own": "application_id", "map": {"application_id": "loan_applications"}},
    {"t": "fp_loan_checks", "own": "application_id", "map": {"application_id": "loan_applications"}},
    {"t": "fp_trade_checks", "own": "application_id", "map": {"application_id": "loan_applications"}},
    {"t": "fp_title_verifications", "own": "application_id", "map": {"application_id": "loan_applications"}},
    {"t": "credit_score_entries", "own": "application_id", "map": {"application_id": "loan_applications"}},
    {"t": "review_assignments", "own": "application_id", "map": {"application_id": "loan_applications"}},
    {"t": "review_decisions", "own": "application_id",
     "map": {"application_id": "loan_applications", "assignment_id": "review_assignments"}},
    {"t": "review_decision_items", "own": "decision_id", "map": {"decision_id": "review_decisions"}, "no_id": true},
    {"t": "approval_decisions", "own": "application_id",
     "map": {"application_id": "loan_applications", "assignment_id": "review_assignments"}},
    {"t": "mrac_runs", "own": "application_id", "map": {"application_id": "loan_applications"},
     "set": {"status": "case when s.status in ('PENDING', 'RUNNING') then 'FAILED' else s.status end",
             "error": "case when s.status in ('PENDING', 'RUNNING') then {note} else s.error end"}},
    {"t": "mrac_finding_reviews", "own": "run_id", "map": {"run_id": "mrac_runs"}},
    {"t": "credit_ai_suggestions", "own": "application_id",
     "map": {"application_id": "loan_applications", "mrac_run_id": "mrac_runs"},
     "set": {"status": "case when s.status in ('QUEUED', 'RUNNING') then 'FAILED' else s.status end",
             "error": "case when s.status in ('QUEUED', 'RUNNING') then {note} else s.error end"}},
    {"t": "messages", "own": "application_id", "map": {"application_id": "loan_applications"}},
    {"t": "message_reads", "own": "application_id", "map": {"application_id": "loan_applications"}, "no_id": true,
     "set": {"last_read_id": "coalesce((select max(m.new_id) from _clone_map m join messages om on om.id = m.old_id where m.tbl = 'messages' and om.id <= s.last_read_id), 0)"}},
    {"t": "applicant_outcomes", "own": "application_id", "map": {"application_id": "loan_applications"}},
    {"t": "document_requests", "own": "application_id", "map": {"application_id": "loan_applications"}},
    {"t": "document_request_items", "own": "request_id",
     "map": {"request_id": "document_requests", "applicant_id": "applicants"}},
    {"t": "document_request_uploads", "own": "item_id",
     "map": {"item_id": "document_request_items", "document_id": "documents"}, "no_id": true},
    {"t": "document_request_reminders", "own": "application_id",
     "map": {"application_id": "loan_applications", "request_id": "document_requests"},
     "set": {"in_app_title": "replace(s.in_app_title, {old_no}, {new_no})",
             "in_app_body": "replace(s.in_app_body, {old_no}, {new_no})",
             "sms_text": "replace(s.sms_text, {old_no}, {new_no})",
             "email_subject": "replace(s.email_subject, {old_no}, {new_no})",
             "email_body": "replace(s.email_body, {old_no}, {new_no})"}},
    {"t": "document_reminder_deliveries", "own": "reminder_id", "map": {"reminder_id": "document_request_reminders"},
     "set": {"status": "case when s.status in ('QUEUED', 'RUNNING') then 'SKIPPED' else s.status end",
             "last_error": "case when s.status in ('QUEUED', 'RUNNING') then {note} else s.last_error end",
             "subject": "replace(s.subject, {old_no}, {new_no})", "body": "replace(s.body, {old_no}, {new_no})"}},
    {"t": "applicant_notices", "own": "application_id",
     "map": {"application_id": "loan_applications", "outcome_id": "applicant_outcomes",
             "request_id": "document_requests", "clarification_id": "kyc_clarifications",
             "correction_of": "applicant_notices"},
     "set": {"in_app_title": "replace(s.in_app_title, {old_no}, {new_no})",
             "in_app_body": "replace(s.in_app_body, {old_no}, {new_no})",
             "sms_text": "replace(s.sms_text, {old_no}, {new_no})",
             "email_subject": "replace(s.email_subject, {old_no}, {new_no})",
             "email_body": "replace(s.email_body, {old_no}, {new_no})"}},
    {"t": "applicant_notice_deliveries", "own": "notice_id", "map": {"notice_id": "applicant_notices"},
     "set": {"status": "case when s.status in ('QUEUED', 'RUNNING') then 'SKIPPED' else s.status end",
             "last_error": "case when s.status in ('QUEUED', 'RUNNING') then {note} else s.last_error end",
             "subject": "replace(s.subject, {old_no}, {new_no})", "body": "replace(s.body, {old_no}, {new_no})"}},
    {"t": "ci_finding_flags", "own": "application_id", "map": {"application_id": "loan_applications"}},
    {"t": "document_file_marks", "own": "application_id",
     "map": {"application_id": "loan_applications", "document_id": "documents", "applicant_id": "applicants"}},
    {"t": "document_manual_values", "own": "application_id",
     "map": {"application_id": "loan_applications", "document_id": "documents"}},
    {"t": "audit_log", "own": "application_id", "map": {"application_id": "loan_applications"},
     "set": {"row_id": "coalesce((select m.new_id from _clone_map m where m.tbl = s.table_name and m.old_id = s.row_id), s.row_id)"}}
  ]$cfg$;
  v_skip text[] := array['notifications'];   -- linked to an application, deliberately not copied

  v_src      loan_applications%rowtype;
  v_owner    uuid;
  v_new      bigint;
  v_new_no   text;
  v_tables   text[];
  v_bad      text;
  v_note     text := 'Copied by clone_application() while still in progress: run it again on the copy.';
  e          jsonb;
  v_t        text;
  v_rel      regclass;
  v_has_id   boolean;
  v_filter   text;
  v_cols     text;
  v_exprs    text;
  v_sql      text;
  v_rows     int;
  v_counts   jsonb := '{}';
  v_max      timestamptz;
  v_tmax     timestamptz;
  v_shift    interval := interval '0';
  v_files    jsonb;
begin
  -- ---------- source and owner ----------
  select * into v_src from loan_applications where id = p_application_id;
  if not found then raise exception 'clone_application: no application with id %', p_application_id; end if;

  if p_owner_email is null then
    v_owner := v_src.user_id;
  else
    select u.id into v_owner from auth.users u where lower(u.email) = lower(btrim(p_owner_email));
    if v_owner is null then raise exception 'clone_application: no account with e-mail %', p_owner_email; end if;
    if (select role::text from users where id = v_owner) is distinct from 'APPLICANT' then
      raise exception 'clone_application: % is not an applicant account', p_owner_email;
    end if;
  end if;
  if v_src.status::text = 'DRAFT'
     and exists (select 1 from loan_applications where user_id = v_owner and status::text = 'DRAFT') then
    raise exception 'clone_application: application % is a DRAFT and that account already has a draft (one per account): give another applicant e-mail', p_application_id;
  end if;

  -- ---------- guard: anything linked to an application that this list doesn't know ----------
  v_tables := array(select x->>'t' from jsonb_array_elements(v_cfg) x);

  with cfg as (select x->>'t' as t, x as e from jsonb_array_elements(v_cfg) x)
  select string_agg(distinct format('%s.%s', bad.rel, bad.col), ', ') into v_bad
  from (
    -- foreign keys to a copied table's id: from a table not in the list, or a column the list doesn't remap correctly
    select cl.relname::text as rel, a.attname::text as col
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_class rc on rc.oid = c.confrelid
    cross join lateral unnest(c.conkey, c.confkey) as k(col, rcol)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.col
    join pg_attribute ra on ra.attrelid = c.confrelid and ra.attnum = k.rcol
    left join cfg on cfg.t = cl.relname
    where c.contype = 'f' and cl.relnamespace = 'public'::regnamespace
      and rc.relname = any (v_tables) and ra.attname = 'id'
      and cl.relname <> all (v_skip)
      and (cfg.t is null or (cfg.e->'map'->>a.attname::text) is distinct from rc.relname::text)
    union all
    -- bigint *_id columns without a foreign key in a copied table, not remapped
    select cl.relname::text, a.attname::text
    from pg_attribute a
    join pg_class cl on cl.oid = a.attrelid
    join cfg on cfg.t = cl.relname
    where a.attnum > 0 and not a.attisdropped and a.atttypid = 'bigint'::regtype
      and a.attname like '%\_id'
      and not (cfg.e->'map' ? a.attname::text) and not (coalesce(cfg.e->'set', '{}') ? a.attname::text)
      and not exists (select 1 from pg_constraint c where c.conrelid = cl.oid and c.contype = 'f'
                                                      and a.attnum = any (c.conkey))
    union all
    -- other tables with an application_id
    select cl.relname::text, a.attname::text
    from pg_attribute a
    join pg_class cl on cl.oid = a.attrelid
    where cl.relnamespace = 'public'::regnamespace and cl.relkind = 'r'
      and a.attnum > 0 and not a.attisdropped and a.attname = 'application_id'
      and cl.relname <> all (v_tables) and cl.relname <> all (v_skip)
  ) bad;
  if v_bad is not null then
    raise exception 'clone_application does not know these yet (add them to v_cfg in 20261209_clone_application.sql): %', v_bad;
  end if;

  -- ---------- copy ----------
  create temp table if not exists _clone_map (tbl text, old_id bigint, new_id bigint, primary key (tbl, old_id))
    on commit drop;
  truncate _clone_map;

  foreach v_t in array v_tables loop
    execute format('alter table public.%I disable trigger user', v_t);
  end loop;

  if v_src.application_no is not null then
    v_new_no := 'HL-' || to_char(now() at time zone 'Asia/Manila', 'YYYY') || '-'
                || lpad(nextval('application_no_seq')::text, 6, '0');
  end if;

  for e in select x from jsonb_array_elements(v_cfg) x loop
    v_t := e->>'t';
    v_rel := format('public.%I', v_t)::regclass;
    v_has_id := not coalesce((e->>'no_id')::boolean, false);

    if e ? 'where' then
      v_filter := e->>'where';
    else
      select string_agg(format('s.%I in (select old_id from _clone_map where tbl = %L)', o, e->'map'->>o), ' or ')
        into v_filter
      from jsonb_array_elements_text(case jsonb_typeof(e->'own') when 'array' then e->'own'
                                          else jsonb_build_array(e->'own') end) o;
    end if;

    select string_agg(format('%I', a.attname), ', ' order by a.attnum),
           string_agg(case when coalesce(e->'set', '{}') ? a.attname::text then e->'set'->>a.attname::text
                           when coalesce(e->'map', '{}') ? a.attname::text
                             then format('(select m.new_id from _clone_map m where m.tbl = %L and m.old_id = s.%I)',
                                         e->'map'->>a.attname::text, a.attname)
                           else format('s.%I', a.attname) end, ', ' order by a.attnum)
      into v_cols, v_exprs
    from pg_attribute a
    where a.attrelid = v_rel and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
      and not (v_has_id and a.attname = 'id');

    v_exprs := replace(replace(replace(replace(replace(replace(v_exprs,
                 '{src}', p_application_id::text),
                 '{new}', coalesce(v_new::text, 'null')),
                 '{owner}', quote_literal(v_owner::text)),
                 '{old_no}', quote_nullable(v_src.application_no)),
                 '{new_no}', quote_nullable(v_new_no)),
                 '{note}', quote_literal(v_note));
    v_filter := replace(v_filter, '{src}', p_application_id::text);

    if v_has_id then
      -- new ids handed out in the source's id order, so "latest = highest id" stays true in the copy
      execute format('insert into _clone_map (tbl, old_id, new_id)
                      select %L, x.id, nextval(%L) from (select s.id from public.%I s where %s order by s.id) x',
                     v_t, pg_get_serial_sequence(format('public.%I', v_t), 'id'), v_t, v_filter);
      execute format('insert into public.%I (id, %s) overriding system value
                      select m.new_id, %s from public.%I s join _clone_map m on m.tbl = %L and m.old_id = s.id
                      order by s.id',
                     v_t, v_cols, v_exprs, v_t, v_t);
    else
      execute format('insert into public.%I (%s) select %s from public.%I s where %s', v_t, v_cols, v_exprs, v_t, v_filter);
    end if;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then v_counts := v_counts || jsonb_build_object(v_t, v_rows); end if;

    if v_t = 'loan_applications' then
      select new_id into v_new from _clone_map where tbl = 'loan_applications';
    end if;
  end loop;

  -- ---------- p_fresh: move every timestamp so the copy's latest event is now ----------
  if p_fresh then
    for e in select x from jsonb_array_elements(v_cfg) x loop
      v_t := e->>'t';
      select string_agg(format('max(s.%I)', a.attname), ', ') into v_cols
      from pg_attribute a
      where a.attrelid = format('public.%I', v_t)::regclass and a.attnum > 0 and not a.attisdropped
        and a.atttypid = 'timestamptz'::regtype;
      continue when v_cols is null;
      if coalesce((e->>'no_id')::boolean, false) then
        v_sql := format('select greatest(%s) from public.%I s where s.%I in (select new_id from _clone_map where tbl = %L)',
                        v_cols, v_t, e->>'own', e->'map'->>(e->>'own'));
      else
        v_sql := format('select greatest(%s) from public.%I s where s.id in (select new_id from _clone_map where tbl = %L)',
                        v_cols, v_t, v_t);
      end if;
      execute v_sql into v_tmax;
      v_max := greatest(v_max, v_tmax);
    end loop;
    if v_max is not null and v_max < now() then v_shift := now() - v_max; end if;

    if v_shift > interval '0' then
      for e in select x from jsonb_array_elements(v_cfg) x loop
        v_t := e->>'t';
        select string_agg(format('%1$I = %1$I + %2$L::interval', a.attname, v_shift), ', ') into v_cols
        from pg_attribute a
        where a.attrelid = format('public.%I', v_t)::regclass and a.attnum > 0 and not a.attisdropped
          and a.atttypid = 'timestamptz'::regtype;
        continue when v_cols is null;
        if coalesce((e->>'no_id')::boolean, false) then
          execute format('update public.%I set %s where %I in (select new_id from _clone_map where tbl = %L)',
                         v_t, v_cols, e->>'own', e->'map'->>(e->>'own'));
        else
          execute format('update public.%I set %s where id in (select new_id from _clone_map where tbl = %L)',
                         v_t, v_cols, v_t);
        end if;
      end loop;
    end if;
  end if;

  foreach v_t in array v_tables loop
    execute format('alter table public.%I enable trigger user', v_t);
  end loop;

  -- ---------- the files the script must copy in Storage ----------
  select coalesce(jsonb_agg(jsonb_build_object('from', f.old_path, 'to', f.new_path) order by f.new_path), '[]')
    into v_files
  from (
    select o.file_path as old_path, n.file_path as new_path
    from _clone_map m join documents o on o.id = m.old_id join documents n on n.id = m.new_id
    where m.tbl = 'documents'
    union all
    select o.file_path, n.file_path
    from _clone_map m join ci_documents o on o.id = m.old_id join ci_documents n on n.id = m.new_id
    where m.tbl = 'ci_documents'
    union all
    select o.file_path, n.file_path
    from _clone_map m join kyc_clarification_files o on o.id = m.old_id join kyc_clarification_files n on n.id = m.new_id
    where m.tbl = 'kyc_clarification_files'
  ) f;

  return jsonb_build_object(
    'application_id', v_new,
    'application_no', v_new_no,
    'source_application_no', v_src.application_no,
    'status', v_src.status,
    'owner', v_owner,
    'shifted_by', case when v_shift > interval '0' then v_shift::text end,
    'rows', v_counts,
    'bucket', 'application-documents',
    'files', v_files);
end $$;

revoke execute on function public.clone_application(bigint, text, boolean) from public, anon, authenticated;
grant execute on function public.clone_application(bigint, text, boolean) to service_role;
