// One CI request, opened from the Credit Investigator's work tray: the NFIS and TU request forms and the AO's
// remarks (view only), then the CI results: upload the reports, record results + summaries, Mark CI Done.
// Any active CI can work it while the application is in Credit Investigation; afterwards it's read-only.
// While the CI can edit, the work is four step subpages of this page (components/stepStrip.jsx as tabs), one shown
// at a time, with Back / Next at the bottom. The step is in the URL (&step=request|upload|ai|results), so the
// browser's Back button and links (e.g. the document check's "Go to step 4") work:
//   1. Review the request (forms + AO remarks)   2. Upload the reports (borrower x check grid)
//   3. AI check NFIS / TU (each report, opened on /documentCheckPage?ci=1; optional)   4. Results and Mark CI Done
// The AI check comes before the results because confirming it writes the result + summary for that report.
// Opened without &step, the page starts on the first step that isn't done.
import { CiRequestSkeleton } from '../../components/skeleton';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Info } from 'lucide-react';
import Breadcrumbs from '../../components/breadcrumbs';
import StepStrip from '../../components/stepStrip';
import { fetchApplication } from '../applicationForm/api';
import { fetchStaffNames } from '../loanFolder/api';
import { whenOf } from '../loanFolder/options';
import { fetchCiCanEdit, fetchCiRequests } from './api';
import { buildCiRequest, missingFields, peso } from './buildRequest';
import CiRequestForms from './ciRequestForms';
import useIdDetails from './useIdDetails';
import { CiResultsEditor, CiResultsView } from './ciResults';
import { REQUIRED_CHECKS, isAiChecked, keyOf, missingItems, useCiResults } from './ciResultsData';
import MessagesPanel from '../messages/messagesPanel';
import '../loanFolder/loanFolder.css';
import '../financialPackage/financialPackage.css';
import './ciRequest.css';
import { Term, Terms } from '../../components/term';
import { useTermTitle } from '../../components/useTermTitle';

const STEP_KEYS = ['request', 'upload', 'ai', 'results'];
const STEP_INTRO = {
    request: 'What the Account Officer is asking you to check, built from the application.',
    upload: 'The NFIS, TransUnion and BRAS reports for each borrower.',
    ai: "Compare the AI's reading of each NFIS and TU report with the report itself.",
    results: 'Your result and summary for each check, then send the file to Credit Evaluation.',
};

const Remark = ({ title, text }) => (
    <div>
        <div className="ci-remark-label"><Terms text={title} /><small>from the Account Officer</small></div>
        <p className={`ci-remark${text ? '' : ' empty'}`}>{text || 'No remarks.'}</p>
    </div>
);

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// The CI's four steps, from the saved CI rows (data), the request's missing values and unsaved findings
const ciSteps = ({ data, missing, dirty, onOpen }) => {
    const slots = data.borrowers.flatMap((p) => REQUIRED_CHECKS.map((c) => data.byKey[keyOf(p.id, c.value)]));
    const total = slots.length;
    const uploaded = slots.filter((s) => s?.documents?.length).length;
    const checked = slots.filter((s) => isAiChecked(s, data.confirmed)).length;
    // Reports not AI-checked: skipping step 3 is fine once each has a result entered by hand
    const unchecked = slots.filter((s) => !isAiChecked(s, data.confirmed));
    const skipped = total > 0 && uploaded === total && checked < total && unchecked.every((s) => s?.result);
    const stillNeeded = missingItems(data.borrowers, data.byKey).length;

    let aiText = `${checked} of ${total} reports confirmed · optional`;
    if (uploaded === 0) aiText = 'Upload a NFIS or TU report first · optional';
    else if (skipped) aiText = `${checked} of ${total} AI-checked · the rest entered by hand`;
    let resultsText = stillNeeded ? `${plural(stillNeeded, 'item')} still needed` : 'Ready: Mark CI Done';
    if (dirty) resultsText = 'Unsaved changes';

    return [
        {
            key: 'request', title: 'Review the request',
            text: missing.length ? `${plural(missing.length, 'missing value')}: ask the AO` : 'Forms and AO remarks · nothing missing',
            done: missing.length === 0 || uploaded > 0,
        },
        {
            key: 'upload', title: 'Upload the reports', text: `${uploaded} of ${total} required reports uploaded`,
            done: total > 0 && uploaded === total, meter: { value: uploaded, max: total },
        },
        {
            key: 'ai', title: 'AI check NFIS & TU', text: aiText, skipped,
            done: total > 0 && checked === total, meter: { value: checked, max: total },
        },
        { key: 'results', title: 'Results and Mark CI Done', text: resultsText, done: false },
    ].map((s) => ({ ...s, onClick: () => onOpen(s.key) }));
};

