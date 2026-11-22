// The open KYC clarifications of a file as one line ("Employment, Loan Details"), for pages that must wait for them
// (the CI's Mark CI Done). null = none open, or not loaded / not allowed (the database still refuses the move).
import { useEffect, useState } from 'react';
import { fetchThreads } from './api';
import { openSectionsText } from './sections';

export const useOpenClarifications = (applicationId) => {
    const [text, setText] = useState(null);
    useEffect(() => {
        if (!applicationId) return undefined;
        let cancelled = false;
        fetchThreads(applicationId)
            .then((threads) => { if (!cancelled) setText(openSectionsText(threads)); })
            .catch(() => { if (!cancelled) setText(null); });
        return () => { cancelled = true; };
    }, [applicationId]);
    return text;
};
