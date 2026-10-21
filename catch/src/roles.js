// Where each role lands after login. Applicants get their own home; every staff role shares the admin home for now.
export const homePathFor = (role) => (role === 'APPLICANT' ? '/applicantHomePage' : '/adminHomePage');

export const STAFF_ROLES = ['ACCOUNT_OFFICER', 'CREDIT_INVESTIGATOR', 'DISPATCH_ADMIN',
    'CREDIT_OFFICER', 'REVIEWER', 'APPROVER', 'DEPT_HEAD'];

// Can assign / reassign / unassign any AO or CO (mirrors is_assigning_head() in the DB)
export const ASSIGNING_HEADS = ['DISPATCH_ADMIN', 'REVIEWER', 'APPROVER', 'DEPT_HEAD'];

// Roles that are assigned to applications and may claim / release them themselves
export const ASSIGNABLE_ROLES = ['ACCOUNT_OFFICER', 'CREDIT_OFFICER'];

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
