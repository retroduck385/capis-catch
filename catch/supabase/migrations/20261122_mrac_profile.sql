-- CATCH — MRAC policy recommender: the application profile a policy check runs on.
-- Run after 20261122_mrac_embedding_model.sql (needs 20261105_mrac_rag.sql). Re-runnable, no data dropped.
--
-- What it does
--   * mrac_runs.profile: the wider picture the recommender reads (borrower types by ROLE, documents on file, CI results,
--     collateral, figures), built by the FP page (catch/src/pages/mrac/profile.js). The flat `facts` stay what the
--     rules test and what "figures changed since the check" compares. Kept on the run so every recommendation can be
--     traced to exactly what it was given (audit), like credit_ai_suggestions.input.
--   * request_mrac_check(p_application_id, p_facts, p_profile default null): same as before, plus the profile, refused
--     when it holds a personal field (mrac_profile_problem). Two-argument calls still work.
--   * claim_mrac_runs also returns run_profile to the worker.
--
-- The profile goes to the Claude API (an external model) through mrac-service: de-identified, borrowers by role only.
do $$
begin
  if to_regclass('public.mrac_runs') is null then
    raise exception 'Run 20261105_mrac_rag.sql first: public.mrac_runs is missing';
  end if;
end $$;

alter table public.mrac_runs add column if not exists profile jsonb;

comment on column public.mrac_runs.profile is
  'De-identified application profile the policy recommender ran on (catch/src/pages/mrac/profile.js). Borrowers by role only.';

-- null = fine; otherwise why the profile is refused
create or replace function public.mrac_profile_problem(p_profile jsonb)
returns text language plpgsql immutable set search_path = public as $$
declare
  v_key text;
begin
  if p_profile is null then return null; end if;
  if jsonb_typeof(p_profile) <> 'object' or pg_column_size(p_profile) > 30000 then
    return 'The profile must be a JSON object under 30 kB';
  end if;
  for v_key in select jsonb_object_keys(p_profile) loop
    if v_key not in ('schema', 'loan', 'borrowers', 'other_parties', 'totals', 'credit_score', 'ci', 'documents', 'exceptions') then
      return 'Unexpected part in the profile: ' || v_key;
    end if;
  end loop;
  -- every key at any depth (same pattern as credit_suggestion_input_problem)
  select k into v_key
  from jsonb_path_query(p_profile, 'strict $.**') v, lateral (
    select jsonb_object_keys(v) k where jsonb_typeof(v) = 'object') x
  where k ~* '((^|_)name$|address|email|mobile|phone|birth|gender|civil|dependent|residence|length_of_stay|^tin$|account_number|^tct|application_no)'
  limit 1;
  if v_key is not null then return 'The profile contains a personal field: ' || v_key; end if;
  return null;
end $$;
revoke execute on function public.mrac_profile_problem(jsonb) from public, anon, authenticated;

drop function if exists public.request_mrac_check(bigint, jsonb);

create or replace function public.request_mrac_check(p_application_id bigint, p_facts jsonb, p_profile jsonb default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
  v_problem text;
begin
  if not public.co_can_edit(p_application_id) then
    raise exception 'Only the assigned Credit Officer can run the MRAC check';
  end if;
  if p_facts is null or jsonb_typeof(p_facts) <> 'object' or pg_column_size(p_facts) > 20000 then
    raise exception 'facts must be a JSON object under 20 kB';
  end if;
  v_problem := public.mrac_profile_problem(p_profile);
  if v_problem is not null then raise exception '%', v_problem; end if;
  select id into v_id from mrac_runs
    where kind = 'CHECK' and application_id = p_application_id and requested_by = auth.uid()
      and status in ('PENDING', 'RUNNING')
    order by id desc limit 1;
  if v_id is not null then return v_id; end if;
  insert into mrac_runs (kind, application_id, facts, profile, requested_by)
    values ('CHECK', p_application_id, p_facts, p_profile, auth.uid()) returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.request_mrac_check(bigint, jsonb, jsonb) from public, anon;
grant execute on function public.request_mrac_check(bigint, jsonb, jsonb) to authenticated;

-- Worker: same as before, plus the profile
drop function if exists public.claim_mrac_runs(int);

create or replace function public.claim_mrac_runs(p_limit int default 1)
returns table (run_id bigint, run_kind text, run_application_id bigint, run_question text, run_facts jsonb, run_profile jsonb)
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
  returning r.id, r.kind, r.application_id, r.question, r.facts, r.profile;
end $$;

revoke execute on function public.claim_mrac_runs(int) from public, anon, authenticated;
grant execute on function public.claim_mrac_runs(int) to service_role;
