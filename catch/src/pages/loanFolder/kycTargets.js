// Links between the Document check and the loan folder's KYC sections. No Supabase calls here.
//  - kycFieldLink(def, party, appId): the arrow on a Document check value (e.g. Co-borrower 2's ID address) ->
//    the loan folder section where that value is edited, plus the form field to scroll to and highlight.
//    /loanFolderPage?id=<app>&field=<id>[,<fallback id>]#kyc-<section> (loanFolderPage.jsx opens the section and
//    flashes the first field id it finds; ids are the ones fields.jsx gives each input).
//  - sectionParties / sectionDocTypes: which borrower(s) a KYC section is about, and which of their documents are
//    "for this section" (loanFolder/sectionDocuments.jsx: the section's Documents popup).
import { partyLabel } from '../applicationForm/options.js';

// The KYC section that holds a person's details. Principal: their own three steps; others: one step each.
const personSection = (party) => {
    if (!party) return null;
    if (party.role === 'PRINCIPAL') return { key: 'principalInfo', title: 'Principal Borrower' };
    if (party.role === 'SPOUSE') return { key: 'spouse', title: 'Spouse' };
    if (party.role === 'CO_BORROWER') return { key: `coBorrower-${party.party_no ?? 1}`, title: partyLabel(party) };
    return { key: 'mortgagor', title: 'Mortgagor / Attorney-in-Fact' };
};

const addressSection = (party) => (party?.role === 'PRINCIPAL' ? { key: 'principalAddress', title: 'Address' } : personSection(party));
const employmentSection = (party) => (party?.role === 'PRINCIPAL' ? { key: 'principalEmployment', title: 'Employment' } : personSection(party));

// Form field ids (fields.jsx): person fields `${role}-${column}`, employment `${role}-job-${column}`, the principal's
// present address `present-${part}`, a spouse / co-borrower's `${role}-present-${part}` (hidden while "Same as
// principal" is ticked, so that checkbox is the fallback), the attorney-in-fact's `aif-${part}`.
const addressIds = (party) => {
    if (party.role === 'PRINCIPAL') return ['present-building_street'];
    if (party.role === 'ATTORNEY_IN_FACT') return ['aif-building_street'];
    if (party.role === 'MORTGAGOR') return [];
    return [`${party.role}-present-building_street`, `${party.role}-same_as_principal`];
};

// Where the value of one extraction field def lives in the loan folder, or null when it has no counterpart there
// (ID number, issue date, signatory ...).
export const kycFieldTarget = (def, party) => {
    if (!party) return null;
    if (def.target_table === 'applicants') return { section: personSection(party), ids: [`${party.role}-${def.target_column}`] };
    if (def.target_table === 'employment_info') return { section: employmentSection(party), ids: [`${party.role}-job-${def.target_column}`] };
    if (def.target_table === 'addresses' || def.compare_with === 'PRESENT_ADDRESS') return { section: addressSection(party), ids: addressIds(party) };
    if (def.compare_with === 'FULL_NAME') return { section: personSection(party), ids: [`${party.role}-first_name`] };
    return null;
};

export const kycFieldLink = (def, party, appId) => {
    const t = kycFieldTarget(def, party);
    if (!t) return null;
    const field = t.ids.length ? `&field=${encodeURIComponent(t.ids.join(','))}` : '';
    return { to: `/loanFolderPage?id=${appId}${field}#kyc-${t.section.key}`, sectionTitle: t.section.title };
};

// The person / people a KYC section is about (none for loan, references, collateral ...)
export const sectionParties = (parties, key) => {
    if (['principalInfo', 'principalAddress', 'principalEmployment'].includes(key)) return parties.filter((p) => p.role === 'PRINCIPAL');
    if (key === 'spouse') return parties.filter((p) => p.role === 'SPOUSE');
    if (key?.startsWith('coBorrower-')) return parties.filter((p) => p.role === 'CO_BORROWER' && String(p.party_no ?? 1) === key.slice(11));
    if (key === 'mortgagor') return parties.filter((p) => ['MORTGAGOR', 'ATTORNEY_IN_FACT'].includes(p.role));
    return [];
};

// Document types that belong to a section, in the order they are shown first; null = all of that person's files
const SECTION_DOC_TYPES = {
    principalInfo: ['VALID_ID_PASSPORT'],
    principalAddress: ['VALID_ID_PASSPORT'],
    principalEmployment: ['COE_ITR', 'PAYSLIPS_REMITTANCES', 'FS_BANK_STATEMENTS', 'SEC_DTI_MAYORS_PERMIT'],
};
export const sectionDocTypes = (key) => SECTION_DOC_TYPES[key] ?? null;

// Split a person's files into "for this section" (in the section's type order, then by upload time) and the rest
export const splitSectionDocs = (key, docs) => {
    const types = sectionDocTypes(key);
    const byUpload = (a, b) => String(a.uploaded_at ?? '').localeCompare(String(b.uploaded_at ?? ''));
    // ID first, then income, then the rest (same order as the Document check)
    const ORDER = ['VALID_ID_PASSPORT', 'COE_ITR', 'PAYSLIPS_REMITTANCES', 'FS_BANK_STATEMENTS', 'SPA', 'SEC_DTI_MAYORS_PERMIT'];
    const rank = (list, t) => (list.indexOf(t) === -1 ? list.length : list.indexOf(t));
    if (!types) return { main: [...docs].sort((a, b) => rank(ORDER, a.document_type) - rank(ORDER, b.document_type) || byUpload(a, b)), other: [] };
    return {
        main: docs.filter((d) => types.includes(d.document_type))
            .sort((a, b) => rank(types, a.document_type) - rank(types, b.document_type) || byUpload(a, b)),
        other: docs.filter((d) => !types.includes(d.document_type))
            .sort((a, b) => rank(ORDER, a.document_type) - rank(ORDER, b.document_type) || byUpload(a, b)),
    };
};
