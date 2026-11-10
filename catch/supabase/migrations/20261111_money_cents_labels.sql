-- CATCH — Credit score band labels with cents (display text only)
-- Run after 20261021_credit_scoring.sql. Re-runnable, no drops of data.
--
-- Every money amount the app shows has cents (e.g. ₱1,500,000.00). This updates only credit_score_bands.label for the
-- money bands, keeping the bank's wording; codes, points, sort order and the scoring (creditScore.js) are unchanged.
-- Ranges use "to" instead of a dash.
--
-- Re-runs of earlier files: 20261021_credit_scoring.sql re-run -> its labels come back: run this file again.

do $$
begin
  if to_regclass('public.credit_score_bands') is null then
    raise exception 'Run 20261021_credit_scoring.sql first, then this file again';
  end if;
end $$;

update public.credit_score_bands b set label = v.label
from (values
  ('NDI', 'FROM_100K',             'More than ₱100,000.00'),
  ('NDI', 'FROM_80K',              '₱80,000.00 to ₱99,999.99'),
  ('NDI', 'FROM_60K',              '₱60,000.00 to ₱79,999.99'),
  ('NDI', 'FROM_40K',              '₱40,000.00 to ₱59,999.99'),
  ('NDI', 'BELOW_40K',             'Less than ₱40,000.00'),
  ('COLLATERAL_VALUE', 'FROM_1M_TO_3M', '₱1,000,000.00 to ₱3,000,000.00'),
  ('COLLATERAL_VALUE', 'ABOVE_3M',      'Above ₱3,000,000.00'),
  ('COLLATERAL_VALUE', 'BELOW_1M',      'Less than ₱1,000,000.00')
) as v (criterion, code, label)
where b.criterion = v.criterion and b.code = v.code and b.label is distinct from v.label;
