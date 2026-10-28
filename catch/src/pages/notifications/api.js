// Supabase calls for in-app notifications (see 20261024_notifications.sql).
// RLS returns only the signed-in user's own rows. Functions throw on error;
// callers handle it in try/catch/finally.
import { supabase } from '../../supabaseClient';

const check = ({ data, error, count }) => {
    if (error) throw error;
    return count ?? data;
};

export const PAGE_SIZE = 30;

const COLUMNS = 'id, application_id, kind, title, body, link, created_at, read_at';

// Newest first; pass the oldest loaded created_at to get the next page
export const fetchNotifications = async (before = null) => {
    let query = supabase.from('notifications').select(COLUMNS)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(PAGE_SIZE);
    if (before) query = query.lt('created_at', before);
    return check(await query) ?? [];
};

export const fetchUnreadCount = async () =>
    check(await supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null)) ?? 0;

// ids omitted = mark all of mine read
export const markRead = async (ids = null) =>
    check(await supabase.rpc('mark_notifications_read', { p_ids: ids }));

// Calls onChange({ eventType, new, old }) for every insert / update of the user's notifications.
// Returns the unsubscribe function.
export const subscribeToNotifications = (userId, onChange) => {
    const channel = supabase.channel(`notifications:${userId}:${crypto.randomUUID()}`)
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` },
            onChange)
        .subscribe();
    return () => { supabase.removeChannel(channel); };
};

// The applicant's own applications: status, what they may see, whether the outcome notice was sent
// (my_application_statuses() in 20261029_applicant_notices.sql)
export const fetchMyApplicationStatuses = async () =>
    check(await supabase.rpc('my_application_statuses')) ?? [];
