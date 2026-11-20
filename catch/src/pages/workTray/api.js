// Supabase calls for the staff work tray. Functions throw on error;
// callers handle it in try/catch/finally.
import { supabase } from '../../supabaseClient';

const check = ({ data, error }) => {
    if (error) throw error;
    return data;
};

// One row per submitted application, FIFO by submission (see get_work_tray() in 20261005_work_tray.sql)
export const fetchWorkTray = async () => check(await supabase.rpc('get_work_tray')) ?? [];

// The caller's team (AO or CO Manager only, empty for everyone else): officers with availability, open files,
// workload (borrowers on open files) and last assignment. See 20261120_team_managers_auto_assignment.sql.
export const fetchAssignableStaff = async () => check(await supabase.rpc('list_assignable_staff')) ?? [];

// Manager override: assign / reassign their team's slot to one officer
export const assignApplication = async (applicationId, role, userId) =>
    check(await supabase.rpc('assign_application', {
        p_application_id: applicationId, p_role: role, p_user_id: userId,
    }));

export const unassignApplication = async (applicationId, role) =>
    check(await supabase.rpc('unassign_application', { p_application_id: applicationId, p_role: role }));

// Manager: fill every empty slot of their team on open files (FIFO). Returns { assigned, left }.
export const autoAssignUnassigned = async () => check(await supabase.rpc('auto_assign_unassigned'));

// Manager: take an officer in / out of the auto-assignment rotation
export const setOfficerAvailability = async (userId, available) =>
    check(await supabase.rpc('set_officer_availability', { p_user_id: userId, p_available: available }));
