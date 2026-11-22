// Acronym hovers for applicants (src/glossary.js): document and everyday terms only, never staff roles or checks
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APPLICANT_TERMS, GLOSSARY, termsTitle } from '../src/glossary.js';

const STAFF_ONLY = ['AO', 'CO', 'CI', 'AIF', 'KYC', 'NFIS', 'TU', 'DBR', 'LCR', 'NDI', 'AMD', 'ADB', 'TCP', 'TAT', 'MRAC', 'RAAC',
    'RAG', 'DOSRI', 'RPT', 'FP', 'OCR', 'CRMD', 'CIAD', 'CrID', 'CCS'];

test('every applicant term has a glossary entry', () => {
    for (const k of APPLICANT_TERMS) assert.ok(GLOSSARY[k], `${k} is in the glossary`);
});

test('staff and role acronyms are never applicant terms', () => {
    for (const k of STAFF_ONLY) assert.equal(APPLICANT_TERMS.has(k), false, `${k} stays staff only`);
});

test('the asked-for document terms are explained to applicants', () => {
    for (const k of ['CTC', 'COE', 'ITR', 'TIN', 'SSS', 'HGC']) assert.ok(APPLICANT_TERMS.has(k), k);
});

test('a title filtered for an applicant explains only applicant terms', () => {
    const applicant = (k) => APPLICANT_TERMS.has(k);
    assert.equal(termsTitle('COE / ITR for the AO', applicant).split('\n').map((l) => l.split(':')[0]).join(','), 'COE,ITR');
    assert.equal(termsTitle('AO and CO', applicant), undefined);
    assert.match(termsTitle('AO and CO'), /^AO: Account Officer/);
});
