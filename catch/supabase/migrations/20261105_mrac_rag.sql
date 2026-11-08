-- CATCH — MRAC / policy RAG: policy chunks (pgvector + full-text), MRAC criteria, and the check / ask queue
-- Run after 20261029_applicant_notices.sql. Re-runnable, no drops of data.
--
-- What this adds (nothing existing is changed):
--   * policy_chunks   the bank's Credit Policy Manual cut into clauses (python -m mrac.ingest.load_chunks).
--                     Chunks start as 'draft'; a reviewer sets 'approved' / 'retired'.
--   * mrac_criteria   the MRAC rules. Two kinds: 'auto' (field op threshold, optionally only when applies_when holds) and
--                     'manual' (a document / CI judgement the underwriter verifies). Loaded DISABLED from
--                     rules/housing_raac_draft.json (python -m mrac.ingest.load_criteria); only enabled = true rows are
--                     evaluated, and credit policy enables them one by one.
--   * mrac_runs       the queue, same pattern as ocr_runs: the CO (or any staff for a policy question) queues a run,
--                     the mrac-service worker claims it with the service role and saves the result.
--   * request_mrac_check(app, facts)   assigned CO only (co_can_edit). facts = the numbers the FP page already computes.
--   * ask_policy(question)             any staff member.
--   * claim_mrac_runs / search_policy  service role only (the worker).
--
-- Human in the loop, like the credit score: a result is a SUGGESTION. It never writes to fp_exceptions,
-- the approval tier or the credit result; the CO adds a suggested exception with one click and edits it.
--
-- The embedding is vector(384) (all-MiniLM-L6-v2). Another model/size = alter the column and re-load the chunks.
-- Retrieval = vector search + full-text search fused with Reciprocal Rank Fusion inside search_policy().

-- ============================================================
-- 0. Dependencies: stop before creating anything if an earlier migration is missing
-- ============================================================
do $$
begin
  if to_regclass('public.loan_applications') is null then
    raise exception 'Run the earlier migrations first: public.loan_applications is missing';
  end if;
  if to_regprocedure('public.staff_can_access(bigint)') is null
     or to_regprocedure('public.co_can_edit(bigint)') is null
     or to_regprocedure('public.is_staff()') is null then
    raise exception 'Run 20261020_financial_package.sql first: staff_can_access / co_can_edit / is_staff are missing';
  end if;
end $$;

create extension if not exists vector with schema extensions;

-- ============================================================
-- 1. Policy chunks
-- ============================================================
create table if not exists public.policy_chunks (
  id bigint generated always as identity primary key,
  document text not null,                 -- source file name
  chunk_key text not null,                -- stable id inside the document, e.g. CPM-IX-0095
  section text,
  heading_path text,                      -- e.g. IX > G. Insurance > 6. MRI Policy > c. Housing Loan
  revision_date date,                     -- the page's own REVISION DATE
  effective_from date,
  effective_to date,
  manual_pages text[] not null default '{}',
  pdf_pages int[] not null default '{}',
  tags text[] not null default '{}',      -- housing_loan, exception, approval_authority, ...
  products text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  body text not null,
  embedding vector(384),
  fts tsvector generated always as (to_tsvector('english', coalesce(heading_path, '') || ' ' || body)) stored,
  created_at timestamptz not null default now(),
  unique (document, chunk_key)
);
create index if not exists policy_chunks_fts on public.policy_chunks using gin (fts);
create index if not exists policy_chunks_tags on public.policy_chunks using gin (tags);
create index if not exists policy_chunks_embedding on public.policy_chunks using hnsw (embedding vector_cosine_ops);

