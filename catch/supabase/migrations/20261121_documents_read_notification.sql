-- CATCH — tell the Account Officer when the AI has finished reading an application's documents (2026-11-21)
-- Run after 20261120_credit_ai_suggestions.sql (needs 20261109_ai_extraction.sql and 20261024_notifications.sql).
-- Re-runnable, no drops of data. Independent of 20261121_replace_documents.sql (either order).
--
-- Decided 2026-11-21 (Dobbe, from the Account Officer's side): the AO should not have to keep the Document check page
-- open to know the AI is done. When the last document of an application that is still being read finishes (read, or
-- could not be read), the assigned Account Officer gets ONE alert in the bell:
--     "Documents are ready to check for HL-2026-000012"
--     "3 read by the AI, waiting for your check; 1 could not be read."
-- and a click opens the Document check. One alert per batch, not one per file: with 4 to 12 documents arriving a
-- minute apart, an alert for each would bury the bell.
--
-- How it decides
--   * Fires when an extraction run ends (DONE or FAILED) or an OCR run fails (no extraction follows a failed OCR).
--   * Only the applicant's documents the AI reads (document types in extraction_field_defs) that are still current
--     (files a new upload replaced are ignored). CI reports (NFIS / TU) are not covered here.
--   * If any of those documents is still waiting for OCR or the AI, it stays quiet: the run that finishes last sends
--     the alert. A per-application lock makes sure two runs finishing together send exactly one.
--   * Counts: documents with a finished AI reading that nobody has confirmed yet, and documents that could not be read.
--     Nothing to count (everything is already confirmed) = no alert.
--   * Goes to the assigned Account Officer only (kind DOCUMENTS_READ, source workflow). Switch row, on: turn it off with
--       update public.notification_switches set enabled = false where kind = 'DOCUMENTS_READ';
--   * A failure inside the alert is only a warning: it can never fail or slow the OCR / AI worker.
--
-- Nothing is written to an application: this only adds a notification. No existing function or trigger is changed.

-- ============================================================
-- 0. Dependencies
-- ============================================================
do $$
declare
  v_missing text;
begin
  select string_agg(m, ', ') into v_missing
  from (values ('public.extraction_runs', '20261109_ai_extraction.sql'),
               ('public.notification_switches', '20261024_notifications.sql'),
               ('public.documents', '20260928_application_side.sql')) d (t, m)
  where to_regclass(t) is null;
  if v_missing is not null then
    raise exception 'Run these migrations first, then this file again: %', v_missing;
  end if;
end $$;

insert into public.notification_switches (kind, enabled, note) values
  ('DOCUMENTS_READ', true, 'The assigned Account Officer hears when the AI has finished reading an application''s documents')
on conflict (kind) do nothing;

-- ============================================================
-- 1. The alert, once per batch
-- ============================================================
create or replace function public.notify_ao_documents_read(p_application_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_busy boolean;
  v_ready int;
  v_unread int;
begin
  -- one at a time per application, so two runs that finish together can't both stay quiet
  perform pg_advisory_xact_lock(7121, p_application_id::int);

  select exists (
    select 1 from documents d
    where d.application_id = p_application_id and d.requirement_id is not null
      and d.document_type = any (extraction_document_types())
      and (exists (select 1 from ocr_runs o where o.document_id = d.id and o.status::text in ('PENDING', 'RUNNING'))
           or exists (select 1 from extraction_runs e join ocr_runs o on o.id = e.ocr_run_id
                      where o.document_id = d.id and e.status::text in ('PENDING', 'RUNNING')))
  ) into v_busy;
  if v_busy then return; end if;

  select count(*) filter (where lo.ocr = 'FAILED' or le.ai = 'FAILED'),
         count(*) filter (where le.ai = 'DONE' and le.confirmed_at is null)
  into v_unread, v_ready
  from documents d
  left join lateral (select o.status::text as ocr from ocr_runs o where o.document_id = d.id order by o.id desc limit 1) lo on true
  left join lateral (select e.status::text as ai, e.confirmed_at from extraction_runs e join ocr_runs o on o.id = e.ocr_run_id
                     where o.document_id = d.id order by e.id desc limit 1) le on true
  where d.application_id = p_application_id and d.requirement_id is not null
    and d.document_type = any (extraction_document_types());
  if coalesce(v_ready, 0) + coalesce(v_unread, 0) = 0 then return; end if;

  perform send_notification('DOCUMENTS_READ',
    'Documents are ready to check for ' || notification_app_no(p_application_id),
    trim(both ' ' from
      case when v_ready > 0 then v_ready || ' read by the AI, waiting for your check' else '' end
      || case when v_ready > 0 and v_unread > 0 then '; ' else '' end
      || case when v_unread > 0 then v_unread || ' could not be read' else '' end || '.'),
    p_application_id, p_assigned => array['ACCOUNT_OFFICER'],
    p_link => '/documentCheckPage?id=' || p_application_id);
end $$;
revoke execute on function public.notify_ao_documents_read(bigint) from public, anon, authenticated;

-- ============================================================
-- 2. Triggers: an extraction run ended, or an OCR run failed
-- ============================================================
create or replace function public.notify_ao_on_extraction_end() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_app bigint;
begin
  begin
    select d.application_id into v_app
    from ocr_runs o join documents d on d.id = o.document_id where o.id = new.ocr_run_id;
    if v_app is not null then perform notify_ao_documents_read(v_app); end if;
  exception when others then
    raise warning 'notify_ao_on_extraction_end failed: %', sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists notify_ao_on_extraction_end on public.extraction_runs;
create trigger notify_ao_on_extraction_end after update of status on public.extraction_runs
  for each row when (new.status::text in ('DONE', 'FAILED') and old.status is distinct from new.status)
  execute function public.notify_ao_on_extraction_end();

create or replace function public.notify_ao_on_ocr_failed() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_app bigint;
begin
  begin
    select d.application_id into v_app from documents d where d.id = new.document_id;
    if v_app is not null then perform notify_ao_documents_read(v_app); end if;
  exception when others then
    raise warning 'notify_ao_on_ocr_failed failed: %', sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists notify_ao_on_ocr_failed on public.ocr_runs;
create trigger notify_ao_on_ocr_failed after update of status on public.ocr_runs
  for each row when (new.status::text = 'FAILED' and old.status is distinct from new.status and new.document_id is not null)
  execute function public.notify_ao_on_ocr_failed();
