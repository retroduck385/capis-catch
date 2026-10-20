// VII. Approval (KYC-FP "FP" tab): approval authority by loan amount and policy deviation.
// Values match approval_tier in 20261021_review_routing.sql. The suggestion is a hint; the CO picks the tier.
//
// From the sheet's labels:
//   Senior Credit Committee  "Upto 3M to P10M With Deviation" / "More than P10M to P30M Without Deviation"
//   Executive Committee      "More than P10M to P30M With Deviation" / "More than P30M Without Deviation"
//   Board                    "More than P30M With Deviation"
// The President's block (with an alternate) has no range on the sheet; CATCH reads it as everything the
// committees don't cover (up to P10M without deviation), and "Upto 3M to P10M" as up to P10M.
// Both readings are in FUTURE_TODO.md, "To ask the bank".
const M = 1_000_000;

export const APPROVAL_TIERS = [
    { value: 'PRESIDENT', label: 'President (or alternate)', rule: 'Up to ₱10M without deviation' },
    { value: 'SENIOR_CREDIT_COMMITTEE', label: 'Senior Credit Committee',
        rule: 'Up to ₱10M with deviation · more than ₱10M to ₱30M without deviation' },
    { value: 'EXECUTIVE_COMMITTEE', label: 'Executive Committee',
        rule: 'More than ₱10M to ₱30M with deviation · more than ₱30M without deviation' },
    { value: 'BOARD', label: 'Board', rule: 'More than ₱30M with deviation' },
];

export const tierLabel = (tier) => APPROVAL_TIERS.find((t) => t.value === tier)?.label ?? null;

// A deviation = at least one row in V. Exception/s of the saved FP
export const suggestApprovalTier = (loanAmount, hasDeviation) => {
    const amount = Number(loanAmount);
    if (!amount) return null;
    const band = amount <= 10 * M ? 0 : amount <= 30 * M ? 1 : 2;
    return (hasDeviation
        ? ['SENIOR_CREDIT_COMMITTEE', 'EXECUTIVE_COMMITTEE', 'BOARD']
        : ['PRESIDENT', 'SENIOR_CREDIT_COMMITTEE', 'EXECUTIVE_COMMITTEE'])[band];
};

// Active rows -> { reviewers: [...], approvers: [...] }, each in seq order
export const splitRouting = (rows) => {
    const active = rows.filter((r) => !r.unassigned_at).sort((a, b) => a.seq - b.seq);
    return {
        reviewers: active.filter((r) => r.assignee_role === 'REVIEWER'),
        approvers: active.filter((r) => r.assignee_role === 'APPROVER'),
    };
};
