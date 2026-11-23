// A submitted application's page body for the applicant (applicationFormPage.jsx), split by two tabs right under the
// page header: "Your application" (where it stands, the Account Officer's open questions, and the read-only
// application to check) and "Document requests" (what the Account Officer asked for, documentRequests/applicantRequestCard.jsx;
// an orange count while documents are still missing). The Document requests tab shows only when there is a request.
// "Your application" opens by default; &tab=documents in the URL opens Document requests (the tab is kept there, replace).
// Tabs follow the ARIA pattern: arrow keys / Home / End move between them, Tab goes into the panel.
// Styles: "Submitted application tabs" and "Documents tab" in applicantPages.css.
import { useId, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileText, FolderUp } from 'lucide-react';
import ApplicationSummary from './applicationSummary';
import { SummaryContext } from './summaryContext';
import ApplicantStageTracker from '../notifications/applicantStageTracker';
import ApplicantClarifications from '../kycClarify/applicantClarifications';
import ApplicantRequests from '../documentRequests/applicantRequestCard';
import { missingCount, useMyRequests } from '../documentRequests/useMyRequests';

const Summary = ({ app }) => (
    <section className="ct-card ap-summary" aria-label="Your application">
        <div className="ct-sheet-body">
            <SummaryContext.Provider value={{ stacked: true, hideEmpty: false }}>
                <ApplicationSummary app={app} />
            </SummaryContext.Provider>
        </div>
    </section>
);

// The application, open for checking: where it stands, the open questions, then the application itself
const ApplicationPanel = ({ app }) => (
    <>
        <ApplicantStageTracker application={app} />
        <ApplicantClarifications applicationId={app.id} />
        <Summary app={app} />
    </>
);

const ApplicationTabs = ({ app }) => {
    const id = useId();
    const tabRefs = useRef({});
    const [searchParams, setSearchParams] = useSearchParams();
    const { requests, reload } = useMyRequests(app.id);

    const hasTabs = requests.length > 0;
    const tab = hasTabs && searchParams.get('tab') === 'documents' && !searchParams.get('clarify') ? 'documents' : 'application';

    const pick = (key, focus = false) => {
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            if (key === 'documents') next.set('tab', key); else next.delete('tab');
            next.delete('clarify');   // a question's link has been followed; switching tabs is the applicant's choice now
            return next;
        }, { replace: true });
        if (focus) tabRefs.current[key]?.focus();
    };

    const tabs = [
        { key: 'application', label: 'Your application', Icon: FileText },
        { key: 'documents', label: 'Document requests', Icon: FolderUp, n: missingCount(requests) },
    ];
    const onKey = (e) => {
        const at = tabs.findIndex((t) => t.key === tab);
        const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: tabs.length - 1 }[e.key];
        if (next === undefined) return;
        e.preventDefault();
        pick(tabs[(next + tabs.length) % tabs.length].key, true);
    };

    return (
        <>
            {hasTabs && (
                <div className="ap-tabs" role="tablist" aria-label="Application" onKeyDown={onKey}>
                    {tabs.map(({ key, label, Icon, n }) => (
                        <button key={key} ref={(el) => { tabRefs.current[key] = el; }} type="button" role="tab"
                            id={`${id}-tab-${key}`} aria-controls={`${id}-panel`} aria-selected={tab === key}
                            tabIndex={tab === key ? 0 : -1} onClick={() => pick(key)}>
                            <Icon size={17} aria-hidden="true" />
                            {label}
                            {n > 0 && <b>{n}<span className="sr-only"> still needed</span></b>}
                        </button>
                    ))}
                </div>
            )}
            <div key={tab} id={`${id}-panel`} className="ap-tabpanel"
                {...(hasTabs ? { role: 'tabpanel', 'aria-labelledby': `${id}-tab-${tab}`, tabIndex: 0 } : {})}>
                {tab === 'documents' ? <ApplicantRequests requests={requests} onChanged={reload} /> : <ApplicationPanel app={app} />}
            </div>
        </>
    );
};

export default ApplicationTabs;
