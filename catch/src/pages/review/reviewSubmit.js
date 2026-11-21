// Reviewer sign-off, Part E (group notes items 34 and 35, 2026-11-22). Pure, for the review form and the tests.
//
// toSubmission(form, checkItems): what is sent to submit_review(). "Doesn't endorse" (from any reviewer) is sent as a
//   return to the Credit Officer: severity Major, remarks "Not endorsed: <justification>", and the checklist item
//   Recommendation marked Needs revision (the reviewer's own remark on it is kept, else the justification). The file
//   reaches the approvers only once every reviewer has endorsed it; the database refuses a "Not endorsed" sign-off
//   (20261124_review_endorse_guard.sql).
// seedFromReturn(decision): the form a reviewer starts from when the file comes back after their return: the items they
//   marked OK stay OK with their remarks; Needs revision items, the decision and the remarks start blank.

export const NOT_ENDORSED_PREFIX = 'Not endorsed: ';
export const RECOMMENDATION = 'RECOMMENDATION';

export const toSubmission = (form, checkItems) => {
    const items = checkItems.filter((i) => form.checks[i.code]?.result)
        .map((i) => ({ code: i.code, result: form.checks[i.code].result, remark: form.checks[i.code].remark.trim() || null }));
    const remarks = form.remarks.trim();
    if (form.action !== 'NOT_ENDORSED') {
        return { action: form.action, remarks, severity: form.action === 'RETURNED' ? form.severity : null, items };
    }
    const rec = items.find((i) => i.code === RECOMMENDATION);
    const recItem = { code: RECOMMENDATION, result: 'NEEDS_REVISION', remark: (rec?.result === 'NEEDS_REVISION' && rec.remark) || remarks };
    const hasRec = checkItems.some((i) => i.code === RECOMMENDATION);
    return {
        action: 'RETURNED',
        severity: 'MAJOR',
        remarks: `${NOT_ENDORSED_PREFIX}${remarks}`,
        items: hasRec ? [...items.filter((i) => i.code !== RECOMMENDATION), recItem] : items,
    };
};

// A return that was a "Doesn't endorse" (for labels)
export const isNotEndorsedReturn = (decision) => decision?.action === 'RETURNED'
    && String(decision.remarks ?? '').startsWith(NOT_ENDORSED_PREFIX);

export const seedFromReturn = (decision) => {
    if (decision?.action !== 'RETURNED') return null;
    const checks = {};
    for (const i of decision.review_decision_items ?? []) {
        if (i.result === 'OK') checks[i.item_code] = { result: 'OK', remark: i.remark ?? '' };
    }
    return Object.keys(checks).length ? { checks, action: '', remarks: '', severity: '' } : null;
};
