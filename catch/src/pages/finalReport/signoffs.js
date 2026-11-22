// Final report: the pure parts (no React, no Supabase), so tests/finalReport.test.mjs can import them.
//   reportMode()       which version of the report a viewer gets: FINAL, DRAFT or none
//   buildSignoffs()    page 5: who did each step, what they did and when, from our own records
//   scoreSheet()       page 3: every criterion with all its bands, the picked one, sub-totals per category
// Plain .js with explicit extensions on imports: Node's test runner loads it directly.

// "Nov 20, 2026, 9:02 AM", Philippine time (the bank's time zone, whatever the viewer's computer says)
export const whenPH = (iso) => (iso ? new Date(iso).toLocaleString('en-PH', {
    timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
}) : null);

// Which version of the final report a viewer gets (FINAL, DRAFT or null = not available; the page says so).
//   FINAL  once every reviewer has endorsed it (the file is in Approval, then Decided): the Account Officer (prints it
//          for the approvers), the assigned Credit Officer and the routed reviewers; the Approvers once Decided
//          (group notes item 36). In Approval the sheets say "for approval".
//   DRAFT  the assigned Credit Officer while they can edit the FP in Credit Evaluation (still editing, or after a
//          reviewer return); the routed reviewers while the file is in Review, to see what the approvers will get
//          before they endorse.
// assigned: the viewer holds this file's Credit Officer slot, or (for a reviewer) an active review assignment.
const ENDORSED_STAGES = ['APPROVAL', 'DECIDED'];
export const reportMode = ({ stage, role, coCanEdit, assigned = false }) => {
    const s = stage?.stage;
    const endorsed = ENDORSED_STAGES.includes(s);
    if (role === 'ACCOUNT_OFFICER') return endorsed ? 'FINAL' : null;
    if (role === 'APPROVER') return s === 'DECIDED' ? 'FINAL' : null;
    if (role === 'CREDIT_OFFICER') {
        if (s === 'CREDIT_EVALUATION' && coCanEdit) return 'DRAFT';
        return endorsed && assigned ? 'FINAL' : null;
    }
    if (role === 'REVIEWER' && assigned) {
        if (s === 'REVIEW') return 'DRAFT';
        return endorsed ? 'FINAL' : null;
    }
    return null;
};

const REVIEW_LABELS = { ENDORSED: 'Endorsed', NOT_ENDORSED: 'Not endorsed', RETURNED: 'Returned for revision' };
const SEVERITY_LABELS = { MINOR: 'minor', MAJOR: 'major' };
const OUTCOME_LABELS = { APPROVED: 'Approved', REJECTED: 'Rejected' };
const byTime = (a, b) => new Date(a.at) - new Date(b.at);

// When a stage was marked Done, and by whom: the last DONE status of the last visit of that stage
// (falls back to when the stage was left, with nobody named, for files moved before statuses were recorded)
const stageDone = (stages, stage) => {
    const visits = stages.filter((s) => s.stage === stage);
    for (const visit of [...visits].reverse()) {
        const done = (visit.stage_status_changes ?? []).filter((c) => c.status === 'DONE')
            .sort((a, b) => new Date(a.changed_at) - new Date(b.changed_at)).at(-1);
        if (done) return { by: done.changed_by ?? null, at: done.changed_at };
        if (visit.left_at) return { by: null, at: visit.left_at };
    }
    return null;
};

// Every send to Review (the first one and each resend after a return), from the Credit Evaluation visits
const sendsToReview = (stages) => stages.filter((s) => s.stage === 'CREDIT_EVALUATION').flatMap((visit) => {
    const done = (visit.stage_status_changes ?? []).filter((c) => c.status === 'DONE');
    if (done.length) return done.map((c) => ({ by: c.changed_by ?? null, at: c.changed_at }));
    return visit.left_at ? [{ by: null, at: visit.left_at }] : [];
});

