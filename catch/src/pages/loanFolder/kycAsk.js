// "Request a file" on a KYC section marked Needs clarification (group notes, item 15): a document request with the
// documents that back that section already ticked, not a message. The AO's KYC remark is internal staff text: it is
// shown above the request box for reference and never put into what the applicant receives.
//   kycFileRequest(sectionKey, parties, sectionTitle) -> the `ask` for AskApplicantButton (ask.jsx)
// parties: getParties(app) rows ({ id, role, party_no, application_requirements: [{ requirement_type }] }).
// Only documents that are on that person's checklist are ticked; a section with none (Address, Loan, References,
// Collateral) gets one empty "Other document" line for the AO to name (e.g. proof of billing, TCT copy). The Documents
// section ticks every borrower's still-missing checklist documents (the request box does that when items is empty).

const ID = ['VALID_ID_PASSPORT'];
const INCOME = ['COE_ITR', 'PAYSLIPS_REMITTANCES', 'SEC_DTI_MAYORS_PERMIT'];

// section key -> [roles whose documents count, requirement types]
const sectionDocs = (key) => {
    const coBorrower = key.match(/^coBorrower-([0-9]+)$/);
    if (key === 'principalInfo') return { roles: ['PRINCIPAL'], types: ID };
    if (key === 'principalEmployment') return { roles: ['PRINCIPAL'], types: INCOME };
    if (key === 'spouse') return { roles: ['SPOUSE'], types: [...ID, ...INCOME] };
    if (coBorrower) return { roles: ['CO_BORROWER'], partyNo: Number(coBorrower[1]), types: [...ID, ...INCOME] };
    if (key === 'obligations') return { roles: ['PRINCIPAL'], types: ['FS_BANK_STATEMENTS'] };
    if (key === 'mortgagor') return { roles: ['MORTGAGOR', 'ATTORNEY_IN_FACT'], types: [...ID, 'SPA'] };
    return { roles: ['PRINCIPAL'], types: [] };
};

export const kycFileRequest = (sectionKey, parties, sectionTitle) => {
    const note = `We need an updated or clearer copy of the document(s) below for the ${sectionTitle} part of your application.`;
    const from = `the KYC check of "${sectionTitle}" (Needs clarification)`;
    if (sectionKey === 'documents') return { kind: 'file', items: [], note, from };
    const { roles, partyNo, types } = sectionDocs(sectionKey);
    const people = (parties ?? []).filter((p) => roles.includes(p.role) && (partyNo === undefined || p.party_no === partyNo));
    const items = people.flatMap((p) => (p.application_requirements ?? [])
        .filter((r) => types.includes(r.requirement_type))
        .map((r) => ({ applicant_id: p.id, requirement_type: r.requirement_type })));
    const principal = (parties ?? []).find((p) => p.role === 'PRINCIPAL');
    return {
        kind: 'file',
        items,
        // no checklist document fits: one empty Other line, for that person (or the principal)
        blankOtherFor: items.length ? undefined : (people[0] ?? principal)?.id ?? null,
        note,
        from,
    };
};
