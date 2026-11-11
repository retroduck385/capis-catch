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

// ---------- Applicant ----------
// Same rules as the application form's uploads (the bucket enforces them too)
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const fileProblem = (file) => {
    if (!ACCEPTED_TYPES.includes(file.type)) return `${file.name}: use a JPG, PNG or PDF file.`;
    if (file.size > MAX_FILE_BYTES) return `${file.name} is larger than 10 MB.`;
    return null;
};

// My requests that are not closed yet (one per application at most)
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
