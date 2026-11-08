import { REVIEW_ROLES } from '../../roles';

// Where a work tray row opens for each role: the CI opens the NFIS / TU request, the CO the Financial Package,
// a reviewer / approver the review summary of what's routed to them, everyone else the loan folder.
export const folderPath = (role, row, routedToMe) => {
    const id = row.application_id;
    if (role === 'CREDIT_INVESTIGATOR') return `/ciRequestPage?id=${id}`;
    if (role === 'CREDIT_OFFICER') return `/financialPackagePage?id=${id}`;
    if (REVIEW_ROLES.includes(role) && routedToMe) return `/reviewSummaryPage?id=${id}`;
    return `/loanFolderPage?id=${id}`;
};
