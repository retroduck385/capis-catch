import { useEffect, useState } from 'react';
import { applicantStatusLabel, visibleStatusLabel } from './applicantStatus';
import { fetchMyApplicationStatuses } from './api';

// One request shared by every label on the page (reused for a few seconds, so a remount fetches fresh data)
let shared = null;
const loadStatuses = () => {
    if (!shared || Date.now() - shared.at > 5000) {
        shared = { at: Date.now(), promise: fetchMyApplicationStatuses() };
    }
    return shared.promise;
};

// The status label for one of the applicant's own applications: what the database says they may see
// (visible_status: an outcome only after the AO's notice, "Documents needed" / "Documents sent" while a document
// request is open). Until that has loaded, an outcome shows as "Under review", so the applicant never sees an outcome
// before the Account Officer's notice.
const ApplicantStatusLabel = ({ application }) => {
    const [noticeSent, setNoticeSent] = useState(false);
    const [visible, setVisible] = useState(null);

    useEffect(() => {
        let cancelled = false;
        loadStatuses()
            .then((rows) => {
                if (cancelled) return;
                const row = rows.find((r) => r.application_id === application.id);
                setNoticeSent(Boolean(row?.notice_sent));
                setVisible(row?.visible_status ?? null);
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [application.id, application.status]);

    return <>{visibleStatusLabel(visible) ?? applicantStatusLabel(application.status, noticeSent)}</>;
};

export default ApplicantStatusLabel;
