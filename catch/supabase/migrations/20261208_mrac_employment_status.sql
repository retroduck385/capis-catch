-- CATCH — the policy check reads each borrower's employment status from their confirmed COEC (2026-11-27)
-- Run after 20261122_mrac_profile.sql and 20261109_ai_extraction.sql. Re-runnable.
--
-- The application form never asks for employment status (Regular / Probationary / Contractual); it is only on the
-- COEC, where the AI reads it into the COE_ITR field `employment_status` and the Account Officer confirms it in the
-- Document check. Until now that confirmed value was stored but never used, so the policy check could not see that a
-- borrower is probationary (RAAC, Employment status and tenure: locally employed borrowers must be regular /
-- permanent; a probationary employee needs 2 years of continuous work experience).
--
-- 1. mrac_employment_facts(): per locally employed borrower, the CONFIRMED status only (human-in-the-loop: an
--    unconfirmed AI reading never counts). Facts:
--      non_regular_borrowers  how many locally employed borrowers are confirmed as not regular / permanent;
--                             null (needs review) when none is non-regular but some status is not confirmed yet
--      employment_statuses    e.g. "principal borrower: Regular; co-borrower 2: Probationary" (role labels only)
-- 2. request_mrac_check(): same as 20261122, plus those facts merged in on the server, so every check gets them
--    without a front-end change (a fact the page sends under the same name is overwritten).
-- 3. RAAC-EMP-REGULAR (enabled): non_regular_borrowers <= 0, cited to RAAC-HL-07-EMPLOYMENT-STATUS-TENURE. When it
--    fails, the recommender sets that clause to "not met" with action "exception", so the Credit Officer gets an
--    exception card (+ Add to V. Exception/s). A flag for the CO, never an automatic rejection. CATCH does not know a
--    borrower's previous jobs, so the 2-years-of-experience part stays the CO's mitigant.

-- ============================================================
-- 1. Employment status facts from the confirmed COEC readings
-- ============================================================
create or replace function public.mrac_employment_facts(p_application_id bigint)
returns jsonb language sql stable security definer set search_path = public as $$
  with s as (
    select party_label_text(a.id) as party, a.role, a.party_no,
           (select nullif(btrim(coalesce(f.final_value, f.extracted_value)), '')
              from documents d
              join ocr_runs o on o.document_id = d.id
              join extraction_runs e on e.ocr_run_id = o.id and e.confirmed_at is not null
              join extraction_fields f on f.run_id = e.id and f.field_key = 'employment_status' and f.item_no = 0
             where d.applicant_id = a.id and d.document_type = 'COE_ITR' and d.superseded_by is null
             order by e.confirmed_at desc, e.id desc
             limit 1) as status
    from applicants a
    join employment_info ei on ei.applicant_id = a.id
    where a.application_id = p_application_id and ei.employment_type::text = 'LOCALLY_EMPLOYED'
  ), t as (
    select *, status is not null
              and status ~* '(regular|permanent)'
              and status !~* '(non[- ]?regular|not regular|probation|contractual|casual|project|seasonal|temporary)'
              as regular
    from s
  )
  select jsonb_build_object(
    'non_regular_borrowers',
      case when count(*) filter (where status is not null and not regular) > 0
                then count(*) filter (where status is not null and not regular)
           when count(*) filter (where status is null) > 0 then null
           else 0 end,
    'employment_statuses',
      string_agg(party || ': ' || coalesce(status, 'not confirmed yet'), '; ' order by role, party_no))
  from t;
$$;
revoke execute on function public.mrac_employment_facts(bigint) from public, anon, authenticated;

-- ============================================================
-- 2. Every check gets those facts (body otherwise identical to 20261122_mrac_profile.sql)
-- ============================================================
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
  p_facts := p_facts || public.mrac_employment_facts(p_application_id);
  insert into mrac_runs (kind, application_id, facts, profile, requested_by)
    values ('CHECK', p_application_id, p_facts, p_profile, auth.uid()) returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.request_mrac_check(bigint, jsonb, jsonb) from public, anon;
grant execute on function public.request_mrac_check(bigint, jsonb, jsonb) to authenticated;

-- ============================================================
-- 3. The rule (also in mrac-service/rules/housing_raac_draft.json; the loader keeps this row's enabled flag)
-- ============================================================
do $$
begin
  if to_regclass('public.mrac_criteria') is null then
    raise exception 'Run 20261105_mrac_rag.sql first, then this file again';
  end if;
  if not exists (select 1 from public.policy_chunks where chunk_key = 'RAAC-HL-07-EMPLOYMENT-STATUS-TENURE') then
    raise notice 'Policy clause RAAC-HL-07-EMPLOYMENT-STATUS-TENURE is not loaded: the rule works, but shows no cited clause';
  end if;
end $$;

insert into public.mrac_criteria (code, label, section, check_type, field, op, threshold, applies_when, options,
                                  hard_stop, enabled, search_hint, source_chunk_key, source_chunk_id, notes, updated_at)
values ('RAAC-EMP-REGULAR', 'Locally employed borrowers are regular / permanent', 'Capacity', 'auto',
        'non_regular_borrowers', '<=', '0'::jsonb, '[]'::jsonb, '{}'::jsonb, false, true,
        'employment status and tenure', 'RAAC-HL-07-EMPLOYMENT-STATUS-TENURE',
        (select id from public.policy_chunks where chunk_key = 'RAAC-HL-07-EMPLOYMENT-STATUS-TENURE' order by id limit 1),
        'Fact from each locally employed borrower''s confirmed COEC employment status (mrac_employment_facts, merged in '
        || 'by request_mrac_check). Probationary / contractual = exception for the CO with a mitigant (2 years of '
        || 'continuous work experience, or the loan holds without that income); never an automatic rejection.',
        now())
on conflict (code) do update set
  label = excluded.label, section = excluded.section, check_type = excluded.check_type, field = excluded.field,
  op = excluded.op, threshold = excluded.threshold, applies_when = excluded.applies_when, options = excluded.options,
  hard_stop = excluded.hard_stop, enabled = true, search_hint = excluded.search_hint,
  source_chunk_key = excluded.source_chunk_key, source_chunk_id = excluded.source_chunk_id, notes = excluded.notes,
  updated_at = now();
