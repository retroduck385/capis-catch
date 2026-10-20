// Supabase calls for the Financial Package (see 20261020_financial_package.sql). Functions throw on error;
// callers handle it in try/catch/finally.
import { supabase } from '../../supabaseClient';

const check = ({ data, error }) => {
    if (error) throw error;
    return data;
};

const byApplication = async (table, applicationId) =>
    check(await supabase.from(table).select('*').eq('application_id', applicationId).order('id')) ?? [];

// True only for the assigned CO while the application is open (see co_can_edit())
export const fetchCoCanEdit = async (applicationId) =>
    check(await supabase.rpc('co_can_edit', { p_application_id: applicationId })) ?? false;

// Everything the CO has entered so far (empty values when nothing is saved yet)
export const fetchFinancialPackage = async (applicationId, applicantIds) => {
    const [pkg, parties, exceptions, depositChecks, loanChecks, tradeChecks, titles, creditScore] = await Promise.all([
        check(await supabase.from('financial_packages').select('*').eq('application_id', applicationId).maybeSingle()),
        applicantIds.length
            ? check(await supabase.from('fp_party_details').select('*').in('applicant_id', applicantIds)) ?? []
            : [],
        byApplication('fp_exceptions', applicationId),
        byApplication('fp_deposit_checks', applicationId),
        byApplication('fp_loan_checks', applicationId),
        byApplication('fp_trade_checks', applicationId),
        byApplication('fp_title_verifications', applicationId),
        byApplication('credit_score_entries', applicationId),
    ]);
    return { pkg, parties, exceptions, depositChecks, loanChecks, tradeChecks, titles, creditScore };
};

// Credit_Score tab rules (criteria + bands with points), in sheet order
export const fetchCreditScoreRules = async () => {
    const [criteria, bands] = await Promise.all([
        check(await supabase.from('credit_score_criteria').select('*').order('sort_order')),
        check(await supabase.from('credit_score_bands').select('*').order('sort_order')),
    ]);
    return { criteria, bands };
};

// Replaces the application's credit score; rows without a band are unscored (see save_credit_score())
export const saveCreditScore = async (applicationId, rows) =>
    check(await supabase.rpc('save_credit_score', { p_application_id: applicationId, p_rows: rows }));

// Active AO / CO assignee; null if nobody is assigned
export const fetchAssignee = async (applicationId, role) =>
    check(await supabase.from('application_assignments').select('user_id')
        .eq('application_id', applicationId).eq('assignee_role', role)
        .is('unassigned_at', null).maybeSingle())?.user_id ?? null;

// The FP's "Handling Account Officer"
export const fetchAssignedAo = (applicationId) => fetchAssignee(applicationId, 'ACCOUNT_OFFICER');

// payload shape: see save_financial_package() in the migration
export const saveFinancialPackage = async (applicationId, payload) =>
    check(await supabase.rpc('save_financial_package', { p_application_id: applicationId, p_fp: payload }));
