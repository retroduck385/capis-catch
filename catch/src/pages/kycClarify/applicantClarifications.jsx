// Every open question on one submitted application, at the top of the applicant's read-only view. The notification
// links here with &clarify=<section>: that question comes first, highlighted and scrolled into view; its "Show the
// ... part" button scrolls to the matching block of the application below (applicationSummary.jsx anchors).
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ApplicantClarifyCard from './applicantClarifyCard';
import { fetchMyClarifications } from './api';
import { summaryAnchor } from './sections';

const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

const ApplicantClarifications = ({ applicationId }) => {
    const [threads, setThreads] = useState([]);
    const [searchParams] = useSearchParams();
    const focus = searchParams.get('clarify');

    const load = useCallback(async () => {
        try {
            const rows = await fetchMyClarifications();
            setThreads(rows.filter((t) => t.application_id === applicationId));
        } catch {
            setThreads([]);   // the questions are extra: the page still shows without them
        }
    }, [applicationId]);

    useEffect(() => {
        let cancelled = false;
        fetchMyClarifications()
            .then((rows) => { if (!cancelled) setThreads(rows.filter((t) => t.application_id === applicationId)); })
            .catch(() => { if (!cancelled) setThreads([]); });
        return () => { cancelled = true; };
    }, [applicationId, focus]);   // a notification clicked while this page is open (a new &clarify=) loads again

    // Bring the question the notification pointed to into view once it is there
    const focused = threads.some((t) => t.section === focus);
    useEffect(() => {
        if (focused) scrollTo(`clarify-${focus}`);
    }, [focused, focus]);

    const ordered = [...threads].sort((a, b) => (b.section === focus) - (a.section === focus));
    return ordered.map((t) => (
        <ApplicantClarifyCard key={t.id} thread={t} focus={t.section === focus} onChanged={load}
            onShowPart={summaryAnchor(t.section) ? () => scrollTo(summaryAnchor(t.section)) : null} />
    ));
};

export default ApplicantClarifications;
