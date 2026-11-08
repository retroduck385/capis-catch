// Labels for the loan folder (values match kyc_check_result in 20261007_ao_kyc_verification.sql)
export const RESULT_LABELS = { VERIFIED: 'Verified', NEEDS_CLARIFICATION: 'Needs clarification' };

export const whenOf = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
