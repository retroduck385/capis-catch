-- CATCH — AI suggestion for the Credit Officer's credit result (group meeting follow-ups, part D, 2026-11-18)
-- Run after 20261119_document_request_reminders.sql (needs 20261020_financial_package.sql, 20261105_mrac_rag.sql,
-- 20261024_notifications.sql and 20261007_ao_kyc_verification.sql). Re-runnable, no drops of data.
--
-- The bank cleared the data privacy question (Q-04) on 2026-11-20: the de-identified figures below and the policy
-- findings go to the Claude API (an external model). The filters stay.
--
-- What it does
--   * The assigned Credit Officer asks for a suggestion on the Financial Package (request_credit_suggestion), while
--     the file is in Credit Evaluation and only with a finished policy check (MRAC / RAG) that is the latest one for
--     the file and was run on the same figures as now (the facts are compared; changed figures = run the check
--     again). One request waits at a time per file.
--   * The input is built by the page from saved, confirmed values only: loan figures, income per borrower ROLE (no
--     names), DBR / LCR, the credit score without the Condition criteria (only their sub-total: never gender, civil
--     status, dependents, residence type, length of stay or age bands), CI results per role (no summaries), the
--     recorded exceptions. The function refuses an input with personal fields or a Condition criterion in it.
--   * The advise-service worker (advise-service/advise.py, service role; was ocr-service until 2026-11-22) claims it,
--     adds the policy check's rule results and recommender findings with the CO's reviews (mrac_finding_reviews),
--     calls Claude, keeps only reasons that cite a finding it was given, flags untraceable figures, and saves
--     the suggestion with exactly what was sent (sent), the model and the tokens. Without ANTHROPIC_API_KEY the
--     request stays QUEUED.
--   * The suggestion never sets the credit result: the Credit Officer may copy the draft justification and edits it.
--   * The requesting Credit Officer gets AI_SUGGESTION_READY in the bell (switch row, on).
--
-- Table credit_ai_suggestions: RLS on, staff who can open the file read (Decision Support, final report); no client
-- writes. The request (who, when, input, policy check) never changes; only the worker moves the status and saves the
-- result. Rows go only with their application. Inserts and updates are logged in audit_log (agent executions).
--
-- Calls
--   request_credit_suggestion(p_application_id, p_mrac_run_id, p_input jsonb, p_facts jsonb)  -> id   (assigned CO)
--   claim_credit_suggestions(p_limit) / save_credit_suggestion(...) / fail_credit_suggestion(...)   service role only
--   select from credit_ai_suggestions (RLS)

-- ============================================================
-- 0. Dependencies
-- ============================================================
do $$
declare
  v_missing text;
begin
  select string_agg(m, ', ') into v_missing
  from (values ('public.financial_packages', '20261020_financial_package.sql'),
               ('public.mrac_runs', '20261105_mrac_rag.sql'),
               ('public.notifications', '20261024_notifications.sql'),
               ('public.audit_log', '20261007_ao_kyc_verification.sql')) d (t, m)
  where to_regclass(t) is null;
  if v_missing is not null then
    raise exception 'Run these migrations first, then this file again: %', v_missing;
  end if;
end $$;

-- ============================================================
-- 1. Table
-- ============================================================
create table if not exists public.credit_ai_suggestions (
  id bigint generated always as identity primary key,
  application_id bigint not null,
  mrac_run_id bigint not null,
  input jsonb not null,                       -- the figures used, as built by the page (no names)
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  status text not null default 'QUEUED' check (status in ('QUEUED', 'RUNNING', 'DONE', 'FAILED')),
  attempts smallint not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  model text,                                 -- the model that answered
  sent jsonb,                                 -- exactly what went to the model (input + policy summary + excerpts)
  output jsonb,                               -- { suggested_result, reasons [{text, chunk_key}], draft_justification, missing_data, notes }
  input_tokens integer,
  output_tokens integer,                      -- includes thinking
  error text,
  check (status <> 'DONE' or output is not null),
  check (output is null or output->>'suggested_result' in ('ENDORSED', 'NOT_ENDORSED', 'DEFERRED'))
);
create index if not exists credit_ai_suggestions_application on public.credit_ai_suggestions (application_id, id);
create index if not exists credit_ai_suggestions_queue on public.credit_ai_suggestions (id) where status in ('QUEUED', 'RUNNING');

