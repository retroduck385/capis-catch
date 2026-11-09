// Document check (Module 1, HITL): each uploaded ID / COE / ITR / payslip / bank statement shown next to what
// the AI read from it (ocr-service: PaddleOCR text -> Gemini -> extraction_fields). The AI only proposes; the
// assigned AO checks every value against the document, picks what goes into the application, and confirms.
// Opened from the loan folder: /documentCheckPage?id=<application id>[&doc=<document id>]
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { fetchApplication, getParties, one } from '../applicationForm/api';
import { joinAddress, presentAddressOf } from '../applicationForm/derived';
import { REQUIREMENT_LABELS, partyLabel } from '../applicationForm/options';
import { fetchCanEdit, fetchStaffNames } from '../loanFolder/api';
import { fetchDocumentChecks, fetchFieldDefs, requestExtraction } from './api';
import DocumentViewer from './documentViewer';
import ExtractionPanel from './extractionPanel';

const POLL_MS = 5000;
const TYPE_ORDER = ['VALID_ID_PASSPORT', 'COE_ITR', 'PAYSLIPS_REMITTANCES', 'FS_BANK_STATEMENTS'];
const BUSY = ['PENDING', 'RUNNING'];

// Where a document is in OCR -> AI -> AO confirmation
const docStatus = (c) => {
    const run = c?.run;
    if (run?.confirmed_at) return { key: 'CONFIRMED', label: 'Confirmed', tone: 'bg-green-100 text-green-800' };
    if (run?.status === 'DONE') return { key: 'READY', label: 'Ready to check', tone: 'bg-amber-100 text-amber-800' };
    if (run && BUSY.includes(run.status)) return { key: 'AI', label: 'AI extracting...', tone: 'bg-blue-100 text-blue-800' };
    if (run?.status === 'FAILED') return { key: 'AI_FAILED', label: 'AI extraction failed', tone: 'bg-red-100 text-red-800' };
    if (!c?.ocr || BUSY.includes(c.ocr.status)) return { key: 'OCR', label: 'Reading document...', tone: 'bg-blue-100 text-blue-800' };
    if (c.ocr.status === 'FAILED') return { key: 'OCR_FAILED', label: 'Could not read file', tone: 'bg-red-100 text-red-800' };
    return { key: 'WAITING', label: 'Waiting for AI', tone: 'bg-gray-100 text-gray-700' };
};
const stillWorking = (c) => ['OCR', 'AI', 'WAITING'].includes(docStatus(c).key);

const nameOf = (party) => [party.first_name, party.last_name].filter(Boolean).join(' ') || partyLabel(party);

