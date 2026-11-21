-- CATCH — MRAC policy recommender: the Credit Officer's decision on each finding, and the worker's progress.
-- Run after 20261122_mrac_profile.sql (needs 20261105_mrac_rag.sql, 20261007_ao_kyc_verification.sql for audit_log,
-- co_can_edit and staff_can_access). Re-runnable, no data dropped.
--
-- What it does
--   * mrac_runs.progress: the worker's current step ("Claude is reading 34 policy clauses"), shown while a check runs.
--   * mrac_finding_reviews: one decision per finding of a check run (ACCEPTED / EDITED / DISMISSED, a reason required
--     to dismiss). Human-in-the-loop: the recommender only proposes; this records what the CO did with each proposal.
--     The application is the run's (not stored twice). Every insert / update / delete goes to audit_log.
--   * review_mrac_finding(p_run_id, p_chunk_key, p_decision, p_reason, p_edited): the only way to write. Assigned CO of
--     the run's application, finished check only, the finding must be in that run's recommendations. p_decision 'UNDO'
--     removes the decision (logged).
--   * Staff who can open the application read the decisions (Decision Support, final report).
do $$
declare
  v_missing text;
begin
  select string_agg(n, ', ') into v_missing
  from unnest(array['public.mrac_runs', 'public.audit_log', 'public.loan_applications']) n
  where to_regclass(n) is null;
  if v_missing is not null then raise exception 'Missing (run the earlier migrations first): %', v_missing; end if;
  if to_regprocedure('public.co_can_edit(bigint)') is null or to_regprocedure('public.staff_can_access(bigint)') is null then
    raise exception 'Missing co_can_edit / staff_can_access: run the earlier migrations first';
  end if;
end $$;

alter table public.mrac_runs add column if not exists progress text;
comment on column public.mrac_runs.progress is 'The worker''s current step while a check runs (shown to the CO).';

create table if not exists public.mrac_finding_reviews (
  id bigint generated always as identity primary key,
  run_id bigint not null references public.mrac_runs(id) on delete cascade,
  chunk_key text not null check (length(chunk_key) between 1 and 200),
  decision text not null check (decision in ('ACCEPTED', 'EDITED', 'DISMISSED')),
  reason text check (reason is null or (reason = btrim(reason) and length(reason) between 1 and 500)),
  edited jsonb check (edited is null or (jsonb_typeof(edited) = 'object' and pg_column_size(edited) <= 6000)),
  reviewed_by uuid not null default auth.uid(),
  reviewed_at timestamptz not null default now(),
  unique (run_id, chunk_key),
  check (decision <> 'DISMISSED' or reason is not null),
  check (decision = 'EDITED' or edited is null)
);

-- Audit: same audit_log as every application table; the application is found through the run
create or replace function public.log_mrac_review() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_app bigint;
begin
  select application_id into v_app from mrac_runs where id = (v_row->>'run_id')::bigint;
  if v_app is null then return null; end if;
  insert into audit_log (application_id, table_name, row_id, action, old_data, new_data, changed_by)
  values (v_app, tg_table_name, (v_row->>'id')::bigint, tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end, auth.uid());
  return null;
end $$;
revoke execute on function public.log_mrac_review() from public, anon, authenticated;

drop trigger if exists log_mrac_review on public.mrac_finding_reviews;
create trigger log_mrac_review after insert or update or delete on public.mrac_finding_reviews
  for each row execute function public.log_mrac_review();

create or replace function public.review_mrac_finding(p_run_id bigint, p_chunk_key text, p_decision text,
                                                      p_reason text default null, p_edited jsonb default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_run mrac_runs;
  v_reason text := nullif(btrim(coalesce(p_reason, ''), E' \t\r\n'), '');
  v_key text;
  v_id bigint;
begin
  select * into v_run from mrac_runs where id = p_run_id;
  if v_run.id is null or v_run.kind <> 'CHECK' then raise exception 'Policy check not found'; end if;
  if not public.co_can_edit(v_run.application_id) then
    raise exception 'Only the assigned Credit Officer can review the policy findings';
  end if;
  if v_run.status <> 'DONE' then raise exception 'The policy check has not finished'; end if;
  if not exists (
    select 1 from jsonb_each(coalesce(v_run.result #> '{recommendations,groups}', '{}'::jsonb)) g,
                  jsonb_array_elements(case when jsonb_typeof(g.value) = 'array' then g.value else '[]' end) f
    where f->>'chunk_key' = p_chunk_key) then
    raise exception 'That finding is not in this policy check';
  end if;

  if p_decision = 'UNDO' then
    delete from mrac_finding_reviews where run_id = p_run_id and chunk_key = p_chunk_key returning id into v_id;
    return v_id;
  end if;
  if p_decision not in ('ACCEPTED', 'EDITED', 'DISMISSED') then raise exception 'Unknown decision: %', p_decision; end if;
  if p_decision = 'DISMISSED' and v_reason is null then raise exception 'Say why the finding is dismissed'; end if;
  if p_decision = 'EDITED' then
    if p_edited is null or jsonb_typeof(p_edited) <> 'object' then raise exception 'An edited finding needs its edited text'; end if;
    for v_key in select jsonb_object_keys(p_edited) loop
      if v_key not in ('policy', 'recommendation', 'mitigant', 'text') then raise exception 'Unexpected edited field: %', v_key; end if;
      if jsonb_typeof(p_edited->v_key) <> 'string' or length(p_edited->>v_key) > 1500 then
        raise exception 'Edited field % must be text under 1,500 characters', v_key;
      end if;
    end loop;
  end if;

  insert into mrac_finding_reviews (run_id, chunk_key, decision, reason, edited)
  values (p_run_id, p_chunk_key, p_decision, v_reason, case when p_decision = 'EDITED' then p_edited end)
  on conflict (run_id, chunk_key) do update
    set decision = excluded.decision, reason = excluded.reason, edited = excluded.edited,
        reviewed_by = auth.uid(), reviewed_at = now()
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.review_mrac_finding(bigint, text, text, text, jsonb) from public, anon;
grant execute on function public.review_mrac_finding(bigint, text, text, text, jsonb) to authenticated;

alter table public.mrac_finding_reviews enable row level security;
revoke all on public.mrac_finding_reviews from anon;
revoke insert, update, delete, truncate on public.mrac_finding_reviews from authenticated;
grant select on public.mrac_finding_reviews to authenticated;

drop policy if exists "staff read mrac finding reviews" on public.mrac_finding_reviews;
create policy "staff read mrac finding reviews" on public.mrac_finding_reviews
  for select to authenticated
  using (exists (select 1 from mrac_runs r where r.id = run_id and r.application_id is not null
                 and public.staff_can_access(r.application_id)));
