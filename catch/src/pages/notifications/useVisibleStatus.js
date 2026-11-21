import { useEffect, useState } from 'react';
import { fetchMyApplicationStatuses } from './api';

// One request shared by every label and tracker on the page (reused for a few seconds, so a remount fetches fresh data)
let shared = null;
const loadStatuses = () => {
    if (!shared || Date.now() - shared.at > 5000) {
        shared = { at: Date.now(), promise: fetchMyApplicationStatuses() };
    }
    return shared.promise;
};

// What the database says the applicant may see for one of their applications (my_application_statuses().visible_status:
// an outcome only after the AO's notice, "Documents needed" / "Documents sent" while a document request is open), or
// null until it loads. Until then an outcome shows as "Final approval", so it never shows before the notice.
export const useVisibleStatus = (application) => {
    const [visible, setVisible] = useState(null);
    useEffect(() => {
        let cancelled = false;
        loadStatuses()
            .then((rows) => {
                if (!cancelled) setVisible(rows.find((r) => r.application_id === application.id)?.visible_status ?? null);
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [application.id, application.status]);
    return visible;
};
