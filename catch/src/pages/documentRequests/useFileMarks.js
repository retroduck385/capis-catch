// One load per page of the staff marks on an application's files (document_file_marks): every file's marks
// (oldest first per document), the markers' names, and whether I can mark. reload() loads them again.
// applicationId null = nothing to load (the CI report check has no marks).
import { useCallback, useEffect, useState } from 'react';
import { fetchStaffNames } from '../loanFolder/api';
import { fetchCanMark, fetchFileMarks } from './api';

export const useFileMarks = (applicationId) => {
    const [state, setState] = useState({ byDoc: {}, names: {}, canMark: false });
    const [version, setVersion] = useState(0);

    useEffect(() => {
        if (!applicationId) return undefined;
        let cancelled = false;
        (async () => {
            try {
                const [rows, canMark] = await Promise.all([fetchFileMarks(applicationId), fetchCanMark(applicationId)]);
                const names = await fetchStaffNames(rows.map((r) => r.marked_by));
                const byDoc = {};
                for (const r of rows) (byDoc[r.document_id] ??= []).push(r);
                if (!cancelled) setState({ byDoc, names, canMark });
            } catch { /* the table may not be migrated yet: the page still works without marks */ }
        })();
        return () => { cancelled = true; };
    }, [applicationId, version]);

    const reload = useCallback(() => setVersion((v) => v + 1), []);
    return { ...state, reload };
};
