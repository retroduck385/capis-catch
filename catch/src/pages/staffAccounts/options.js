// Display data for the staff accounts page: one short description and one accent colour per staff role,
// plus the PLACEHOLDER permission matrix shown in "Roles & access". The matrix is design-only sample data:
// real permissions live in the database (RLS / RPCs, see roles.js) and nothing here is read from or saved to it.

export const ROLE_INFO = {
    ACCOUNT_OFFICER: { hue: '#1e3f97', blurb: 'Takes in applications and verifies the KYC for the ones assigned to them.' },
    CREDIT_INVESTIGATOR: { hue: '#5b2bb0', blurb: 'Runs the NFIS and TU checks on requests sent by Account Officers.' },
    DISPATCH_ADMIN: { hue: '#0f766e', blurb: 'Assigns Account and Credit Officers and can change review routing.' },
    CREDIT_OFFICER: { hue: '#3730a3', blurb: 'Prepares the Financial Package and credit score, then sends it for approval.' },
    REVIEWER: { hue: '#9a4a0c', blurb: 'Reviews the applications routed to them, in order.' },
    APPROVER: { hue: '#166534', blurb: 'Gives the final approval on routed applications.' },
    DEPT_HEAD: { hue: '#334155', blurb: 'Manages staff accounts, assignments and review routing.' },
};

export const PERMISSIONS = [
    { key: 'view_apps', label: 'View Loan Applications' },
    { key: 'edit_profile', label: 'Edit Applicant Profile' },
    { key: 'view_score', label: 'View Credit Score' },
    { key: 'view_tin', label: 'View Tax ID (TIN)', masked: '***-***-***-000' },
    { key: 'view_ssn', label: 'View SSN / GSIS No.', masked: '***-**-****' },
    { key: 'approve', label: 'Approve / Reject' },
];

// Sample starting positions for the preview only
export const SAMPLE_ACCESS = {
    ACCOUNT_OFFICER: { level: 2, on: ['view_apps', 'edit_profile', 'view_score'] },
    CREDIT_INVESTIGATOR: { level: 2, on: ['view_apps', 'view_score'] },
    DISPATCH_ADMIN: { level: 3, on: ['view_apps', 'view_score'] },
    CREDIT_OFFICER: { level: 3, on: ['view_apps', 'edit_profile', 'view_score', 'view_tin'] },
    REVIEWER: { level: 3, on: ['view_apps', 'view_score', 'view_tin', 'view_ssn'] },
    APPROVER: { level: 4, on: ['view_apps', 'view_score', 'view_tin', 'view_ssn', 'approve'] },
    DEPT_HEAD: { level: 4, on: ['view_apps', 'edit_profile', 'view_score', 'view_tin', 'view_ssn', 'approve'] },
};

export const initialsOf = (name, email) => {
    const source = name?.trim() || (email ?? '?').split('@')[0].replace(/[._-]+/g, ' ');
    return source.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
};

// 12 characters without look-alikes (0/O, 1/l/I)
export const generatePassword = () => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
};
