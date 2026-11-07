// Supabase calls for loan-file messages (see 20261028_messages.sql). RLS returns only threads the
// signed-in staff member can read. Functions throw on error; callers handle it in try/catch/finally.
import { supabase } from '../../supabaseClient';

const check = ({ data, error }) => {
    if (error) throw error;
    return data;
};

export const PAGE_SIZE = 30;
export const MAX_LENGTH = 2000;

const COLUMNS = 'id, application_id, sender_id, sender_role, stage, body, created_at';

// Newest first; pass the oldest loaded id to get the next (older) page
export const fetchMessages = async (applicationId, beforeId = null) => {
    let query = supabase.from('messages').select(COLUMNS).eq('application_id', applicationId)
        .order('id', { ascending: false }).limit(PAGE_SIZE);
    if (beforeId) query = query.lt('id', beforeId);
    return check(await query) ?? [];
};

export const fetchCanPost = async (applicationId) =>
    check(await supabase.rpc('message_can_post', { p_application_id: applicationId })) ?? false;

// How many messages from other people I haven't read on this file
export const fetchUnread = async (applicationId) => {
    const rows = check(await supabase.rpc('message_unread_counts', { p_application_ids: [applicationId] })) ?? [];
    return rows[0]?.unread ?? 0;
};

// My read marker (0 = never opened)
export const fetchLastRead = async (applicationId) => {
    const rows = check(await supabase.from('message_reads').select('last_read_id')
        .eq('application_id', applicationId)) ?? [];
    return rows[0]?.last_read_id ?? 0;
};

export const markMessagesRead = async (applicationId) =>
    check(await supabase.rpc('mark_messages_read', { p_application_id: applicationId }));

export const postMessage = async (applicationId, body) =>
    check(await supabase.rpc('post_message', { p_application_id: applicationId, p_body: body }));

export const fetchSenderName = async (userId) =>
    check(await supabase.rpc('staff_name', { p_user_id: userId }));

// Calls onInsert(row) for every new message on the file. Returns the unsubscribe function.
export const subscribeToMessages = (applicationId, onInsert) => {
    const channel = supabase.channel(`messages:${applicationId}:${crypto.randomUUID()}`)
        .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'messages', filter: `application_id=eq.${applicationId}` },
            (change) => onInsert(change.new))
        .subscribe();
    return () => { supabase.removeChannel(channel); };
};
