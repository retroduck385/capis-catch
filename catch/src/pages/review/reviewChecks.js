// Reviewer sign-off (20261108_reviewer_signoff.sql): labels, whose turn it is, and the automatic flags the
// review page raises. Flags only point the reviewer at something to look at; the reviewer decides (no flag
// blocks a sign-off). policyFlags() adds the latest policy check (MRAC / RAG) to the same list.
import { getParties, one } from '../applicationForm/api';
import { BORROWER_ROLES, REQUIREMENT_LABELS, formatMoney, minFilesFor, partyLabel } from '../applicationForm/options';
import { percent } from '../financialPackage/compute';
import { showFact, showRequirement } from '../mrac/labels';
import { splitRouting } from './approval';

export const REVIEW_ACTIONS = [
    { value: 'ENDORSED', label: 'Endorse' },
    { value: 'NOT_ENDORSED', label: 'Not endorse' },
    { value: 'RETURNED', label: 'Return to the Credit Officer for revision' },
];
export const DECISION_LABELS = { ENDORSED: 'Endorsed', NOT_ENDORSED: 'Not endorsed', RETURNED: 'Returned for revision' };

// Credit Head interview: "minor or major revision"
export const SEVERITIES = [
    { value: 'MINOR', label: 'Minor', hint: 'typo, small correction' },
    { value: 'MAJOR', label: 'Major', hint: 'wrong amount, missed exception, computation not supported' },
];
export const severityLabel = (v) => SEVERITIES.find((s) => s.value === v)?.label ?? v;

// Mirrors current_review_assignment(): reviewers act in order; a sign-off (not a return) stands across rounds.
// rows = review_assignments, decisions = review_decisions (oldest first)
export const reviewState = (rows, decisions) => {
    const { reviewers } = splitRouting(rows);
    const signoffs = Object.fromEntries(decisions.filter((d) => d.action !== 'RETURNED').map((d) => [d.assignment_id, d]));
    const returns = decisions.filter((d) => d.action === 'RETURNED');
    return {
        reviewers,
        signoffs,
        returns,
        current: reviewers.find((r) => !signoffs[r.id]) ?? null,
        openReturn: returns.find((d) => !d.response) ?? null,
        // Round of a decision = 1 + the returns before it
        roundOf: (d) => 1 + returns.filter((x) => x.id !== d.id && new Date(x.decided_at) < new Date(d.decided_at)).length,
    };
};

// Who made a decision (the assignment's user; inactive rows included)
export const deciderOf = (decision, rows) => rows.find((r) => r.id === decision.assignment_id) ?? null;

// Income documents shown next to the income computation (claim vs. evidence)
export const INCOME_DOCUMENT_TYPES = ['COE_ITR', 'PAYSLIPS_REMITTANCES', 'FS_BANK_STATEMENTS', 'SEC_DTI_MAYORS_PERMIT'];

// Thresholds = the worst band of the KYC-FP Credit_Score tab (DBR > 40%, LCR > 80%), not the bank's MRAC
const DBR_LIMIT = 0.4;
const LCR_LIMIT = 0.8;
const peso = (v) => `₱${formatMoney(v)}`;

