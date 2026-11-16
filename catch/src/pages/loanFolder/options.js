// Labels for the loan folder (values match kyc_check_result in 20261007_ao_kyc_verification.sql)
export const RESULT_LABELS = { VERIFIED: 'Verified', NEEDS_CLARIFICATION: 'Needs clarification' };

export const whenOf = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// KYC status of a section from its latest check: 'VERIFIED' | 'NEEDS_CLARIFICATION' | 'NONE' (not checked)
export const statusOf = (check) => check?.result ?? 'NONE';
export const TONE_OF = { VERIFIED: 'ok', NEEDS_CLARIFICATION: 'warn', NONE: 'none' };

// { ALL, VERIFIED, NEEDS_CLARIFICATION, NONE } for the sections' latest checks
export const kycCounts = (sections, latestCheck) => {
    const counts = { ALL: sections.length, VERIFIED: 0, NEEDS_CLARIFICATION: 0, NONE: 0 };
    sections.forEach((s) => { counts[statusOf(latestCheck(s.key))] += 1; });
    return counts;
};
