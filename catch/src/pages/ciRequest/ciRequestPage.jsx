// One CI request, opened from the Credit Investigator's work tray: the NFIS and TU request forms and the AO's
// remarks (view only), then the CI results: upload the reports, record results + summaries, Mark CI Done.
// Any active CI can work it while the application is in Credit Investigation; afterwards it's read-only.
// While the CI can edit, the work is three step subpages of this page (components/stepStrip.jsx as tabs), one shown
// at a time, with Back / Next at the bottom. The step is in the URL (&step=request|reports|send), so the browser's
// Back button and links (e.g. the document check's "Go to step 3") work:
//   1. Review the request (forms + AO remarks)
//   2. Reports and results: per borrower x check, upload the report, open its OCR extraction on
//      /documentCheckPage?ci=1 (optional; confirming there fills in the result + summary), choose the result, Save
//   3. Check and send: a recap of the saved results, overall remarks, flag findings, Mark CI Done
// Opened without &step (e.g. from the work tray), the page always starts on the first step, done or not.
// Look (DESIGN.md, "CI request"): an .lf-folder page like the loan folder and document check: header with a mode tag
// and fact chips, the steps as glass step cards, then one step panel with its own progress chip and Back / Next.
// Styles: ciRequest.css (.lf-ci block).
import { CiRequestSkeleton } from '../../components/skeleton';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, ClipboardCheck, ClipboardList, FileText, Info, Lock, PenLine, SearchCheck,
    Send, Users, Wallet,
} from 'lucide-react';
import Breadcrumbs from '../../components/breadcrumbs';
import Byline from '../../components/byline';
import StepStrip from '../../components/stepStrip';
import { fetchApplication } from '../applicationForm/api';
import { fetchStaffNames } from '../loanFolder/api';
import { fetchCiCanEdit, fetchCiRequests } from './api';
import { buildCiRequest, missingFields, peso } from './buildRequest';
import CiRequestForms from './ciRequestForms';
import useIdDetails from './useIdDetails';
import { CiResultsEditor, CiResultsView } from './ciResults';
import { REQUIRED_CHECKS, keyOf, missingItems, useCiResults } from './ciResultsData';
import MessagesPanel from '../messages/messagesPanel';
import '../loanFolder/loanFolder.css';
import './ciRequest.css';
import { Term, Terms } from '../../components/term';
import { useTermTitle } from '../../components/useTermTitle';

const STEP_KEYS = ['request', 'reports', 'send'];
const STEP_ICONS = { request: ClipboardList, reports: FileText, send: ClipboardCheck };
const STEP_INTRO = {
    request: 'What the Account Officer is asking you to check, built from the application.',
    reports: 'For each borrower and report: upload it, check its OCR extraction if you like, then record the result and summary.',
    send: 'Check every result, add your overall remarks, flag any findings, then send the file to Credit Evaluation.',
};

