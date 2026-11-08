// CI result labels (enum values match ci_check_type / ci_check_result in 20261108_ci_results.sql)

export const CI_CHECKS = [
    { value: 'NFIS', label: 'NFIS', required: true },
    { value: 'TU', label: 'TransUnion (TU)', required: true },
    { value: 'BRAS', label: 'BRAS', required: false },
];

export const CI_RESULTS = [
    { value: 'NO_ADVERSE_FINDINGS', label: 'No adverse findings' },
    { value: 'WITH_FINDINGS', label: 'With findings' },
];
