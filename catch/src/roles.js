// Where each role lands after login. Applicants get their own home; every staff role shares the admin home for now.
export const homePathFor = (role) => (role === 'APPLICANT' ? '/applicantHomePage' : '/adminHomePage');

export const STAFF_ROLES = ['ACCOUNT_OFFICER', 'CREDIT_INVESTIGATOR', 'DISPATCH_ADMIN',
    'CREDIT_OFFICER', 'REVIEWER', 'APPROVER', 'DEPT_HEAD'];

// Can open the Decision Support page: every staff role except the Credit Investigator
// (mirrors the "read mrac runs" policy in 20261111_decision_support.sql)
export const DSS_ROLES = STAFF_ROLES.filter((r) => r !== 'CREDIT_INVESTIGATOR');

// Can open the FINAL report (group notes item 36): the Account Officer and the Approvers. The assigned Credit Officer
// still previews the DRAFT from the Financial Package while editing (reportMode() in finalReport/signoffs.js).
export const FINAL_REPORT_ROLES = ['ACCOUNT_OFFICER', 'APPROVER'];
export const REPORT_PAGE_ROLES = [...FINAL_REPORT_ROLES, 'CREDIT_OFFICER'];

// Roles assigned to applications (one AO and one CO slot per file). CATCH auto-assigns both on submission,
// balanced by workload (20261120_team_managers_auto_assignment.sql); nobody claims or releases files.
export const ASSIGNABLE_ROLES = ['ACCOUNT_OFFICER', 'CREDIT_OFFICER'];

// An AO or CO account marked Manager by the Dept Head manages that team: reassigns its slot, sets who's
// available for new files and runs "Auto-assign unassigned" (mirrors managed_role() in the DB).
// Returns the slot role they manage, or null.
export const managedSlot = (role, isManager) => (isManager && ASSIGNABLE_ROLES.includes(role) ? role : null);

export const MANAGER_LABELS = {
    ACCOUNT_OFFICER: 'Account Officer Manager',
    CREDIT_OFFICER: 'Credit Officer Manager',
};

// Picked by the CO in VII. Approval (review_assignments in 20261021_review_routing.sql)
export const REVIEW_ROLES = ['REVIEWER', 'APPROVER'];

// Can change the reviewers / approvers after the CO has sent the application (update_review_routing())
export const ROUTING_HEADS = ['DEPT_HEAD', 'DISPATCH_ADMIN'];

export const ROLE_LABELS = {
    APPLICANT: 'Loan Applicant',
    ACCOUNT_OFFICER: 'Account Officer',
    CREDIT_INVESTIGATOR: 'Credit Investigator',
    DISPATCH_ADMIN: 'Dispatch Admin (Credit Officer Admin)',
    CREDIT_OFFICER: 'Credit Officer',
    REVIEWER: 'Reviewer',
    APPROVER: 'Approver',
    DEPT_HEAD: 'Credit Department Head',
};
