// Labels for the work tray (enum values match workflow_stage / stage_status in 20261005_work_tray.sql)

export const STAGES = [
    { value: 'INTAKE', label: 'Intake' },
    { value: 'CREDIT_INVESTIGATION', label: 'Credit Investigation' },
    { value: 'CREDIT_EVALUATION', label: 'Credit Evaluation' },
    { value: 'REVIEW', label: 'Review' },
    { value: 'APPROVAL', label: 'Approval' },
    { value: 'DECIDED', label: 'Decided' },
];

// One colour per stage (chart bars, the marker beside the stage in the table): a blue scale that deepens as the
// application moves along, so the page stays blue / white. Kept clear of green / amber / red (on track / near /
// beyond TAT). Each is at least 3:1 on white.
export const STAGE_COLORS = {
    INTAKE: '#0284c7',                // sky
    CREDIT_INVESTIGATION: '#2563eb',  // blue
    CREDIT_EVALUATION: '#1d4ed8',     // royal
    REVIEW: '#1e40af',                // deep blue
    APPROVAL: '#172b6b',              // navy
    DECIDED: '#64748b',               // slate
};

// Avatar colours (light fill, dark initials, 4.5:1+), picked per person from their name so it stays stable.
// Blues, with one peach for a hint of orange.
export const AVATAR_TONES = [
    ['#dbeafe', '#1e3a8a'], ['#e0f2fe', '#075985'], ['#e0e7ff', '#3730a3'],
    ['#eef2f7', '#334155'], ['#ffedd5', '#9a3412'], ['#cfe0ff', '#1e40af'],
];

export const STAGE_STATUS_LABELS = {
    PENDING: 'Pending',
    IN_PROGRESS: 'In Progress',
    REQUESTED: 'Requested',
    RETURNED: 'Returned',
    DONE: 'Done',
};

export const TAT_LABELS = { ON_TRACK: 'On track', NEAR: 'Near TAT', BEYOND: 'Beyond TAT' };

// Colour tones for the tray (ok = green, warn = orange, bad = red, info = blue, plain = grey)
export const TAT_TONES = { ON_TRACK: 'ok', NEAR: 'warn', BEYOND: 'bad' };
export const STATUS_TONES = { PENDING: 'plain', IN_PROGRESS: 'info', REQUESTED: 'info', RETURNED: 'warn', DONE: 'ok' };

export const SLOT_LABELS = { ACCOUNT_OFFICER: 'AO', CREDIT_OFFICER: 'CO' };

// "Good morning / afternoon / evening" by the viewer's local hour
export const greetingFor = (date) => {
    const h = date.getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

// A display name without the role in it (e.g. a test account named "Josh Denzel Account Officer"), trimmed
export const nameWithoutRole = (name, roleLabel) => {
    const n = (name ?? '').trim();
    if (!n || !roleLabel) return n;
    const stripped = n.replace(new RegExp(roleLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), '').replace(/\s+/g, ' ').trim();
    return stripped || n;
};

export const stageLabel = (stage) => STAGES.find((s) => s.value === stage)?.label ?? stage;
