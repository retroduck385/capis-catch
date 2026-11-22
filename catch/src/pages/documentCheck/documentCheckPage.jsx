// Document check (Module 1, HITL): each uploaded ID / COE / ITR / payslip / bank statement shown next to what
// the AI read from it (ocr-service: PaddleOCR text -> Claude -> extraction_fields). The AI only proposes; the
// assigned AO checks every value against the document, picks what goes into the application, and confirms.
// Opened from the loan folder: /documentCheckPage?id=<application id>[&doc=<document id>]
// CI mode (&ci=1, "Open report" on the CI page): the NFIS / TU reports of each borrower instead, each next to ONE set
// of boxes for that borrower x check (ciRequest/ciReportForm.jsx): result, report date, summary, NFIS records or TU
// accounts. The Credit Investigator types them, or presses "Run AI" and the AI fills the same boxes for them to check
// (20261125_ci_ocr_opt_in.sql, 20261126_ci_facts.sql). Nothing is saved until the CI presses Save.
// Once every document here is confirmed, a banner points at the next step: the loan folder's KYC verification (AO)
// or the CI request's results + Mark CI Done (CI).
// Look (DESIGN.md, "Document check"): an .lf-folder page (panel, glass cards, tokens, dark mode) with a header, the
// borrowers as tabs, and a two-pane workspace (files + staff check + viewer | extracted values) of fixed height; each card scrolls inside itself.
// Styles: documentCheck.css.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
    AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Clock, Eye, FileText, Loader2, Lock, RotateCcw, ScanText, ShieldCheck, Sparkles, UserRound,
} from 'lucide-react';
import { UserAuth } from '../../context/authContext';
import { fetchApplication, getParties, one } from '../applicationForm/api';
import { formatDay, formatExact, fullWhen } from '../../components/people';
import { readingTime } from './duration';
import { isExpired } from './compare';
import { docHasProblem } from './severity';
import { joinAddress, presentAddressOf } from '../applicationForm/derived';
import { BORROWER_ROLES, REQUIREMENT_LABELS, partyLabel } from '../applicationForm/options';
import { fetchCiCanEdit, fetchCiResults } from '../ciRequest/api';
import { fetchCanEdit, fetchStaffNames } from '../loanFolder/api';
import { fetchDocumentChecks, fetchFieldDefs, requestCiRead, rerunExtraction, UNREADABLE_TEXT } from './api';
import DocumentViewer from './documentViewer';
import ExtractionPanel from './extractionPanel';
import ManualValuesCard from './manualValuesCard';
import CiReportForm from '../ciRequest/ciReportForm';
import { DocumentCheckSkeleton } from '../../components/skeleton';
import Breadcrumbs from '../../components/breadcrumbs';
import AskApplicantButton from '../documentRequests/ask';
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
// a failed read is an error (form red), "Ready to check" waits on the AO (amber), never a TAT colour.
// c = its loaded check (undefined while loading); a CI report with no OCR run was never sent to the AI (NOT_READ)
const docStatus = (c) => {
    if (c && c.ci && !c.ocr) return { key: 'NOT_READ', label: 'Not read by AI', tone: 'none', Icon: ScanText };
    const run = c?.run;
    if (run?.confirmed_at) return { key: 'CONFIRMED', label: 'Confirmed', tone: 'ok', Icon: CheckCircle2 };
    if (run?.status === 'DONE') return { key: 'READY', label: 'Ready to check', tone: 'warn', Icon: Eye };
    if (run && BUSY.includes(run.status)) return { key: 'AI', label: 'AI extracting...', tone: 'info', Icon: Loader2, spin: true };
    // FAILED is final: the worker already retried once (ocr-service/worker.py)
    if (run?.status === 'FAILED') return { key: 'AI_FAILED', label: 'Could not read file', tone: 'err', Icon: AlertTriangle };
    if (!c?.ocr || BUSY.includes(c.ocr.status)) return { key: 'OCR', label: 'Reading document...', tone: 'info', Icon: Loader2, spin: true };
    if (c.ocr.status === 'FAILED') return { key: 'OCR_FAILED', label: 'Could not read file', tone: 'err', Icon: AlertTriangle };
    return { key: 'WAITING', label: 'Waiting for AI', tone: 'none', Icon: Clock };
};
const stillWorking = (c) => ['OCR', 'AI', 'WAITING'].includes(docStatus(c).key);

