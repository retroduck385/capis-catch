// Data behind the KYC-FP "CI Request" tab (NFIS Request Form + TransUnion Request Template), built from the
// application record instead of being typed in. Shared by the forms, the CI's page and the AO's "Request CI" panel.
import { getAddress, getParties, one } from '../applicationForm/api';
import { joinAddress, presentAddressOf, tenure } from '../applicationForm/derived';
import { BORROWER_ROLES, CIVIL_STATUSES, EMPLOYMENT_TYPES, formatMoney, labelFor, partyLabel } from '../applicationForm/options';

export const peso = (value) => (value === null || value === undefined || value === '' ? null : `₱${formatMoney(value)}`);
export const isBlank = (v) => v === null || v === undefined || v === '';

// Everything both forms need, per borrower (principal, spouse, co-borrowers 1..n)
export const buildCiRequest = (app) => {
    const parties = getParties(app, BORROWER_ROLES);
    const principal = parties.find((p) => p.role === 'PRINCIPAL');

    const people = parties.map((p) => {
        const job = one(p.employment_info);
        const employed = job && job.employment_type !== 'UNEMPLOYED';
        const address = presentAddressOf(p, principal);
        return {
            key: `${p.role}-${p.party_no ?? 1}`,
            label: p.role === 'PRINCIPAL' ? 'Subject' : partyLabel(p),
            lastName: p.last_name,
            firstName: p.first_name,
            middleName: p.middle_name,
            maidenName: p.maiden_name,
            birthDate: p.date_of_birth,
            civilStatus: p.civil_status ? labelFor(CIVIL_STATUSES, p.civil_status) : null,
            address: joinAddress(address),
            zip: address?.zip_code ?? null,
            mobile: p.mobile_number,
            incomeSource: job?.employment_type ? labelFor(EMPLOYMENT_TYPES, job.employment_type) : null,
            employer: employed ? job.employer_business_name : null,
            employerAddress: employed ? joinAddress(getAddress(p, 'EMPLOYER')) : null,
            monthlyIncome: employed ? job.gross_monthly_income : null,
            tenure: employed ? tenure(job.employment_date, app.submitted_at) : null,
            employed,
        };
    });

    return {
        loanType: one(app.loan_purposes)?.label ?? app.loan_purpose_other ?? null,
        loanAmount: app.loan_amount,
        people,
    };
};

// TU rows: [label, value per person, optional? (boolean, or a function of the person)]
export const TU_ROWS = [
    ['Last Name', (p) => p.lastName],
    ['First Name', (p) => p.firstName],
    ['Middle Name', (p) => p.middleName, true],
    ['Full Maiden Name (married female)', (p) => p.maidenName, true],
    ['Date of Birth', (p) => p.birthDate],
    ['Civil Status', (p) => p.civilStatus],
    ['Complete Address (Philippines)', (p) => p.address],
    ['Zip Code', (p) => p.zip],
    ['Contact Number (Philippines)', (p) => p.mobile],
    ['Source of Income', (p) => p.incomeSource],
    ['Company / Employer Name', (p) => p.employer, (p) => !p.employed],
    ['Monthly Gross Salary / Income', (p) => peso(p.monthlyIncome), (p) => !p.employed],
    ['Annual Gross Salary / Income', (p) => (p.monthlyIncome == null ? null : peso(p.monthlyIncome * 12)), (p) => !p.employed],
    ['Tenure', (p) => p.tenure, (p) => !p.employed],
];

// ID details come later from the uploaded ID (OCR labeling not built yet)
export const ID_ROWS = ['ID Type', 'ID Number', 'Expiry Date'];

// Mandatory values that are still blank: the sheet says a request with missing values won't be accommodated
export const missingFields = (request) => request.people.flatMap((p) => TU_ROWS
    .filter(([, get, optional]) => !(typeof optional === 'function' ? optional(p) : optional) && isBlank(get(p)))
    .map(([label]) => ({ who: p.label, field: label })));