const CiRequestPage = () => {
    const tt = useTermTitle();
    const [searchParams, setSearchParams] = useSearchParams();
    const applicationId = Number(searchParams.get('id'));
    const stepParam = STEP_KEYS.includes(searchParams.get('step')) ? searchParams.get('step') : null;

    const [app, setApp] = useState(null);
    const [request, setRequest] = useState(null);
    const [requesterName, setRequesterName] = useState(null);
    const [canEdit, setCanEdit] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [dirty, setDirty] = useState(false); // unsaved findings in step 4 (the editor reports them)

    // Request + edit right change after Save / Mark CI Done; the application record doesn't
    const loadRequest = useCallback(async () => {
        const [requests, editable] = await Promise.all([fetchCiRequests(applicationId), fetchCiCanEdit(applicationId)]);
        const latest = requests.at(-1) ?? null;
        const names = latest ? await fetchStaffNames([latest.requested_by]) : {};
        return { latest, editable, requester: latest ? names[latest.requested_by] : null };
    }, [applicationId]);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const [data, r] = await Promise.all([fetchApplication(applicationId), loadRequest()]);
                if (cancelled) return;
                setApp(data);
                setRequest(r.latest);
                setRequesterName(r.requester);
                setCanEdit(r.editable);
            } catch (err) {
                if (!cancelled) setError(err.message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [applicationId, loadRequest]);

    const handleChanged = async () => {
        try {
            const r = await loadRequest();
            setRequest(r.latest);
            setCanEdit(r.editable);
        } catch (err) {
            setError(err.message);
        }
    };

    const idDetails = useIdDetails(app);
    const built = useMemo(() => (app ? buildCiRequest(app, idDetails) : null), [app, idDetails]);
    const missing = useMemo(() => (built ? missingFields(built) : []), [built]);
    const ciData = useCiResults(app);
    const working = Boolean(request && canEdit);
    const ready = !loading && working && !ciData.loading;

    // Open a step: a new history entry, so the browser's Back goes to the previous step. Focus its heading.
    const openStep = useCallback((key, { replace = false, focus = true } = {}) => {
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.set('step', key);
            return next;
        }, { replace });
        if (focus) requestAnimationFrame(() => document.getElementById('ci-panel-h')?.focus());
    }, [setSearchParams]);

    // Opened without a step: start on the first one still to do (fixed in the URL, so it doesn't move on by itself)
    const steps = ready ? ciSteps({ data: ciData, missing, dirty, onOpen: openStep }) : [];
    const firstOpen = steps.find((s) => !s.done && !s.skipped)?.key ?? 'results';
    useEffect(() => {
        if (ready && !stepParam) openStep(firstOpen, { replace: true, focus: false });
    }, [ready, stepParam, firstOpen, openStep]);

    if (loading) return <CiRequestSkeleton />;
    if (error) return <p className="ci-err">{error}</p>;
    if (!app) return null;

    const metrics = [
        {
            key: 'status', label: 'Request status', value: request ? 'Requested' : 'Not sent',
            sub: request ? whenOf(request.requested_at) : 'The AO has not sent it yet', tone: request ? 'info' : 'warn',
        },
        { key: 'people', label: 'Borrowers to check', value: built.people.length, sub: 'Subject, spouse, co-borrowers', tone: 'plain' },
        {
            key: 'missing', label: 'Missing values', value: missing.length,
            sub: missing.length ? 'Required for the request' : 'Nothing missing', tone: missing.length ? 'warn' : 'ok',
        },
        { key: 'amount', label: 'Loan amount', value: peso(built.loanAmount) ?? '—', sub: built.loanType ?? 'Loan type not set', tone: 'plain' },
    ];

    const missingNote = missing.length > 0 && (
        <p className="ci-warn" role="note">
            <Info size={16} aria-hidden="true" />
            <span>
                <b>{missing.length} required {missing.length === 1 ? 'value is' : 'values are'} missing.</b>{' '}
                The request can't be accommodated with missing values. The Account Officer corrects them in the loan folder;
                ask them in Messages.
            </span>
        </p>
    );
    const remarks = request && (
        <section className="lf-card" aria-label="Remarks">
            <div className="lf-cardhead"><h2>Remarks</h2></div>
            <div className="ci-cols">
                <Remark title="NFIS remarks" text={request.nfis_remarks} />
                <Remark title="TU remarks" text={request.tu_remarks} />
            </div>
        </section>
    );

    const current = stepParam ?? firstOpen;
    const at = STEP_KEYS.indexOf(current);
    const step = steps[at];
    const prev = steps[at - 1];
    const next = steps[at + 1];

    return (
        <div className="lf fp">
            <Breadcrumbs current="request" appId={app.id} appNo={app.application_no} />
            <header className="lf-card">
                <div className="lf-titlerow">
                    <div>
                        <h1><Term k="CI" /> request {app.application_no}</h1>
                        <ul className="lf-meta">
                            <li><Terms>NFIS and TransUnion inquiry details</Terms></li>
                            {request && <li>Requested by {requesterName ?? 'Account Officer'}</li>}
                        </ul>
                    </div>
                    <div className="lf-actions">
                        <MessagesPanel applicationId={app.id} inline />
                    </div>
                </div>

                <div className="fp-metrics">
                    {metrics.map((m) => (
                        <div key={m.key} className={`fp-metric ${m.tone}`}>
                            <span className="lbl">{m.label}</span>
                            <span className="val">{m.value}</span>
                            <span className="sub"><Terms text={m.sub} /></span>
                        </div>
                    ))}
                </div>

                {ready && <StepStrip steps={steps} openStep={current} />}

                {!request && (
                    <p className="lf-note">
                        <Info size={16} aria-hidden="true" />
                        <span><Terms>No CI request has been sent for this application yet.</Terms></span>
                    </p>
                )}
            </header>

            {working && !ready && <p className="ci-note" role="status"><Terms>Loading the CI results...</Terms></p>}

            {ready && step && (
                <section className="lf-card ci-panel" aria-labelledby="ci-panel-h">
                    <div className="ci-panel-head">
                        <p className="ci-panel-kicker">Step {at + 1} of {STEP_KEYS.length}</p>
                        <h2 id="ci-panel-h" tabIndex={-1}><Terms text={step.title} /></h2>
                        <p className="ci-panel-intro"><Terms text={STEP_INTRO[current]} /></p>
                    </div>

                    {current === 'request' && (
                        <div className="ci-request-body">
                            {missingNote}
                            <CiRequestForms app={app} idDetails={idDetails} />
                            {remarks}
                        </div>
                    )}
                    {/* Always mounted while working, so unsaved findings in step 4 survive a step change */}
                    <CiResultsEditor app={app} ciRequest={request} data={ciData} show={current === 'request' ? null : current}
                        onGoTo={openStep} onChanged={handleChanged} onDirtyChange={setDirty} />

                    <nav className="ci-panel-nav" aria-label="Step navigation">
                        {prev ? (
                            <button type="button" className="lf-btn quiet" title={tt(prev.title)} onClick={() => openStep(prev.key)}>
                                <ArrowLeft size={16} aria-hidden="true" />Back: {prev.title}
                            </button>
                        ) : <span />}
                        {next && (
                            <button type="button" className="lf-btn" title={tt(next.title)} onClick={() => openStep(next.key)}>
                                Next: {next.title}<ArrowRight size={16} aria-hidden="true" />
                            </button>
                        )}
                    </nav>
                </section>
            )}

            {!working && (
                <>
                    {missingNote}
                    <CiRequestForms app={app} idDetails={idDetails} />
                    {remarks}
                    {request && <CiResultsView app={app} />}
                </>
            )}
        </div>
    );
};

export default CiRequestPage;
