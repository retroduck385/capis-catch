// MRAC / policy-RAG: queue a run and read its result. The mrac-service worker does the work (see supabase/migrations/
// 20261105_mrac_rag.sql); the app only talks to two RPCs and reads mrac_runs, like the ID OCR runs.
import { supabase } from '../../supabaseClient';
import { getParties } from '../applicationForm/api';
import { BORROWER_ROLES } from '../applicationForm/options';
import { fetchCiFindingFlagCount, fetchCiResults } from '../ciRequest/api';
import { fetchFileMarks, fetchOpenRequest } from '../documentRequests/api';

const unwrap = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
};

const RUN_FIELDS = 'id, kind, status, facts, result, error, created_at, finished_at';

// Assigned CO only (the RPC checks co_can_edit). Returns the run id. The profile (profile.js) needs
// 20261122_mrac_profile.sql; on a database without it the check still runs on the facts alone.
export const requestMracCheck = async (applicationId, facts, profile = null) => {
    const { data, error } = await supabase.rpc('request_mrac_check',
        { p_application_id: applicationId, p_facts: facts, ...(profile ? { p_profile: profile } : {}) });
    if (error && profile && error.code === 'PGRST202') return requestMracCheck(applicationId, facts, null);
    if (error) throw new Error(error.message);
    return data;
};

// What the profile needs beyond the FP page's own data. Each part is optional: a missing table or a failed read
// leaves that part empty instead of blocking the check.
export const fetchProfileInputs = async (app) => {
    const ids = getParties(app, BORROWER_ROLES).map((p) => p.id);
    const soft = (promise, fallback) => promise.catch(() => fallback);
    const [ci, flags, fileMarks, openRequest] = await Promise.all([
        soft(fetchCiResults(ids), { checks: [], documents: [] }),
        soft(fetchCiFindingFlagCount(app.id), 0),
        soft(fetchFileMarks(app.id), []),
        soft(fetchOpenRequest(app.id), null),
    ]);
    return { ci, ciFlagged: flags > 0, fileMarks, openDocumentRequest: Boolean(openRequest) };
};

// Any staff member. Returns the run id.
export const askPolicy = async (question) =>
    unwrap(await supabase.rpc('ask_policy', { p_question: question }));

export const fetchMracRun = async (runId) =>
    unwrap(await supabase.from('mrac_runs').select(RUN_FIELDS).eq('id', runId).single());

// The most recent check for this application (null if none yet)
export const fetchLatestMracCheck = async (applicationId) =>
    unwrap(await supabase.from('mrac_runs').select(RUN_FIELDS).eq('application_id', applicationId)
        .eq('kind', 'CHECK').order('created_at', { ascending: false }).limit(1).maybeSingle());

// Poll until the worker has finished the run
export const waitForMracRun = async (runId, { intervalMs = 1500, timeoutMs = 60000 } = {}) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const run = await fetchMracRun(runId);
        if (run.status === 'DONE') return run;
        if (run.status === 'FAILED') throw new Error(run.error || 'The MRAC check failed.');
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error('The MRAC worker did not respond in time. Is mrac-service running?');
};
