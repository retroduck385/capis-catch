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

const BASE_FIELDS = 'id, kind, status, facts, result, error, created_at, finished_at';
// `progress` needs 20261122_mrac_reviews.sql; without it the run is read without it (42703 = no such column)
const selectRun = async (build) => {
    const res = await build(`${BASE_FIELDS}, progress`);
    return res.error?.code === '42703' ? build(BASE_FIELDS) : res;
};

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
    unwrap(await selectRun((fields) => supabase.from('mrac_runs').select(fields).eq('id', runId).single()));

// The most recent check for this application (null if none yet)
export const fetchLatestMracCheck = async (applicationId) =>
    unwrap(await selectRun((fields) => supabase.from('mrac_runs').select(fields).eq('application_id', applicationId)
        .eq('kind', 'CHECK').order('created_at', { ascending: false }).limit(1).maybeSingle()));

// Poll until the worker has finished the run. The policy recommender reads ~30 clauses with Claude, so a check takes
// one to two minutes; onProgress(run) gets every poll (run.progress = the worker's current step).
export const waitForMracRun = async (runId, { intervalMs = 2000, timeoutMs = 300000, onProgress } = {}) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const run = await fetchMracRun(runId);
        if (run.status === 'DONE') return run;
        if (run.status === 'FAILED') throw new Error(run.error || 'The MRAC check failed.');
        onProgress?.(run);
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error('The MRAC worker did not respond in time. Is mrac-service running?');
};

// The CO's decision on each finding of a check run (20261122_mrac_reviews.sql): { [chunk_key]: row }.
// Empty when the table isn't migrated yet.
export const fetchFindingReviews = async (runId) => {
    if (!runId) return {};
    const { data, error } = await supabase.from('mrac_finding_reviews')
        .select('id, chunk_key, decision, reason, edited, reviewed_by, reviewed_at').eq('run_id', runId);
    if (error) return {};
    return Object.fromEntries((data ?? []).map((r) => [r.chunk_key, r]));
};

// decision: ACCEPTED / EDITED (with edited { policy, recommendation, mitigant } or { text }) / DISMISSED (with reason) / UNDO
export const reviewFinding = async (runId, chunkKey, decision, { reason = null, edited = null } = {}) =>
    unwrap(await supabase.rpc('review_mrac_finding', {
        p_run_id: runId, p_chunk_key: chunkKey, p_decision: decision, p_reason: reason, p_edited: edited,
    }));
