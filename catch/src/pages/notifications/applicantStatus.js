// What an applicant sees for each application_status (20260928_application_side.sql), in plain words: the stage the
// file is at, never the internal name (decided 2026-11-22):
//   Received (Intake) · Background check (Credit Investigation) · Evaluation (Credit Evaluation) · Review ·
//   Final approval (Approval)
// Besides those: Draft, Incomplete submission, and the outcome (Approved / Rejected / Deferred, the bank's answer to
// Q-42). An outcome shows only once the Account Officer has sent the notice for it; until then "Final approval".
// The database decides that (applicant_visible_status() in 20261112_document_requests.sql, unchanged): an outcome is
// shown only when visible_status IS that outcome. "Documents needed" / "Documents sent" while a document request is
// open come from there too. After a reviewer's return the file is back in Credit Evaluation, and the applicant sees
// "Evaluation" again (kept accurate on purpose).
// Every enum value is listed; anything added later shows "In progress" until it's mapped here.

// The applicant's five steps, in order (the tracker on the application page)
export const APPLICANT_STAGES = ['Received', 'Background check', 'Evaluation', 'Review', 'Final approval'];

export const OUTCOME_STATUSES = ['APPROVED', 'REJECTED', 'DEFERRED'];
const OUTCOME_LABELS = { APPROVED: 'Approved', REJECTED: 'Rejected', DEFERRED: 'Deferred' };

// application_status -> index in APPLICANT_STAGES (an outcome sits on Final approval). Draft and Incomplete
// submission are not on the track.
const STAGE_OF_STATUS = {
    SUBMITTED: 0,
    UNDER_CI: 1,
    UNDER_CREDIT_EVALUATION: 2,
    UNDER_REVIEW: 3,
    FOR_APPROVAL: 4,
    APPROVED: 4,
    REJECTED: 4,
    DEFERRED: 4,
};
const OFF_TRACK = { DRAFT: 'Draft', FOR_CLARIFICATION: 'Incomplete submission' };
const DOCUMENT_REQUEST = { DOCUMENTS_NEEDED: 'Documents needed', DOCUMENTS_SENT: 'Documents sent' };

const own = (map, key) => (Object.hasOwn(map, key ?? '') ? map[key] : undefined);

// Step index (0-4) for a status, or null when it isn't on the track
export const applicantStageIndex = (status) => own(STAGE_OF_STATUS, status) ?? null;

// The outcome the applicant may see: only when the database's visible_status is that outcome (the notice was sent)
export const shownOutcome = (visible) => own(OUTCOME_LABELS, visible) ?? null;

// The label for one application.
//   status:  loan_applications.status
//   visible: my_application_statuses().visible_status, or null while it hasn't loaded (an outcome then stays hidden)
export const applicantLabel = (status, visible = null) => {
    if (own(DOCUMENT_REQUEST, visible)) return DOCUMENT_REQUEST[visible];
    if (shownOutcome(visible)) return shownOutcome(visible);
    if (own(OFF_TRACK, status)) return OFF_TRACK[status];
    const i = applicantStageIndex(status);
    return i === null ? 'In progress' : APPLICANT_STAGES[i];
};
