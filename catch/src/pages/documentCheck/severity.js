// How serious each finding on the AI check is, so real problems stand out (group notes, 2026-11-22):
//   bad      a problem: a key fact differs (name, birth date, sex, TIN, SSS, income), an expired ID, a wrong format,
//            or the AI isn't sure it is the right kind of document. Same red as the "Major" note tag.
//   check    worth a look: any other difference (address, employer, position), text that was hard to read.
//            Same amber as the "Minor" tag.
//   neutral  nothing wrong: not in the application, not found on the document, corrected by the officer
//   good     matches the application
// Display only: nothing here changes what is saved or confirmed.
import { readIssues } from './issues.js';

// Fields where a difference from the application is a problem, not just something to look at
export const KEY_FIELDS = new Set([
    'last_name', 'first_name', 'middle_name', 'employee_name', 'date_of_birth', 'sex',
    'employee_tin', 'employer_tin', 'sss_no', 'monthly_gross_income',
]);
const isKey = (def) => KEY_FIELDS.has(def.field_key) || def.compare_with === 'FULL_NAME';

// The AI's guess of the document kind that means "this may be the wrong file"
export const UNEXPECTED_KINDS = new Set(['NOT_AN_ID', 'OTHER']);

const RANK = { bad: 3, check: 2, good: 1, neutral: 0 };
export const worst = (tones) => tones.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'neutral');

// Tone of a "Differs from application" chip
export const differsTone = (def) => (isKey(def) ? 'bad' : 'check');

// One field: status = compareStatus(); expired / invalid / lowConfidence as the panel works them out
export const fieldTone = ({ def, status, expired = false, invalid = false, lowConfidence = false }) => {
    if (invalid || expired || (status === 'DIFFERS' && isKey(def))) return 'bad';
    if (status === 'DIFFERS' || lowConfidence) return 'check';
    if (status === 'MATCH') return 'good';
    return 'neutral';
};

// One document in the file list (check = fetchDocumentChecks()[id]): a problem the AI flagged on its own, before the
// officer has confirmed it. Differences from the application are shown on the fields themselves.
// isExpired: compare.js isExpired (passed in, so this file stays importable by the node tests)
export const docHasProblem = (check, isExpired) => {
    const run = check?.run;
    if (!run || run.status !== 'DONE' || run.confirmed_at) return false;
    if (UNEXPECTED_KINDS.has(run.output?.document_kind)) return true;
    if (readIssues(run.output).some((i) => i.severity === 'MAJOR')) return true;
    const expiry = (check.fields ?? []).find((f) => f.field_key === 'expiry_date');
    return Boolean(expiry && isExpired(expiry.extracted_value));
};
