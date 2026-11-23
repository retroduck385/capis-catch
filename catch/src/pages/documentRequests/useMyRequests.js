import { useCallback, useEffect, useState } from 'react';
import { fetchMyRequests } from './api';

// The applicant's document requests on one application (open first), and a reload for after a change: the
// Documents tab of a submitted application (applicationForm/applicationTabs.jsx).
export const useMyRequests = (applicationId) => {
    const [requests, setRequests] = useState([]);
    const [loaded, setLoaded] = useState(false);
    const pick = useCallback((rows) => rows
        .filter((r) => r.application_id === applicationId)
        .sort((a, b) => (a.status === 'OPEN' ? 0 : 1) - (b.status === 'OPEN' ? 0 : 1)), [applicationId]);

    const reload = useCallback(async () => {
        try {
            setRequests(pick(await fetchMyRequests()));
        } catch {
            setRequests([]);   // the requests are extra: the page still shows without them
        }
    }, [pick]);

    useEffect(() => {
        let cancelled = false;
        fetchMyRequests()
            .then((rows) => { if (!cancelled) setRequests(pick(rows)); })
            .catch(() => { if (!cancelled) setRequests([]); })
            .finally(() => { if (!cancelled) setLoaded(true); });
        return () => { cancelled = true; };
    }, [pick]);

    return { requests, loaded, reload };
};

// Documents still short of files on the open requests (the tab's badge)
export const missingCount = (requests) => requests
    .filter((r) => r.status === 'OPEN')
    .reduce((n, r) => n + r.items.filter((i) => i.uploads.length < i.min_files).length, 0);
