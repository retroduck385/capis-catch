-- Trim the applicant's Purpose dropdown to the Purchase options and House Renovation
-- ("Other (please specify)" is added by the form itself). The rest are deactivated,
-- not deleted, so applications that already reference them keep their label.
update public.loan_purposes
set is_active = (label like 'Purchase of %' or label = 'House Renovation');
