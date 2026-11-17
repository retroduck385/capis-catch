// Whether each uploaded file could be read, for the request box: OCR (and, for the four types the AI reads, the AI
// step). Every requested upload gets an OCR run: ID / COE / payslip / bank statement on upload (queue_ocr_run), the
// other types (Other, SPA, SEC / DTI / Mayor's permit) through 20261118_request_uploads_ocr.sql, OCR only.
// The worker retries a failed step once by itself, so FAILED is final. Polls while any file is still being read.
import { useEffect, useState } from 'react';
import { fetchReadStates } from './api';

const POLL_MS = 5000;

// documentIds: the uploads shown in the box. Returns { [document id]: 'READING' | 'READ' | 'UNREADABLE' }
// (no entry = no reading queued, e.g. before the migration was run)
export const useReadStates = (documentIds) => {
    const key = [...documentIds].sort((a, b) => a - b).join(',');
    const [reads, setReads] = useState({});
    const [tick, setTick] = useState(0);

    useEffect(() => {
        let cancelled = false;
        let timer = null;
        const ids = key ? key.split(',').map(Number) : [];
        fetchReadStates(ids)
            .then((r) => {
                if (cancelled) return;
                setReads(r);
                if (Object.values(r).includes('READING')) timer = setTimeout(() => setTick((t) => t + 1), POLL_MS);
            })
            .catch(() => {}); // only a hint: the files still show without it
        return () => { cancelled = true; clearTimeout(timer); };
    }, [key, tick]);

    return reads;
};
