// Supabase calls for the loan folder (staff view of one application). Functions throw on error;
// callers handle it in try/catch/finally.
import { supabase } from '../../supabaseClient';

const check = ({ data, error }) => {
    if (error) throw error;
    return data;
};

// True only for the assigned AO while the application is in Intake (see ao_can_edit() in 20261007_ao_kyc_verification.sql)
export const fetchCanEdit = async (applicationId) =>
    check(await supabase.rpc('ao_can_edit', { p_application_id: applicationId })) ?? false;

// Oldest first; the last row per section is the current result
export const fetchKycChecks = async (applicationId) =>
    check(await supabase.from('kyc_checks').select('*')
        .eq('application_id', applicationId).order('checked_at').order('id')) ?? [];

export const recordKycCheck = async (applicationId, section, result, remarks) =>
    check(await supabase.from('kyc_checks').insert({
        application_id: applicationId, section, result, remarks: remarks.trim() || null,
    }));

// Every change made after submission, newest first
export const fetchAuditLog = async (applicationId) =>
    check(await supabase.from('audit_log').select('*')
        .eq('application_id', applicationId).order('changed_at', { ascending: false }).order('id', { ascending: false })) ?? [];

// Display names for the staff in checks / history (null when they have no profile)
export const fetchStaffNames = async (userIds) => {
    const entries = await Promise.all([...new Set(userIds.filter(Boolean))].map(async (id) =>
        [id, check(await supabase.rpc('staff_name', { p_user_id: id }))]));
    return Object.fromEntries(entries);
};