const DocumentCheckPage = () => {
    const [searchParams] = useSearchParams();
    const applicationId = Number(searchParams.get('id'));
    const docParam = Number(searchParams.get('doc')) || null;

    const [app, setApp] = useState(null);
    const [canEdit, setCanEdit] = useState(false);
    const [defs, setDefs] = useState([]);
    const [checks, setChecks] = useState({});
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

    // Borrowers with at least one document the AI reads, and those documents (ID first, then income)
    const parties = useMemo(() => getParties(app ?? {})
        .map((party) => ({
            party,
            docs: (party.application_requirements ?? []).flatMap((r) => r.documents ?? [])
                .filter((d) => types.has(d.document_type))
                .sort((a, b) => TYPE_ORDER.indexOf(a.document_type) - TYPE_ORDER.indexOf(b.document_type)
                    || a.uploaded_at.localeCompare(b.uploaded_at)),
        }))
        .filter((p) => p.docs.length > 0), [app, types]);
    const docIds = useMemo(() => parties.flatMap((p) => p.docs.map((d) => d.id)), [parties]);

    const loadChecks = useCallback(async (ids) => {
        const next = await fetchDocumentChecks(ids);
        setChecks(next);
        setNames(await fetchStaffNames(Object.values(next).map((c) => c.run?.confirmed_by)));
    }, []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [data, editable, fieldDefs] = await Promise.all([
                    fetchApplication(applicationId), fetchCanEdit(applicationId), fetchFieldDefs()]);
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
    }, [applicationId]);

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

    if (loading) return <p className="p-4">Loading documents...</p>;
    if (!app) return <p className="p-4 text-red-600">{error ?? 'Application not found.'}</p>;

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
    } : null;

    const leaveEdits = () => !dirtyRef.current || window.confirm('Discard your unsaved changes on this document?');
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
        setApp(await fetchApplication(applicationId));  // confirm may have changed the record
        await loadChecks(docIds);
    };
    const rerun = async () => {
        if (!window.confirm('Run the AI on this document again? The current values and your unsaved edits are replaced by a new proposal.')) return;
        setBusy(true);
        setError(null);
        try {
            await requestExtraction(doc.id);
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
    const workerHint = 'This usually takes under a minute. If it stays here, the OCR worker (ocr-service) may not be running, or has no GEMINI_API_KEY.';

    return (
        <div className="min-h-screen lg:h-screen flex flex-col text-left">
            <header className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 border-b bg-white">
                <Link to={`/loanFolderPage?id=${app.id}`} className="border rounded px-3 py-1.5 text-sm"
                    onClick={(e) => { if (!leaveEdits()) e.preventDefault(); }}>
                    ← Back to loan folder
                </Link>
                <h2 className="text-xl font-semibold">Document check</h2>
                <span className="text-gray-600">Application {app.application_no}</span>
                <span className="lg:ml-auto text-xs text-gray-600 max-w-md">
                    The AI only proposes values. Nothing in the application changes until the assigned Account Officer confirms.
                </span>
            </header>

            {parties.length > 0 && (
                <nav className="flex gap-1 px-4 border-b bg-white overflow-x-auto">
                    {parties.map(({ party }) => (
                        <button key={party.id} type="button" onClick={() => openParty(party.id)}
                            className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 ${party.id === selectedParty?.party.id
                                ? 'border-blue-700 text-blue-800 font-semibold' : 'border-transparent text-gray-600'}`}>
                            {nameOf(party).toUpperCase()} <span className="font-normal">· {partyLabel(party)}</span>
                        </button>
                    ))}
                </nav>
            )}

            {error && <p className="px-4 pt-2 text-red-600">{error}</p>}

            {parties.length === 0 ? (
                <p className="p-4">No IDs, COE / ITR, payslips or bank statements have been uploaded for this application.</p>
            ) : (
                <div className="flex-1 lg:min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-4 p-4 bg-gray-50">
                    <section className="bg-white rounded-lg border p-3 flex flex-col h-[80vh] lg:h-auto lg:min-h-0">
                        <h3 className="font-semibold pb-2">Documents for {nameOf(selectedParty.party)}</h3>
                        <ul className="space-y-1 pb-3 max-h-48 overflow-auto">
                            {selectedParty.docs.map((d) => {
                                const s = docStatus(checks[d.id]);
                                const active = d.id === doc?.id;
                                return (
                                    <li key={d.id}>
                                        <button type="button" onClick={() => openDoc(d.id)}
                                            className={`w-full flex items-center gap-2 rounded px-3 py-2 text-left text-sm ${active
                                                ? 'bg-green-700 text-white' : 'bg-gray-50 hover:bg-gray-100 border'}`}>
                                            <span className="font-semibold">{REQUIREMENT_LABELS[d.document_type] ?? d.document_type}</span>
                                            <span className={`truncate flex-1 ${active ? 'text-green-50' : 'text-gray-600'}`}>{d.file_name}</span>
                                            <span className={`text-xs rounded-full px-2 py-0.5 whitespace-nowrap ${s.tone}`}>{s.label}</span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                        {doc && (
                            <div className="flex-1 min-h-0">
                                <DocumentViewer key={doc.id} doc={doc} pageSizes={check?.pages} highlights={highlights}
                                    page={page} onPageChange={setPage} />
                            </div>
                        )}
                    </section>

                    <section className="bg-white rounded-lg border p-3 flex flex-col h-[80vh] lg:h-auto lg:min-h-0">
                        <h3 className="font-semibold pb-2">Extracted information</h3>
                        {!doc ? <p>Pick a document on the left.</p>
                            : status.key === 'READY' || status.key === 'CONFIRMED' ? (
                                <div className="flex-1 min-h-0">
                                    <ExtractionPanel key={`${check.run.id}-${check.run.confirmed_at ?? ''}`}
                                        doc={doc} defs={docDefs} check={check} ctx={ctx} canEdit={canEdit} names={names}
                                        focusedId={focused?.id} onFocusField={focusField} onConfirmed={refreshAll}
                                        onRerun={rerun} onDirtyChange={setDirty} />
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <p><span className={`text-xs rounded-full px-2 py-0.5 ${status.tone}`}>{status.label}</span></p>
                                    {['OCR', 'AI', 'WAITING'].includes(status.key) && <p className="text-sm text-gray-600">{workerHint}</p>}
                                    {status.key === 'OCR_FAILED' && <p className="text-sm text-red-700">{check.ocr.error}</p>}
                                    {status.key === 'AI_FAILED' && <p className="text-sm text-red-700">{check.run.error}</p>}
                                    {canEdit && status.key === 'AI_FAILED' && (
                                        <button type="button" className="border rounded px-3 py-1.5 text-sm" disabled={busy} onClick={rerun}>
                                            {busy ? 'Queuing...' : 'Run AI again'}
                                        </button>
                                    )}
                                </div>
                            )}
                    </section>
                </div>
            )}
        </div>
    );
};

export default DocumentCheckPage;
