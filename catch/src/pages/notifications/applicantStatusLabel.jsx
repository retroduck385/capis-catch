import { useEffect, useState } from 'react';
import { applicantStatusLabel } from './applicantStatus';
import { fetchMyApplicationStatuses } from './api';

// One request shared by every label on the page (reused for a few seconds, so a remount fetches fresh data)
let shared = null;
const loadStatuses = () => {
    if (!shared || Date.now() - shared.at > 5000) {
        shared = { at: Date.now(), promise: fetchMyApplicationStatuses() };
    }
    return shared.promise;
};

// The status label for one of the applicant's own applications. Until we know whether the outcome notice was sent,
// an outcome shows as "Under review", so the applicant never sees an outcome before the Account Officer's notice.
const ApplicantStatusLabel = ({ application }) => {
    const [noticeSent, setNoticeSent] = useState(false);

    useEffect(() => {
        let cancelled = false;
        loadStatuses()
            .then((rows) => {
                if (!cancelled) setNoticeSent(Boolean(rows.find((r) => r.application_id === application.id)?.notice_sent));
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [application.id, application.status]);

    return <>{applicantStatusLabel(application.status, noticeSent)}</>;
};

export default ApplicantStatusLabel;
