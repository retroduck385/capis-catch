// What an applicant sees for each application_status (20260928_application_side.sql), never the internal stage.
// Besides Draft: Submitted, Incomplete submission, Under review, and the outcome (Approved / Rejected / Deferred,
// the bank's answer to Q-42). Same buckets as applicant_status_bucket() in 20261029_applicant_notices.sql.
// An outcome shows only once the Account Officer has sent the notice for it (noticeSent); until then "Under review",
// like applicant_visible_status() in SQL.
// Every enum value is listed; anything added later shows "In progress" until it's mapped here.
const APPLICANT_STATUS = {
    DRAFT: 'Draft',
    SUBMITTED: 'Submitted',
    FOR_CLARIFICATION: 'Incomplete submission',
    UNDER_CI: 'Under review',
    UNDER_CREDIT_EVALUATION: 'Under review',
    UNDER_REVIEW: 'Under review',
    FOR_APPROVAL: 'Under review',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    DEFERRED: 'Deferred',
};

export const OUTCOME_STATUSES = ['APPROVED', 'REJECTED', 'DEFERRED'];

export const applicantStatusLabel = (status, noticeSent = false) => {
    if (OUTCOME_STATUSES.includes(status) && !noticeSent) return 'Under review';
    return Object.hasOwn(APPLICANT_STATUS, status ?? '') ? APPLICANT_STATUS[status] : 'In progress';
};
