// Document check (Module 1, HITL): each uploaded ID / COE / ITR / payslip / bank statement shown next to what
// the AI read from it (ocr-service: PaddleOCR text -> Claude -> extraction_fields). The AI only proposes; the
// assigned AO checks every value against the document, picks what goes into the application, and confirms.
// Opened from the loan folder: /documentCheckPage?id=<application id>[&doc=<document id>]
// CI mode (&ci=1, opened from the CI page): the NFIS / TU reports of each borrower instead. A Credit Investigator
// checks the values and the AI's proposed result + summary, and confirms them into the CI results.
// Once every document here is confirmed, a banner points at the next step: the loan folder's KYC verification (AO)
// or the CI request's results + Mark CI Done (CI).
// Look (DESIGN.md, "Document check"): an .lf-folder page (panel, glass cards, tokens, dark mode) with a header, the
// borrowers as tabs, and a two-pane workspace (document + viewer | extracted values) that fills the screen on desktop.
// Styles: documentCheck.css.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
    AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Clock, Eye, FileText, Loader2, Lock, ScanText, ShieldCheck, UserRound,
} from 'lucide-react';
import { UserAuth } from '../../context/authContext';
import { fetchApplication, getParties, one } from '../applicationForm/api';
import { joinAddress, presentAddressOf } from '../applicationForm/derived';
import { BORROWER_ROLES, REQUIREMENT_LABELS, partyLabel } from '../applicationForm/options';
import { fetchCiCanEdit, fetchCiResults } from '../ciRequest/api';
import { fetchCanEdit, fetchStaffNames } from '../loanFolder/api';
import { fetchDocumentChecks, fetchFieldDefs, RERUN_HINT, requestCiExtraction, requestExtraction } from './api';
import DocumentViewer from './documentViewer';
import ExtractionPanel from './extractionPanel';
import { DocumentCheckSkeleton } from '../../components/skeleton';
import Breadcrumbs from '../../components/breadcrumbs';
import FileMark from '../documentRequests/fileMark';
import { useFileMarks } from '../documentRequests/useFileMarks';
import { Term, Terms } from '../../components/term';
import { useTermTitle } from '../../components/useTermTitle';
import '../loanFolder/loanFolder.css';
import './documentCheck.css';

const POLL_MS = 5000;
const TYPE_ORDER = ['VALID_ID_PASSPORT', 'COE_ITR', 'PAYSLIPS_REMITTANCES', 'FS_BANK_STATEMENTS', 'CI_NFIS', 'CI_TU'];
const CI_LABELS = { CI_NFIS: 'NFIS result', CI_TU: 'TU credit report' };
const docLabel = (type) => CI_LABELS[type] ?? REQUIREMENT_LABELS[type] ?? type;
const BUSY = ['PENDING', 'RUNNING'];

// Where a document is in OCR -> AI -> AO confirmation. tone: an .lf-chip tone (documentCheck.css adds info / err);
// a failed read is an error (form red), "Ready to check" waits on the AO (amber), never a TAT colour
const docStatus = (c) => {
    const run = c?.run;
    if (run?.confirmed_at) return { key: 'CONFIRMED', label: 'Confirmed', tone: 'ok', Icon: CheckCircle2 };
    if (run?.status === 'DONE') return { key: 'READY', label: 'Ready to check', tone: 'warn', Icon: Eye };
    if (run && BUSY.includes(run.status)) return { key: 'AI', label: 'AI extracting...', tone: 'info', Icon: Loader2, spin: true };
    if (run?.status === 'FAILED') return { key: 'AI_FAILED', label: 'AI extraction failed', tone: 'err', Icon: AlertTriangle };
    if (!c?.ocr || BUSY.includes(c.ocr.status)) return { key: 'OCR', label: 'Reading document...', tone: 'info', Icon: Loader2, spin: true };
    if (c.ocr.status === 'FAILED') return { key: 'OCR_FAILED', label: 'Could not read file', tone: 'err', Icon: AlertTriangle };
    return { key: 'WAITING', label: 'Waiting for AI', tone: 'none', Icon: Clock };
};
const stillWorking = (c) => ['OCR', 'AI', 'WAITING'].includes(docStatus(c).key);

