// Every open question on one submitted application, at the top of the applicant's read-only view, then a bar that
// opens the closed ones (applicantClarifyHistory.jsx). The notification
// links here with &clarify=<section>: that question comes first, highlighted and scrolled into view; its "Show the
// ... part" button scrolls to the matching block of the application below (applicationSummary.jsx anchors).
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ApplicantClarifyCard from './applicantClarifyCard';
import ApplicantClarifyHistory from './applicantClarifyHistory';
import { fetchMyClarifications } from './api';
import { summaryAnchor } from './sections';

const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

// "Show the ... part": bring that block of the application into view and highlight it for a few seconds
// (orange ring like the question, .kq-target in kycClarify.css), so it's clear which part was asked about.
// Focus moves there too, so screen readers land on it.
const HIGHLIGHT_MS = 4000;
let highlightTimer = null;
const showPart = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.querySelectorAll('.kq-target').forEach((n) => n.classList.remove('kq-target'));
    clearTimeout(highlightTimer);
    void el.offsetWidth;   // restart the animation when the same part is shown twice in a row
    el.classList.add('kq-target');
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
    highlightTimer = setTimeout(() => el.classList.remove('kq-target'), HIGHLIGHT_MS);
};

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
    return (
        <>
            {ordered.map((t) => (
                <ApplicantClarifyCard key={t.id} thread={t} focus={t.section === focus} onChanged={load}
                    onShowPart={summaryAnchor(t.section) ? () => showPart(summaryAnchor(t.section)) : null} />
            ))}
            {/* the closed ones, in a popup; reloads when the open ones change (one may just have closed) */}
            <ApplicantClarifyHistory applicationId={applicationId} reloadKey={threads.map((t) => t.id).join(',')} />
        </>
    );
};

export default ApplicantClarifications;
