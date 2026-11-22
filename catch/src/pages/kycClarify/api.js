// Supabase calls for KYC clarification threads (20261203_kyc_clarifications.sql). Functions throw on error;
// callers handle it in try/catch/finally.
import { supabase } from '../../supabaseClient';
import { fileProblem } from './sections';

const BUCKET = 'application-documents';

const check = ({ data, error }) => {
    if (error) throw error;
    return data;
};

// ---------- Account Officer ----------
// "Needs clarification": records the KYC check, opens the thread and sends the question (in-app, SMS, email)
export const askClarification = async (applicationId, section, question) =>
    check(await supabase.rpc('ask_kyc_clarification',
        { p_application_id: applicationId, p_section: section, p_question: question }));

// An answer in an open thread (in-app only)
export const answerClarification = async (threadId, body) =>
    check(await supabase.rpc('answer_kyc_clarification', { p_clarification_id: threadId, p_body: body }));

// Withdraw an open question (Intake or Credit Investigation): the thread closes, the applicant gets the neutral line
export const withdrawClarification = async (threadId) =>
    check(await supabase.rpc('withdraw_kyc_clarification', { p_clarification_id: threadId }));

// Every thread of the file, open and closed (closed ones are read-only history), oldest first
export const fetchThreads = async (applicationId) =>
    check(await supabase.rpc('kyc_clarification_threads', { p_application_id: applicationId })) ?? [];

// ---------- Applicant ----------
// My open threads (a closed one is no longer listed)
export const fetchMyClarifications = async () => check(await supabase.rpc('my_kyc_clarifications')) ?? [];

// A reply: the file (optional) goes to {user_id}/{application_id}/clarifications/{thread_id}/ first; if the reply is
// refused, the file is removed again so nothing is left over
export const replyClarification = async (thread, body, file = null) => {
    let path = null;
    if (file) {
        const problem = fileProblem(file);
        if (problem) throw new Error(problem);
        const ext = file.name.match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase();
        path = `${thread.user_id}/${thread.application_id}/clarifications/${thread.id}/${Date.now()}${ext ? `.${ext}` : ''}`;
        check(await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type }));
    }
    try {
        return check(await supabase.rpc('reply_kyc_clarification', {
            p_clarification_id: thread.id, p_body: body, p_file_name: file?.name ?? null, p_file_path: path,
        }));
    } catch (err) {
        if (path) await supabase.storage.from(BUCKET).remove([path]);
        throw err;
    }
};

// ---------- Both ----------
// A short-lived link to view an attached file
export const clarificationFileUrl = async (path) =>
    check(await supabase.storage.from(BUCKET).createSignedUrl(path, 60)).signedUrl;