const StatusChip = ({ status }) => (
    <span className={`lf-chip dc-chip ${status.tone}`}>
        <status.Icon size={13} className={status.spin ? 'dc-spin' : undefined} aria-hidden="true" />
        {status.label}
    </span>
);

const nameOf = (party) => [party.first_name, party.last_name].filter(Boolean).join(' ') || partyLabel(party);

const DocumentCheckPage = () => {
    const tt = useTermTitle();
    const [searchParams] = useSearchParams();
    const applicationId = Number(searchParams.get('id'));
    const docParam = Number(searchParams.get('doc')) || null;
    const ciMode = searchParams.get('ci') === '1';
    const { role } = UserAuth();

    const [app, setApp] = useState(null);
    const [canEdit, setCanEdit] = useState(false);
    const [defs, setDefs] = useState([]);
    const [checks, setChecks] = useState({});
    const [ciData, setCiData] = useState({ checks: [], documents: [] }); // CI mode: ci_checks + ci_documents
    const [names, setNames] = useState({});
    const [partyId, setPartyId] = useState(null);
    const [docId, setDocId] = useState(docParam);
    const [focused, setFocused] = useState(null);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const dirtyRef = useRef(false);
    const setDirty = useCallback((d) => { dirtyRef.current = d; }, []);

    const types = useMemo(() => new Set(defs.map((d) => d.document_type)), [defs]);
    // Staff check of each applicant file (Cleared / Needs a new copy); not for the CI's reports
    const marks = useFileMarks(ciMode ? null : applicationId);

    // Borrowers with at least one document the AI reads, and those documents (ID first, then income; NFIS, then TU)
    const parties = useMemo(() => getParties(app ?? {}, ciMode ? BORROWER_ROLES : undefined)
        .map((party) => ({
            party,
            docs: (ciMode
                ? ciData.documents.filter((d) => d.applicant_id === party.id)
                    .map((d) => ({ ...d, document_type: `CI_${d.check_type}` }))
                : (party.application_requirements ?? []).flatMap((r) => r.documents ?? []))
                .filter((d) => types.has(d.document_type))
                .sort((a, b) => TYPE_ORDER.indexOf(a.document_type) - TYPE_ORDER.indexOf(b.document_type)
                    || a.uploaded_at.localeCompare(b.uploaded_at)),
        }))
        .filter((p) => p.docs.length > 0), [app, types, ciMode, ciData.documents]);
    const docIds = useMemo(() => parties.flatMap((p) => p.docs.map((d) => d.id)), [parties]);

    const loadChecks = useCallback(async (ids) => {
        const next = await fetchDocumentChecks(ids, { ci: ciMode });
        setChecks(next);
        setNames(await fetchStaffNames(Object.values(next).map((c) => c.run?.confirmed_by)));
    }, [ciMode]);
    const loadCiData = useCallback(async (record) => {
        if (!ciMode) return;
        setCiData(await fetchCiResults(getParties(record, BORROWER_ROLES).map((p) => p.id)));
    }, [ciMode]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [data, editable, fieldDefs] = await Promise.all([
                    fetchApplication(applicationId),
                    ciMode ? fetchCiCanEdit(applicationId) : fetchCanEdit(applicationId),
                    fetchFieldDefs()]);
                if (cancelled) return;
                await loadCiData(data);
                if (cancelled) return;
                setApp(data);
                setCanEdit(editable);
                setDefs(fieldDefs);
            } catch (err) {
                if (!cancelled) setError(err.message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [applicationId, ciMode, loadCiData]);

    useEffect(() => {
        if (docIds.length === 0) return;
        const load = async () => {
            try {
                await loadChecks(docIds);
            } catch (err) {
                setError(err.message);
            }
        };
        load();
    }, [docIds, loadChecks]);

    // While OCR / AI is still working on something, check again every few seconds
    const working = docIds.some((id) => stillWorking(checks[id]));
    useEffect(() => {
        if (!working) return undefined;
        const timer = setTimeout(() => loadChecks(docIds).catch((err) => setError(err.message)), POLL_MS);
        return () => clearTimeout(timer);
    }, [working, checks, docIds, loadChecks]);

    useEffect(() => {
        const warn = (e) => {
            if (!dirtyRef.current) return;
            e.preventDefault();
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, []);

    if (loading) return <DocumentCheckSkeleton />;
    if (!app) {
        return (
            <div className="lf lf-folder lf-doccheck">
                <p className="lf-err" role="alert">{error ?? 'Application not found.'}</p>
            </div>
        );
    }

    const selectedParty = parties.find((p) => p.docs.some((d) => d.id === docId))
        ?? parties.find((p) => p.party.id === partyId) ?? parties[0] ?? null;
    const doc = selectedParty?.docs.find((d) => d.id === docId) ?? selectedParty?.docs[0] ?? null;
    const check = doc ? checks[doc.id] : null;
    const status = docStatus(check);
    const principal = getParties(app, ['PRINCIPAL'])[0] ?? null;
    const ctx = selectedParty ? {
        party: selectedParty.party,
        employment: one(selectedParty.party.employment_info),
        presentAddress: joinAddress(presentAddressOf(selectedParty.party, principal)),
        loanAmount: app.loan_amount ?? null,
    } : null;
    const ciCheckType = ciMode && doc ? doc.check_type : null;
    const ci = ciCheckType ? {
        check: ciData.checks.find((c) => c.applicant_id === selectedParty.party.id && c.check_type === ciCheckType) ?? null,
        label: `${ciCheckType} for ${nameOf(selectedParty.party)}`,
    } : null;

    const isConfirmed = (id) => Boolean(checks[id]?.run?.confirmed_at);
    const confirmedCount = docIds.filter(isConfirmed).length;
    const allConfirmed = docIds.length > 0 && confirmedCount === docIds.length;
    const leaveEdits = () => !dirtyRef.current || window.confirm('Discard your unsaved changes on this document?');
    const guardLink = (e) => { if (!leaveEdits()) e.preventDefault(); };
    const openDoc = (id) => {
        if (id === doc?.id || !leaveEdits()) return;
        setDocId(id);
        setFocused(null);
        setPage(1);
    };
    const openParty = (id) => {
        if (id === selectedParty?.party.id || !leaveEdits()) return;
        setPartyId(id);
        setDocId(null);
        setFocused(null);
        setPage(1);
    };
    const focusField = (field) => {
        setFocused(field);
        if (field.lines[0]) setPage(field.lines[0].page_no);
    };

    const refreshAll = async () => {
        const record = await fetchApplication(applicationId);  // confirm may have changed the record
        await loadCiData(record);                              // ...or the CI results
        setApp(record);
        await loadChecks(docIds);
    };
    const rerun = async () => {
        if (!window.confirm('Run the AI on this document again? The current values and your unsaved edits are replaced by a new proposal.')) return;
        setBusy(true);
        setError(null);
        try {
            await (ciMode ? requestCiExtraction(doc.id) : requestExtraction(doc.id));
            setDirty(false);
            setFocused(null);
            await loadChecks(docIds);
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const docDefs = doc ? defs.filter((d) => d.document_type === doc.document_type) : [];
    const highlights = (focused?.lines ?? []).map((l) => ({ id: l.id, page_no: l.page_no, bbox: l.bbox, text: l.text }));
    const workerHint = 'This usually takes under a minute. If it stays here, the OCR worker (ocr-service) may not be running, or has no ANTHROPIC_API_KEY.';
    const backTo = ciMode && role === 'CREDIT_INVESTIGATOR'
        ? { to: `/ciRequestPage?id=${app.id}&step=ai`, label: 'CI request' }
        : { to: `/loanFolderPage?id=${app.id}`, label: 'Loan folder' };

    return (
        <div className="lf lf-folder lf-doccheck">
            <Breadcrumbs current={ciMode ? 'cidocs' : 'docs'} appId={app.id} appNo={app.application_no} onNavigate={guardLink} />
            <header className="lf-hero">
                <div className="lf-hero-main">
                    <p className="lf-eyebrow">
                        <ScanText size={15} aria-hidden="true" />
                        {ciMode ? <><Term k="CI" />&nbsp;report check</> : 'Document check (AI)'}
                        <span className={`lf-mode ${canEdit ? 'edit' : 'read'}`}>
                            {canEdit
                                ? <><ShieldCheck size={13} aria-hidden="true" />You confirm</>
                                : <><Lock size={13} aria-hidden="true" />Read-only</>}
                        </span>
                    </p>
                    <h1>Application <span className="lf-appno">{app.application_no}</span></h1>
                    {docIds.length > 0 && (
                        <ul className="lf-meta">
                            <li className={allConfirmed ? 'dc-meta-done' : undefined}>
                                <CheckCircle2 size={15} aria-hidden="true" />
                                <span><b>{confirmedCount}</b> of {docIds.length} {ciMode ? 'reports' : 'documents'} confirmed</span>
                            </li>
                        </ul>
                    )}
                </div>
                <div className="lf-actions">
                    <Link to={backTo.to} className="lf-btn" onClick={guardLink}>
                        <ArrowLeft size={16} aria-hidden="true" />{backTo.label}
                    </Link>
                </div>
            </header>
            <p className="lf-note">
                <ShieldCheck size={16} aria-hidden="true" />
                <span><Terms text={ciMode
                    ? 'The AI only proposes values and a draft result. Nothing is saved to the CI results until a Credit Investigator confirms. The application record is never changed here.'
                    : 'The AI only proposes values. Nothing in the application changes until the assigned Account Officer confirms.'} /></span>
            </p>

            {error && <p className="lf-err" role="alert">{error}</p>}

            {/* Everything here is confirmed: point at the next step (CI: results + Mark CI Done; AO: KYC verification) */}
            {canEdit && allConfirmed && (
                <div role="status" className="dc-next">
                    <CheckCircle2 size={20} aria-hidden="true" />
                    <p>
                        <b><Terms text={ciMode ? 'Every NFIS and TU report is confirmed.' : 'Every document is confirmed.'} /></b>{' '}
                        <Terms text={ciMode
                            ? 'Next: review the results, add BRAS if you have it, save, then Mark CI Done.'
                            : 'Next: KYC verification of each section in the loan folder.'} />
                    </p>
                    <Link to={ciMode ? `/ciRequestPage?id=${app.id}&step=results` : `/loanFolderPage?id=${app.id}`}
                        title={tt(ciMode ? 'Mark CI Done' : 'KYC verification')} onClick={guardLink} className="dc-next-go">
                        {ciMode ? 'Go to step 4: Results' : 'Go to step 2: KYC verification'}
                        <ArrowRight size={16} aria-hidden="true" />
                    </Link>
                </div>
            )}

            {parties.length === 0 ? (
                <section className="lf-card dc-empty">
                    <FileText size={22} aria-hidden="true" />
                    <p><Terms text={ciMode
                        ? 'No NFIS or TU reports have been uploaded for this application yet. Upload them on the CI request page.'
                        : 'No IDs, COE / ITR, payslips or bank statements have been uploaded for this application.'} /></p>
                </section>
            ) : (
                <>
                    {/* the borrowers, each with how many of their files are confirmed */}
                    <nav className="lf-tabs dc-people" aria-label="Borrowers">
                        {parties.map(({ party, docs }) => {
                            const done = docs.filter((d) => isConfirmed(d.id)).length;
                            return (
                                <button key={party.id} type="button" onClick={() => openParty(party.id)}
                                    aria-current={party.id === selectedParty?.party.id ? 'true' : undefined}>
                                    <span className="dc-person" aria-hidden="true"><UserRound size={15} /></span>
                                    <span className="who">{nameOf(party)} <span className="role">· {partyLabel(party)}</span></span>
                                    <b className={done === docs.length ? 'all' : undefined}>
                                        {done}/{docs.length}<span className="sr-only"> confirmed</span>
                                    </b>
                                </button>
                            );
                        })}
                    </nav>

                    <div className="dc-work">
                        <section className="lf-card dc-pane dc-docs" aria-labelledby="dc-docs-title">
                            <div className="lf-cardhead">
                                <h2 id="dc-docs-title">{ciMode ? <><Term k="CI" /> reports</> : 'Documents'} for {nameOf(selectedParty.party)}</h2>
                                <span>{selectedParty.docs.length} {selectedParty.docs.length === 1 ? 'file' : 'files'}</span>
                            </div>
                            <ul className="dc-doclist">
                                {selectedParty.docs.map((d) => {
                                    const s = docStatus(checks[d.id]);
                                    const active = d.id === doc?.id;
                                    return (
                                        <li key={d.id}>
                                            <button type="button" onClick={() => openDoc(d.id)} aria-current={active ? 'true' : undefined}
                                                className={`dc-doc ${s.tone}`}>
                                                <FileText size={18} className="ic" aria-hidden="true" />
                                                <span className="txt">
                                                    <b>{docLabel(d.document_type)}</b>
                                                    <span className="file">{d.file_name}</span>
                                                </span>
                                                <StatusChip status={s} />
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                            {doc && !ciMode && (
                                <div className="dc-filemark">
                                    <FileMark key={`mark-${doc.id}`} applicationId={app.id} marks={marks}
                                        unreadable={status.key === 'OCR_FAILED'} confirmLeave={leaveEdits}
                                        file={{ documentId: doc.id, applicantId: selectedParty.party.id, requirementType: doc.document_type, label: docLabel(doc.document_type) }} />
                                </div>
                            )}
                            {doc && (
                                <div className="dc-viewer-wrap">
                                    <DocumentViewer key={doc.id} doc={doc} pageSizes={check?.pages} highlights={highlights}
                                        page={page} onPageChange={setPage} />
                                </div>
                            )}
                        </section>

                        <section className="lf-card dc-pane dc-fields" aria-labelledby="dc-fields-title">
                            <div className="lf-cardhead">
                                <h2 id="dc-fields-title">Extracted information</h2>
                                {doc && <StatusChip status={status} />}
                            </div>
                            {!doc ? <p className="lf-empty">Pick a document on the left.</p>
                                : status.key === 'READY' || status.key === 'CONFIRMED' ? (
                                    <div className="dc-fields-body">
                                        <ExtractionPanel key={`${check.run.id}-${check.run.confirmed_at ?? ''}`}
                                            doc={doc} defs={docDefs} check={check} ctx={ctx} canEdit={canEdit} names={names}
                                            focusedId={focused?.id} onFocusField={focusField} onConfirmed={refreshAll}
                                            onRerun={rerun} onDirtyChange={setDirty} ci={ci} />
                                    </div>
                                ) : (
                                    <div className="dc-wait">
                                        <span className={`dc-wait-ic ${status.tone}`}>
                                            <status.Icon size={22} className={status.spin ? 'dc-spin' : undefined} aria-hidden="true" />
                                        </span>
                                        <p className="dc-wait-title">{status.label}</p>
                                        {['OCR', 'AI', 'WAITING'].includes(status.key) && <p className="dc-muted"><Terms text={workerHint} /></p>}
                                        {status.key === 'OCR_FAILED' && <p className="lf-err">{check.ocr.error}</p>}
                                        {status.key === 'AI_FAILED' && <p className="lf-err">{check.run.error}</p>}
                                        {canEdit && status.key === 'AI_FAILED' && (
                                            <>
                                                <button type="button" className="lf-btn" disabled={busy} onClick={rerun}>
                                                    {busy ? 'Queuing...' : 'Run AI again'}
                                                </button>
                                                <p className="dc-muted">{RERUN_HINT}</p>
                                            </>
                                        )}
                                    </div>
                                )}
                        </section>
                    </div>
                </>
            )}
        </div>
    );
};

export default DocumentCheckPage;
