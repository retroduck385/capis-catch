// Supabase calls for "What we need" document requests (see 20261112_document_requests.sql).
// Functions throw on error; callers handle it in try/catch/finally.
import { supabase } from '../../supabaseClient';

const BUCKET = 'application-documents';

const check = ({ data, error }) => {
    if (error) throw error;
    return data;
};

// ---------- Account Officer ----------
// Current request (items, uploads, delivery status), earlier ones, whether I can open one, suggestions, checklist
export const fetchRequestContext = async (applicationId) =>
    check(await supabase.rpc('document_request_context', { p_application_id: applicationId }));

// items: [{ applicant_id, requirement_type } | { applicant_id, requirement_type: null, label }]
export const previewRequest = async (applicationId, message, items) =>
    check(await supabase.rpc('preview_document_request',
        { p_application_id: applicationId, p_message: message, p_items: items }));

export const openRequest = async (applicationId, message, items) =>
    check(await supabase.rpc('open_document_request',
        { p_application_id: applicationId, p_message: message, p_items: items }));

// SENT -> RECEIVED ("We received your documents"), OPEN -> WITHDRAWN
export const closeRequest = async (requestId, note) =>
    check(await supabase.rpc('close_document_request', { p_request_id: requestId, p_note: note || null }));

// A short-lived link to view an uploaded file
export const fileUrl = async (path) =>
    check(await supabase.storage.from(BUCKET).createSignedUrl(path, 60)).signedUrl;

// Am I the assigned AO, and may I open a request on this file right now? (shows or hides "Ask the applicant")
export const fetchCanOpen = async (applicationId) =>
    check(await supabase.rpc('document_request_can_open', { p_application_id: applicationId })) ?? false;

// A request the applicant still owes or has just sent, if any (staff read; null = none in progress)
export const fetchOpenRequest = async (applicationId) =>
    (check(await supabase.from('document_requests').select('id, status, opened_at, sent_at')
        .eq('application_id', applicationId).neq('status', 'CLOSED')) ?? [])[0] ?? null;

// Reminders sent for the file's requests and the next one due (20261119_document_request_reminders.sql)
export const fetchReminderStatus = async (applicationId) =>
    check(await supabase.rpc('document_reminder_status', { p_application_id: applicationId }));

// Read state of uploaded files (useReadStates.js): latest OCR run of each document, and its AI run if it has one.
// Staff read ocr_runs / extraction_runs by RLS.
export const fetchReadStates = async (documentIds) => {
    if (documentIds.length === 0) return {};
    const ocr = check(await supabase.from('ocr_runs').select('id, document_id, status')
        .in('document_id', documentIds).order('id')) ?? [];
    const latest = {};
    for (const r of ocr) latest[r.document_id] = r;   // ordered by id: the last one wins
    const done = Object.values(latest).filter((r) => r.status === 'DONE').map((r) => r.id);
    const ai = done.length === 0 ? [] : check(await supabase.from('extraction_runs').select('ocr_run_id, status')
        .in('ocr_run_id', done).order('id')) ?? [];
    const aiOf = {};
    for (const a of ai) aiOf[a.ocr_run_id] = a.status;
    return Object.fromEntries(Object.values(latest).map((r) => [r.document_id,
        r.status === 'FAILED' || aiOf[r.id] === 'FAILED' ? 'UNREADABLE'
            : r.status === 'DONE' ? 'READ' : 'READING']));
};

// ---------- Staff marks on uploaded files (20261116_findings_and_file_marks.sql) ----------
// Every mark on the application's files, oldest first: the last one per document is its current mark
export const fetchFileMarks = async (applicationId) =>
    check(await supabase.from('document_file_marks')
        .select('id, document_id, mark, comment, marked_by, marked_role, marked_at')
        .eq('application_id', applicationId).order('id')) ?? [];

// The assigned Account Officer or the assigned Credit Officer
export const fetchCanMark = async (applicationId) =>
    check(await supabase.rpc('document_file_can_mark', { p_application_id: applicationId })) ?? false;

// mark: 'CLEARED' | 'NEEDS_NEW_COPY' (a comment is required for the second)
export const markFile = async (documentId, mark, comment) =>
    check(await supabase.rpc('mark_document_file',
        { p_document_id: documentId, p_mark: mark, p_comment: comment?.trim() || null }));

// ---------- Applicant ----------
// Same rules as the application form's uploads (the bucket enforces them too)
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const fileProblem = (file) => {
    if (!ACCEPTED_TYPES.includes(file.type)) return `${file.name}: use a JPG, PNG or PDF file.`;
    if (file.size > MAX_FILE_BYTES) return `${file.name} is larger than 10 MB.`;
    return null;
};

// My requests that are not closed yet (several per application can be open)
export const fetchMyRequests = async () => check(await supabase.rpc('my_document_requests'));

// Uploads into {user_id}/{application_id}/requests/{request_id}/ and adds it to the item.
// The add_requested_document() function renames it like the form's uploads (name_document).
export const uploadRequested = async (request, item, file) => {
    const problem = fileProblem(file);
    if (problem) throw new Error(problem);
    const ext = file.name.match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase();
    const path = `${request.user_id}/${request.application_id}/requests/${request.id}/${item.id}-${Date.now()}${ext ? `.${ext}` : ''}`;
    check(await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type }));
    try {
        check(await supabase.rpc('add_requested_document', { p_item_id: item.id, p_file_name: file.name, p_file_path: path }));
    } catch (err) {
        await supabase.storage.from(BUCKET).remove([path]); // don't leave an orphaned file
        throw err;
    }
};

// Removes the documents row, then the file (allowed only while the request is open)
export const removeRequested = async (documentId) => {
    const path = check(await supabase.rpc('remove_requested_document', { p_document_id: documentId }));
    if (path) check(await supabase.storage.from(BUCKET).remove([path]));
};

export const sendRequested = async (requestId) =>
    check(await supabase.rpc('send_requested_documents', { p_request_id: requestId }));
