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
    check(await supabase.from('review_assignments').select('id, application_id, assignee_role, user_id, seq')
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

// Assigned CO: saves the reviewers, the DB sets the authority + approvers from the matrix, moves to Review
export const sendForReview = async (applicationId, reviewers) =>
    check(await supabase.rpc('send_for_review', { p_application_id: applicationId, p_reviewers: reviewers }));

// Dept Head / Dispatch Admin, after sending: reviewers + authority override; approvers follow the authority
export const updateReviewRouting = async (applicationId, tier, reviewers) =>
    check(await supabase.rpc('update_review_routing',
        { p_application_id: applicationId, p_tier: tier, p_reviewers: reviewers }));

// ---------- Reviewer sign-off (20261108_reviewer_signoff.sql)

// The reviewer's checklist, in order: [{ code, label, hint, sort_order }]
export const fetchReviewCheckItems = async () =>
    check(await supabase.from('review_check_items').select('*').order('sort_order')) ?? [];

// Every sign-off / return of one application, oldest first, with its checklist
export const fetchReviewDecisions = async (applicationId) =>
    check(await supabase.from('review_decisions').select('*, review_decision_items ( * )')
        .eq('application_id', applicationId).order('decided_at').order('id')) ?? [];

// Sign-offs (not returns) of every application the caller can open: [{ application_id, assignment_id }] (work tray)
export const fetchSignoffs = async () =>
    check(await supabase.from('review_decisions').select('application_id, assignment_id')
        .neq('action', 'RETURNED')) ?? [];

// True only for the current reviewer while the application is in Review
export const fetchReviewerCanAct = async (applicationId) =>
    check(await supabase.rpc('reviewer_can_act', { p_application_id: applicationId })) ?? false;

// action: ENDORSED | NOT_ENDORSED | RETURNED; items: [{ code, result, remark }]; severity: MINOR | MAJOR (returns only)
export const submitReview = async (applicationId, { action, remarks, items, severity }) =>
    check(await supabase.rpc('submit_review', {
        p_application_id: applicationId, p_action: action, p_remarks: remarks, p_items: items,
        p_severity: severity ?? null,
    }));

// Assigned CO, after a return: what they changed; review continues from the reviewer who returned it
export const resendForReview = async (applicationId, response) =>
    check(await supabase.rpc('resend_for_review', { p_application_id: applicationId, p_response: response }));

// ---------- Approver decision (20261110_approver_decision.sql)

// Every approve / disapprove of one application, oldest first
export const fetchApprovalDecisions = async (applicationId) =>
    check(await supabase.from('approval_decisions').select('*')
        .eq('application_id', applicationId).order('decided_at').order('id')) ?? [];

// True only for a routed approver who hasn't decided yet, while the application is in Approval
export const fetchApproverCanAct = async (applicationId) =>
    check(await supabase.rpc('approver_can_act', { p_application_id: applicationId })) ?? false;

// action: APPROVED | DISAPPROVED; conditions only with APPROVED ("Approve with conditions").
// Returns 'APPROVED' | 'DISAPPROVED' (decided) or 'WAITING' (other approvers still needed / can still approve)
export const submitApproval = async (applicationId, { action, remarks, conditions }) =>
    check(await supabase.rpc('submit_approval', {
        p_application_id: applicationId, p_action: action, p_remarks: remarks || null, p_conditions: conditions || null,
    }));