const Remark = ({ title, text }) => (
    <div className="ci-remark-box">
        <p className="ci-remark-label"><Terms text={title} /></p>
        <p className={`ci-remark${text ? '' : ' empty'}`}>{text || 'No remarks.'}</p>
    </div>
);

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// The CI's three steps, from the saved CI rows (data), the request's missing values and unsaved edits.
// chip: the step panel's progress chip (an .lf-chip tone: ok when complete, warn when it needs a look, none otherwise)
const ciSteps = ({ data, missing, dirty, onOpen }) => {
    const slots = data.borrowers.flatMap((p) => REQUIRED_CHECKS.map((c) => data.byKey[keyOf(p.id, c.value)]));
    const total = slots.length;
    const uploaded = slots.filter((s) => s?.documents?.length).length;
    const complete = slots.filter((s) => s?.documents?.length && s?.result).length;
    const stillNeeded = missingItems(data.borrowers, data.byKey).length;

    let reportsText = stillNeeded ? `${complete} of ${total} required reports done` : 'Every required report and result is in';
    let reportsChip = stillNeeded ? { label: `${plural(stillNeeded, 'item')} still needed`, tone: 'warn' } : { label: 'All required in', tone: 'ok' };
    if (dirty) {
        reportsText = 'Unsaved changes';
        reportsChip = { label: 'Unsaved changes', tone: 'warn' };
    }

    return [
        {
            key: 'request', title: 'Review the request',
            text: missing.length ? `${plural(missing.length, 'missing value')}: ask the AO` : 'Forms and AO remarks · nothing missing',
            done: missing.length === 0 || uploaded > 0,
            chip: missing.length ? { label: plural(missing.length, 'missing value'), tone: 'warn' } : { label: 'Nothing missing', tone: 'ok' },
        },
        {
            key: 'reports', title: 'Reports and results', text: reportsText,
            done: total > 0 && stillNeeded === 0, meter: { value: complete, max: total }, chip: reportsChip,
        },
        {
            key: 'send', title: 'Check and send', text: stillNeeded ? 'Mark CI Done once the reports are in' : 'Ready: Mark CI Done',
            done: false, chip: stillNeeded ? { label: 'Not ready yet', tone: 'none' } : { label: 'Ready to send', tone: 'ok' },
        },
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

    // Open a step: a new history entry, so the browser's Back goes to the previous step. Focus its heading, or the
    // card the recap's "Edit" points at (after the step has rendered).
    const openStep = useCallback((key, { replace = false, focus = true, target = null } = {}) => {
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.set('step', key);
            return next;
        }, { replace });
        if (!focus) return;
        setTimeout(() => {
            const card = target && document.getElementById(target);
            if (card) {
                card.scrollIntoView({ block: 'start' });
                card.focus({ preventScroll: true });
            } else {
                document.getElementById('ci-panel-h')?.focus();
            }
        }, 60);
    }, [setSearchParams]);
    const goTo = useCallback((key, target) => openStep(key, { target }), [openStep]);

    // Opened without a step: start on the first one, even when it is done (fixed in the URL, so it doesn't move on by itself)
    const steps = ready ? ciSteps({ data: ciData, missing, dirty, onOpen: openStep }) : [];
    const firstOpen = STEP_KEYS[0];
    useEffect(() => {
        if (ready && !stepParam) openStep(firstOpen, { replace: true, focus: false });
    }, [ready, stepParam, firstOpen, openStep]);

    if (loading) return <CiRequestSkeleton />;
    if (error || !app) {
        return (
            <div className="lf lf-folder lf-ci">
                <p className="lf-err" role="alert">{error ?? 'Application not found.'}</p>
            </div>
        );
    }

    const missingNote = missing.length > 0 ? (
        <p className="ci-warn" role="note">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>
                <b>{missing.length} required {missing.length === 1 ? 'value is' : 'values are'} missing.</b>{' '}
                The request can't be accommodated with missing values. The Account Officer corrects them in the loan folder;
                ask them in Messages.
            </span>
        </p>
    ) : null;
    const remarks = request && (
        <section className="lf-card ci-remarks" aria-labelledby="ci-remarks-h">
            <div className="lf-cardhead">
                <h2 id="ci-remarks-h">Remarks from the Account Officer</h2>
                <span>Sent with the request</span>
            </div>
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
    const StepIcon = STEP_ICONS[current];

    return (
        <div className="lf lf-folder lf-ci">
            <Breadcrumbs current="request" appId={app.id} appNo={app.application_no} />
            <header className="lf-hero">
                <div className="lf-hero-main">
                    <p className="lf-eyebrow">
                        <SearchCheck size={15} aria-hidden="true" />
                        <span><Term k="CI" /> request</span>
                        <span className={`lf-mode ${working ? 'edit' : 'read'}`}>
                            {working
                                ? <><PenLine size={13} aria-hidden="true" />You can edit</>
                                : <><Lock size={13} aria-hidden="true" />Read-only</>}
                        </span>
                    </p>
                    <h1>Application <span className="lf-appno">{app.application_no}</span></h1>
                    <ul className="lf-meta">
                        {request && (
                            <li>
                                <Send size={15} aria-hidden="true" />
                                <span className="k">Requested</span>
                                <Byline layout="inline" name={requesterName} fallback="Account Officer" at={request.requested_at} />
                            </li>
                        )}
                        <li>
                            <Users size={15} aria-hidden="true" />
                            <span className="k">Borrowers</span>
                            <span className="v">{built.people.length}</span>
                        </li>
                        <li>
                            <Wallet size={15} aria-hidden="true" />
                            <span className="k">{built.loanType ?? 'Loan amount'}</span>
                            <span className="v">{peso(built.loanAmount) ?? '—'}</span>
                        </li>
                        {missing.length > 0 && (
                            <li className="ci-meta-warn">
                                <AlertTriangle size={15} aria-hidden="true" />
                                <span className="v">{missing.length}</span>
                                <span className="k">{missing.length === 1 ? 'missing value' : 'missing values'}</span>
                            </li>
                        )}
                    </ul>
                </div>
                <div className="lf-actions">
                    <MessagesPanel applicationId={app.id} inline />
                </div>
            </header>

            {!request && (
                <p className="lf-note">
                    <Info size={16} aria-hidden="true" />
                    <span><Terms>No CI request has been sent for this application yet.</Terms></span>
                </p>
            )}

            {working && !ready && <p className="lf-note" role="status"><Info size={16} aria-hidden="true" /><span><Terms>Loading the CI results...</Terms></span></p>}

            {ready && (
                <section className="lf-card lf-stepcard" aria-label="Your steps">
                    <StepStrip steps={steps} openStep={current} />
                </section>
            )}

            {ready && step && (
                <section className="lf-card ci-panel" aria-labelledby="ci-panel-h">
                    <header className="ci-panel-head">
                        <span className="ci-panel-ic" aria-hidden="true"><StepIcon size={20} /></span>
                        <div className="ci-panel-title">
                            <p className="ci-panel-kicker">Step {at + 1} of {STEP_KEYS.length}</p>
                            <h2 id="ci-panel-h" tabIndex={-1}><Terms text={step.title} /></h2>
                            <p className="ci-panel-intro"><Terms text={STEP_INTRO[current]} /></p>
                        </div>
                        {step.chip && <span className={`lf-chip ${step.chip.tone}`}>{step.chip.label}</span>}
                    </header>

                    {current === 'request' && (
                        <div className="ci-step ci-request-body">
                            {missingNote ?? (
                                <p className="lf-note">
                                    <CheckCircle2 size={16} aria-hidden="true" />
                                    <span>Everything the forms need is filled in.</span>
                                </p>
                            )}
                            {remarks}
                            <CiRequestForms app={app} idDetails={idDetails} />
                        </div>
                    )}
                    {/* Always mounted while working, so unsaved findings in step 4 survive a step change */}
                    <CiResultsEditor app={app} ciRequest={request} data={ciData} show={current === 'request' ? null : current}
                        onGoTo={goTo} onChanged={handleChanged} onDirtyChange={setDirty} />

                    <nav className="ci-panel-nav" aria-label="Step navigation">
                        {prev ? (
                            <button type="button" className="lf-btn quiet ci-prev" title={tt(prev.title)} onClick={() => openStep(prev.key)}>
                                <ArrowLeft size={16} aria-hidden="true" />Back: {prev.title}
                            </button>
                        ) : <span />}
                        {next && (
                            <button type="button" className="ci-go" title={tt(next.title)} onClick={() => openStep(next.key)}>
                                Next: {next.title}<ArrowRight size={16} aria-hidden="true" />
                            </button>
                        )}
                    </nav>
                </section>
            )}

            {!working && (
                <>
                    {missingNote}
                    {remarks}
                    <CiRequestForms app={app} idDetails={idDetails} />
                    {request && (
                        <section className="lf-card lf-ciresults" aria-labelledby="ci-results-h">
                            <div className="lf-cardhead">
                                <h2 id="ci-results-h"><Term k="CI" /> results</h2>
                                <span>From the Credit Investigator</span>
                            </div>
                            <CiResultsView app={app} title={null} />
                        </section>
                    )}
                </>
            )}
        </div>
    );
};

export default CiRequestPage;
