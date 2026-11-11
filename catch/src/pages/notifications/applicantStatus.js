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

// What my_application_statuses() returns as visible_status (applicant_visible_status(), 20261112_document_requests.sql):
// the buckets above, plus an open document request ("Documents needed" / "Documents sent"). null = not mapped here.
const VISIBLE_STATUS = {
    DRAFT: 'Draft',
    SUBMITTED: 'Submitted',
    INCOMPLETE: 'Incomplete submission',
    UNDER_REVIEW: 'Under review',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    DEFERRED: 'Deferred',
    DOCUMENTS_NEEDED: 'Documents needed',
    DOCUMENTS_SENT: 'Documents sent',
};

export const visibleStatusLabel = (visible) => (Object.hasOwn(VISIBLE_STATUS, visible ?? '') ? VISIBLE_STATUS[visible] : null);

export const applicantStatusLabel = (status, noticeSent = false) => {
    if (OUTCOME_STATUSES.includes(status) && !noticeSent) return 'Under review';
    return Object.hasOwn(APPLICANT_STATUS, status ?? '') ? APPLICANT_STATUS[status] : 'In progress';
};
