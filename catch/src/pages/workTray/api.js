// Supabase calls for the staff work tray. Functions throw on error;
// callers handle it in try/catch/finally.
import { supabase } from '../../supabaseClient';

const check = ({ data, error }) => {
    if (error) throw error;
    return data;
};

// One row per submitted application, FIFO by submission (see get_work_tray() in 20261005_work_tray.sql)
export const fetchWorkTray = async () => check(await supabase.rpc('get_work_tray')) ?? [];

// Active AOs and COs; empty unless the caller is a head
export const fetchAssignableStaff = async () => check(await supabase.rpc('list_assignable_staff')) ?? [];

// userId omitted = assign yourself
export const assignApplication = async (applicationId, role, userId = null) =>
    check(await supabase.rpc('assign_application', {
        p_application_id: applicationId, p_role: role, p_user_id: userId,
    }));

export const unassignApplication = async (applicationId, role) =>
    check(await supabase.rpc('unassign_application', { p_application_id: applicationId, p_role: role }));
