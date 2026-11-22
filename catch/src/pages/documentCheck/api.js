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
//   ocr    = latest OCR run of the document (created_at / started_at / finished_at: duration.js works out how long it took)
//   run    = latest AI extraction run of that OCR run (the confirmed one, once locked: no later run can be made)
//   fields = the run's fields, each with the OCR lines it was read from (`lines`)
//   pages  = { [page_no]: { width, height, angle } } of the OCR run the extraction read
export const fetchDocumentChecks = async (documentIds, { ci = false } = {}) => {
    if (documentIds.length === 0) return {};
    const source = ci ? 'ci_document_id' : 'document_id';
    const ocrRuns = check(await supabase.from('ocr_runs')
        .select(`id, ${source}, status, error, created_at, started_at, finished_at`)
        .in(source, documentIds).order('id')) ?? [];
    const ocrIds = ocrRuns.map((r) => r.id);
    const runs = ocrIds.length === 0 ? [] : check(await supabase.from('extraction_runs')
        .select('id, ocr_run_id, status, model, output, error, requested_by, created_at, started_at, finished_at, confirmed_by, confirmed_at')
        .in('ocr_run_id', ocrIds).order('id')) ?? [];

    const result = Object.fromEntries(documentIds.map((id) => [id, { ocr: null, run: null, fields: [], pages: {} }]));
    const docOfOcr = {};
    for (const r of ocrRuns) {
        result[r[source]].ocr = r;
        docOfOcr[r.id] = r[source];
    }
    // The confirmed run once there is one; otherwise the latest run of the latest OCR run (a failed run of an older
    // OCR run doesn't count after the file was read again)
    for (const run of runs) {
        const c = result[docOfOcr[run.ocr_run_id]];
        if (c.run?.confirmed_at) continue;
        if (run.confirmed_at || run.ocr_run_id === c.ocr?.id) c.run = run;
    }

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

// Which of these documents have a confirmed AI extraction (a Set of their ids). ci = true: ci_documents ids.
// Reads run status only, not the extracted fields, so it is cheap enough for page headers and step lists.
export const fetchConfirmedIds = async (documentIds, { ci = false } = {}) => {
    if (documentIds.length === 0) return new Set();
    const source = ci ? 'ci_document_id' : 'document_id';
    const ocrRuns = check(await supabase.from('ocr_runs').select(`id, ${source}`).in(source, documentIds)) ?? [];
    if (ocrRuns.length === 0) return new Set();
    const docOfOcr = Object.fromEntries(ocrRuns.map((r) => [r.id, r[source]]));
    const confirmed = check(await supabase.from('extraction_runs')
        .select('ocr_run_id').in('ocr_run_id', ocrRuns.map((r) => r.id)).not('confirmed_at', 'is', null)) ?? [];
    return new Set(confirmed.map((r) => docOfOcr[r.ocr_run_id]));
};

// Where each document is in OCR -> AI -> confirmation, from its latest runs: { [id]: state }. ci = true: ci_documents ids.
//   NONE (never read: CI reports are read only on "Run AI"), READING (OCR or AI queued / running),
//   READY (to check), CONFIRMED (locked), FAILED (the last OCR or AI step failed: can be read again)
export const fetchReadStates = async (documentIds, { ci = false } = {}) => {
    const states = Object.fromEntries(documentIds.map((id) => [id, 'NONE']));
    if (documentIds.length === 0) return states;
    const source = ci ? 'ci_document_id' : 'document_id';
    const ocrRuns = check(await supabase.from('ocr_runs').select(`id, ${source}, status`)
        .in(source, documentIds).order('id')) ?? [];
    if (ocrRuns.length === 0) return states;
    const runs = check(await supabase.from('extraction_runs').select('ocr_run_id, status, confirmed_at')
        .in('ocr_run_id', ocrRuns.map((r) => r.id)).order('id')) ?? [];
    const docOfOcr = Object.fromEntries(ocrRuns.map((r) => [r.id, r[source]]));
    const latestOcr = {};
    for (const r of ocrRuns) latestOcr[r[source]] = r;            // ordered by id: the last one wins
    const latestRun = {};
    const confirmed = new Set();
    for (const run of runs) {
        if (run.confirmed_at) confirmed.add(docOfOcr[run.ocr_run_id]);
        if (latestOcr[docOfOcr[run.ocr_run_id]]?.id === run.ocr_run_id) latestRun[docOfOcr[run.ocr_run_id]] = run;
    }
    for (const id of documentIds) {
        const ocr = latestOcr[id];
        const run = latestRun[id];
        if (confirmed.has(id)) states[id] = 'CONFIRMED';
        else if (!ocr) states[id] = 'NONE';
        else if (ocr.status === 'FAILED' || run?.status === 'FAILED') states[id] = 'FAILED';
        else if (ocr.status !== 'DONE' || !run || run.status !== 'DONE') states[id] = 'READING';
        else states[id] = 'READY';
    }
    return states;
};

// Loan folder step 1: of the application's documents the AI reads (a type in extraction_field_defs), how many the
// AO has confirmed. documents = every application document; returns { total, confirmed }.
export const fetchDocumentProgress = async (documents) => {
    const defs = check(await supabase.from('extraction_field_defs').select('document_type')) ?? [];
    const types = new Set(defs.map((d) => d.document_type));
    const ids = documents.filter((d) => types.has(d.document_type)).map((d) => d.id);
    return { total: ids.length, confirmed: (await fetchConfirmedIds(ids)).size };
};

// Application documents are read automatically: OCR is queued when a file is uploaded (queue_ocr_run) and the AI
// extraction when OCR finishes (queue_extraction_run). CI reports (NFIS / TU) are read only when the Credit
// Investigator presses "Run AI" (requestCiRead, 20261125_ci_ocr_opt_in.sql). The worker retries a failed step
// once by itself; a second failure is final, and staff ask the applicant for a clearer copy (AO), or the CI reads
// the report again or uploads a clearer copy.
export const UNREADABLE_TEXT = "We couldn't read this file. Ask the applicant for a clearer copy.";

// AO: confirm & lock. fields = [{ id, final_value, apply_to_record }] for every field of the run
export const confirmExtraction = async (runId, fields) =>
    check(await supabase.rpc('confirm_extraction', { p_run_id: runId, p_fields: fields }));

// Testing: queue a fresh AI extraction on the same OCR run (the worker picks it up within seconds)
export const rerunExtraction = async (ocrRunId) =>
    check(await supabase.rpc('request_rerun_extraction', { p_ocr_run_id: ocrRunId }));

// Credit Investigator: "Run AI" on one NFIS / TU report (queues OCR; the AI extraction follows by itself).
// Also reads a report again after a failed OCR or AI step.
export const requestCiRead = async (ciDocumentId) =>
    check(await supabase.rpc('request_ci_ocr', { p_ci_document_id: ciDocumentId }));

// Credit Investigator: confirm & lock a CI report and save the result + summary to the CI results.
// fields = [{ id, final_value }] for every field of the run; result = NO_ADVERSE_FINDINGS | WITH_FINDINGS
export const confirmCiExtraction = async (runId, fields, result, summary) =>
    check(await supabase.rpc('confirm_ci_extraction', {
        p_run_id: runId, p_fields: fields, p_result: result, p_summary: summary,
    }));
