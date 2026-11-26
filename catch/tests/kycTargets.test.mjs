// Document check arrow -> loan folder section + form field, and the section Documents popup's file split
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kycFieldLink, kycFieldTarget, sectionParties, splitSectionDocs } from '../src/pages/loanFolder/kycTargets.js';

const principal = { id: 1, role: 'PRINCIPAL', party_no: 1 };
const spouse = { id: 2, role: 'SPOUSE', party_no: 1 };
const co2 = { id: 4, role: 'CO_BORROWER', party_no: 2 };
const dob = { field_key: 'date_of_birth', target_table: 'applicants', target_column: 'date_of_birth' };
const address = { field_key: 'address', target_table: 'addresses', target_column: 'building_street', compare_with: 'PRESENT_ADDRESS' };
const employer = { field_key: 'employer_name', target_table: 'employment_info', target_column: 'employer_business_name' };
const idNo = { field_key: 'id_number', target_table: null, target_column: null, compare_with: null };

test('principal values go to their own three sections', () => {
    assert.equal(kycFieldTarget(dob, principal).section.key, 'principalInfo');
    assert.deepEqual(kycFieldTarget(dob, principal).ids, ['PRINCIPAL-date_of_birth']);
    assert.equal(kycFieldTarget(address, principal).section.key, 'principalAddress');
    assert.deepEqual(kycFieldTarget(address, principal).ids, ['present-building_street']);
    assert.equal(kycFieldTarget(employer, principal).section.key, 'principalEmployment');
    assert.deepEqual(kycFieldTarget(employer, principal).ids, ['PRINCIPAL-job-employer_business_name']);
});

test('co-borrower 2 address goes to the Co-borrower 2 section, with the Same-as-principal fallback', () => {
    const link = kycFieldLink(address, co2, 42);
    assert.equal(link.sectionTitle, 'Co-borrower 2');
    assert.equal(link.to, `/loanFolderPage?id=42&field=${encodeURIComponent('CO_BORROWER-present-building_street,CO_BORROWER-same_as_principal')}#kyc-coBorrower-2`);
});

test('values with nothing in the application get no arrow', () => {
    assert.equal(kycFieldLink(idNo, principal, 1), null);
    assert.equal(kycFieldLink(dob, null, 1), null);
});

test('a section is about the right person', () => {
    const all = [principal, spouse, { id: 3, role: 'CO_BORROWER', party_no: 1 }, co2];
    assert.deepEqual(sectionParties(all, 'coBorrower-2'), [co2]);
    assert.deepEqual(sectionParties(all, 'principalAddress'), [principal]);
    assert.deepEqual(sectionParties(all, 'loan'), []);
});

test('Employment opens on income files, the ID is under other files', () => {
    const docs = [
        { id: 1, document_type: 'VALID_ID_PASSPORT', uploaded_at: '2026-01-01' },
        { id: 2, document_type: 'PAYSLIPS_REMITTANCES', uploaded_at: '2026-01-02' },
        { id: 3, document_type: 'COE_ITR', uploaded_at: '2026-01-03' },
    ];
    const { main, other } = splitSectionDocs('principalEmployment', docs);
    assert.deepEqual(main.map((d) => d.id), [3, 2]);
    assert.deepEqual(other.map((d) => d.id), [1]);
    const spouseSplit = splitSectionDocs('spouse', docs);
    assert.deepEqual(spouseSplit.main.map((d) => d.id), [1, 3, 2]);
    assert.deepEqual(spouseSplit.other, []);
});