-- ============================================================
-- 2. MRAC criteria (rules). Loaded disabled; credit policy enables them.
-- ============================================================
create table if not exists public.mrac_criteria (
  code text primary key,
  label text not null,
  section text,
  check_type text not null default 'auto' check (check_type in ('auto', 'manual')),
  field text,                             -- a key of the facts object (see src/pages/mrac/facts.js)
  op text check (op in ('<=', '>=', '<', '>', '==', '!=', 'in', 'not_in')),
  threshold jsonb,                        -- a number, a string, a boolean, or an array for in / not_in
  applies_when jsonb not null default '[]'::jsonb,   -- all must hold: [{"field":"loan_amount","op":">=","value":1000000}]
  options jsonb not null default '{}'::jsonb,        -- borderline_pct (numeric ops), fail_values (op 'in')
  prompt text,                            -- manual checks: what the underwriter verifies
  hard_stop boolean not null default false,
  enabled boolean not null default false,
  is_example boolean not null default false,
  search_hint text,                       -- the policy's own wording, used to find this rule's exception clauses
  source_chunk_key text,                  -- chunk_key of the policy clause the rule comes from
  source_chunk_id bigint references public.policy_chunks(id) on delete set null,
  notes text,
  updated_at timestamptz not null default now(),
  check (check_type = 'manual' or (field is not null and op is not null and threshold is not null)),
  check (check_type = 'auto' or prompt is not null)
);

-- ============================================================
-- 3. Queue
-- ============================================================
create table if not exists public.mrac_runs (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('CHECK', 'ASK')),
  application_id bigint references public.loan_applications(id) on delete cascade,
  question text,
  facts jsonb,
  status text not null default 'PENDING' check (status in ('PENDING', 'RUNNING', 'DONE', 'FAILED')),
  result jsonb,
  error text,
  engine text,
  requested_by uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  check (kind <> 'CHECK' or (application_id is not null and facts is not null)),
  check (kind <> 'ASK' or nullif(trim(question), '') is not null)
);
create index if not exists mrac_runs_pending on public.mrac_runs (created_at) where status = 'PENDING';
create index if not exists mrac_runs_application on public.mrac_runs (application_id, created_at desc);

