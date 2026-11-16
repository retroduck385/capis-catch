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

// How the TAT state is worked out, for the hovers. Mirrors work_tray() and stage_tat (20261005_work_tray.sql,
// 20261020_ci_request.sql): calendar days since the file entered its current stage, against that stage's target;
// Near once past near_ratio (0.75) of it, Beyond once past the target. The day values are placeholders until the
// bank's SLA is known (Q-09). If stage_tat changes in the database, change TAT_TARGET_DAYS here too.
export const TAT_NEAR_RATIO = 0.75;
export const TAT_TARGET_DAYS = { INTAKE: 1, CREDIT_INVESTIGATION: 3, CREDIT_EVALUATION: 3, REVIEW: 2, APPROVAL: 2 };
const pctText = (ratio) => `${Math.round(ratio * 100)}%`;
const dayText = (n) => `${n} day${Number(n) === 1 ? '' : 's'}`;
export const TAT_RULE = "TAT counts calendar days since the file entered its current stage, against that stage's target. "
    + `On track: up to ${pctText(TAT_NEAR_RATIO)} of the target. Near TAT: past ${pctText(TAT_NEAR_RATIO)}. Beyond TAT: past 100%.`;
export const TAT_TARGETS_TEXT = `Targets (placeholders until the bank's SLA is known): ${STAGES
    .filter((s) => TAT_TARGET_DAYS[s.value] != null)
    .map((s) => `${s.label} ${dayText(TAT_TARGET_DAYS[s.value])}`).join(', ')}.`;
// One state's rule, for the Near / Beyond filter choices
export const TAT_STATE_RULES = {
    ON_TRACK: `On track: up to ${pctText(TAT_NEAR_RATIO)} of the stage's target used.`,
    NEAR: `Near TAT: past ${pctText(TAT_NEAR_RATIO)} of the stage's target, not yet past it.`,
    BEYOND: "Beyond TAT: past 100% of the stage's target.",
};
// The TAT cell's hover: days used against this stage's target, then the rule
export const tatDetail = (days, limit) => {
    const d = Number(days);
    const t = Number(limit);
    const over = d - t;
    const used = t > 0 ? ` (${pctText(d / t)})` : '';
    return [
        `${d}d of the ${t}d target${used}${over > 0 ? `, ${over.toFixed(1)}d over` : ''}.`,
        TAT_RULE,
        "This target is a placeholder until the bank's SLA is known.",
    ].join('\n');
};

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
