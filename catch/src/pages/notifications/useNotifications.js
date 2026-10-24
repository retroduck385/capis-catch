import { useCallback, useEffect, useState } from 'react';
import { PAGE_SIZE, fetchNotifications, fetchUnreadCount, markRead, subscribeToNotifications } from './api';

// The signed-in user's notifications, kept live through Supabase Realtime.
// latest = the newest one that arrived while the page was open (for the screen-reader announcement).
export const useNotifications = (userId) => {
    const [items, setItems] = useState([]);
    const [unread, setUnread] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [latest, setLatest] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!userId) return;
        let cancelled = false;

        Promise.all([fetchNotifications(), fetchUnreadCount()])
            .then(([rows, count]) => {
                if (cancelled) return;
                setItems(rows);
                setHasMore(rows.length === PAGE_SIZE);
                setUnread(count);
            })
            .catch((err) => { if (!cancelled) setError(err.message); });

        const unsubscribe = subscribeToNotifications(userId, (change) => {
            if (cancelled) return;
            if (change.eventType === 'INSERT') {
                const row = change.new;
                setItems((prev) => (prev.some((n) => n.id === row.id) ? prev : [row, ...prev]));
                if (!row.read_at) setUnread((n) => n + 1);
                setLatest(row);
            } else if (change.eventType === 'UPDATE') {
                // Read in another tab: take the new row and recount
                setItems((prev) => prev.map((n) => (n.id === change.new.id ? { ...n, ...change.new } : n)));
                fetchUnreadCount().then((count) => { if (!cancelled) setUnread(count); }).catch(() => {});
            }
        });

        return () => { cancelled = true; unsubscribe(); };
    }, [userId]);

    const loadMore = useCallback(async () => {
        try {
            const rows = await fetchNotifications(items.at(-1)?.created_at);
            setItems((prev) => [...prev, ...rows.filter((r) => !prev.some((n) => n.id === r.id))]);
            setHasMore(rows.length === PAGE_SIZE);
        } catch (err) {
            setError(err.message);
        }
    }, [items]);

    const markOneRead = useCallback(async (id) => {
        const item = items.find((n) => n.id === id);
        if (!item || item.read_at) return;
        setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
        setUnread((n) => Math.max(0, n - 1));
        try { await markRead([id]); } catch (err) { setError(err.message); }
    }, [items]);

    const markAllRead = useCallback(async () => {
        const now = new Date().toISOString();
        setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })));
        setUnread(0);
        try { await markRead(); } catch (err) { setError(err.message); }
    }, []);

    return { items, unread, hasMore, latest, error, loadMore, markOneRead, markAllRead };
};
