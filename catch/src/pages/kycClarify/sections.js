// KYC clarification threads: section names and where each section sits in the read-only application summary.
// The names mirror kyc_section_label() in 20261203_kyc_clarifications.sql (the SMS / email use the SQL one).
const LABELS = {
    loan: 'Loan Details',
    principalInfo: 'Principal Borrower',
    principalAddress: 'Address',
    principalEmployment: 'Employment',
    spouse: 'Spouse',
    coBorrowers: 'Co-borrowers',
    mortgagor: 'Mortgagor / Attorney-in-Fact',
    obligations: 'Financial Obligations',
    references: 'Character References',
    collateral: 'Collateral & Referral',
    documents: 'Documents',
};

export const sectionLabel = (key) => {
    const co = String(key ?? '').match(/^coBorrower-([0-9]{1,2})$/);
    if (co) return `Co-borrower ${co[1]}`;
    return LABELS[key] ?? null;
};

// The summary block a borrower is shown in (applicationSummary.jsx gives each block this id)
export const partyAnchor = (role, partyNo) => `sum-party-${role}-${partyNo ?? 1}`;

// The summary block to scroll to for a section (the borrower's block for their sections; documents are listed there too)
export const summaryAnchor = (key) => {
    const co = String(key ?? '').match(/^coBorrower-([0-9]{1,2})$/);
    if (co) return partyAnchor('CO_BORROWER', Number(co[1]));
    switch (key) {
        case 'loan': return 'sum-loan';
        case 'principalInfo': case 'principalAddress': case 'principalEmployment': case 'documents':
            return partyAnchor('PRINCIPAL');
        case 'spouse': return partyAnchor('SPOUSE');
        case 'coBorrowers': return partyAnchor('CO_BORROWER', 1);
        case 'mortgagor': return partyAnchor('MORTGAGOR');
        case 'obligations': return 'sum-obligations';
        case 'references': return 'sum-references';
        case 'collateral': return 'sum-collateral';
        default: return null;
    }
};

// Who wrote a message, as the applicant sees it
export const fromLabel = (from, viewer) => {
    if (from === 'APPLICANT') return viewer === 'APPLICANT' ? 'You' : 'Applicant';
    return 'Your Account Officer';
};

// Reply attachments: the same rules as the form's uploads (the bucket enforces them too)
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const fileProblem = (file) => {
    if (!file) return null;
    if (!ACCEPTED_TYPES.includes(file.type)) return `${file.name}: attach a JPG, PNG or PDF file.`;
    if (file.size > MAX_FILE_BYTES) return `${file.name} is larger than 10 MB.`;
    return null;
};

export const QUESTION_MAX = 300;
export const REPLY_MAX = 1000;

// The open questions of a file as one line ("Employment, Loan Details"), or null when none is open
export const openSectionsText = (threads) => {
    const open = (threads ?? []).filter((t) => t.status === 'OPEN');
    return open.length ? open.map((t) => t.section_label ?? sectionLabel(t.section)).join(', ') : null;
};

// The note on Request CI / Mark CI Done while a question is open (the database refuses the move with the same words)
export const stageBlockNote = (text) => (text ? `Resolve the open clarification on ${text} first.` : null);
