// Supabase calls for VII. Approval routing and the reviewer / approver summary (see 20261021_review_routing.sql).
// Functions throw on error; callers handle it in try/catch/finally.
import { supabase } from '../../supabaseClient';

const check = ({ data, error }) => {
    if (error) throw error;
    return data;
};

// Every reviewer / approver row of one application, past ones included (unassigned_at set)
export const fetchReviewAssignments = async (applicationId) =>
    check(await supabase.from('review_assignments').select('*')
        .eq('application_id', applicationId).order('seq').order('id')) ?? [];

// Active rows of every application the caller can open (work tray)
export const fetchActiveReviewAssignments = async () =>
    check(await supabase.from('review_assignments').select('application_id, assignee_role, user_id, seq')
        .is('unassigned_at', null).order('seq')) ?? [];

// Active Reviewer / Approver accounts with a staff profile: [{ user_id, role, name }]
export const fetchReviewStaff = async () => check(await supabase.rpc('list_review_staff')) ?? [];

// Open stage + its latest status; null if the application has no stage yet
export const fetchCurrentStage = async (applicationId) => {
    const row = check(await supabase.from('application_stages')
        .select('stage, entered_at, stage_status_changes ( id, status )')
        .eq('application_id', applicationId).is('left_at', null).maybeSingle());
    if (!row) return null;
    const latest = [...row.stage_status_changes].sort((a, b) => a.id - b.id).at(-1);
    return { stage: row.stage, status: latest?.status ?? null, enteredAt: row.entered_at };
};

const routing = (applicationId, tier, reviewers, approvers) => ({
    p_application_id: applicationId, p_tier: tier, p_reviewers: reviewers, p_approvers: approvers,
});

// Assigned CO: saves the routing and moves the application to Review
export const sendForReview = async (applicationId, tier, reviewers, approvers) =>
    check(await supabase.rpc('send_for_review', routing(applicationId, tier, reviewers, approvers)));

// Dept Head / Dispatch Admin, after sending
export const updateReviewRouting = async (applicationId, tier, reviewers, approvers) =>
    check(await supabase.rpc('update_review_routing', routing(applicationId, tier, reviewers, approvers)));
