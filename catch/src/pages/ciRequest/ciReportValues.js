// Every other field on a CI report as a box (20261127_ci_report_values.sql): who was searched, the TU subject's
// identity, summary totals, score, bureau flags, and the lists (IDs, addresses, employers, previous inquiries).
// The field list is the AI's (extraction_field_defs for CI_NFIS / CI_TU), so the boxes, Run AI and the database
// always agree. Not here: the TU accounts and the report date (typed homes: ciFactRows.js, ci_checks).
//   form shape: { fields: { [field_key]: string }, lists: { [row_group]: [{ _key, [field_key]: string }] } }
// Tests: tests/ciReportValues.test.mjs.

const SKIPPED_GROUPS = new Set(['accounts']);
const SKIPPED_KEYS = new Set(['report_date', 'date_reported']);
export const isBoxDef = (def) => !SKIPPED_KEYS.has(def.field_key) && !def.field_key.startsWith('acct_')
    && !(def.scope === 'ROW' && SKIPPED_GROUPS.has(def.row_group ?? 'rows'));

const SEXES = [{ value: 'MALE', label: 'Male' }, { value: 'FEMALE', label: 'Female' }];
// A def as a box for FactRowsEditor / the form: kind by data_type
export const boxOf = (def) => ({
    key: def.field_key,
    label: def.label,
    hint: def.hint ?? undefined,
    compareWith: def.compare_with ?? null,
    def,
    ...({
        DATE: { kind: 'date' },
        MONTH: { kind: 'month' },
        AMOUNT: { kind: 'money' },
        NUMBER: { kind: 'number' },
        SEX: { kind: 'select', options: SEXES },
    }[def.data_type] ?? { kind: 'text', wide: (def.hint ?? '').length > 60 }),
});

// Titled sections of single fields, by the def's sort_order (the order the report prints them in)
const TU_SECTIONS = [
    { title: 'Personal information and this inquiry', upTo: 199 },
    { title: 'Summary of accounts', upTo: 299 },
    { title: 'Credit score', upTo: 399 },
    { title: 'Bureau flags', upTo: Infinity },
];
const GROUP_TITLES = { ids: 'IDs', addresses: 'Addresses', employers: 'Employment', inquiries: 'Previous inquiries', rows: 'Rows' };
const GROUP_NOUNS = { ids: 'ID', addresses: 'address', employers: 'employer', inquiries: 'inquiry', rows: 'row' };

// { sections: [{ title, boxes }], groups: [{ group, title, noun, boxes }] } for one report kind
export const layoutOf = (checkType, defs) => {
    const own = defs.filter((d) => d.document_type === `CI_${checkType}` && isBoxDef(d))
        .sort((a, b) => a.sort_order - b.sort_order);
    const header = own.filter((d) => d.scope === 'HEADER');
    const sections = checkType === 'TU'
        ? TU_SECTIONS.map((s, i) => ({
            title: s.title,
            boxes: header.filter((d) => d.sort_order <= s.upTo && (i === 0 || d.sort_order > TU_SECTIONS[i - 1].upTo)).map(boxOf),
        })).filter((s) => s.boxes.length)
        : [{ title: 'Who was searched', boxes: header.map(boxOf) }].filter((s) => s.boxes.length);
    const groups = [...new Set(own.filter((d) => d.scope === 'ROW').map((d) => d.row_group ?? 'rows'))].map((group) => ({
        group,
        title: GROUP_TITLES[group] ?? group,
        noun: GROUP_NOUNS[group] ?? 'row',
        boxes: own.filter((d) => d.scope === 'ROW' && (d.row_group ?? 'rows') === group).map(boxOf),
    }));
    return { sections, groups };
};

let nextKey = 0;
export const newListRow = (boxes) => Object.fromEntries([['_key', `v${nextKey++}`], ...boxes.map((b) => [b.key, ''])]);

// From { field_key, item_no, value } rows (saved ci_report_values, or an AI run's fields with extracted_value)
const toForm = (layout, items) => {
    const fields = Object.fromEntries(layout.sections.flatMap((s) => s.boxes).map((b) => [b.key, '']));
    const lists = {};
    for (const g of layout.groups) {
        const keys = new Set(g.boxes.map((b) => b.key));
        const byItem = {};
        for (const it of items) {
            if (it.item_no > 0 && keys.has(it.field_key)) (byItem[it.item_no] ??= newListRow(g.boxes))[it.field_key] = it.value ?? '';
        }
        lists[g.group] = Object.keys(byItem).map(Number).sort((a, b) => a - b).map((n) => byItem[n]);
    }
    for (const it of items) {
        if (!it.item_no && it.field_key in fields) fields[it.field_key] = it.value ?? '';
    }
    return { fields, lists };
};
export const valuesFromSaved = (layout, saved = []) => toForm(layout, saved);
// A value the AI read, made to fit its box: a date / month box can't show "03/15/1988", so what doesn't fit the
// box's type is left empty for the CI to type (they see the report next to it); numbers lose their commas
export const fitBox = (dataType, value) => {
    const v = String(value ?? '').trim();
    if (v === '') return '';
    if (dataType === 'DATE') return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
    if (dataType === 'MONTH') return /^\d{4}-\d{2}$/.test(v) ? v : '';
    if (dataType === 'AMOUNT' || dataType === 'NUMBER') {
        const n = v.replaceAll(',', '').replace(/^₱|^PHP\s*/i, '').trim();
        return n !== '' && Number.isFinite(Number(n)) ? String(Number(n)) : '';
    }
    if (dataType === 'SEX') return /^(M|MALE)$/i.test(v) ? 'MALE' : /^(F|FEMALE)$/i.test(v) ? 'FEMALE' : '';
    return v;
};
// The AI's reading of one report (fetchDocumentChecks entry), fitted to the boxes, for the CI to check
export const valuesFromAi = (layout, check) => {
    const typeOf = Object.fromEntries([...layout.sections.flatMap((s) => s.boxes), ...layout.groups.flatMap((g) => g.boxes)]
        .map((b) => [b.key, b.def.data_type]));
    return toForm(layout, (check?.fields ?? []).map((f) => ({
        field_key: f.field_key, item_no: f.item_no, value: fitBox(typeOf[f.field_key], f.extracted_value),
    })));
};

// What save_ci_card takes as p_values: every non-empty box; list rows numbered 1..n in their order on screen
export const valuesPayload = (layout, form) => [
    ...layout.sections.flatMap((s) => s.boxes)
        .map((b) => ({ field_key: b.key, item_no: 0, value: String(form.fields?.[b.key] ?? '').trim() })),
    ...layout.groups.flatMap((g) => (form.lists?.[g.group] ?? []).flatMap((row, i) => g.boxes
        .map((b) => ({ field_key: b.key, item_no: i + 1, value: String(row[b.key] ?? '').trim() })))),
].filter((x) => x.value !== '');

export const valuesDirty = (layout, form, saved) =>
    JSON.stringify(valuesPayload(layout, form)) !== JSON.stringify(valuesPayload(layout, valuesFromSaved(layout, saved)));

// One-line summary of a list row (collapsed box): its first few filled-in values
export const listRowSummary = (boxes, row) =>
    boxes.map((b) => String(row[b.key] ?? '').trim()).filter(Boolean).slice(0, 3).join(' · ') || 'New row';
