-- CATCH — wake the OCR worker on upload instead of polling every few seconds.
-- Run after 20261108_ci_results.sql. Re-runnable.
--
-- Adds ocr_runs to the supabase_realtime publication. The worker (ocr-service/worker.py) subscribes
-- to INSERTs on ocr_runs with the service role key, so a new upload (or requeue_ocr / requeue_ci_ocr)
-- starts OCR right away. RLS still applies to every other subscriber: staff only receive runs they
-- can already read. The worker keeps a slow fallback poll for anything missed while disconnected.

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ocr_runs') then
    alter publication supabase_realtime add table public.ocr_runs;
  end if;
end $$;
