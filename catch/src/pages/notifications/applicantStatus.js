// What an applicant sees for each application_status (20260928_application_side.sql), never the internal stage.
// Besides Draft, only the four statuses from the meeting (2026-10-23): Submitted, Incomplete submission,
// Under review, Decision. Same buckets as applicant_status_bucket() in 20261024_notifications.sql.
// Every enum value is listed; anything added later shows "In progress" until it's mapped here.
const APPLICANT_STATUS = {
    DRAFT: 'Draft',
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
    Object.hasOwn(APPLICANT_STATUS, status ?? '') ? APPLICANT_STATUS[status] : 'In progress';
