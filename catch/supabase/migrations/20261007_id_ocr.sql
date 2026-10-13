-- CATCH — raw OCR of uploaded IDs (Module 1, first step; no LLM yet)
-- Run after 20261007_ao_kyc_verification.sql. Re-runnable, no drops of data.
--
-- Every uploaded Valid ID / Passport gets a PENDING row in ocr_runs (trigger on documents).
-- The local PaddleOCR worker (ocr-service/) claims pending runs with claim_ocr_runs(),
-- downloads the file from Storage, OCRs it and stores every detected text line in ocr_lines.
--
-- This is raw output only, for checking extraction quality. Nothing here touches the
-- application record: mapping lines to fields (and the human confirmation step) comes later.
-- The worker uses the service role key, so it bypasses RLS; clients only read.

-- ============================================================
-- 1. Tables
-- ============================================================
do $$ begin
  create type ocr_run_status as enum ('PENDING', 'RUNNING', 'DONE', 'FAILED');
exception when duplicate_object then null; end $$;

-- One row per OCR attempt on a document. Re-OCR = insert another row (history is kept).
create table if not exists public.ocr_runs (
  id bigint generated always as identity primary key,
  document_id bigint not null references public.documents(id) on delete cascade,
  status ocr_run_status not null default 'PENDING',
  engine text,                 -- e.g. 'paddleocr 3.7.0 / PP-OCRv5'
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  error text
);
create index if not exists ocr_runs_document_idx on public.ocr_runs (document_id);
create index if not exists ocr_runs_pending_idx on public.ocr_runs (created_at) where status = 'PENDING';

-- Every text line PaddleOCR detected, in reading order per page.
create table if not exists public.ocr_lines (
  id bigint generated always as identity primary key,
  run_id bigint not null references public.ocr_runs(id) on delete cascade,
  page_no int not null check (page_no >= 1),
  line_no int not null check (line_no >= 1),
  text text not null,
  confidence numeric(5, 4) not null check (confidence between 0 and 1),
  bbox jsonb not null,         -- 4 corner points [[x,y],...] in pixels of the page image
  unique (run_id, page_no, line_no)
);

-- Whole text per run (derived, so a view instead of a column) — easiest place to eyeball results.
create or replace view public.ocr_run_text with (security_invoker = true) as
select r.id as run_id, r.document_id, d.application_id, d.document_type, d.file_name,
       r.status, r.engine, r.finished_at, r.error,
       count(l.id) as line_count,
       round(avg(l.confidence), 4) as avg_confidence,
       string_agg(l.text, E'\n' order by l.page_no, l.line_no) as full_text
from ocr_runs r
join documents d on d.id = r.document_id
left join ocr_lines l on l.run_id = r.id
group by r.id, d.id;

-- ============================================================
-- 2. Queue: which document types get OCR'd on upload
-- ============================================================
create or replace function public.ocr_document_types()
returns text[] language sql immutable as $$
  select array['VALID_ID_PASSPORT'];
$$;

create or replace function public.queue_ocr_run() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.document_type = any (ocr_document_types()) then
    insert into ocr_runs (document_id) values (new.id);
  end if;
  return new;
end $$;

drop trigger if exists queue_ocr_run on public.documents;
create trigger queue_ocr_run
  after insert on public.documents
  for each row execute function public.queue_ocr_run();

-- Backfill: IDs uploaded before this migration that were never queued
insert into public.ocr_runs (document_id)
select d.id from public.documents d
where d.document_type = any (public.ocr_document_types())
  and not exists (select 1 from public.ocr_runs r where r.document_id = d.id);

-- Worker claims up to p_limit pending runs. SKIP LOCKED lets several workers run safely.
-- Also re-queues runs stuck in RUNNING for over 15 minutes (worker crashed mid-run).
create or replace function public.claim_ocr_runs(p_limit int default 1)
returns table (run_id bigint, document_id bigint, file_path text, file_name text, document_type text)
language plpgsql security definer set search_path = public as $$
begin
  update ocr_runs set status = 'PENDING', started_at = null
  where status = 'RUNNING' and started_at < now() - interval '15 minutes';

  return query
  with picked as (
    select r.id from ocr_runs r
    where r.status = 'PENDING'
    order by r.created_at
    limit p_limit
    for update skip locked)
  update ocr_runs r set status = 'RUNNING', started_at = now()
  from picked, documents d
  where r.id = picked.id and d.id = r.document_id
  returning r.id, d.id, d.file_path, d.file_name, d.document_type;
end $$;

-- Queue a fresh OCR run for a document (e.g. after changing OCR settings). Worker/SQL Editor only.
create or replace function public.requeue_ocr(p_document_id bigint)
returns bigint language sql security definer set search_path = public as $$
  insert into ocr_runs (document_id) values (p_document_id) returning id;
$$;

revoke execute on function public.claim_ocr_runs(int) from public, anon, authenticated;
revoke execute on function public.requeue_ocr(bigint) from public, anon, authenticated;
grant execute on function public.claim_ocr_runs(int) to service_role;
grant execute on function public.requeue_ocr(bigint) to service_role;

-- ============================================================
-- 3. Access: staff with access to the application read; no client writes
-- ============================================================
alter table public.ocr_runs enable row level security;
alter table public.ocr_lines enable row level security;

revoke insert, update, delete on public.ocr_runs, public.ocr_lines from anon, authenticated;
grant select on public.ocr_runs, public.ocr_lines, public.ocr_run_text to authenticated;

drop policy if exists "staff reads ocr runs" on public.ocr_runs;
create policy "staff reads ocr runs" on public.ocr_runs
  for select to authenticated
  using (public.staff_can_access((select application_id from public.documents where id = document_id)));

drop policy if exists "staff reads ocr lines" on public.ocr_lines;
create policy "staff reads ocr lines" on public.ocr_lines
  for select to authenticated
  using (exists (select 1 from public.ocr_runs r where r.id = run_id));
