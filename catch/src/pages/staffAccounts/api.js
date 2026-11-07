// Supabase calls for the Department Head's staff accounts page. Functions throw on error;
// callers handle it in try/catch/finally.
import { createDetachedClient, supabase } from '../../supabaseClient';

const check = ({ data, error }) => {
    if (error) throw error;
    return data;
};

// Staff accounts, newest first; empty unless the caller is the Department Head
export const fetchStaffAccounts = async () => check(await supabase.rpc('list_staff_accounts')) ?? [];

// Creates the login, then gives it the staff role (see grant_staff_role() in 20261010_staff_accounts.sql).
// Returns { existing }: true when the email already had a login, so the password typed here was not used.
// position = approval_position, Approver accounts only (null otherwise)
export const createStaffAccount = async (email, password, role, position) => {
    const { data, error } = await createDetachedClient().auth.signUp({ email, password });
    // With email confirmation on, Supabase hides "already registered" behind a user with no identities
    const existing = error?.code === 'user_already_exists' || /already registered/i.test(error?.message ?? '')
        || data?.user?.identities?.length === 0;
    if (error && !existing) throw error;

    check(await supabase.rpc('grant_staff_role', { p_email: email, p_role: role, p_position: position || null }));
    return { existing };
};

// Department Head: change an existing Approver's position (20261108_approver_positions.sql)
export const setApprovalPosition = async (userId, position) =>
    check(await supabase.rpc('set_approval_position', { p_user_id: userId, p_position: position }));