// the narrow file list on desktop shows only the icon (documentCheck.css); the label stays for screen readers + hover
const StatusChip = ({ status }) => (
    <span className={`lf-chip dc-chip ${status.tone}`} title={status.label}>
        <status.Icon size={13} className={status.spin ? 'dc-spin' : undefined} aria-hidden="true" />
        <span className="dc-chip-txt">{status.label}</span>
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
    const [view, setView] = useState('current');   // 'current' files, or the 'earlier' versions a new upload replaced
    const [earlierId, setEarlierId] = useState(null);
    const [rerunning, setRerunning] = useState(false);
    const [reading, setReading] = useState(false);     // CI: "Run AI" being queued
    const [savedStamp, setSavedStamp] = useState(0);   // CI: bumped on each save, so the boxes start from what's saved
    const [loading, setLoading] = useState(true);
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
            // files a new upload replaced: not counted or confirmed here, but still openable
            earlier: ciMode ? [] : (party.application_requirements ?? []).flatMap((r) => r.earlier_documents ?? [])
                .filter((d) => types.has(d.document_type)).sort((a, b) => a.superseded_at.localeCompare(b.superseded_at)),
        }))
        .filter((p) => p.docs.length > 0), [app, types, ciMode, ciData.documents]);
    const docIds = useMemo(() => parties.flatMap((p) => p.docs.map((d) => d.id)), [parties]);

    const loadChecks = useCallback(async (ids) => {
        const next = await fetchDocumentChecks(ids, { ci: ciMode });
        if (ciMode) for (const c of Object.values(next)) c.ci = true;   // docStatus: no OCR run = not read (yet)
        setChecks(next);
        setNames(await fetchStaffNames(Object.values(next).map((c) => c.run?.confirmed_by)));
    }, [ciMode]);
    const loadCiData = useCallback(async (record) => {
        if (!ciMode) return;
        setCiData(await fetchCiResults(getParties(record, BORROWER_ROLES).map((p) => p.id)));
    }, [ciMode]);
    // CI mode: what is saved for one borrower x check (the boxes' starting point)
    const slotOf = (applicantId, checkType) => {
        const c = ciData.checks.find((x) => x.applicant_id === applicantId && x.check_type === checkType);
        return {
            result: c?.result ?? null, summary: c?.summary ?? '', report_date: c?.report_date ?? null,
            rows: (checkType === 'NFIS' ? ciData.nfisRecords : ciData.tuAccounts)?.filter((r) => r.applicant_id === applicantId) ?? [],
            values: (ciData.reportValues ?? []).filter((v) => v.applicant_id === applicantId && v.check_type === checkType),
            documents: ciData.documents.filter((d) => d.applicant_id === applicantId && d.check_type === checkType),
        };
    };
    const slotDone = (applicantId, checkType) => {
        const sl = slotOf(applicantId, checkType);
        return Boolean(sl.result && sl.report_date);
    };

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
    const showEarlier = view === 'earlier' && (selectedParty?.earlier.length ?? 0) > 0;
    const earlierDoc = showEarlier ? selectedParty.earlier.find((d) => d.id === earlierId) ?? selectedParty.earlier[0] : null;
    const viewDoc = showEarlier ? earlierDoc : doc;
    const check = doc ? checks[doc.id] : null;
    const took = readingTime(check);
    const status = docStatus(check);
    const unreadable = ['OCR_FAILED', 'AI_FAILED'].includes(status.key); // final: the worker already retried once
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

    // AO: documents confirmed. CI: each borrower's NFIS / TU filled in (result + report date saved), counted per report
    // kind, not per file (a report split into two files is one set of boxes)
    const slotsOf = (p) => [...new Set(p.docs.map((d) => d.check_type))].map((t) => ({ party: p.party, checkType: t }));
    const ciSlots = ciMode ? parties.flatMap(slotsOf) : [];
    const isConfirmed = (id) => Boolean(checks[id]?.run?.confirmed_at);
    const confirmedCount = ciMode ? ciSlots.filter((sl) => slotDone(sl.party.id, sl.checkType)).length
        : docIds.filter(isConfirmed).length;
    const totalCount = ciMode ? ciSlots.length : docIds.length;
    const allConfirmed = totalCount > 0 && confirmedCount === totalCount;
    const leaveEdits = () => !dirtyRef.current || window.confirm('Discard your unsaved changes on this document?');
    const guardLink = (e) => { if (!leaveEdits()) e.preventDefault(); };
    const openDoc = (id) => {
        // CI: another file of the same report keeps the same boxes, so nothing is lost
        const target = selectedParty?.docs.find((d) => d.id === id);
        const sameBoxes = ciMode && target && doc && target.check_type === doc.check_type;
        if (id === doc?.id || (!sameBoxes && !leaveEdits())) return;
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

    const handleRunAgain = async () => {
        if (!check?.ocr?.id || rerunning) return;
        setRerunning(true);
        try {
            await rerunExtraction(check.ocr.id);
            await loadChecks(docIds);
        } catch (err) {
            setError(err.message);
        } finally {
            setRerunning(false);
        }
    };

    // CI: "Run AI" on this report (also after a failed read); the page polls while it's being read
    const handleReadCi = async () => {
        if (!doc || reading) return;
        setReading(true);
        setError(null);
        try {
            await requestCiRead(doc.id);
            await loadChecks(docIds);
        } catch (err) {
            setError(err.message);
        } finally {
            setReading(false);
        }
    };

    const docDefs = doc ? defs.filter((d) => d.document_type === doc.document_type) : [];
    const highlights = (focused?.lines ?? []).map((l) => ({ id: l.id, page_no: l.page_no, bbox: l.bbox, text: l.text }));
    const backTo = ciMode && role === 'CREDIT_INVESTIGATOR'
        ? { to: `/ciRequestPage?id=${app.id}&step=reports`, label: 'CI request' }
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
                    <p className="dc-hitl">
                        <ShieldCheck size={15} aria-hidden="true" />
                        <span><Terms text={ciMode
                            ? 'Fill in the boxes from the report yourself, or press Run AI to have them filled for you to check. Nothing is saved to the CI results until a Credit Investigator presses Save. The application record is never changed here.'
                            : 'The AI only proposes values. Nothing in the application changes until the assigned Account Officer confirms.'} /></span>
                    </p>
                </div>
                <div className="lf-actions">
                    {docIds.length > 0 && (
                        <ul className="lf-meta dc-progress">
                            <li className={allConfirmed ? 'dc-meta-done' : undefined}>
                                <CheckCircle2 size={15} aria-hidden="true" />
                                <span><b>{confirmedCount}</b> of {totalCount} {ciMode ? 'reports filled in' : 'documents confirmed'}</span>
                            </li>
                        </ul>
                    )}
                    <Link to={backTo.to} className="lf-btn" onClick={guardLink}>
                        <ArrowLeft size={16} aria-hidden="true" />{backTo.label}
                    </Link>
                </div>
            </header>

            {error && <p className="lf-err" role="alert">{error}</p>}

            {/* Everything here is confirmed: point at the next step (CI: results + Mark CI Done; AO: KYC verification) */}
            {canEdit && allConfirmed && (
                <div role="status" className="dc-next">
                    <CheckCircle2 size={20} aria-hidden="true" />
                    <p>
                        <b><Terms text={ciMode ? 'Every NFIS and TU report is filled in.' : 'Every document is confirmed.'} /></b>{' '}
                        <Terms text={ciMode
                            ? 'Their results, report dates and rows are saved. Next: check the recap, add your overall remarks and Mark CI Done.'
                            : 'Next: KYC verification of each section in the loan folder.'} />
                    </p>
                    <Link to={ciMode ? `/ciRequestPage?id=${app.id}&step=send` : `/loanFolderPage?id=${app.id}`}
                        title={tt(ciMode ? 'Mark CI Done' : 'KYC verification')} onClick={guardLink} className="dc-next-go">
                        {ciMode ? 'Go to step 3: Check and send' : 'Go to step 2: KYC verification'}
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
                        {parties.map((pp) => {
                            const { party } = pp;
                            const docs = ciMode ? slotsOf(pp) : pp.docs;
                            const done = ciMode ? docs.filter((sl) => slotDone(party.id, sl.checkType)).length
                                : docs.filter((d) => isConfirmed(d.id)).length;
                            return (
                                <button key={party.id} type="button" onClick={() => openParty(party.id)}
                                    aria-current={party.id === selectedParty?.party.id ? 'true' : undefined}>
                                    <span className="dc-person" aria-hidden="true"><UserRound size={15} /></span>
                                    <span className="who">{nameOf(party)} <span className="role">· {partyLabel(party)}</span></span>
                                    <b className={done === docs.length ? 'all' : undefined}>
                                        {done}/{docs.length}<span className="sr-only"> {ciMode ? 'filled in' : 'confirmed'}</span>
                                    </b>
                                </button>
                            );
                        })}
                    </nav>

                    <div className="dc-work">
                        <section className="lf-card dc-pane dc-docs" aria-labelledby="dc-docs-title">
                            <div className="lf-cardhead">
                                <h2 id="dc-docs-title">{ciMode ? <><Term k="CI" /> reports</> : 'Documents'} for {nameOf(selectedParty.party)}</h2>
                                <span>{showEarlier ? selectedParty.earlier.length : selectedParty.docs.length}{' '}
                                    {(showEarlier ? selectedParty.earlier.length : selectedParty.docs.length) === 1 ? 'file' : 'files'}</span>
                            </div>
                            {selectedParty.earlier.length > 0 && (
                                <div className="dc-viewtabs" role="group" aria-label="Which files to show">
                                    <button type="button" aria-pressed={!showEarlier} onClick={() => setView('current')}>
                                        Current ({selectedParty.docs.length})
                                    </button>
                                    <button type="button" aria-pressed={showEarlier} onClick={() => { setView('earlier'); setPage(1); }}>
                                        Earlier versions ({selectedParty.earlier.length})
                                    </button>
                                </div>
                            )}
                            {showEarlier ? (
                                <>
                                    <ul className="dc-doclist">
                                        {selectedParty.earlier.map((d) => (
                                            <li key={d.id}>
                                                <button type="button" className="dc-doc" aria-current={d.id === earlierDoc.id ? 'true' : undefined}
                                                    onClick={() => { setEarlierId(d.id); setPage(1); }}>
                                                    <FileText size={18} className="ic" aria-hidden="true" />
                                                    <span className="txt">
                                                        <b>{docLabel(d.document_type)}</b>
                                                        <span className="file">{d.file_name}</span>
                                                        <span className="note">
                                                            Uploaded <time dateTime={d.uploaded_at} title={fullWhen(d.uploaded_at)}>{formatExact(d.uploaded_at)}</time>
                                                            {' · '}Replaced {formatDay(d.superseded_at)}{d.replaced_by ? ` by ${d.replaced_by.file_name}` : ''}
                                                        </span>
                                                    </span>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                </>
                            ) : (
                                <>
                            <ul className="dc-doclist">
                                {selectedParty.docs.map((d) => {
                                    const s = docStatus(checks[d.id]);
                                    const active = d.id === doc?.id;
                                    const problem = docHasProblem(checks[d.id], isExpired);
                                    return (
                                        <li key={d.id}>
                                            <button type="button" onClick={() => openDoc(d.id)} aria-current={active ? 'true' : undefined}
                                                className={`dc-doc ${s.tone}`} title={problem ? `${d.file_name}: the AI flagged a problem` : d.file_name}>
                                                <span className="ic-wrap">
                                                    <FileText size={18} className="ic" aria-hidden="true" />
                                                    {problem && <span className="dc-probdot" aria-hidden="true" />}
                                                </span>
                                                {problem && <span className="sr-only">The AI flagged a problem. </span>}
                                                <span className="txt">
                                                    <b>{docLabel(d.document_type)}</b>
                                                    <span className="note">
                                                        Uploaded <time dateTime={d.uploaded_at} title={fullWhen(d.uploaded_at)}>{formatExact(d.uploaded_at)}</time>
                                                    </span>
                                                </span>
                                                <StatusChip status={s} />
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                            {doc && !ciMode && (
                                <div className="dc-filemark">
                                    <FileMark key={`mark-${doc.id}`} applicationId={app.id} marks={marks} autoOpen={false}
                                        unreadable={unreadable} confirmLeave={leaveEdits}
                                        file={{ documentId: doc.id, applicantId: selectedParty.party.id, requirementType: doc.document_type, label: docLabel(doc.document_type) }} />
                                </div>
                            )}
                                </>
                            )}
                            {viewDoc && (
                                <div className="dc-viewer-wrap">
                                    {showEarlier
                                        ? <DocumentViewer key={viewDoc.id} doc={viewDoc} highlights={[]} page={page} onPageChange={setPage} />
                                        : <DocumentViewer key={viewDoc.id} doc={viewDoc} pageSizes={check?.pages} highlights={highlights}
                                            page={page} onPageChange={setPage} />}
                                </div>
                            )}
                        </section>

                        <section className="lf-card dc-pane dc-fields" aria-labelledby="dc-fields-title">
                            <div className="lf-cardhead">
                                <div className="dc-headleft">
                                    <h2 id="dc-fields-title">{ciMode && doc ? <Terms text={`${CI_LABELS[doc.document_type]?.split(' ')[0] ?? ''} results for ${nameOf(selectedParty.party)}`} /> : 'Extracted information'}</h2>
                                    {!showEarlier && took && (
                                        <span className="dc-took" title={`Took ${took}, from the start of the OCR to the end of the AI extraction`}>
                                            <Clock size={13} className="dc-took-ic" aria-hidden="true" />
                                            <span className="dc-took-word">Took </span>{took}
                                        </span>
                                    )}
                                </div>
                                {doc && !showEarlier && (
                                    <div className="dc-headright">
                                        <StatusChip status={status} />
                                        {!ciMode && check?.ocr?.status === 'DONE' && !['AI', 'WAITING'].includes(status.key) && (
                                            <button type="button" className="dc-rerun-btn" disabled={rerunning} onClick={handleRunAgain}
                                                title="Run again: queue a fresh AI extraction on the same OCR scan (testing)">
                                                <RotateCcw size={13} aria-hidden="true" className={rerunning ? 'dc-spin' : undefined} />
                                                <span className="dc-rerun-txt">{rerunning ? 'Queuing...' : 'Run again'}</span>
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                            {showEarlier ? (
                                <p className="lf-empty">
                                    This is an earlier version. A new file replaced it, so it is not counted or confirmed.
                                    Switch back to Current to read and confirm the files that count.
                                </p>
                            ) : !doc ? <p className="lf-empty">Pick a document on the left.</p>
                                : ciMode ? (
                                    <div className="dc-fields-body">
                                        <CiReportForm key={`${selectedParty.party.id}:${doc.check_type}:${savedStamp}`}
                                            party={selectedParty.party} checkType={doc.check_type}
                                            slot={slotOf(selectedParty.party.id, doc.check_type)} canEdit={canEdit}
                                            defs={defs} ctx={ctx}
                                            ai={{ status: status.key, check, fileName: doc.file_name }}
                                            running={reading} onRunAi={handleReadCi} onDirtyChange={setDirty}
                                            onSaved={async () => { await refreshAll(); setSavedStamp((n) => n + 1); }} />
                                    </div>
                                )
                                : status.key === 'READY' || status.key === 'CONFIRMED' ? (
                                    <div className="dc-fields-body">
                                        <ExtractionPanel key={`${check.run.id}-${check.run.confirmed_at ?? ''}`}
                                            doc={doc} defs={docDefs} check={check} ctx={ctx} canEdit={canEdit} names={names}
                                            focusedId={focused?.id} onFocusField={focusField} onConfirmed={refreshAll}
                                            onDirtyChange={setDirty} ci={ci} />
                                    </div>
                                ) : (
                                    <div className="dc-wait">
                                        <span className={`dc-wait-ic ${status.tone}`}>
                                            <status.Icon size={22} className={status.spin ? 'dc-spin' : undefined} aria-hidden="true" />
                                        </span>
                                        <p className="dc-wait-title">{unreadable ? (ciMode ? "We couldn't read this file." : UNREADABLE_TEXT) : status.label}</p>
                                        {status.key === 'NOT_READ' && (
                                            <p className="dc-muted">
                                                <Terms text="The AI reads a CI report only when you ask. It then drafts the values, the result and a summary for you to check. You can also choose the result and type the findings yourself on the CI request page." />
                                            </p>
                                        )}
                                        {status.key === 'NOT_READ' && canEdit && (
                                            <button type="button" className="lf-btn" disabled={reading} onClick={handleReadCi}>
                                                <Sparkles size={16} aria-hidden="true" />{reading ? 'Queuing...' : 'Run AI'}
                                            </button>
                                        )}
                                        {/* the worker already tried twice: the AO asks for a clearer copy, the CI uploads it again */}
                                        {unreadable && !ciMode && (
                                            <AskApplicantButton applicationId={app.id} confirmLeave={leaveEdits} plain className="lf-ask-btn"
                                                ask={{
                                                    items: [{ applicant_id: selectedParty.party.id, requirement_type: doc.document_type, label: docLabel(doc.document_type) }],
                                                    note: `We couldn't read the ${docLabel(doc.document_type)} you sent. Please upload a clearer copy.`,
                                                    from: `the Document check (${docLabel(doc.document_type)} could not be read)`,
                                                }}>
                                                Ask the applicant for a clearer copy
                                            </AskApplicantButton>
                                        )}
                                        {unreadable && ciMode && canEdit && (
                                            <>
                                                <button type="button" className="lf-btn" disabled={reading} onClick={handleReadCi}>
                                                    <RotateCcw size={16} aria-hidden="true" />{reading ? 'Queuing...' : 'Read again'}
                                                </button>
                                                <Link to={`/ciRequestPage?id=${app.id}&step=reports`} className="lf-btn" onClick={guardLink}>
                                                    Upload a clearer copy
                                                </Link>
                                            </>
                                        )}
                                        {unreadable && (
                                            <p className="dc-muted">Details: {(status.key === 'OCR_FAILED' ? check.ocr.error : check.run.error) || 'no error saved'}</p>
                                        )}
                                    </div>
                                )}
                        </section>
                    </div>
                </>
            )}

            {/* SPA, SEC / DTI / Mayor's permit and Other files: typed by hand, no AI (not for the CI's reports) */}
            {!ciMode && app && <ManualValuesCard app={app} />}
        </div>
    );
};

export default DocumentCheckPage;
