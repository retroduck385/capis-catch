// KYC clarification threads (src/pages/kycClarify/sections.js): section names (the same as the SQL ones the SMS and
// email use), where each section sits in the applicant's read-only summary, and the reply file rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileProblem, fromLabel, openSectionsText, partyAnchor, sectionLabel, stageBlockNote, summaryAnchor } from '../src/pages/kycClarify/sections.js';

const SQL = fs.readFileSync(new URL('../supabase/migrations/20261203_kyc_clarifications.sql', import.meta.url), 'utf8');
const KEYS = ['loan', 'principalInfo', 'principalAddress', 'principalEmployment', 'spouse', 'coBorrowers', 'mortgagor',
    'obligations', 'references', 'collateral', 'documents'];

test('every KYC section has the same name in the page and in kyc_section_label()', () => {
    for (const k of KEYS) {
        const label = sectionLabel(k);
        assert.ok(label, k);
        assert.ok(SQL.includes(`when '${k}' then '${label.replace(/'/g, "''")}'`), `${k} -> ${label} in the SQL`);
    }
    assert.equal(sectionLabel('coBorrower-2'), 'Co-borrower 2');
    assert.equal(sectionLabel('nowhere'), null);
    assert.equal(sectionLabel(null), null);
});

test('each section scrolls to its part of the summary', () => {
    assert.equal(summaryAnchor('principalEmployment'), partyAnchor('PRINCIPAL'));
    assert.equal(summaryAnchor('documents'), 'sum-party-PRINCIPAL-1');
    assert.equal(summaryAnchor('spouse'), 'sum-party-SPOUSE-1');
    assert.equal(summaryAnchor('coBorrower-3'), 'sum-party-CO_BORROWER-3');
    assert.equal(summaryAnchor('loan'), 'sum-loan');
    assert.equal(summaryAnchor('obligations'), 'sum-obligations');
    assert.equal(summaryAnchor('unknown'), null);
    for (const k of KEYS) assert.ok(summaryAnchor(k), k);
});

test('the applicant sees roles, never names', () => {
    assert.equal(fromLabel('ACCOUNT_OFFICER', 'APPLICANT'), 'Your Account Officer');
    assert.equal(fromLabel('APPLICANT', 'APPLICANT'), 'You');
    assert.equal(fromLabel('APPLICANT', 'STAFF'), 'Applicant');
});

test('reply files: JPG, PNG or PDF up to 10 MB; no file is fine', () => {
    assert.equal(fileProblem(null), null);
    assert.equal(fileProblem({ name: 'a.pdf', type: 'application/pdf', size: 1000 }), null);
    assert.equal(fileProblem({ name: 'a.png', type: 'image/png', size: 10 * 1024 * 1024 }), null);
    assert.match(fileProblem({ name: 'a.exe', type: 'application/x-msdownload', size: 10 }), /JPG, PNG or PDF/);
    assert.match(fileProblem({ name: 'big.jpg', type: 'image/jpeg', size: 10 * 1024 * 1024 + 1 }), /larger than 10 MB/);
});

test('Request CI / Mark CI Done wait for open questions, with the same words as the database', () => {
    const threads = [
        { status: 'OPEN', section: 'principalEmployment', section_label: 'Employment' },
        { status: 'CLOSED', section: 'spouse', section_label: 'Spouse' },
        { status: 'OPEN', section: 'loan' },
    ];
    assert.equal(openSectionsText(threads), 'Employment, Loan Details');
    assert.equal(stageBlockNote(openSectionsText(threads)), 'Resolve the open clarification on Employment, Loan Details first.');
    assert.equal(openSectionsText([{ status: 'CLOSED', section: 'loan' }]), null);
    assert.equal(stageBlockNote(null), null);
    const guard = fs.readFileSync(new URL('../supabase/migrations/20261204_kyc_clarification_guard.sql', import.meta.url), 'utf8');
    assert.ok(guard.includes("raise exception 'Resolve the open clarification on % first.'"));
});
