// Labels for the work tray (enum values match workflow_stage / stage_status in 20261005_work_tray.sql)

export const STAGES = [
    { value: 'INTAKE', label: 'Intake' },
    { value: 'CREDIT_INVESTIGATION', label: 'Credit Investigation' },
    { value: 'CREDIT_EVALUATION', label: 'Credit Evaluation' },
    { value: 'REVIEW', label: 'Review' },
    { value: 'APPROVAL', label: 'Approval' },
    { value: 'DECIDED', label: 'Decided' },
];

export const STAGE_STATUS_LABELS = {
    PENDING: 'Pending',
    IN_PROGRESS: 'In Progress',
    REQUESTED: 'Requested',
    RETURNED: 'Returned',
    DONE: 'Done',
};

export const TAT_LABELS = { ON_TRACK: 'On track', NEAR: 'Near TAT', BEYOND: 'Beyond TAT' };

export const SLOT_LABELS = { ACCOUNT_OFFICER: 'AO', CREDIT_OFFICER: 'CO' };

export const stageLabel = (stage) => STAGES.find((s) => s.value === stage)?.label ?? stage;
