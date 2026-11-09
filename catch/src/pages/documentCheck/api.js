// Supabase calls for the document check page (AI extraction + confirmation): application documents
// (AO, 20261109_ai_extraction.sql) and CI reports, NFIS / TU (Credit Investigator, 20261109_ci_extraction.sql).
// Functions throw on error; callers handle it in try/catch/finally.
import { supabase } from '../../supabaseClient';

const check = ({ data, error }) => {
    if (error) throw error;
    return data;
};

// Every field the AI extracts, per document type, in display order
export const fetchFieldDefs = async () =>
    check(await supabase.from('extraction_field_defs').select('*').order('sort_order')) ?? [];

// Per document id: { ocr, run, fields, pages }. ci = true: the ids are ci_documents ids (CI reports).
//   ocr    = latest OCR run of the document
//   run    = latest AI extraction run (the confirmed one, once locked: no later run can be made)
//   fields = the run's fields, each with the OCR lines it was read from (`lines`)
//   pages  = { [page_no]: { width, height, angle } } of the OCR run the extraction read
export const fetchDocumentChecks = async (documentIds, { ci = false } = {}) => {
    if (documentIds.length === 0) return {};
    const source = ci ? 'ci_document_id' : 'document_id';
    const ocrRuns = check(await supabase.from('ocr_runs')
        .select(`id, ${source}, status, error, created_at`)
        .in(source, documentIds).order('id')) ?? [];
    const ocrIds = ocrRuns.map((r) => r.id);
    const runs = ocrIds.length === 0 ? [] : check(await supabase.from('extraction_runs')
        .select('id, ocr_run_id, status, model, output, error, requested_by, created_at, finished_at, confirmed_by, confirmed_at')
        .in('ocr_run_id', ocrIds).order('id')) ?? [];

    const result = Object.fromEntries(documentIds.map((id) => [id, { ocr: null, run: null, fields: [], pages: {} }]));
    const docOfOcr = {};
    for (const r of ocrRuns) {
        result[r[source]].ocr = r;
        docOfOcr[r.id] = r[source];
    }
    for (const run of runs) result[docOfOcr[run.ocr_run_id]].run = run;

    const done = Object.values(result).map((c) => c.run).filter((run) => run?.status === 'DONE');
    if (done.length === 0) return result;

    const [fields, pages] = await Promise.all([
        supabase.from('extraction_fields')
            .select('*, extraction_field_lines ( ocr_lines ( id, page_no, text, confidence, bbox ) )')
            .in('run_id', done.map((run) => run.id)).order('item_no').order('id').then(check),
        supabase.from('ocr_pages').select('*').in('run_id', done.map((run) => run.ocr_run_id)).then(check),
    ]);
    const docOfRun = Object.fromEntries(done.map((run) => [run.id, docOfOcr[run.ocr_run_id]]));
    for (const { extraction_field_lines: links, ...f } of fields ?? []) {
        const lines = (links ?? []).map((l) => l.ocr_lines).filter(Boolean)
            .sort((a, b) => a.page_no - b.page_no || a.id - b.id);
        result[docOfRun[f.run_id]].fields.push({ ...f, lines });
    }
    for (const p of pages ?? []) {
        result[docOfOcr[p.run_id]].pages[p.page_no] = p;
    }
    return result;
};

// AO: run the AI again on the document's latest OCR (refused once confirmed)
export const requestExtraction = async (documentId) =>
    check(await supabase.rpc('request_extraction', { p_document_id: documentId }));

// AO: confirm & lock. fields = [{ id, final_value, apply_to_record }] for every field of the run
export const confirmExtraction = async (runId, fields) =>
    check(await supabase.rpc('confirm_extraction', { p_run_id: runId, p_fields: fields }));

// Credit Investigator: run the AI again on a CI report's latest OCR (refused once confirmed)
export const requestCiExtraction = async (ciDocumentId) =>
    check(await supabase.rpc('request_ci_extraction', { p_ci_document_id: ciDocumentId }));

// Credit Investigator: confirm & lock a CI report and save the result + summary to the CI results.
// fields = [{ id, final_value }] for every field of the run; result = NO_ADVERSE_FINDINGS | WITH_FINDINGS
export const confirmCiExtraction = async (runId, fields, result, summary) =>
    check(await supabase.rpc('confirm_ci_extraction', {
        p_run_id: runId, p_fields: fields, p_result: result, p_summary: summary,
    }));