-- ============================================================
-- 4. Functions
-- ============================================================
-- The assigned CO queues a check. Returns the run id; a check already waiting / running for the same
-- application and person is reused (double clicks don't pile up).
create or replace function public.request_mrac_check(p_application_id bigint, p_facts jsonb)
returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not public.co_can_edit(p_application_id) then
    raise exception 'Only the assigned Credit Officer can run the MRAC check';
  end if;
  if p_facts is null or jsonb_typeof(p_facts) <> 'object' or pg_column_size(p_facts) > 20000 then
    raise exception 'facts must be a JSON object under 20 kB';
  end if;
  select id into v_id from mrac_runs
    where kind = 'CHECK' and application_id = p_application_id and requested_by = auth.uid()
      and status in ('PENDING', 'RUNNING')
    order by id desc limit 1;
  if v_id is not null then return v_id; end if;
  insert into mrac_runs (kind, application_id, facts, requested_by)
    values ('CHECK', p_application_id, p_facts, auth.uid()) returning id into v_id;
  return v_id;
end $$;

-- Any staff member asks the policy a question
create or replace function public.ask_policy(p_question text)
returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not public.is_staff() then raise exception 'Staff only'; end if;
  if p_question is null or char_length(trim(p_question)) not between 3 and 500 then
    raise exception 'Ask a question of 3 to 500 characters';
  end if;
  if (select count(*) from mrac_runs where kind = 'ASK' and requested_by = auth.uid() and status in ('PENDING', 'RUNNING')) >= 3 then
    raise exception 'Wait for your earlier questions to finish';
  end if;
  insert into mrac_runs (kind, question, requested_by) values ('ASK', trim(p_question), auth.uid()) returning id into v_id;
  return v_id;
end $$;

-- Worker: claim queued runs (a run stuck in RUNNING for 15 minutes goes back to the queue)
create or replace function public.claim_mrac_runs(p_limit int default 1)
returns table (run_id bigint, run_kind text, run_application_id bigint, run_question text, run_facts jsonb)
language plpgsql security definer set search_path = public as $$
begin
  update mrac_runs set status = 'PENDING', started_at = null
  where status = 'RUNNING' and started_at < now() - interval '15 minutes';

  return query
  with picked as (
    select r.id from mrac_runs r
    where r.status = 'PENDING'
    order by r.created_at
    limit p_limit
    for update skip locked)
  update mrac_runs r set status = 'RUNNING', started_at = now()
  from picked
  where r.id = picked.id
  returning r.id, r.kind, r.application_id, r.question, r.facts;
end $$;

-- Worker: hybrid retrieval. Candidates are filtered first (status, dates, tags), then vector rank and
-- full-text rank are fused with RRF (k = 60). The full-text query is OR-style (any word may match, more words rank
-- higher); vector candidates below p_min_similarity are dropped so an unrelated clause is never returned just because
-- it is the nearest. Fine for a few thousand chunks (no ANN index use after the filter).
create or replace function public.search_policy(
  p_query text,
  p_embedding vector(384),
  p_limit int default 5,
  p_tags text[] default null,
  p_on date default current_date,
  p_include_draft boolean default true,
  p_min_similarity double precision default 0.25)
returns table (id bigint, chunk_key text, document text, heading_path text, manual_pages text[],
               revision_date date, status text, tags text[], body text, score double precision)
language sql stable security definer set search_path = public, extensions as $$
  with eligible as (
    select c.* from policy_chunks c
    where c.status <> 'retired'
      and (p_include_draft or c.status = 'approved')
      and (c.effective_from is null or c.effective_from <= p_on)
      and (c.effective_to is null or c.effective_to >= p_on)
      and (p_tags is null or c.tags && p_tags)
  ), v as (
    select e.id, row_number() over (order by e.embedding <=> p_embedding) as rn
    from eligible e
    where e.embedding is not null and 1 - (e.embedding <=> p_embedding) >= p_min_similarity
    order by e.embedding <=> p_embedding limit 30
  ), l as (
    select e.id, row_number() over (order by ts_rank_cd(e.fts, q) desc) as rn
    from eligible e,
         websearch_to_tsquery('english', regexp_replace(trim(p_query), '\s+', ' or ', 'g')) q
    where e.fts @@ q
    order by ts_rank_cd(e.fts, q) desc limit 30
  ), fused as (
    select coalesce(v.id, l.id) as id,
           coalesce(1.0 / (60 + v.rn), 0) + coalesce(1.0 / (60 + l.rn), 0) as score
    from v full join l on l.id = v.id
  )
  select c.id, c.chunk_key, c.document, c.heading_path, c.manual_pages, c.revision_date, c.status, c.tags, c.body,
         f.score::double precision
  from fused f join policy_chunks c on c.id = f.id
  order by f.score desc
  limit p_limit;
$$;

revoke execute on function public.claim_mrac_runs(int) from public, anon, authenticated;
revoke execute on function public.search_policy(text, vector, int, text[], date, boolean, double precision) from public, anon, authenticated;
grant execute on function public.claim_mrac_runs(int) to service_role;
grant execute on function public.search_policy(text, vector, int, text[], date, boolean, double precision) to service_role;

revoke execute on function public.request_mrac_check(bigint, jsonb) from public, anon;
revoke execute on function public.ask_policy(text) from public, anon;
grant execute on function public.request_mrac_check(bigint, jsonb) to authenticated;
grant execute on function public.ask_policy(text) to authenticated;

-- ============================================================
-- 5. Access: staff read; no client writes (the worker uses the service role)
-- ============================================================
alter table public.policy_chunks enable row level security;
alter table public.mrac_criteria enable row level security;
alter table public.mrac_runs enable row level security;

revoke all on public.policy_chunks, public.mrac_criteria, public.mrac_runs from anon;
revoke insert, update, delete, truncate on public.policy_chunks, public.mrac_criteria, public.mrac_runs from authenticated;
grant select on public.policy_chunks, public.mrac_criteria, public.mrac_runs to authenticated;

drop policy if exists "staff read policy chunks" on public.policy_chunks;
create policy "staff read policy chunks" on public.policy_chunks
  for select to authenticated using (public.is_staff());

drop policy if exists "staff read mrac criteria" on public.mrac_criteria;
create policy "staff read mrac criteria" on public.mrac_criteria
  for select to authenticated using (public.is_staff());

-- A check is readable by staff who can open the application; a policy question only by who asked it
drop policy if exists "read mrac runs" on public.mrac_runs;
create policy "read mrac runs" on public.mrac_runs
  for select to authenticated
  using ((application_id is not null and public.staff_can_access(application_id)) or requested_by = auth.uid());
