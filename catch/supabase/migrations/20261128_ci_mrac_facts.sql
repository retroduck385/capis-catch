-- CATCH — the policy check reads the CI's NFIS records: switch on the replevin / foreclosure rule (2026-11-22)
-- Run after 20261127_ci_report_values.sql (needs 20261105_mrac_rag.sql and the criteria loaded). Re-runnable.
--
-- The FP's policy check now sends has_replevin_or_foreclosure (src/pages/mrac/facts.js, from ci_nfis_records via
-- ciFacts.js): true when any borrower's NFIS lists a replevin or foreclosure, false when none does, null (needs review)
-- while an NFIS result is missing. The RAAC (RAAC-HL-03-NFIS-BMI-DATABASE, note under the acceptable records):
-- "Borrower/s with history of replevin or foreclosure will not be allowed, regardless of date of report."
-- Decided with Josh (2026-11-22): turn the rule on. It is a flag for the Credit Officer (an exception summary),
-- never an automatic rejection. The other new facts (nfis_deviation_count, nfis_lcr_cap_breaches,
-- undisclosed_tu_accounts, expired_ci_reports) have no rule yet; the recommender reads them from the profile.
do $$
begin
  if to_regclass('public.mrac_criteria') is null then
    raise exception 'Run 20261105_mrac_rag.sql first, then this file again';
  end if;
  if not exists (select 1 from public.mrac_criteria where code = 'RAAC-NO-REPLEVIN') then
    raise notice 'RAAC-NO-REPLEVIN is not loaded yet: run python -m mrac.ingest.load_criteria (mrac-service), then this file again';
  end if;
end $$;

update public.mrac_criteria
set enabled = true,
    notes = 'The RAAC: not allowed regardless of date of report. Fact from the Credit Investigator''s NFIS records '
            || '(ci_nfis_records, record kind REPLEVIN / FORECLOSURE); null until every borrower''s NFIS result is in.',
    updated_at = now()
where code = 'RAAC-NO-REPLEVIN' and (not enabled or notes is distinct from
    'The RAAC: not allowed regardless of date of report. Fact from the Credit Investigator''s NFIS records '
    || '(ci_nfis_records, record kind REPLEVIN / FORECLOSURE); null until every borrower''s NFIS result is in.');
