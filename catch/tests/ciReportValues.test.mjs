// Every other field on a CI report as boxes (src/pages/ciRequest/ciReportValues.js, 20261127_ci_report_values.sql).
// Field defs are a small copy of 20261109_ci_extraction.sql; values are synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    fitBox, layoutOf, listRowSummary, valuesDirty, valuesFromAi, valuesFromSaved, valuesPayload,
} from '../src/pages/ciRequest/ciReportValues.js';

const def = (document_type, field_key, label, scope, data_type, sort_order, extra = {}) =>
    ({ document_type, field_key, label, scope, data_type, sort_order, hint: null, compare_with: null, row_group: null, ...extra });
const DEFS = [
    def('CI_TU', 'report_date', 'Report date', 'HEADER', 'DATE', 10),
    def('CI_TU', 'subject_name', 'Name', 'HEADER', 'TEXT', 20, { compare_with: 'FULL_NAME' }),
    def('CI_TU', 'date_of_birth', 'Date of birth', 'HEADER', 'DATE', 30, { compare_with: 'DATE_OF_BIRTH' }),
    def('CI_TU', 'sex', 'Gender', 'HEADER', 'SEX', 40),
    def('CI_TU', 'open_accounts', 'Open accounts', 'HEADER', 'NUMBER', 200),
    def('CI_TU', 'score', 'Credit score', 'HEADER', 'NUMBER', 300),
    def('CI_TU', 'bcc_never_paid', 'Never-paid flag', 'HEADER', 'TEXT', 430),
    def('CI_TU', 'id_type', 'ID type', 'ROW', 'TEXT', 500, { row_group: 'ids' }),
    def('CI_TU', 'id_number', 'ID number', 'ROW', 'TEXT', 510, { row_group: 'ids' }),
    def('CI_TU', 'employer_name', 'Employer', 'ROW', 'TEXT', 700, { row_group: 'employers' }),
    def('CI_TU', 'employer_annual_income', 'Annual income', 'ROW', 'AMOUNT', 730, { row_group: 'employers' }),
    def('CI_TU', 'acct_type', 'Account type', 'ROW', 'TEXT', 820, { row_group: 'accounts' }),
    def('CI_NFIS', 'result_text', 'Result', 'HEADER', 'TEXT', 10),
    def('CI_NFIS', 'date_reported', 'Date reported', 'HEADER', 'DATE', 50),
    def('CI_NFIS', 'subject_name', 'Name searched', 'HEADER', 'TEXT', 60, { compare_with: 'FULL_NAME' }),
];

test('the TU boxes follow the report: sections by order, lists by group; accounts and report date have their own home', () => {
    const { sections, groups } = layoutOf('TU', DEFS);
    assert.deepEqual(sections.map((s) => s.title), ['Personal information and this inquiry', 'Summary of accounts', 'Credit score', 'Bureau flags']);
    assert.deepEqual(sections[0].boxes.map((b) => b.key), ['subject_name', 'date_of_birth', 'sex']);
    assert.equal(sections[0].boxes[2].kind, 'select');
    assert.deepEqual(groups.map((g) => g.group), ['ids', 'employers']);
    assert.equal(groups[1].boxes[1].kind, 'money');
    const nfis = layoutOf('NFIS', DEFS);
    assert.deepEqual(nfis.sections[0].boxes.map((b) => b.key), ['result_text', 'subject_name']);
    assert.deepEqual(nfis.groups, []);
});

test('saved values come back as the same boxes, and an unchanged form is not "unsaved"', () => {
    const layout = layoutOf('TU', DEFS);
    const saved = [
        { field_key: 'subject_name', item_no: 0, value: 'ANA SAMPLE' },
        { field_key: 'id_type', item_no: 1, value: 'TIN' }, { field_key: 'id_number', item_no: 1, value: '000-000-000' },
        { field_key: 'id_type', item_no: 2, value: 'SSS' },
    ];
    const form = valuesFromSaved(layout, saved);
    assert.equal(form.fields.subject_name, 'ANA SAMPLE');
    assert.equal(form.fields.score, '');
    assert.equal(form.lists.ids.length, 2);
    assert.equal(form.lists.ids[1].id_type, 'SSS');
    assert.deepEqual(form.lists.employers, []);
    assert.equal(valuesDirty(layout, form, saved), false);
    assert.deepEqual(valuesPayload(layout, form), [
        { field_key: 'subject_name', item_no: 0, value: 'ANA SAMPLE' },
        { field_key: 'id_type', item_no: 1, value: 'TIN' }, { field_key: 'id_number', item_no: 1, value: '000-000-000' },
        { field_key: 'id_type', item_no: 2, value: 'SSS' },
    ]);
    // removing the first ID renumbers the rest
    const fewer = { ...form, lists: { ...form.lists, ids: form.lists.ids.slice(1) } };
    assert.equal(valuesDirty(layout, fewer, saved), true);
    assert.deepEqual(valuesPayload(layout, fewer).filter((x) => x.field_key === 'id_type'), [{ field_key: 'id_type', item_no: 1, value: 'SSS' }]);
});

test('Run AI fills the same boxes, fitted to their types', () => {
    const layout = layoutOf('TU', DEFS);
    const check = {
        fields: [
            { field_key: 'subject_name', item_no: 0, extracted_value: 'ANA SAMPLE' },
            { field_key: 'date_of_birth', item_no: 0, extracted_value: '04/12/1988' },     // not ISO: left for the CI
            { field_key: 'sex', item_no: 0, extracted_value: 'F' },
            { field_key: 'score', item_no: 0, extracted_value: '612' },
            { field_key: 'employer_name', item_no: 1, extracted_value: 'SAMPLE CORP' },
            { field_key: 'employer_annual_income', item_no: 1, extracted_value: '480,000.00' },
            { field_key: 'acct_type', item_no: 1, extracted_value: 'CREDIT CARD' },          // accounts: not a box here
            { field_key: 'report_date', item_no: 0, extracted_value: '2026-10-30' },          // typed home: not here
        ],
    };
    const form = valuesFromAi(layout, check);
    assert.equal(form.fields.subject_name, 'ANA SAMPLE');
    assert.equal(form.fields.date_of_birth, '');
    assert.equal(form.fields.sex, 'FEMALE');
    assert.equal(form.lists.employers[0].employer_annual_income, '480000');
    assert.equal('report_date' in form.fields, false);
    assert.equal(valuesPayload(layout, form).some((x) => x.field_key.startsWith('acct_')), false);
    assert.equal(listRowSummary(layout.groups[1].boxes, form.lists.employers[0]), 'SAMPLE CORP · 480000');
});

test('fitting a value to its box', () => {
    assert.equal(fitBox('DATE', '2020-01-02'), '2020-01-02');
    assert.equal(fitBox('DATE', 'Jan 2, 2020'), '');
    assert.equal(fitBox('MONTH', '2024-03'), '2024-03');
    assert.equal(fitBox('AMOUNT', '₱1,250.50'), '1250.5');
    assert.equal(fitBox('NUMBER', 'n/a'), '');
    assert.equal(fitBox('SEX', 'male'), 'MALE');
    assert.equal(fitBox('TEXT', '  -999 '), '-999');
    assert.equal(fitBox('TEXT', null), '');
});
