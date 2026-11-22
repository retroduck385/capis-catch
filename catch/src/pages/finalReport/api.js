// Final report: everything its pages show, loaded once. Read only; RLS decides what each role can read.
// Builds on the Decision Support loader (same data, so the report can't disagree with that page), plus the stage
// history for the sign-offs and the credit score's change history for
// "Prepared by". The CI results for IV. Credit Checking come with the Decision Support data (data.ci).
import { supabase } from '../../supabaseClient';
import { fetchDecisionSupport } from '../decisionSupport/api';
import { fetchCoCanEdit } from '../financialPackage/api';
import { fetchAuditLog, fetchStaffNames } from '../loanFolder/api';

const optional = (promise, fallback) => promise.catch(() => fallback);

const check = ({ data, error }) => {
    if (error) throw error;
    return data;
};

// Every stage visit of the application with its status changes, oldest first
const fetchStageHistory = async (applicationId) =>
    check(await supabase.from('application_stages')
        .select('id, stage, entered_at, left_at, stage_status_changes ( id, status, changed_at, changed_by )')
        .eq('application_id', applicationId).order('entered_at').order('id')) ?? [];

export const fetchFinalReport = async (applicationId) => {
    const data = await fetchDecisionSupport(applicationId);
    const { app } = data;
    const [stages, coCanEdit, audit] = await Promise.all([
        optional(fetchStageHistory(app.id), []),
        optional(fetchCoCanEdit(app.id), false),
        optional(fetchAuditLog(app.id), []),
    ]);
    // Who last saved the credit score (audit_log is newest first)
    const scoreSaved = audit.find((e) => e.table_name === 'credit_score_entries') ?? null;
    const extra = await fetchStaffNames([
        scoreSaved?.changed_by,
        ...stages.flatMap((s) => (s.stage_status_changes ?? []).map((c) => c.changed_by)),
        ...data.rows.map((r) => r.user_id),
    ]);
    return { ...data, names: { ...extra, ...data.names }, stages, coCanEdit, scoreSaved };   // data.ci: loaded by Decision Support
};
