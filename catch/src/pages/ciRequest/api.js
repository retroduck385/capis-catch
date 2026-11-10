// Supabase calls for CI requests and CI results (see 20261020_ci_request.sql, 20261108_ci_results.sql).
// Functions throw on error; callers handle it in try/catch/finally.
import { supabase } from '../../supabaseClient';

const BUCKET = 'application-documents';

const check = ({ data, error }) => {
    if (error) throw error;
    return data;
};

// Assigned AO, while in Intake: Intake -> Credit Investigation (Requested). Returns the request id.
export const requestCi = async (applicationId, nfisRemarks, tuRemarks) =>
    check(await supabase.rpc('request_ci', {
        p_application_id: applicationId, p_nfis_remarks: nfisRemarks, p_tu_remarks: tuRemarks,
    }));

// Requests for one application, oldest first; the last one is current
export const fetchCiRequests = async (applicationId) =>
    check(await supabase.from('ci_requests').select('*')
        .eq('application_id', applicationId).order('requested_at').order('id')) ?? [];

// ID type / number / expiry of each Valid ID document, from its AO-confirmed (locked) AI extraction only
// (20261109_ai_extraction.sql). Returns { [documentId]: { id_type, id_number, expiry_date } }; documents
// without a confirmed extraction are left out.
export const fetchConfirmedIdDetails = async (documentIds) => {
    if (documentIds.length === 0) return {};
    const ocrRuns = check(await supabase.from('ocr_runs').select('id, document_id').in('document_id', documentIds)) ?? [];
    if (ocrRuns.length === 0) return {};
    const runs = check(await supabase.from('extraction_runs')
        .select('ocr_run_id, extraction_fields ( field_key, final_value )')
        .in('ocr_run_id', ocrRuns.map((r) => r.id))
        .not('confirmed_at', 'is', null)) ?? [];
    const docOfOcr = Object.fromEntries(ocrRuns.map((r) => [r.id, r.document_id]));
    return Object.fromEntries(runs.map((run) => [
        docOfOcr[run.ocr_run_id],
        Object.fromEntries((run.extraction_fields ?? []).map((f) => [f.field_key, f.final_value])),
    ]));
};

// ---------- CI results ----------

// True for any active Credit Investigator while the application is in Credit Investigation
export const fetchCiCanEdit = async (applicationId) =>
    check(await supabase.rpc('ci_can_edit', { p_application_id: applicationId })) ?? false;

// Results and files of the given borrowers (ids from the application record)
export const fetchCiResults = async (borrowerIds) => {
    if (!borrowerIds.length) return { checks: [], documents: [] };
    const [checks, documents] = await Promise.all([
        supabase.from('ci_checks').select('*').in('applicant_id', borrowerIds),
        supabase.from('ci_documents').select('*').in('applicant_id', borrowerIds).order('uploaded_at').order('id'),
    ]);
    return { checks: check(checks) ?? [], documents: check(documents) ?? [] };
};

// rows: [{ applicant_id, check_type, result, summary }]; unchanged rows aren't touched by the DB
export const saveCiFindings = async (applicationId, rows, remarks) =>
    check(await supabase.rpc('save_ci_findings', {
        p_application_id: applicationId, p_checks: rows, p_remarks: remarks,
    }));

// Stored at ci/{application}/{borrower}/{check}/..., outside the applicant's folder, so the applicant can't open it
export const uploadCiDocument = async ({ applicationId, applicantId, checkType, file }) => {
    const ext = file.name.match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase();
    const path = `ci/${applicationId}/${applicantId}/${checkType}/${Date.now()}${ext ? `.${ext}` : ''}`;
    check(await supabase.storage.from(BUCKET).upload(path, file));
    try {
        return check(await supabase.rpc('add_ci_document', {
            p_applicant_id: applicantId, p_check_type: checkType, p_file_name: file.name, p_file_path: path,
        }));
    } catch (err) {
        await supabase.storage.from(BUCKET).remove([path]); // don't leave an orphaned file
        throw err;
    }
};

export const removeCiDocument = async (doc) => {
    const path = check(await supabase.rpc('remove_ci_document', { p_id: doc.id }));
    check(await supabase.storage.from(BUCKET).remove([path]));
};

export const getCiDocumentUrl = async (doc) =>
    check(await supabase.storage.from(BUCKET).createSignedUrl(doc.file_path, 60)).signedUrl;

// What's still needed before Mark CI Done (empty list = ready)
export const fetchCiMissing = async (applicationId) =>
    check(await supabase.rpc('ci_missing', { p_application_id: applicationId })) ?? [];

// Credit Investigation -> Done, Credit Evaluation opened, CO notified. Returns what's missing instead (nothing moved).
export const completeCi = async (applicationId) =>
    check(await supabase.rpc('complete_ci', { p_application_id: applicationId })) ?? [];

// The Done row of the latest Credit Investigation visit ({ changed_at, changed_by }), or null while it's open
export const fetchCiDone = async (applicationId) => {
    const visits = check(await supabase.from('application_stages')
        .select('id, stage_status_changes(status, changed_at, changed_by)')
        .eq('application_id', applicationId).eq('stage', 'CREDIT_INVESTIGATION')
        .order('entered_at', { ascending: false }).limit(1)) ?? [];
    return visits[0]?.stage_status_changes?.find((s) => s.status === 'DONE') ?? null;
};
