-- CATCH — Decision Support (basic): the policy-check (MRAC / RAG) results are not shown to Credit Investigators
-- Run after 20261105_mrac_rag.sql. Re-runnable, no drops of data.
--
-- Decided 2026-11-11: the Decision Support page (/decisionSupportPage) is for every staff role except the
-- Credit Investigator (DSS_ROLES in src/roles.js). The page only reads existing data; the one thing it adds is the
-- MRAC check, so the read policy on mrac_runs now leaves the CI out for checks on an application.
-- A staff member's own policy question (ask_policy, application_id null) stays readable by whoever asked it.

do $$
begin
  if to_regclass('public.mrac_runs') is null or to_regprocedure('public.current_user_role()') is null then
    raise exception 'Run 20261105_mrac_rag.sql first, then this file again';
  end if;
end $$;

drop policy if exists "read mrac runs" on public.mrac_runs;
create policy "read mrac runs" on public.mrac_runs
  for select to authenticated
  using ((application_id is not null
          and public.current_user_role() <> 'CREDIT_INVESTIGATOR'
          and public.staff_can_access(application_id))
         or requested_by = auth.uid());
