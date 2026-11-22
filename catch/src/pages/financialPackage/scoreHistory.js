// Credit score change history as plain lines, newest first (group notes item 32, 2026-11-22): band names and points
// instead of codes. Shown in a collapsed "Change History" dropdown (2026-11-23). From audit_log rows of credit_score_entries (log_application_change): an UPDATE
// keeps only the fields that changed, so the criterion comes from the row's INSERT / DELETE entry or the saved scores.
//   scoreHistory(audit, rules, savedRows) -> [{ id, kind, criterion, text, remarks, by, at }]
// kind: SCORED | CHANGED | REMARKS | CLEARED. A change of the suggestion alone (suggested_band) is left out.

const pts = (n) => `${n} ${Math.abs(Number(n)) === 1 ? 'pt' : 'pts'}`;

export const scoreHistory = (audit, rules, savedRows = []) => {
    const criterionOfRow = {};
    for (const r of savedRows) if (r.id != null) criterionOfRow[r.id] = r.criterion;
    for (const e of audit) {
        const c = e.new_data?.criterion ?? e.old_data?.criterion;
        if (c && e.row_id != null) criterionOfRow[e.row_id] = c;
    }
    const labelOf = (code) => rules.criteria.find((c) => c.code === code)?.label ?? code ?? 'A criterion';
    const band = (criterion, code) => {
        if (!code) return 'not scored';
        const b = rules.bands.find((x) => x.criterion === criterion && x.code === code);
        return b ? `${b.label} (${pts(b.points)})` : code;
    };

    const lines = [];
    for (const e of [...audit].sort((a, b) => b.id - a.id)) {
        const criterion = e.new_data?.criterion ?? e.old_data?.criterion ?? criterionOfRow[e.row_id] ?? null;
        const name = labelOf(criterion);
        const base = { id: e.id, criterion, by: e.changed_by, at: e.changed_at };
        const newData = e.new_data ?? {};
        const oldData = e.old_data ?? {};
        if (e.action === 'INSERT') {
            lines.push({ ...base, kind: 'SCORED', text: `${name}: scored ${band(criterion, newData.band)}`, remarks: newData.remarks || null });
        } else if (e.action === 'DELETE') {
            lines.push({ ...base, kind: 'CLEARED', text: `${name}: score cleared (was ${band(criterion, oldData.band)})`, remarks: null });
        } else if ('band' in newData) {
            lines.push({
                ...base, kind: 'CHANGED', text: `${name}: ${band(criterion, oldData.band)} → ${band(criterion, newData.band)}`,
                remarks: 'remarks' in newData ? newData.remarks || null : null,
            });
        } else if ('remarks' in newData) {
            lines.push({ ...base, kind: 'REMARKS', text: `${name}: remarks changed`, remarks: newData.remarks || '(removed)' });
        }
    }
    return lines;
};
