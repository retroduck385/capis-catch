// Where each role lands after login. Applicants get their own home; every staff role shares the admin home for now.
export const homePathFor = (role) => (role === 'APPLICANT' ? '/applicantHomePage' : '/adminHomePage');

export const STAFF_ROLES = ['ACCOUNT_OFFICER', 'CREDIT_INVESTIGATOR', 'DISPATCH_ADMIN',
    'CREDIT_OFFICER', 'REVIEWER', 'APPROVER', 'DEPT_HEAD'];

// Can assign / reassign / unassign any AO or CO (mirrors is_assigning_head() in the DB)
export const ASSIGNING_HEADS = ['DISPATCH_ADMIN', 'REVIEWER', 'APPROVER', 'DEPT_HEAD'];

// Roles that are assigned to applications and may claim / release them themselves
export const ASSIGNABLE_ROLES = ['ACCOUNT_OFFICER', 'CREDIT_OFFICER'];
