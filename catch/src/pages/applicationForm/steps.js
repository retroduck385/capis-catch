// Wizard step order and "is this step done?" checks, computed from the saved record.
// A step can only be opened once every step before it is complete (and was visited).
import { getAddress, getParty, one } from './api';
import { minFilesFor } from './options';
import {
    hasErrors, validateAddress, validateBankAccount, validateCollateral, validateCreditCard,
    validateEmployment, validateExistingLoan, validateLoan, validatePerson, validateReference, validateReferral,
} from './validators';
import LoanDetailsStep from './steps/loanDetailsStep';
import PrincipalInfoStep from './steps/principalInfoStep';
import PrincipalAddressStep from './steps/principalAddressStep';
import PrincipalEmploymentStep from './steps/principalEmploymentStep';
import PartyStep from './steps/partyStep';
import MortgagorStep from './steps/mortgagorStep';
import ObligationsStep from './steps/obligationsStep';
import ReferencesStep from './steps/referencesStep';
import CollateralStep from './steps/collateralStep';
import DocumentsStep from './steps/documentsStep';
import ReviewStep from './steps/reviewStep';

const ok = (errors) => !hasErrors(errors);

const jobComplete = (party, role) => {
    const job = one(party?.employment_info);
    if (!job || !ok(validateEmployment(job, role))) return false;
    return job.employment_type === 'UNEMPLOYED' || ok(validateAddress(getAddress(party, 'EMPLOYER'), 'EMPLOYER'));
};

// Spouse / co-borrower: info + present address (or same as principal) + employment
const otherBorrowerComplete = (party, role) =>
    !!party
    && ok(validatePerson(party, role))
    && ok(validateAddress(getAddress(party, 'PRESENT'), 'PRESENT'))
    && jobComplete(party, role);

const documentsComplete = (app) =>
    (app.applicants ?? [])
        .filter((p) => ['PRINCIPAL', 'SPOUSE', 'CO_BORROWER'].includes(p.role))
        .every((p) => (p.application_requirements ?? [])
            .every((r) => (r.documents ?? []).length >= minFilesFor(r.requirement_type)));

export const buildSteps = (app) => {
    const principal = getParty(app, 'PRINCIPAL');
    const coBorrower = getParty(app, 'CO_BORROWER');
    const mortgagor = getParty(app, 'MORTGAGOR');
    const aif = getParty(app, 'ATTORNEY_IN_FACT');
    const married = principal?.civil_status === 'MARRIED';

    const steps = [
        {
            key: 'loan', title: 'Loan Details', Component: LoanDetailsStep,
            complete: ok(validateLoan(app)),
        },
        {
            key: 'principalInfo', title: 'Principal Borrower', Component: PrincipalInfoStep,
            complete: !!principal && ok(validatePerson(principal, 'PRINCIPAL')),
        },
        {
            key: 'principalAddress', title: 'Address', Component: PrincipalAddressStep,
            complete: !!principal
                && ok(validateAddress(getAddress(principal, 'PRESENT'), 'PRESENT'))
                && ok(validateAddress(getAddress(principal, 'PERMANENT'), 'PERMANENT')),
        },
        {
            key: 'principalEmployment', title: 'Employment', Component: PrincipalEmploymentStep,
            complete: jobComplete(principal, 'PRINCIPAL'),
        },
    ];

    // "Married" expands the checklist with a required spouse step
    if (married) {
        steps.push({
            key: 'spouse', title: 'Spouse', Component: PartyStep, props: { role: 'SPOUSE' },
            complete: otherBorrowerComplete(getParty(app, 'SPOUSE'), 'SPOUSE'),
        });
    }

    steps.push(
        {
            key: 'coBorrower', title: 'Co-borrower', Component: PartyStep, props: { role: 'CO_BORROWER', optional: true },
            complete: !coBorrower || otherBorrowerComplete(coBorrower, 'CO_BORROWER'),
        },
        {
            key: 'mortgagor', title: 'Mortgagor / Attorney-in-Fact', Component: MortgagorStep,
            complete: (!mortgagor || ok(validatePerson(mortgagor, 'MORTGAGOR')))
                && (!aif || (ok(validatePerson(aif, 'ATTORNEY_IN_FACT'))
                    && ok(validateAddress(getAddress(aif, 'PRESENT'), 'CONTACT')))),
        },
        {
            key: 'obligations', title: 'Financial Obligations', Component: ObligationsStep,
            complete: !!principal
                && (principal.bank_accounts ?? []).every((r) => ok(validateBankAccount(r)))
                && (principal.existing_loans ?? []).every((r) => ok(validateExistingLoan(r)))
                && (principal.credit_cards ?? []).every((r) => ok(validateCreditCard(r))),
        },
        {
            key: 'references', title: 'Character References', Component: ReferencesStep,
            complete: (app.character_references ?? []).filter((r) => ok(validateReference(r))).length >= 3,
        },
        {
            key: 'collateral', title: 'Collateral & Referral', Component: CollateralStep,
            complete: ok(validateCollateral(one(app.collateral_details))) && ok(validateReferral(one(app.referral_details))),
        },
        {
            key: 'documents', title: 'Documents', Component: DocumentsStep,
            complete: !!principal && documentsComplete(app),
        },
        { key: 'review', title: 'Review & Submit', Component: ReviewStep, complete: false },
    );

    return steps;
};
