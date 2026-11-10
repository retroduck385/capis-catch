// Confirmed ID details (type / number / expiry) of the application's Valid ID documents, for the TU form.
// undefined while loading; {} on error, so the rows show as missing instead of hanging.
import { useEffect, useMemo, useState } from 'react';
import { fetchConfirmedIdDetails } from './api';
import { idDocumentIds } from './buildRequest';

const useIdDetails = (app) => {
    const key = useMemo(() => (app ? idDocumentIds(app).join(',') : ''), [app]);
    const [loaded, setLoaded] = useState({ key: null, data: undefined });

    useEffect(() => {
        if (!app) return undefined;
        let cancelled = false;
        const load = async () => {
            let data;
            try {
                data = await fetchConfirmedIdDetails(key ? key.split(',').map(Number) : []);
            } catch {
                data = {};
            } finally {
                if (!cancelled) setLoaded({ key, data });
            }
        };
        load();
        return () => { cancelled = true; };
    }, [app, key]);

    return loaded.key === key ? loaded.data : undefined;
};

export default useIdDetails;
