// Each validator takes a row shaped like its DB table (form state uses the same keys)
// and returns { field: message }. An empty object means the block is complete.
// The same functions decide whether a wizard step can be left, and whether it's done.

import { MAX_DEPENDENTS, PARTY_FIELDS, PERSON_FIELDS } from './options';

export const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';

const MOBILE_RE = /^(09\d{9}|\+639\d{9})$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIN_RE = /^\d{3}-?\d{3}-?\d{3}(-?\d{3,5})?$/;
const ZIP_RE = /^\d{4}$/;

const today = () => new Date().toISOString().slice(0, 10);

export const ageOn = (dob, onDate = new Date()) => {
    const d = new Date(dob);
    let age = onDate.getFullYear() - d.getFullYear();
    const m = onDate.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && onDate.getDate() < d.getDate())) age--;
    return age;
};

const required = (errors, row, field, message = 'Required') => {
    if (isBlank(row?.[field])) errors[field] = message;
};

const positive = (errors, row, field) => {
    if (!isBlank(row?.[field]) && !(Number(row[field]) > 0)) errors[field] = 'Must be greater than 0';
};

const notFuture = (errors, row, field) => {
    if (!isBlank(row?.[field]) && row[field] > today()) errors[field] = 'Cannot be a future date';
};

const format = (errors, row, field, re, message) => {
    if (!isBlank(row?.[field]) && !re.test(String(row[field]).trim())) errors[field] = message;
};

export const validateLoan = (app) => {
    const e = {};
    if (isBlank(app?.loan_purpose_id) && isBlank(app?.loan_purpose_other)) e.loan_purpose_id = 'Choose a purpose or type your own';
    required(e, app, 'property_address');
    required(e, app, 'loan_amount');
    positive(e, app, 'loan_amount');
    required(e, app, 'loan_term_years');
    const term = Number(app?.loan_term_years);
    if (!isBlank(app?.loan_term_years) && (!Number.isInteger(term) || term < 1 || term > 30)) {
        e.loan_term_years = 'Whole number of years, 1 to 30';
    }
    return e;
};

export const validatePerson = (person, role) => {
    const e = {};
    PARTY_FIELDS[role].forEach(([field, isRequired]) => {
        if (isRequired) required(e, person, field, `${PERSON_FIELDS[field].label} is required`);
    });
    format(e, person, 'mobile_number', MOBILE_RE, 'Use 09XXXXXXXXX or +639XXXXXXXXX');
    format(e, person, 'email_address', EMAIL_RE, 'Invalid email address');
    format(e, person, 'tin', TIN_RE, 'TIN is 9 to 14 digits');
    if (!isBlank(person?.date_of_birth)) {
        if (person.date_of_birth > today()) e.date_of_birth = 'Cannot be a future date';
        else if (ageOn(person.date_of_birth) < 18) e.date_of_birth = 'Must be at least 18 years old';
    }
    return e;
};

// "How many dependents?" then one age box per dependent. Errors: dependent_count, dependent_age_<i>
export const validateDependents = (count, ages) => {
    const e = {};
    const n = Number(count);
    if (isBlank(count)) e.dependent_count = 'Enter 0 if you have no dependents';
    else if (!Number.isInteger(n) || n < 0 || n > MAX_DEPENDENTS) e.dependent_count = `Whole number, 0 to ${MAX_DEPENDENTS}`;
    else {
        Array.from({ length: n }, (_, i) => ages[i]).forEach((age, i) => {
            if (isBlank(age)) e[`dependent_age_${i}`] = 'Required';
            else if (!/^\d{1,3}$/.test(String(age).trim()) || Number(age) > 120) e[`dependent_age_${i}`] = 'Whole number, 0 to 120';
        });
    }
    return e;
};

// kind: PRESENT (with ownership + move-in), PERMANENT (with move-in), EMPLOYER, CONTACT (address only)
export const validateAddress = (address, kind) => {
    const e = {};
    if (address?.same_as_principal) return e;
    required(e, address, 'building_street');
    required(e, address, 'subdivision_barangay');
    required(e, address, 'municipality_city');
    required(e, address, 'province');
    if (kind !== 'EMPLOYER') required(e, address, 'zip_code');
    format(e, address, 'zip_code', ZIP_RE, 'ZIP code is 4 digits');
    if (kind === 'PRESENT') {
        required(e, address, 'home_ownership');
        if (address?.home_ownership === 'RENTED') {
            required(e, address, 'monthly_rent', 'Rent is required when renting');
            positive(e, address, 'monthly_rent');
        }
    }
    if (kind === 'PRESENT' || kind === 'PERMANENT') {
        required(e, address, 'date_move_in');
        notFuture(e, address, 'date_move_in');
    }
    return e;
};

export const validateEmployment = (job, role) => {
    const e = {};
    required(e, job, 'employment_type');
    if (job?.employment_type === 'UNEMPLOYED') {
        if (role !== 'SPOUSE') e.employment_type = 'A source of income is required';
        return e;
    }
    required(e, job, 'employer_business_name');
    required(e, job, 'occupation');
    required(e, job, 'employment_date');
    notFuture(e, job, 'employment_date');
    required(e, job, 'contact_number');
    required(e, job, 'gross_monthly_income');
    positive(e, job, 'gross_monthly_income');
    format(e, job, 'email_address', EMAIL_RE, 'Invalid email address');
    notFuture(e, job, 'ctc_date_issued');
    return e;
};

export const validateBankAccount = (row) => {
    const e = {};
    required(e, row, 'bank_name');
    required(e, row, 'account_type');
    required(e, row, 'account_number');
    return e;
};

export const validateExistingLoan = (row) => {
    const e = {};
    required(e, row, 'loan_type');
    required(e, row, 'lending_institution');
    required(e, row, 'monthly_payment');
    positive(e, row, 'monthly_payment');
    return e;
};

export const validateCreditCard = (row) => {
    const e = {};
    required(e, row, 'issuing_bank');
    required(e, row, 'credit_limit');
    positive(e, row, 'credit_limit');
    required(e, row, 'expiry_date');
    return e;
};

export const validateReference = (row) => {
    const e = {};
    required(e, row, 'name');
    required(e, row, 'address');
    required(e, row, 'contact_number');
    required(e, row, 'relationship_to_principal');
    return e;
};

export const validateCollateral = (row) => {
    const e = {};
    required(e, row, 'property_type');
    required(e, row, 'selling_price');
    positive(e, row, 'selling_price');
    required(e, row, 'registered_owner');
    return e;
};

export const validateReferral = (row) => {
    const e = {};
    required(e, row, 'channel');
    if (row?.channel === 'DEVELOPER') required(e, row, 'developer_name', "Developer's name is required");
    return e;
};

export const hasErrors = (errors) => Object.keys(errors).length > 0;

// Applicants must complete their master profile before applying; staff before using the work tray
// role: PROFILE (applicant) or STAFF_PROFILE
export const isProfileComplete = (profile, role = 'PROFILE') => !!profile && !hasErrors(validatePerson(profile, role));
