// CI result labels (enum values match ci_check_type / ci_check_result in 20261108_ci_results.sql).
// BRAS is still a value of ci_check_type but is no longer used (meeting 2026-11-18): old rows stay in the database
// and are left out when CI results load (fetchCiResults in api.js).

export const CI_CHECKS = [
    { value: 'NFIS', label: 'NFIS', required: true },
    { value: 'TU', label: 'TransUnion (TU)', required: true },
];

export const CI_RESULTS = [
    { value: 'NO_ADVERSE_FINDINGS', label: 'No adverse findings' },
    { value: 'WITH_FINDINGS', label: 'With findings' },
];