// stages: application_stages rows with stage_status_changes; rows: review_assignments; reviews: review_decisions;
// approvals: approval_decisions; positionLabel(position) -> text; app: loan_applications row (status, decided stage)
// Returns [{ key, step, role, userId, action, details: [text], at }] in the order things happened.
export const buildSignoffs = ({ stages = [], rows = [], reviews = [], approvals = [], app = {}, aoId = null, coId = null,
    positionLabel = (p) => p }) => {
    const out = [];
    const assignment = (id) => rows.find((r) => r.id === id) ?? null;

    const intake = stageDone(stages, 'INTAKE');
    if (intake) {
        out.push({ key: 'kyc', step: 'KYC', role: 'Account Officer', userId: intake.by ?? aoId,
            action: 'KYC verified; Credit Investigation requested', details: [], at: intake.at });
    }
    const ci = stageDone(stages, 'CREDIT_INVESTIGATION');
    if (ci) {
        out.push({ key: 'ci', step: 'Credit Investigation', role: 'Credit Investigator', userId: ci.by,
            action: 'CI Done (NFIS and TU results recorded)', details: [], at: ci.at });
    }
    sendsToReview(stages).forEach((s, i) => {
        out.push({ key: `ce-${i}`, step: 'Credit Evaluation', role: 'Credit Officer', userId: s.by ?? coId,
            action: i === 0 ? 'Financial Package and credit result sent for review' : 'Resent for review after a return',
            details: [], at: s.at });
    });

    for (const d of reviews) {
        const a = assignment(d.assignment_id);
        const details = [d.remarks].filter(Boolean);
        if (d.action === 'RETURNED' && d.response) details.push(`Credit Officer's answer: ${d.response}`);
        out.push({ key: `rv-${d.id}`, step: 'Review', role: a ? `Reviewer ${a.seq}` : 'Reviewer', userId: a?.user_id ?? null,
            action: d.action === 'RETURNED' && d.severity
                ? `${REVIEW_LABELS.RETURNED} (${SEVERITY_LABELS[d.severity] ?? d.severity})`
                : REVIEW_LABELS[d.action] ?? d.action,
            details, at: d.decided_at });
    }

    for (const d of approvals) {
        const a = assignment(d.assignment_id);
        const action = d.action === 'DISAPPROVED' ? 'Disapproved' : d.conditions ? 'Approved with conditions' : 'Approved';
        out.push({ key: `ap-${d.id}`, step: 'Approval', role: positionLabel(d.approval_position) ?? 'Approver',
            userId: a?.user_id ?? null, action,
            details: [d.conditions && `Conditions: ${d.conditions}`, d.remarks && `Remarks: ${d.remarks}`].filter(Boolean),
            at: d.decided_at });
    }

    const decided = [...stages].reverse().find((s) => s.stage === 'DECIDED');
    if (decided && OUTCOME_LABELS[app.status]) {
        out.push({ key: 'outcome', step: 'Decision', role: 'Outcome', userId: null, action: OUTCOME_LABELS[app.status],
            details: [], at: decided.entered_at, outcome: true });
    }
    return out.filter((s) => s.at).sort(byTime);
};

// rules = { criteria, bands } (credit_score_criteria / credit_score_bands); entries = credit_score_entries rows;
// categories = [{ value, label }] in sheet order. Returns [{ category, label, criteria: [{ criterion, bands, picked,
// points, remarks }], subtotal, max }]
export const scoreSheet = (rules, entries, categories) => categories.map(({ value, label }) => {
    const criteria = rules.criteria.filter((c) => c.category === value).map((c) => {
        const bands = rules.bands.filter((b) => b.criterion === c.code).sort((a, b) => a.sort_order - b.sort_order);
        const entry = entries.find((e) => e.criterion === c.code) ?? null;
        const picked = bands.find((b) => b.code === entry?.band) ?? null;
        return { criterion: c, bands, picked, points: picked ? Number(picked.points) : null, remarks: entry?.remarks ?? null };
    });
    return {
        category: value, label, criteria,
        subtotal: criteria.reduce((sum, c) => sum + (c.points ?? 0), 0),
        max: criteria.reduce((sum, c) => sum + Math.max(0, ...c.bands.map((b) => Number(b.points))), 0),
    };
});