// [{ item: checklist code | null, level: 'warn' | 'info', text }]
export const reviewFlags = ({ app, fp, computed, score, rules, ciDone, changes, changesSince }) => {
    const flags = [];
    const add = (item, text, level = 'warn') => flags.push({ item, text, level });
    const pkg = fp.pkg ?? {};
    const noExceptions = fp.exceptions.length === 0;

    // Income: claim vs. evidence
    computed.missingBasis.forEach((p) =>
        add('INCOME', `No income basis picked for ${partyLabel(p)}: gross income and DBR are incomplete.`));
    computed.incomes.forEach(({ party, declared, basis, other }) => {
        if (declared > 0 && basis?.value === 'DECLARED') {
            add('INCOME', `${partyLabel(party)}'s income is counted as declared (100%), not COE 80% / payslip 90%.`);
        }
        if (other > 0) {
            add('INCOME', `${partyLabel(party)}: other income of ${peso(other)} is counted. Check a document supports it (e.g. a bonus on the payslip).`, 'info');
        }
    });

    // Documents still missing from the checklist
    getParties(app, BORROWER_ROLES).forEach((p) => (p.application_requirements ?? []).forEach((r) => {
        const count = r.documents?.length ?? 0;
        const min = minFilesFor(r.requirement_type);
        if (count < min) {
            add('DOCUMENTS', `${partyLabel(p)}: ${REQUIREMENT_LABELS[r.requirement_type] ?? r.requirement_type} has `
                + `${count === 0 ? 'no file' : `${count} of ${min} files`}.`);
        }
    }));

    if (app.interest_rate === null || app.interest_rate === undefined) {
        add('LOAN_TERMS', 'No interest rate set: the amortization and DBR can\'t be computed.');
    }

    if (computed.appraised === null) add('COLLATERAL', 'No appraised value yet: LCR uses the TCP (selling price).', 'info');
    if (computed.lcr !== null && computed.lcr > LCR_LIMIT) {
        add(noExceptions ? 'EXCEPTIONS' : 'COLLATERAL', `LCR ${percent(computed.lcr)} is above 80% (the credit score's worst band)`
            + (noExceptions ? ' and V. Exception/s is empty. Check whether it needs an exception.' : '. Check V. Exception/s covers it.'),
        noExceptions ? 'warn' : 'info');
    }
    if (computed.dbr !== null && computed.dbr > DBR_LIMIT) {
        add(noExceptions ? 'EXCEPTIONS' : 'INCOME', `DBR ${percent(computed.dbr)} is above 40% (the credit score's worst band)`
            + (noExceptions ? ' and V. Exception/s is empty. Check whether it needs an exception.' : '. Check V. Exception/s covers it.'),
        noExceptions ? 'warn' : 'info');
    }

    if (!ciDone) add('CREDIT_CHECKS', 'Credit Investigation isn\'t marked Done: CI results may be missing or still change.');

    if (!score.complete) add('CREDIT_SCORE', `Credit score not finished: ${score.scored} of ${score.count} criteria scored.`);
    const overridden = fp.creditScore.filter((e) => e.band && e.suggested_band && e.band !== e.suggested_band)
        .map((e) => rules.criteria.find((c) => c.code === e.criterion)?.label ?? e.criterion);
    if (overridden.length) {
        add('CREDIT_SCORE', `The CO picked a different band than suggested for: ${overridden.join('; ')}.`, 'info');
    }

    if (pkg.credit_result === 'ENDORSED' && score.complete && score.recommendation === 'Disapprove') {
        add('RECOMMENDATION', `Endorsed, but the credit score (${score.total} / 100) recommends Disapprove.`);
    }
    if (pkg.credit_result === 'NOT_ENDORSED' && score.complete && score.recommendation === 'For Approval') {
        add('RECOMMENDATION', `Not endorsed, but the credit score (${score.total} / 100) recommends For Approval.`, 'info');
    }

    if (changes.length && changesSince) {
        add(null, `${changes.length} change${changes.length === 1 ? '' : 's'} to the FP, credit score or loan details since `
            + `${changesSince.label} (${new Date(changesSince.at).toLocaleString()}). See "Changes since" below.`, 'info');
    }
    return flags;
};

// The checklist item a policy criterion that needs review belongs to, by the fact it is missing or reads
// (mrac-service/rules/housing_raac_draft.json). A criterion that fails always goes to V. Exception/s: every policy
// deviation should be listed there with its mitigant.
const POLICY_ITEM = {
    total_gross_income: 'INCOME', net_income_after_tax: 'INCOME', dbr: 'INCOME', dbr_standalone: 'INCOME',
    employment_type: 'INCOME', tenure_years: 'INCOME', business_years: 'INCOME',
    age: 'DOCUMENTS', age_at_maturity: 'DOCUMENTS', borrower_count: 'DOCUMENTS',
    loan_amount: 'LOAN_TERMS', has_replevin_or_foreclosure: 'CREDIT_CHECKS', scorecard_total: 'CREDIT_SCORE',
};

