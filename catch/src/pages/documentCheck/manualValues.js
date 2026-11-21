// Values typed by hand for the files the AI doesn't read (group notes item 14): SPA, SEC / DTI / Mayor's permit and
// "Other" files. Pure helpers, shared by the page and the tests. The limits mirror manual_values_problem() in
// 20261123_manual_document_values.sql (the database checks them again on save).

export const MANUAL_TYPES = ['SPA', 'SEC_DTI_MAYORS_PERMIT', 'OTHER'];

export const MANUAL_TYPE_LABELS = {
    SPA: 'SPA (Special Power of Attorney)',
    SEC_DTI_MAYORS_PERMIT: "SEC / DTI / Mayor's permit",
    OTHER: 'Other document',
};

export const LIMITS = { rows: 30, label: 60, value: 300 };

// Labels a new form starts with (editable; generic, not the bank's forms)
export const STARTING_LABELS = {
    SPA: ['Principal (grantor)', 'Attorney-in-fact', 'Powers granted', 'Date notarized', 'Notary public'],
    SEC_DTI_MAYORS_PERMIT: ['Business name', 'Registration / permit no.', 'Issued by', 'Date issued', 'Valid until'],
    OTHER: [''],
};

// The rows a form starts with: the latest save, or the starting labels with empty values
export const startingRows = (type, latest) => (latest
    ? latest.entries.map((e) => ({ label: e.label, value: e.value }))
    : (STARTING_LABELS[type] ?? ['']).map((label) => ({ label, value: '' })));

// Rows the officer left completely blank are not saved
export const filledRows = (rows) => rows.filter((r) => r.label.trim() !== '' || r.value.trim() !== '');

// null when fine, else what is wrong (same wording as the database)
export const rowsProblem = (rows) => {
    if (rows.length > LIMITS.rows) return `At most ${LIMITS.rows} rows`;
    const seen = new Set();
    for (const [i, r] of rows.entries()) {
        const n = i + 1;
        const label = r.label.trim();
        const value = r.value.trim();
        if (label === '') return `Row ${n} needs a label`;
        if (label.length > LIMITS.label) return `Row ${n}: the label is longer than ${LIMITS.label} characters`;
        if (value === '') return `Row ${n} (${label}) needs a value`;
        if (value.length > LIMITS.value) return `Row ${n} (${label}): the value is longer than ${LIMITS.value} characters`;
        if (seen.has(label.toLowerCase())) return `The label "${label}" is there twice`;
        seen.add(label.toLowerCase());
    }
    return null;
};

// Same rows as the latest save (trimmed)? Then there is nothing to save
export const sameAsSaved = (rows, latest) => {
    const clean = rows.map((r) => ({ label: r.label.trim(), value: r.value.trim() }));
    const saved = latest?.entries ?? [];
    return JSON.stringify(clean) === JSON.stringify(saved);
};

// document_manual_values rows (any order) -> { [document_id]: [newest, ..., oldest] }
export const savesByDocument = (rows) => {
    const by = {};
    for (const r of [...rows].sort((a, b) => b.id - a.id)) (by[r.document_id] ??= []).push(r);
    return by;
};