do $$ begin
  delete from public.credit_ai_suggestions s where not exists (select 1 from public.loan_applications la where la.id = s.application_id);
  if not exists (select 1 from pg_constraint where conname = 'credit_ai_suggestions_application_fk') then
    alter table public.credit_ai_suggestions add constraint credit_ai_suggestions_application_fk
      foreign key (application_id) references public.loan_applications(id) on delete cascade;
  end if;
end $$;

insert into public.notification_switches (kind, enabled, note) values
  ('AI_SUGGESTION_READY', true, 'The Credit Officer who asked hears when the AI suggestion for the credit result is ready')
on conflict (kind) do nothing;

-- The worker is woken by new requests (Realtime), like ocr_runs / extraction_runs
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'credit_ai_suggestions') then
    alter publication supabase_realtime add table public.credit_ai_suggestions;
  end if;
end $$;

-- ============================================================
-- 2. Guards: the request never changes; no deletes except with the application
-- ============================================================
create or replace function public.credit_suggestion_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from loan_applications la where la.id = old.application_id) then return old; end if;
    raise exception 'AI suggestions can''t be deleted';
  end if;
  if tg_op = 'TRUNCATE' then raise exception 'AI suggestions can''t be deleted'; end if;
  if new.application_id is distinct from old.application_id or new.mrac_run_id is distinct from old.mrac_run_id
     or new.input is distinct from old.input or new.requested_by is distinct from old.requested_by
     or new.requested_at is distinct from old.requested_at then
    raise exception 'The request of an AI suggestion can''t be changed';
  end if;
  if old.status in ('DONE', 'FAILED') then
    raise exception 'A finished AI suggestion can''t be changed';
  end if;
  return new;
end $$;
revoke execute on function public.credit_suggestion_guard() from public, anon, authenticated;

drop trigger if exists credit_suggestion_guard on public.credit_ai_suggestions;
create trigger credit_suggestion_guard before update or delete on public.credit_ai_suggestions
  for each row execute function public.credit_suggestion_guard();
drop trigger if exists credit_suggestion_no_truncate on public.credit_ai_suggestions;
create trigger credit_suggestion_no_truncate before truncate on public.credit_ai_suggestions
  for each statement execute function public.credit_suggestion_guard();

drop trigger if exists log_application_change on public.credit_ai_suggestions;
create trigger log_application_change after insert or update on public.credit_ai_suggestions
  for each row execute function public.log_application_change('application_id');

-- ============================================================
-- 3. RLS: staff who can open the file read; no client writes
-- ============================================================
alter table public.credit_ai_suggestions enable row level security;
revoke all on public.credit_ai_suggestions from anon, authenticated;
grant select on public.credit_ai_suggestions to authenticated;
drop policy if exists "staff read credit ai suggestions" on public.credit_ai_suggestions;
create policy "staff read credit ai suggestions" on public.credit_ai_suggestions
  for select to authenticated using (public.staff_can_access(application_id));

