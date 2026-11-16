// Decision Support: everything the page shows, loaded in one call. The page only reads; nothing here writes.
// Sprint 5: this can become a single RPC (e.g. get_decision_transcript(application_id)) that returns the same shape,
// without changing the page or its sections.
import { supabase } from '../../supabaseClient';
import { fetchApplication, getParties } from '../applicationForm/api';
import { BORROWER_ROLES } from '../applicationForm/options';
import { fetchCiDone } from '../ciRequest/api';
import { fetchKycChecks, fetchStaffNames } from '../loanFolder/api';
import { fetchAssignee, fetchCreditScoreRules, fetchFinancialPackage } from '../financialPackage/api';
import { fetchLatestMracCheck } from '../mrac/api';
import {
    fetchApprovalDecisions, fetchCurrentStage, fetchReviewAssignments, fetchReviewCheckItems, fetchReviewDecisions,
    fetchReviewStaff,
} from '../review/api';

// A part that fails to load (e.g. no MRAC run yet, or the table isn't migrated) shouldn't take the whole page down
const optional = (promise, fallback) => promise.catch(() => fallback);

const check = ({ data, error }) => {
    if (error) throw error;
    return data;
};

// Document types the AI reads for an application (CI reports are checked by the Credit Investigator, not listed here)
const fetchExtractionTypes = async () => {
    const rows = check(await supabase.from('extraction_field_defs').select('document_type')) ?? [];
    return new Set(rows.map((r) => r.document_type).filter((t) => !t.startsWith('CI_')));
};

// Where each document is: { [documentId]: { ocr, run } } (latest OCR run and latest AI extraction run; run.confirmed_at
// is set once a person confirmed it). Light on purpose: no extracted fields.
const fetchDocumentStates = async (documentIds) => {
    if (documentIds.length === 0) return {};
    const ocrRuns = check(await supabase.from('ocr_runs').select('id, document_id, status')
        .in('document_id', documentIds).order('id')) ?? [];
    const runs = ocrRuns.length === 0 ? [] : check(await supabase.from('extraction_runs')
        .select('id, ocr_run_id, status, confirmed_by, confirmed_at')
        .in('ocr_run_id', ocrRuns.map((r) => r.id)).order('id')) ?? [];
    const states = Object.fromEntries(documentIds.map((id) => [id, { ocr: null, run: null }]));
    const docOfOcr = {};
    for (const r of ocrRuns) {
        states[r.document_id].ocr = r;
        docOfOcr[r.id] = r.document_id;
    }
    for (const run of runs) states[docOfOcr[run.ocr_run_id]].run = run;
    return states;
};

export const fetchDecisionSupport = async (applicationId) => {
    const app = await fetchApplication(applicationId);
    const ids = getParties(app, BORROWER_ROLES).map((p) => p.id);
    const [fp, rules, ciDone, mrac, stage, coId, aoId, rows, checkItems, reviews, approvals, staff, kycChecks, types] = await Promise.all([
        fetchFinancialPackage(app.id, ids),
        fetchCreditScoreRules(),
        optional(fetchCiDone(app.id), false),
        optional(fetchLatestMracCheck(app.id), null),
        optional(fetchCurrentStage(app.id), null),
        optional(fetchAssignee(app.id, 'CREDIT_OFFICER'), null),
        optional(fetchAssignee(app.id, 'ACCOUNT_OFFICER'), null),
        optional(fetchReviewAssignments(app.id), []),
        optional(fetchReviewCheckItems(), []),
        optional(fetchReviewDecisions(app.id), []),
        optional(fetchApprovalDecisions(app.id), []),
        optional(fetchReviewStaff(), []),
        optional(fetchKycChecks(app.id), []),
        optional(fetchExtractionTypes(), new Set()),
    ]);

    // The documents the AI reads, with where each one is in OCR -> AI -> confirmation
    const docs = getParties(app, BORROWER_ROLES).flatMap((p) => (p.application_requirements ?? [])
        .flatMap((r) => r.documents ?? [])
        .filter((d) => types.has(d.document_type))
        .map((d) => ({ id: d.id, type: d.document_type, file: d.file_name, partyId: p.id })));
    const docStates = await optional(fetchDocumentStates(docs.map((d) => d.id)), {});

    const positions = Object.fromEntries(staff.map((s) => [s.user_id, s.approval_position]));
    const names = await fetchStaffNames([coId, aoId, ...rows.flatMap((r) => [r.user_id, r.assigned_by]),
        ...reviews.map((d) => d.responded_by)]);
    return {
        app, fp, rules, ciDone, mrac, stage, coId, aoId, rows, checkItems, reviews, approvals, staff, positions, names,
        kycChecks, docs, docStates,
    };
};
