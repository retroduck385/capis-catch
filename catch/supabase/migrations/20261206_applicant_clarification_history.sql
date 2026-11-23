-- The applicant can read their closed KYC clarification questions (history), not only the open ones.
-- my_kyc_clarifications() still returns OPEN threads only (the Reply cards); this adds
-- my_kyc_clarification_history(application_id): that application's CLOSED threads, newest first, in the applicant's
-- view (kyc_clarification_json(id, false): no staff names). Read only; the applicant's files stay readable through the
-- existing "applicant reads own files" storage policy. Shown in the "Past questions" popup on the applicant's
-- submitted application (src/pages/kycClarify/applicantClarifyHistory.jsx).
--
-- Needs: 20261203_kyc_clarifications.sql and 20261204_kyc_clarification_guard.sql (adds 'withdrawn' to the JSON).

do $$
begin
  if to_regclass('public.kyc_clarifications') is null
     or to_regprocedure('public.kyc_clarification_json(bigint, boolean)') is null then
    raise exception 'Run 20261203_kyc_clarifications.sql and 20261204_kyc_clarification_guard.sql first, then this file again';
  end if;
end $$;

create or replace function public.my_kyc_clarification_history(p_application_id bigint)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(kyc_clarification_json(c.id, false)
                            || jsonb_build_object('application_no', la.application_no)
                            order by c.closed_at desc nulls last, c.id desc), '[]'::jsonb)
  from kyc_clarifications c join loan_applications la on la.id = c.application_id
  where la.id = p_application_id and la.user_id = auth.uid() and c.status = 'CLOSED';
$$;

revoke execute on function public.my_kyc_clarification_history(bigint) from public, anon;
grant execute on function public.my_kyc_clarification_history(bigint) to authenticated;
