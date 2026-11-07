import { useCallback, useEffect, useRef, useState } from 'react';
import {
    PAGE_SIZE, fetchCanPost, fetchLastRead, fetchMessages, fetchSenderName, fetchUnread,
    markMessagesRead, postMessage, subscribeToMessages,
} from './api';

// One file's thread, kept live through Supabase Realtime.
// unread = other people's messages I haven't read (counted while the panel is closed).
// dividerId = my read marker when I last opened the panel: messages after it get the "New" divider.
export const useMessages = (applicationId, userId, open) => {
    const [items, setItems] = useState([]);          // oldest first
    const [hasMore, setHasMore] = useState(false);
    const [unread, setUnread] = useState(0);
    const [canPost, setCanPost] = useState(false);
    const [names, setNames] = useState({});
    const [dividerId, setDividerId] = useState(0);
    const [latest, setLatest] = useState(null);      // newest message from someone else (screen-reader announcement)
    const [error, setError] = useState(null);
    const [sending, setSending] = useState(false);
    const markerRef = useRef(0);                     // newest message id I have read
    const openRef = useRef(open);
    const asked = useRef(new Set());

    useEffect(() => { openRef.current = open; }, [open]);

    const loadNames = useCallback((rows) => {
        rows.forEach((m) => {
            if (asked.current.has(m.sender_id)) return;
            asked.current.add(m.sender_id);
            fetchSenderName(m.sender_id)
                .then((name) => setNames((prev) => ({ ...prev, [m.sender_id]: name })))
                .catch(() => {});
        });
    }, []);

    const markRead = useCallback(async () => {
        try { await markMessagesRead(applicationId); } catch (err) { setError(err.message); }
    }, [applicationId]);

    useEffect(() => {
        if (!applicationId || !userId) return;
        let cancelled = false;
        asked.current = new Set();

        Promise.all([fetchMessages(applicationId), fetchCanPost(applicationId), fetchUnread(applicationId),
            fetchLastRead(applicationId)])
            .then(([rows, post, count, marker]) => {
                if (cancelled) return;
                const ordered = [...rows].reverse();
                setItems(ordered);
                setHasMore(rows.length === PAGE_SIZE);
                setCanPost(post);
                setUnread(count);
                markerRef.current = marker;
                setDividerId(marker);
                loadNames(ordered);
            })
            .catch((err) => { if (!cancelled) setError(err.message); });

        const unsubscribe = subscribeToMessages(applicationId, (row) => {
            if (cancelled) return;
            setItems((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
            loadNames([row]);
            if (row.sender_id === userId) return;
            setLatest(row);
            if (openRef.current) markRead(); else setUnread((n) => n + 1);
        });

        return () => { cancelled = true; unsubscribe(); };
    }, [applicationId, userId, loadNames, markRead]);

    // Opening the panel: freeze the divider at my old marker, then mark everything read
    useEffect(() => {
        if (!open) return;
        setDividerId(markerRef.current);
        setUnread(0);
        markRead();
    }, [open, markRead]);

    // Keep the marker in step with what is on screen while the panel is open
    useEffect(() => {
        if (open && items.length) markerRef.current = Math.max(markerRef.current, items.at(-1).id);
    }, [open, items]);

    const loadEarlier = useCallback(async () => {
        try {
            const rows = await fetchMessages(applicationId, items[0]?.id);
            const ordered = [...rows].reverse();
            setItems((prev) => [...ordered.filter((r) => !prev.some((m) => m.id === r.id)), ...prev]);
            setHasMore(rows.length === PAGE_SIZE);
            loadNames(ordered);
        } catch (err) {
            setError(err.message);
        }
    }, [applicationId, items, loadNames]);

    // Resolves true when sent (the realtime event adds the row; this adds it too in case Realtime is slow)
    const send = useCallback(async (body) => {
        setSending(true);
        setError(null);
        try {
            const row = await postMessage(applicationId, body);
            if (row?.id) setItems((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
            return true;
        } catch (err) {
            setError(err.message);
            return false;
        } finally {
            setSending(false);
        }
    }, [applicationId]);

    return { items, hasMore, unread, canPost, names, dividerId, latest, error, sending, loadEarlier, send };
};
