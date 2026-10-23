// The four statuses an applicant sees (meeting 2026-10-23), never the internal stage.
// Same buckets as applicant_status_bucket() in 20261024_notifications.sql.
const APPLICANT_STATUS = {
    SUBMITTED: 'Submitted',
    FOR_CLARIFICATION: 'Incomplete submission',
    DEFERRED: 'Incomplete submission',
    UNDER_CI: 'Under review',
    UNDER_CREDIT_EVALUATION: 'Under review',
    UNDER_REVIEW: 'Under review',
    FOR_APPROVAL: 'Under review',
    APPROVED: 'Decision',
    REJECTED: 'Decision',
};

export const applicantStatusLabel = (status) =>
    status === 'DRAFT' ? 'Draft' : APPLICANT_STATUS[status] ?? 'Under review';
