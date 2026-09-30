// Where each role lands after login. Applicants get their own home; every staff role shares the admin home for now.
export const homePathFor = (role) => (role === 'APPLICANT' ? '/applicantHomePage' : '/adminHomePage');

export const STAFF_ROLES = ['ACCOUNT_OFFICER', 'CREDIT_INVESTIGATOR', 'DISPATCH_ADMIN',
    'CREDIT_OFFICER', 'REVIEWER', 'APPROVER', 'DEPT_HEAD'];