-- ============================================================
-- 4. request_credit_suggestion(): the assigned Credit Officer
-- ============================================================
-- Personal fields that must never be in the input (keys anywhere in the JSON)
create or replace function public.credit_suggestion_input_problem(p_input jsonb)
returns text language plpgsql stable set search_path = public as $$
declare
  v_key text;
  v_crit text;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' or pg_column_size(p_input) > 30000 then
    return 'The input must be a JSON object under 30 kB';
  end if;
  for v_key in select jsonb_object_keys(p_input) loop
    if v_key not in ('schema', 'loan', 'borrowers', 'totals', 'credit_score', 'ci', 'exceptions') then
      return 'Unexpected part in the input: ' || v_key;
    end if;
  end loop;
  -- every key at any depth
  select k into v_key
  from jsonb_path_query(p_input, 'strict $.**') v, lateral (
    select jsonb_object_keys(v) k where jsonb_typeof(v) = 'object') x
  where k ~* '((^|_)name$|address|email|mobile|phone|birth|gender|civil|dependent|residence|length_of_stay|^tin$|account_number|^tct|application_no)'
  limit 1;
  if v_key is not null then return 'The input contains a personal field: ' || v_key; end if;
  -- no Condition criteria (only their sub-total)
  select c.code into v_crit
  from jsonb_array_elements(coalesce(p_input #> '{credit_score,criteria}', '[]'::jsonb)) e
  join credit_score_criteria c on c.code = e->>'criterion'
  where c.category::text = 'CONDITION'
  limit 1;
  if v_crit is not null then return 'Condition criteria are sent as a sub-total only: ' || v_crit; end if;
  return null;
end $$;
revoke execute on function public.credit_suggestion_input_problem(jsonb) from public, anon, authenticated;

-- Numbers in both fact sets must match (tiny tolerance); other values must be equal
create or replace function public.credit_suggestion_facts_changed(p_run jsonb, p_now jsonb)
returns text[] language sql immutable as $$
  select coalesce(array_agg(k order by k), '{}')
  from jsonb_object_keys(coalesce(p_now, '{}')) k
  where k <> 'schema' and coalesce(p_run, '{}') ? k
    and case when jsonb_typeof(p_run->k) = 'number' and jsonb_typeof(p_now->k) = 'number'
             then abs((p_run->>k)::numeric - (p_now->>k)::numeric) > 0.000001 * greatest(1, abs((p_now->>k)::numeric))
             else (p_run->k) is distinct from (p_now->k) end;
$$;

create or replace function public.request_credit_suggestion(p_application_id bigint, p_mrac_run_id bigint,
                                                            p_input jsonb, p_facts jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_run mrac_runs;
  v_latest bigint;
  v_problem text;
  v_changed text[];
  v_id bigint;
begin
  if not co_can_edit(p_application_id) then
    raise exception 'Only the assigned Credit Officer can ask for an AI suggestion';
  end if;
  if coalesce((select stage::text from application_stages where application_id = p_application_id and left_at is null), '') <> 'CREDIT_EVALUATION' then
    raise exception 'An AI suggestion can be asked for while the file is in Credit Evaluation';
  end if;
  select * into v_run from mrac_runs where id = p_mrac_run_id and kind = 'CHECK' and application_id = p_application_id;
  select max(id) into v_latest from mrac_runs where kind = 'CHECK' and application_id = p_application_id;
  if v_run.id is null or v_run.status <> 'DONE' or v_latest is distinct from v_run.id then
    raise exception 'Run the policy check first and wait for it to finish';
  end if;
  if p_facts is null or jsonb_typeof(p_facts) <> 'object' then
    raise exception 'The figures changed since the policy check (no figures given). Run the policy check again first';
  end if;
  v_changed := credit_suggestion_facts_changed(v_run.facts, p_facts);
  if cardinality(v_changed) > 0 then
    raise exception 'The figures changed since the policy check (%). Run the policy check again first',
      coalesce(array_to_string(v_changed, ', '), 'no figures given');
  end if;
  v_problem := credit_suggestion_input_problem(p_input);
  if v_problem is not null then raise exception '%', v_problem; end if;

  select id into v_id from credit_ai_suggestions
  where application_id = p_application_id and status in ('QUEUED', 'RUNNING') order by id desc limit 1;
  if v_id is not null then return v_id; end if;   -- one at a time per file (double clicks don't pile up)

  insert into credit_ai_suggestions (application_id, mrac_run_id, input, requested_by)
  values (p_application_id, p_mrac_run_id, p_input, auth.uid()) returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.request_credit_suggestion(bigint, bigint, jsonb, jsonb) from public, anon;
grant execute on function public.request_credit_suggestion(bigint, bigint, jsonb, jsonb) to authenticated;

-- ============================================================
-- 5. The worker (service role)
-- ============================================================
-- Up to p_limit queued requests (and RUNNING ones stuck for 15 minutes), marked RUNNING, with the policy check result
create or replace function public.claim_credit_suggestions(p_limit integer default 1)
returns table (suggestion_id bigint, application_id bigint, input jsonb, policy jsonb)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with picked as (
    select s.id from credit_ai_suggestions s
    where s.status = 'QUEUED' or (s.status = 'RUNNING' and s.started_at < now() - interval '15 minutes')
    order by s.id limit greatest(p_limit, 1) for update skip locked),
  claimed as (
    update credit_ai_suggestions s set status = 'RUNNING', started_at = now(), attempts = s.attempts + 1
    from picked where s.id = picked.id
    returning s.id, s.application_id, s.input, s.mrac_run_id)
  select c.id, c.application_id, c.input, r.result
  from claimed c left join mrac_runs r on r.id = c.mrac_run_id;
end $$;

create or replace function public.save_credit_suggestion(p_id bigint, p_model text, p_sent jsonb, p_output jsonb,
                                                         p_input_tokens integer default null, p_output_tokens integer default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_row credit_ai_suggestions;
  v_label text;
begin
  select * into v_row from credit_ai_suggestions where id = p_id for update;
  if not found or v_row.status <> 'RUNNING' then raise exception 'Suggestion % is not running', p_id; end if;
  update credit_ai_suggestions
  set status = 'DONE', model = p_model, sent = p_sent, output = p_output, input_tokens = p_input_tokens,
      output_tokens = p_output_tokens, finished_at = now(), error = null
  where id = p_id;
  v_label := case p_output->>'suggested_result' when 'ENDORSED' then 'Endorsed' when 'NOT_ENDORSED' then 'Not endorsed' else 'Deferred' end;
  perform send_notification('AI_SUGGESTION_READY', 'AI suggestion ready for ' || notification_app_no(v_row.application_id),
    'Suggested credit result: ' || v_label || '. The credit result is still yours to set.', v_row.application_id,
    p_users => array[v_row.requested_by], p_link => '/financialPackagePage?id=' || v_row.application_id || '#fp-result',
    p_skip_actor => false);
end $$;

-- A failure that retrying won't fix (the worker already retried once)
create or replace function public.fail_credit_suggestion(p_id bigint, p_error text, p_model text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update credit_ai_suggestions set status = 'FAILED', error = left(coalesce(p_error, 'Unknown error'), 2000),
    model = coalesce(p_model, model), finished_at = now()
  where id = p_id and status = 'RUNNING';
  if not found then raise exception 'Suggestion % is not running', p_id; end if;
end $$;

-- Rate limit: back to the queue (does not count as a failure)
create or replace function public.requeue_credit_suggestion(p_id bigint)
returns void language sql security definer set search_path = public as $$
  update credit_ai_suggestions set status = 'QUEUED', started_at = null where id = p_id and status = 'RUNNING';
$$;

revoke execute on function public.claim_credit_suggestions(integer) from public, anon, authenticated;
revoke execute on function public.save_credit_suggestion(bigint, text, jsonb, jsonb, integer, integer) from public, anon, authenticated;
revoke execute on function public.fail_credit_suggestion(bigint, text, text) from public, anon, authenticated;
revoke execute on function public.requeue_credit_suggestion(bigint) from public, anon, authenticated;
revoke execute on function public.credit_suggestion_facts_changed(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.claim_credit_suggestions(integer) to service_role;
grant execute on function public.save_credit_suggestion(bigint, text, jsonb, jsonb, integer, integer) to service_role;
grant execute on function public.fail_credit_suggestion(bigint, text, text) to service_role;
grant execute on function public.requeue_credit_suggestion(bigint) to service_role;
