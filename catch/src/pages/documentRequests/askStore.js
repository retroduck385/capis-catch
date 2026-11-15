// "May I open a document request on this file?" (document_request_can_open()), shared by every
// "Ask the applicant" button on a page so they ask the database once: { [applicationId]: boolean }
import { useEffect, useSyncExternalStore } from 'react';
import { fetchCanOpen } from './api';

const answers = new Map();
const loading = new Set();
const listeners = new Set();
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const load = (applicationId) => {
    if (loading.has(applicationId)) return;
    loading.add(applicationId);
    fetchCanOpen(applicationId)
        .then((can) => answers.set(applicationId, can), () => answers.set(applicationId, false))
        .finally(() => { loading.delete(applicationId); listeners.forEach((l) => l()); });
};

// Call after a request is sent or closed, so the buttons hide or come back
export const refreshCanAsk = (applicationId) => load(applicationId);

export const useCanAsk = (applicationId) => {
    const can = useSyncExternalStore(subscribe, () => answers.get(applicationId));
    useEffect(() => { if (applicationId) load(applicationId); }, [applicationId]);
    return can === true;
};