// The latest policy check as flags, same shape as reviewFlags(). mracChanges: the facts that changed since it ran
export const policyFlags = (mrac, mracChanges = []) => {
    if (!mrac) return [{ item: 'EXCEPTIONS', level: 'warn', text: 'No policy check (MRAC) has been run on this application.' }];
    if (mrac.status === 'FAILED') return [{ item: 'EXCEPTIONS', level: 'warn', text: 'The last policy check (MRAC) failed to run.' }];
    if (mrac.status !== 'DONE') return [{ item: 'EXCEPTIONS', level: 'info', text: 'A policy check (MRAC) is still running.' }];
    const flags = [];
    if (mracChanges.length > 0) {
        flags.push({ item: 'EXCEPTIONS', level: 'warn', text: `The policy check (MRAC) is out of date: ${mracChanges.join(', ')} changed after it ran.` });
    }
    (mrac.result?.criteria ?? []).forEach((c) => {
        const figs = `${showFact(c.field, c.value)} vs. required ${showRequirement(c.field, c.threshold)}`;
        if (c.status === 'fail') {
            flags.push({ item: 'EXCEPTIONS', level: 'warn', text: `Policy check (MRAC): ${c.label} fails (${figs}). Check V. Exception/s lists it with a mitigant.` });
        } else if (c.status === 'needs_review') {
            flags.push({ item: POLICY_ITEM[c.field] ?? 'EXCEPTIONS', level: 'warn', text: `Policy check (MRAC): ${c.label} needs review${c.reason ? ` (${c.reason})` : ''}.` });
        }
    });
    return flags;
};

// Audit tables that count as "the CO's work" for "Changes since ..."
export const REVIEWED_TABLES = ['financial_packages', 'fp_party_details', 'fp_exceptions', 'fp_deposit_checks',
    'fp_loan_checks', 'fp_trade_checks', 'fp_title_verifications', 'credit_score_entries', 'collateral_details',
    'employment_info', 'existing_loans', 'documents'];

// loan_applications rows only count when the loan terms changed (not status moves)
const LOAN_KEYS = ['loan_amount', 'loan_term_years', 'interest_rate', 'fixing_period'];
export const isReviewedChange = (e) => REVIEWED_TABLES.includes(e.table_name)
    || (e.table_name === 'loan_applications' && LOAN_KEYS.some((k) => k in (e.new_data ?? {})));

// Employment type of a borrower (KYC)
export const jobOf = (party) => one(party.employment_info);

// Where to check each checklist item. here: [section id on the review summary, label] (scrolls there; a "Back to your
// review" button brings the reviewer back to the item). there: the page the Credit Officer worked on, opened in a new
// tab so the review stays put; hash = the section id the page scrolls to (the FP shows the right tab itself).
// dss: the section of the Decision Support page with the analysis for the item (also opened in a new tab).
export const CHECK_SOURCES = {
    DOCUMENTS: {
        here: ['rv-income', 'Income evidence'], there: { path: '/loanFolderPage', label: 'Loan folder' },
        dss: { path: '/decisionSupportPage', hash: 'ds-readiness', label: 'DSS readiness' },
    },
    INCOME: {
        here: ['rv-income', 'Income evidence'], there: { path: '/financialPackagePage', hash: 'fp-ix', label: 'FP IX. Cash flow' },
        dss: { path: '/decisionSupportPage', hash: 'ds-highlights', label: 'DSS exception highlights' },
    },
    LOAN_TERMS: { here: ['rv-figures', 'Key figures'], there: { path: '/financialPackagePage', hash: 'fp-ii', label: 'FP II. Facility' } },
    COLLATERAL: { here: ['rv-figures', 'Key figures'], there: { path: '/financialPackagePage', hash: 'fp-iii', label: 'FP III. Collateral' } },
    CREDIT_CHECKS: { here: ['rv-ci', 'IV. Credit checking'], there: { path: '/financialPackagePage', hash: 'fp-iv', label: 'FP IV. Credit checking' } },
    EXCEPTIONS: {
        here: ['rv-exceptions', 'V. Exceptions'], there: { path: '/financialPackagePage', hash: 'fp-v', label: 'FP V. Exceptions' },
        dss: { path: '/decisionSupportPage', hash: 'ds-highlights', label: 'DSS exception highlights' },
    },
    CREDIT_SCORE: { here: ['rv-score', 'Credit score'], there: { path: '/creditScorePage', label: 'Credit scoring' } },
    TERMS: { here: null, there: { path: '/financialPackagePage', hash: 'fp-vi', label: 'FP VI. Terms and conditions' } },
    RECOMMENDATION: {
        here: ['rv-recommendation', "CO's recommendation"], there: { path: '/financialPackagePage', hash: 'fp-result', label: 'FP Credit result' },
        dss: { path: '/decisionSupportPage', hash: 'ds-policy', label: 'DSS policy check' },
    },
};
export const sourceHref = ({ path, hash }, appId) => `${path}?id=${appId}${hash ? `#${hash}` : ''}`;
