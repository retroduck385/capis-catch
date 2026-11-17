// The current reviewer's unsent review (checklist, decision, remarks), kept in this browser as they type, so it
// survives a reload, a look at another page or closing the tab. Nothing reaches the database until Submit
// (submit_review()); a successful submit clears it. Keyed by user + review assignment, so another reviewer signed in
// on the same computer never sees it. Storage can be blocked (private window): every call fails quietly.
import { REVIEW_ACTIONS, SEVERITIES } from './reviewChecks';

const PREFIX = 'catch-review-draft';
const RESULTS = ['', 'OK', 'NEEDS_REVISION'];

export const draftKey = (userId, assignmentId) => (userId && assignmentId ? `${PREFIX}:${userId}:${assignmentId}` : null);

export const loadDraft = (key) => {
    if (!key) return null;
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
};

// true when it was written
export const saveDraft = (key, draft) => {
    if (!key) return false;
    try {
        localStorage.setItem(key, JSON.stringify(draft));
        return true;
    } catch {
        return false;
    }
};

export const clearDraft = (key) => {
    if (!key) return;
    try { localStorage.removeItem(key); } catch { /* storage blocked: nothing was saved */ }
};

const text = (v) => (typeof v === 'string' ? v : '');

// The form's starting values: a stored draft where it still fits the checklist, blanks otherwise
// (a checklist item added or dropped since the draft was saved is simply blank / ignored)
export const formFromDraft = (draft, checkItems) => ({
    checks: Object.fromEntries(checkItems.map((i) => {
        const c = draft?.checks?.[i.code];
        return [i.code, { result: RESULTS.includes(c?.result) ? c.result : '', remark: text(c?.remark) }];
    })),
    action: REVIEW_ACTIONS.some((a) => a.value === draft?.action) ? draft.action : '',
    remarks: text(draft?.remarks),
    severity: SEVERITIES.some((s) => s.value === draft?.severity) ? draft.severity : '',
});

export const isBlankForm = (f) => f.action === '' && f.remarks.trim() === '' && f.severity === ''
    && Object.values(f.checks).every((c) => !c.result && !c.remark.trim());
