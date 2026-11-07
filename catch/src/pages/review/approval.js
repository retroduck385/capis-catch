// VII. Approval: approval authority by loan amount and policy deviation.
// Values match approval_tier in 20261021_review_routing.sql + 20261108_approval_matrix.sql.
// The suggestion is a hint; the CO picks the tier.
//
// From the bank's authority-limit matrix (Josh, 2026-11-08). Positions only, no names; the bank's own
// unit acronyms are written as generic titles ("Lending Division / Department Head").
// The matrix is a ladder: with a deviation, the next authority up approves.
const M = 1_000_000;

// Lowest to highest
export const APPROVAL_TIERS = [
    { value: 'DEPT_HEADS', label: 'Credit Dept. Head + Lending Dept. Head',
        rule: 'Any one (1) Credit Department Head AND any one (1) Lending Department Head' },
    { value: 'CREDIT_DIVISION_AND_LENDING_DEPT', label: 'Credit Division Head + Lending Dept. Head',
        rule: 'Credit Management Division Head OR any two (2) Credit Department Heads, AND any one (1) Lending Department Head' },
    { value: 'CREDIT_AND_LENDING_DIVISIONS', label: 'Credit Division Head + Lending Division Head',
        rule: 'Credit Management Division Head OR any two (2) Credit Department Heads, AND Lending Division Head OR two (2) Lending Department Heads' },
    { value: 'PRESIDENT', label: 'President', rule: 'President' },
    { value: 'PRESIDENT_AND_SCC_MEMBER', label: 'President + Senior Credit Committee member',
        rule: 'President AND any one (1) Senior Credit Committee member' },
    { value: 'SENIOR_CREDIT_COMMITTEE', label: 'Senior Credit Committee', rule: 'Senior Credit Committee' },
    { value: 'EXECUTIVE_COMMITTEE', label: 'Executive Committee', rule: 'Executive Committee' },
    { value: 'BOARD', label: 'Board', rule: 'Board of Directors' },
];

// Position on Approver accounts (approval_position in 20261108_approver_positions.sql)
export const APPROVAL_POSITIONS = [
    { value: 'CREDIT_DEPT_HEAD', label: 'Credit Department Head' },
    { value: 'CREDIT_DIVISION_HEAD', label: 'Credit Management Division Head' },
    { value: 'LENDING_DEPT_HEAD', label: 'Lending Department Head' },
    { value: 'LENDING_DIVISION_HEAD', label: 'Lending Division Head' },
    { value: 'PRESIDENT', label: 'President' },
    { value: 'SENIOR_CREDIT_COMMITTEE', label: 'Senior Credit Committee' },
    { value: 'EXECUTIVE_COMMITTEE', label: 'Executive Committee' },
    { value: 'BOARD', label: 'Board' },
];
export const positionLabel = (p) => APPROVAL_POSITIONS.find((x) => x.value === p)?.label ?? null;

// What each authority needs (same as approval_requirements() in SQL): every group must be met,
// a group is met by ANY one of its [position, count] options. Committees decide as a body (one account).
const one = (p) => [[p, 1]];
const REQUIREMENTS = {
    DEPT_HEADS: [one('CREDIT_DEPT_HEAD'), one('LENDING_DEPT_HEAD')],
    CREDIT_DIVISION_AND_LENDING_DEPT: [[['CREDIT_DIVISION_HEAD', 1], ['CREDIT_DEPT_HEAD', 2]], one('LENDING_DEPT_HEAD')],
    CREDIT_AND_LENDING_DIVISIONS: [[['CREDIT_DIVISION_HEAD', 1], ['CREDIT_DEPT_HEAD', 2]],
        [['LENDING_DIVISION_HEAD', 1], ['LENDING_DEPT_HEAD', 2]]],
    PRESIDENT: [one('PRESIDENT')],
    PRESIDENT_AND_SCC_MEMBER: [one('PRESIDENT'), one('SENIOR_CREDIT_COMMITTEE')],
    SENIOR_CREDIT_COMMITTEE: [one('SENIOR_CREDIT_COMMITTEE')],
    EXECUTIVE_COMMITTEE: [one('EXECUTIVE_COMMITTEE')],
    BOARD: [one('BOARD')],
};

// staff = list_review_staff() rows. Approvers the authority routes to (same as approvers_for_tier())
export const approversFor = (staff, tier) => {
    const positions = new Set((REQUIREMENTS[tier] ?? []).flat().map(([p]) => p));
    return staff.filter((s) => s.role === 'APPROVER' && positions.has(s.approval_position));
};

// Groups that the existing approver accounts can't meet, as text ("Credit Department Head ×2 or ...")
export const missingApprovers = (staff, tier) => {
    const count = (p) => staff.filter((s) => s.role === 'APPROVER' && s.approval_position === p).length;
    return (REQUIREMENTS[tier] ?? [])
        .filter((group) => !group.some(([p, n]) => count(p) >= n))
        .map((group) => group.map(([p, n]) => `${positionLabel(p)}${n > 1 ? ` ×${n}` : ''}`).join(' or '));
};

// Loan amount bands (upper bound inclusive); index i = APPROVAL_TIERS[i] without deviation, [i + 1] with
export const AMOUNT_BANDS = [
    { max: 3 * M, label: 'Up to ₱3.0M' },
    { max: 5 * M, label: 'More than ₱3.0M to ₱5.0M' },
    { max: 10 * M, label: 'More than ₱5.0M to ₱10.0M' },
    { max: 20 * M, label: 'More than ₱10.0M to ₱20.0M' },
    { max: 30 * M, label: 'More than ₱20.0M to ₱30.0M' },
    { max: 50 * M, label: 'More than ₱30.0M to ₱50.0M' },
    { max: Infinity, label: 'More than ₱50.0M' },
];

export const tierLabel = (tier) => APPROVAL_TIERS.find((t) => t.value === tier)?.label ?? null;

// Index into AMOUNT_BANDS, or null with no amount
export const amountBand = (loanAmount) => {
    const amount = Number(loanAmount);
    if (!amount) return null;
    return AMOUNT_BANDS.findIndex((b) => amount <= b.max);
};

export const tierFor = (band, hasDeviation) => APPROVAL_TIERS[band + (hasDeviation ? 1 : 0)].value;

// A deviation = at least one row in V. Exception/s of the saved FP
export const suggestApprovalTier = (loanAmount, hasDeviation) => {
    const band = amountBand(loanAmount);
    return band === null ? null : tierFor(band, hasDeviation);
};

// Active rows -> { reviewers: [...], approvers: [...] }, each in seq order
export const splitRouting = (rows) => {
    const active = rows.filter((r) => !r.unassigned_at).sort((a, b) => a.seq - b.seq);
    return {
        reviewers: active.filter((r) => r.assignee_role === 'REVIEWER'),
        approvers: active.filter((r) => r.assignee_role === 'APPROVER'),
    };
};
